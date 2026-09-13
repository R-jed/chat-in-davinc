/**
 * Decision-only browser outbox mechanically derived from Chat On Steroids
 * `src/main/session/input.ts` purpose=`decision` paths.
 *
 * CID keeps its existing Session authority. This module owns only the durable helper-message
 * transport needed by canonical Goal/Loop decisions.
 */
import { randomUUID } from 'node:crypto';
import { readDurable, writeDurableNow } from '../../main/durable.js';

const STATE = 'cos-decision-inputs';
const VERSION = 1;
const MAX_ACTIVE = 4;
const MAX_ROWS = 200;
const MAX_PROMPT_CHARS = 120_000;

export type DecisionInputState = 'queued' | 'browser' | 'decision' | 'sent' | 'cancelled' | 'failed';

export interface DecisionInputEntry {
  id: string;
  text: string;
  state: DecisionInputState;
  owner: string | null;
  conversationId: string | null;
  decisionSourceSessionId: string | null;
  lifetime?: 'temporary-planner';
  model: string;
  reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  createdAt: number;
  offeredAt?: number;
  sendAuthorizedAt?: number;
  deliveredAt?: number;
  messageId?: string;
  response?: string;
  error?: string;
}

interface Snapshot { version: 1; savedAt: number; entries: DecisionInputEntry[] }
interface Waiter {
  resolve: (text: string) => void;
  reject: (reason: unknown) => void;
  publish?: (text: string) => void;
}

let entries: DecisionInputEntry[] = [];
let initialized = false;
let chain: Promise<unknown> = Promise.resolve();
const waiters = new Map<string, Waiter>();
let wakeDecision: (() => void | Promise<void>) | null = null;

function terminal(entry: DecisionInputEntry): boolean {
  return entry.state === 'sent' || entry.state === 'cancelled' || entry.state === 'failed';
}

function serial<T>(work: () => Promise<T>): Promise<T> {
  const result = chain.then(work, work);
  chain = result.catch(() => undefined);
  return result;
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9-]{36}$/i.test(value);
}

function validConversation(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-z-]{8,256}$/i.test(value);
}

function clean(raw: unknown): DecisionInputEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Partial<DecisionInputEntry>;
  if (!validId(row.id) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > MAX_PROMPT_CHARS) return null;
  if (!['queued', 'browser', 'decision', 'sent', 'cancelled', 'failed'].includes(String(row.state))) return null;
  const source = typeof row.decisionSourceSessionId === 'string' && row.decisionSourceSessionId.length <= 128
    ? row.decisionSourceSessionId : null;
  const conversationId = row.conversationId === null || row.conversationId === undefined
    ? null : validConversation(row.conversationId) ? row.conversationId : null;
  return {
    id: row.id,
    text: row.text,
    state: row.state as DecisionInputState,
    owner: typeof row.owner === 'string' && row.owner.length <= 160 ? row.owner : null,
    conversationId,
    decisionSourceSessionId: source,
    ...(row.lifetime === 'temporary-planner' ? { lifetime: 'temporary-planner' as const } : {}),
    model: typeof row.model === 'string' && row.model ? row.model.slice(0, 200) : 'gpt-5.6-sol',
    reasoningEffort: row.reasoningEffort === 'none' || row.reasoningEffort === 'low' || row.reasoningEffort === 'medium' || row.reasoningEffort === 'high'
      ? row.reasoningEffort : 'high',
    createdAt: Number.isFinite(row.createdAt) ? Number(row.createdAt) : Date.now(),
    ...(Number.isFinite(row.offeredAt) ? { offeredAt: Number(row.offeredAt) } : {}),
    ...(Number.isFinite(row.sendAuthorizedAt) ? { sendAuthorizedAt: Number(row.sendAuthorizedAt) } : {}),
    ...(Number.isFinite(row.deliveredAt) ? { deliveredAt: Number(row.deliveredAt) } : {}),
    ...(typeof row.messageId === 'string' ? { messageId: row.messageId.slice(0, 300) } : {}),
    ...(typeof row.response === 'string' && row.response.length <= 16_000 ? { response: row.response } : {}),
    ...(typeof row.error === 'string' ? { error: row.error.slice(0, 200) } : {})
  };
}

function snapshot(next = entries): Snapshot {
  return {
    version: VERSION,
    savedAt: Date.now(),
    entries: next.slice(-MAX_ROWS).map((entry) => entry.lifetime === 'temporary-planner'
      ? { ...entry, text: '[Temporary planner]', response: undefined }
      : { ...entry })
  };
}

async function commit(next: DecisionInputEntry[]): Promise<void> {
  const bounded = next.slice(-MAX_ROWS);
  await writeDurableNow(STATE, snapshot(bounded));
  entries = bounded;
}

export function configureDecisionInputWake(wake: (() => void | Promise<void>) | null): void {
  wakeDecision = wake;
}

/** Restart cannot prove whether an in-flight helper send crossed ChatGPT's native Send boundary. */
export async function initDecisionInputTransport(): Promise<void> {
  if (initialized) return;
  const saved = await readDurable<Snapshot>(STATE);
  const restored = saved?.version === VERSION && Array.isArray(saved.entries)
    ? saved.entries.map(clean).filter((entry): entry is DecisionInputEntry => Boolean(entry)).slice(-MAX_ROWS)
    : [];
  const recovered = restored.map((entry) => terminal(entry) ? entry : { ...entry, state: 'cancelled' as const });
  entries = restored;
  if (recovered.some((entry, index) => entry !== restored[index])) await commit(recovered);
  else entries = recovered;
  initialized = true;
}

export function listDecisionInputs(): DecisionInputEntry[] {
  if (!initialized) throw new Error('COS decision input transport is not initialized');
  return entries.map((entry) => ({ ...entry }));
}

export function pendingBrowserDecisions(): Array<{ id: string; conversationId: string | null; lifetime?: 'temporary-planner' }> {
  return entries
    .filter((entry) => entry.state === 'queued' || (entry.state === 'browser' && entry.sendAuthorizedAt === undefined))
    .map((entry) => ({ id: entry.id, conversationId: entry.conversationId, ...(entry.lifetime ? { lifetime: entry.lifetime } : {}) }));
}

export function pausedBrowserHelpers(): Array<{ id: string; sourceSessionId: string }> {
  return entries
    .filter((entry) => entry.state === 'cancelled' && !entry.conversationId && Boolean(entry.decisionSourceSessionId))
    .map((entry) => ({ id: entry.id, sourceSessionId: entry.decisionSourceSessionId! }));
}

export function claimBrowserDecision(
  id: string,
  owner: string,
  conversationId: string | null,
  requiresAuthorization = false
): Promise<DecisionInputEntry | null> {
  return serial(async () => {
    if (!owner || owner.length > 160 || !validId(id)) return null;
    const row = entries.find((entry) => entry.id === id);
    if (!row || !waiters.has(id) || (row.state !== 'queued' && !(row.state === 'browser' && requiresAuthorization))) return null;
    if (row.conversationId !== conversationId) return null;
    if (row.state === 'browser' && !requiresAuthorization) return null;
    const claimed: DecisionInputEntry = {
      ...row,
      state: 'browser',
      owner,
      offeredAt: row.offeredAt ?? Date.now(),
      ...(requiresAuthorization ? {} : { sendAuthorizedAt: row.sendAuthorizedAt })
    };
    await commit(entries.map((entry) => entry === row ? claimed : entry));
    return { ...claimed };
  });
}

/** Revalidates the exact durable claim immediately before native Send. */
export function authorizeBrowserDecision(id: string, owner: string, conversationId: string | null): Promise<boolean> {
  return serial(async () => {
    const row = entries.find((entry) => entry.id === id && entry.owner === owner && entry.state === 'browser' && entry.conversationId === conversationId);
    if (!row || row.sendAuthorizedAt !== undefined || !waiters.has(id)) return false;
    const next = { ...row, sendAuthorizedAt: Date.now() };
    await commit(entries.map((entry) => entry === row ? next : entry));
    return true;
  });
}

/** Native-send ACK changes a helper from browser custody to answer custody. */
export function acknowledgeBrowserDecision(
  id: string,
  owner: string,
  conversationId: string | null,
  messageId?: string
): Promise<boolean> {
  return serial(async () => {
    const row = entries.find((entry) => entry.id === id && entry.owner === owner);
    if (!row || !['browser', 'decision', 'sent'].includes(row.state)) return false;
    if (row.lifetime !== 'temporary-planner' && !conversationId) return false;
    if (row.conversationId && row.conversationId !== conversationId) return false;
    if (row.state === 'sent') return row.conversationId === conversationId;
    const next: DecisionInputEntry = {
      ...row,
      conversationId: conversationId ?? row.conversationId,
      state: 'decision',
      deliveredAt: row.deliveredAt ?? Date.now(),
      ...(messageId ? { messageId: messageId.slice(0, 300) } : {})
    };
    await commit(entries.map((entry) => entry === row ? next : entry));
    return true;
  });
}

/** Only preparation can fail safely; an ambiguous native click remains claimed. */
export function failBrowserDecision(id: string, owner: string, error: string): Promise<boolean> {
  return serial(async () => {
    const row = entries.find((entry) => entry.id === id && entry.owner === owner && entry.state === 'browser');
    if (!row || row.sendAuthorizedAt !== undefined) return false;
    await commit(entries.map((entry) => entry === row ? { ...row, state: 'failed', error: error.slice(0, 200) } : entry));
    waiters.get(id)?.reject(new Error('goal_browser_send_failed'));
    waiters.delete(id);
    return true;
  });
}

export async function publishBrowserDecision(
  id: string,
  owner: string,
  conversationId: string | null,
  text: string
): Promise<boolean> {
  if (text.length > 8_000) return false;
  const row = entries.find((entry) => entry.id === id && entry.owner === owner && entry.conversationId === conversationId
    && (entry.state === 'browser' || entry.state === 'decision'));
  const waiter = waiters.get(id);
  if (!row || !waiter) return false;
  waiter.publish?.(text);
  return true;
}

export function completeBrowserDecision(
  id: string,
  owner: string,
  response: string,
  conversationId: string | null
): Promise<boolean> {
  return serial(async () => {
    if (!response.trim() || response.length > 16_000) return false;
    const spent = entries.find((entry) => entry.id === id && entry.owner === owner && entry.state === 'sent' && entry.response === response);
    if (spent) return true;
    const waiter = waiters.get(id);
    const row = entries.find((entry) => entry.id === id && entry.owner === owner && (entry.state === 'browser' || entry.state === 'decision'));
    if (!waiter || !row) return false;
    if (row.lifetime !== 'temporary-planner' && !conversationId) return false;
    if (row.conversationId && row.conversationId !== conversationId) return false;
    const next: DecisionInputEntry = { ...row, conversationId: conversationId ?? row.conversationId, state: 'sent', response };
    await commit(entries.map((entry) => entry === row ? next : entry));
    const current = waiters.get(id);
    if (!current) {
      await commit(entries.map((entry) => entry.id === id ? { ...entry, state: 'cancelled', response: undefined } : entry));
      return false;
    }
    current.resolve(response);
    return true;
  });
}

/** A deliberate retry retires exactly one ambiguous New Chat helper attempt. */
export function authorizeBrowserHelperRetry(id: string, sourceSessionId: string): Promise<boolean> {
  return serial(async () => {
    const row = entries.find((entry) => entry.id === id && entry.decisionSourceSessionId === sourceSessionId
      && entry.state === 'cancelled' && !entry.conversationId);
    if (!row || entries.some((entry) => entry.decisionSourceSessionId === sourceSessionId && !terminal(entry))) return false;
    await commit(entries.map((entry) => entry === row
      ? { ...entry, state: 'failed', error: 'User authorized a new helper' }
      : entry));
    return true;
  });
}

export async function requestBrowserDecision(
  text: string,
  signal: AbortSignal,
  options: {
    lifetime?: 'temporary-planner';
    sourceSessionId?: string;
    conversationId?: string | null;
    model?: string;
    reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
    publish?: (text: string) => void;
  } = {}
): Promise<string> {
  if (!initialized) throw new Error('COS decision input transport is not initialized');
  if (!text.trim() || text.length > MAX_PROMPT_CHARS) throw new Error('goal_context_too_large');
  signal.throwIfAborted();
  const id = randomUUID();
  let resolveAnswer!: (text: string) => void;
  let rejectAnswer!: (reason: unknown) => void;
  const answer = new Promise<string>((resolve, reject) => { resolveAnswer = resolve; rejectAnswer = reject; });
  void answer.catch(() => undefined);
  waiters.set(id, { resolve: resolveAnswer, reject: rejectAnswer, publish: options.publish });
  const cancel = () => {
    waiters.delete(id);
    rejectAnswer(new Error('goal_browser_cancelled'));
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await serial(async () => {
      signal.throwIfAborted();
      if (entries.filter((entry) => !terminal(entry)).length >= MAX_ACTIVE) throw new Error('goal_browser_busy');
      if (options.sourceSessionId && entries.some((entry) => entry.decisionSourceSessionId === options.sourceSessionId && !terminal(entry))) {
        throw new Error('goal_browser_busy');
      }
      if (options.sourceSessionId && !options.conversationId && entries.some((entry) =>
        entry.decisionSourceSessionId === options.sourceSessionId && entry.state === 'cancelled' && !entry.conversationId)) {
        throw new Error('goal_browser_send_unconfirmed');
      }
      const row: DecisionInputEntry = {
        id,
        text,
        state: 'queued',
        owner: null,
        conversationId: options.conversationId ?? null,
        decisionSourceSessionId: options.sourceSessionId ?? null,
        ...(options.lifetime ? { lifetime: options.lifetime } : {}),
        model: options.model ?? 'gpt-5.6-sol',
        reasoningEffort: options.reasoningEffort ?? 'high',
        createdAt: Date.now()
      };
      await commit([...entries, row]);
    });
    signal.throwIfAborted();
    await wakeDecision?.();
    signal.throwIfAborted();
    return await answer;
  } finally {
    waiters.delete(id);
    signal.removeEventListener('abort', cancel);
    void answer.catch(() => undefined);
    await serial(async () => {
      if (entries.some((entry) => entry.id === id && !terminal(entry))) {
        await commit(entries.map((entry) => entry.id === id && !terminal(entry) ? { ...entry, state: 'cancelled' } : entry));
      }
    });
  }
}

export function resetDecisionInputForTests(): void {
  entries = [];
  initialized = false;
  chain = Promise.resolve();
  waiters.clear();
  wakeDecision = null;
}
