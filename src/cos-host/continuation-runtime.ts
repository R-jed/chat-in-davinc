import { randomBytes } from 'node:crypto';
import { readDurable, writeDurableNow } from '../main/durable.js';
import {
  cosSessionById,
  cosSessionForConversation,
  rebindCosSessionConversationNow
} from './session-runtime.js';
import {
  agentForOwnedConversation,
  beginPrimeTransfer,
  cancelPrimeTransfer,
  commitPrimeTransfer,
  freezePrimeTransfer,
  isWorkerConversation,
  persistCriticalSwarmNow,
  repairPrimeConversationAfterRecovery,
  thawPrimeTransfer
} from './agents.js';
import { moveGoalObjective, moveGoalSwitch } from './canonical/goal.js';

const STATE = 'cos-continuations';
const VERSION = 1;
const MAX_CONTINUATIONS = 100;
const MAX_SUMMARY_CHARS = 96_000;

export type CosContinuationState = 'awaiting-summary' | 'awaiting-chat' | 'committed' | 'aborted';
export type CosContinuationSendState =
  | 'not-attempted'
  | 'attempted-unresolved'
  | 'dispatched-unresolved'
  | 'sent';

export interface CosContinuationSend {
  state: CosContinuationSendState;
  messageId: string | null;
}

export interface CosContinuationDestinationSend extends CosContinuationSend {
  conversationId: string | null;
}

export interface CosContinuationView {
  token: string;
  sessionId: string;
  from: string;
  to: string | null;
  state: CosContinuationState;
  automatic: false;
  openedAt: number;
  updatedAt: number;
  summary: string;
  sourceProgress: number;
  sourceSend: CosContinuationSend;
  destinationSend: CosContinuationDestinationSend;
  error: string | null;
}

interface Snapshot {
  version: 1;
  savedAt: number;
  continuations: CosContinuationView[];
}

const byToken = new Map<string, CosContinuationView>();
const tokenBySession = new Map<string, string>();
let initialized = false;
let mutationQueue: Promise<void> = Promise.resolve();

function clone(value: CosContinuationView): CosContinuationView {
  return structuredClone(value);
}

function validId(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= max && /^[0-9a-z_-]+$/i.test(value);
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(value);
}

function validSendState(value: unknown): value is CosContinuationSendState {
  return value === 'not-attempted'
    || value === 'attempted-unresolved'
    || value === 'dispatched-unresolved'
    || value === 'sent';
}

function snapshot(next?: CosContinuationView): Snapshot {
  const values = [...byToken.values()]
    .map((row) => next && row.token === next.token ? next : row)
    .filter((row) => row.state !== 'aborted' || Date.now() - row.updatedAt < 24 * 60 * 60_000)
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_CONTINUATIONS);
  if (next && !values.some((row) => row.token === next.token)) values.unshift(next);
  return {
    version: VERSION,
    savedAt: Date.now(),
    continuations: values.slice(0, MAX_CONTINUATIONS).map(clone)
  };
}

function publish(row: CosContinuationView): void {
  byToken.set(row.token, row);
  if (row.state === 'awaiting-summary' || row.state === 'awaiting-chat') {
    tokenBySession.set(row.sessionId, row.token);
  } else if (tokenBySession.get(row.sessionId) === row.token) {
    tokenBySession.delete(row.sessionId);
  }
}

async function serialized<T>(work: () => Promise<T>): Promise<T> {
  let resolveGate!: () => void;
  const gate = new Promise<void>((resolve) => { resolveGate = resolve; });
  const prior = mutationQueue;
  mutationQueue = prior.then(() => gate, () => gate);
  try {
    await prior;
    return await work();
  } finally {
    resolveGate();
  }
}

async function persistCandidate(candidate: CosContinuationView): Promise<CosContinuationView> {
  await writeDurableNow(STATE, snapshot(candidate));
  publish(candidate);
  return clone(candidate);
}

async function ensureSourcePrimeTransferDurable(sourceConversationId: string): Promise<void> {
  const opened = beginPrimeTransfer(sourceConversationId);
  if (!opened) return;
  try {
    const durable = await persistCriticalSwarmNow();
    if (!durable) throw new Error('COS Prime transfer could not cross its durable acceptance barrier');
  } catch (error) {
    // The continuation row, when present, is the recovery record. Locally restore ordinary
    // source ownership until a retry/restart can durably establish the transfer fence.
    cancelPrimeTransfer(sourceConversationId);
    await persistCriticalSwarmNow().catch(() => false);
    throw error;
  }
}

function activeForSession(sessionId: string): CosContinuationView | null {
  const token = tokenBySession.get(sessionId);
  const row = token ? byToken.get(token) : null;
  return row ? clone(row) : null;
}

export async function initCosContinuationRuntime(): Promise<void> {
  if (initialized) return;
  byToken.clear();
  tokenBySession.clear();
  const saved = await readDurable<Snapshot>(STATE);
  if (saved?.version === VERSION && Array.isArray(saved.continuations)) {
    for (const raw of saved.continuations.slice(0, MAX_CONTINUATIONS)) {
      if (!raw || !validToken(raw.token) || !validId(raw.sessionId, 128) || !validId(raw.from)) continue;
      if (raw.to !== null && !validId(raw.to)) continue;
      if (raw.state !== 'awaiting-summary' && raw.state !== 'awaiting-chat'
        && raw.state !== 'committed' && raw.state !== 'aborted') continue;
      if (!raw.sourceSend || !validSendState(raw.sourceSend.state)) continue;
      if (!raw.destinationSend || !validSendState(raw.destinationSend.state)) continue;
      const row: CosContinuationView = {
        token: raw.token,
        sessionId: raw.sessionId,
        from: raw.from,
        to: raw.to,
        state: raw.state,
        automatic: false,
        openedAt: Number.isFinite(raw.openedAt) ? raw.openedAt : Date.now(),
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
        summary: typeof raw.summary === 'string' ? raw.summary.slice(0, MAX_SUMMARY_CHARS) : '',
        sourceProgress: Number.isSafeInteger(raw.sourceProgress) && raw.sourceProgress >= 0 ? raw.sourceProgress : 0,
        sourceSend: {
          state: raw.sourceSend.state,
          messageId: typeof raw.sourceSend.messageId === 'string' ? raw.sourceSend.messageId.slice(0, 300) : null
        },
        destinationSend: {
          state: raw.destinationSend.state,
          messageId: typeof raw.destinationSend.messageId === 'string' ? raw.destinationSend.messageId.slice(0, 300) : null,
          conversationId: typeof raw.destinationSend.conversationId === 'string'
            ? raw.destinationSend.conversationId.slice(0, 256)
            : null
        },
        error: typeof raw.error === 'string' ? raw.error.slice(0, 500) : null
      };
      publish(row);
    }
  }
  initialized = true;
}

export function continuationByToken(token: string): CosContinuationView | null {
  const row = byToken.get(token);
  return row ? clone(row) : null;
}

export function continuationForSession(sessionId: string): CosContinuationView | null {
  return activeForSession(sessionId);
}

export function continuationForConversation(conversationId: string): CosContinuationView | null {
  const session = cosSessionForConversation(conversationId);
  return session ? activeForSession(session.sessionId) : null;
}

export function continuationJobForConversation(conversationId: string): Record<string, unknown> | null {
  const session = cosSessionForConversation(conversationId);
  if (!session) return null;
  const active = activeForSession(session.sessionId);
  const latest = active ?? [...byToken.values()]
    .filter((row) => row.sessionId === session.sessionId)
    .sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null;
  if (!latest) return null;
  const stage =
    latest.state === 'awaiting-summary' ? 'handoff-pending'
      : latest.state === 'awaiting-chat' ? 'opening'
        : latest.state === 'committed' ? 'done'
          : 'failed';
  return {
    busy: latest.state === 'awaiting-summary' || latest.state === 'awaiting-chat',
    stage,
    automatic: false,
    token: latest.token,
    sourceSend: structuredClone(latest.sourceSend),
    destinationSend: structuredClone(latest.destinationSend),
    error: latest.error
  };
}

export async function openCosContinuationNow(
  sessionId: string,
  fromConversationId: string
): Promise<{ continuation: CosContinuationView; started: boolean }> {
  return await serialized(async () => {
    if (!initialized) throw new Error('COS continuation runtime is not initialized');
    const session = cosSessionById(sessionId);
    if (!session || session.conversationId !== fromConversationId) {
      throw new Error('Compact & Resume source does not own this COS Session');
    }
    const existing = activeForSession(sessionId);
    if (existing) {
      if (existing.from !== fromConversationId) throw new Error('COS Session already has a continuation from another conversation');
      await ensureSourcePrimeTransferDurable(fromConversationId);
      return { continuation: existing, started: false };
    }
    const now = Date.now();
    const row: CosContinuationView = {
      token: randomBytes(24).toString('base64url'),
      sessionId,
      from: fromConversationId,
      to: null,
      state: 'awaiting-summary',
      automatic: false,
      openedAt: now,
      updatedAt: now,
      summary: '',
      sourceProgress: 0,
      sourceSend: { state: 'not-attempted', messageId: null },
      destinationSend: { state: 'not-attempted', messageId: null, conversationId: null },
      error: null
    };
    // The transaction record is the first durable cut. If the following swarm write fails,
    // restart still has enough information to re-establish the source transfer and continue or
    // abort safely. The inverse order can strand a durable transfer flag with no transaction.
    await writeDurableNow(STATE, snapshot(row));
    publish(row);
    await ensureSourcePrimeTransferDurable(fromConversationId);
    return { continuation: clone(row), started: true };
  });
}

export async function beginCosContinuationSourceSendNow(
  token: string
): Promise<{ allowed: boolean; checkpoint: CosContinuationSend } | null> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-summary') return null;
    if (current.sourceSend.state === 'attempted-unresolved') {
      return { allowed: true, checkpoint: structuredClone(current.sourceSend) };
    }
    if (current.sourceSend.state !== 'not-attempted') {
      return { allowed: false, checkpoint: structuredClone(current.sourceSend) };
    }
    const candidate = clone(current);
    candidate.sourceSend = { state: 'attempted-unresolved', messageId: null };
    candidate.updatedAt = Date.now();
    const saved = await persistCandidate(candidate);
    return { allowed: true, checkpoint: saved.sourceSend };
  });
}

export async function dispatchCosContinuationSourceSendNow(token: string): Promise<boolean> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-summary' || current.sourceSend.state !== 'attempted-unresolved') return false;
    const candidate = clone(current);
    candidate.sourceSend = { state: 'dispatched-unresolved', messageId: null };
    candidate.updatedAt = Date.now();
    await persistCandidate(candidate);
    return true;
  });
}

export async function bindCosContinuationSourceMessageNow(
  token: string,
  messageId: string,
  progress?: number
): Promise<boolean> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-summary' || !messageId) return false;
    if (current.sourceSend.state === 'sent') return current.sourceSend.messageId === messageId;
    if (current.sourceSend.state !== 'dispatched-unresolved') return false;
    const candidate = clone(current);
    candidate.sourceSend = { state: 'sent', messageId: messageId.slice(0, 300) };
    candidate.sourceProgress = Number.isSafeInteger(progress) && progress! >= 0
      ? Math.min(4_000_000, progress!)
      : candidate.sourceProgress;
    candidate.updatedAt = Date.now();
    await persistCandidate(candidate);
    return true;
  });
}

export async function captureCosContinuationSummaryNow(
  token: string,
  summary: string
): Promise<CosContinuationView | null> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current) return null;
    if (current.state === 'awaiting-chat' || current.state === 'committed') return clone(current);
    if (current.state !== 'awaiting-summary' || current.sourceSend.state !== 'sent') return null;
    const brief = summary.trim().slice(0, MAX_SUMMARY_CHARS);
    if (!brief) return null;
    const candidate = clone(current);
    candidate.summary = brief;
    candidate.state = 'awaiting-chat';
    candidate.updatedAt = Date.now();
    return await persistCandidate(candidate);
  });
}

export async function beginCosContinuationDestinationSendNow(
  token: string
): Promise<{ allowed: boolean; checkpoint: CosContinuationDestinationSend } | null> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-chat') return null;
    if (current.destinationSend.state === 'attempted-unresolved') {
      return { allowed: true, checkpoint: structuredClone(current.destinationSend) };
    }
    if (current.destinationSend.state !== 'not-attempted') {
      return { allowed: false, checkpoint: structuredClone(current.destinationSend) };
    }
    const candidate = clone(current);
    candidate.destinationSend = { state: 'attempted-unresolved', messageId: null, conversationId: null };
    candidate.updatedAt = Date.now();
    const saved = await persistCandidate(candidate);
    return { allowed: true, checkpoint: saved.destinationSend };
  });
}

export async function dispatchCosContinuationDestinationSendNow(token: string): Promise<boolean> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-chat' || current.destinationSend.state !== 'attempted-unresolved') return false;
    const candidate = clone(current);
    candidate.destinationSend = { state: 'dispatched-unresolved', messageId: null, conversationId: null };
    candidate.updatedAt = Date.now();
    await persistCandidate(candidate);
    return true;
  });
}

async function persistConvergedPrimeAuthority(): Promise<void> {
  const durable = await persistCriticalSwarmNow();
  if (!durable) throw new Error('COS Prime transfer publish is not durable yet');
}

/**
 * Finishes the forward-only half of Compact & Resume after the Session rebind is durable.
 *
 * Once Session S says chat B is current, A can never become authoritative again. The only safe
 * recovery is therefore to converge the Prime projection to B, make that projection durable, and
 * only then publish the continuation as committed. Keeping this as one helper is important: live
 * ACK retry, failed-ACK/timeout settlement and restart recovery all cross the same durable cuts.
 */
async function commitAfterSessionRebind(
  current: CosContinuationView,
  toConversationId: string,
  messageId: string | null
): Promise<'committed' | 'rejected'> {
  if (!validId(toConversationId) || toConversationId === current.from) return 'rejected';
  if (current.destinationSend.state !== 'dispatched-unresolved' && current.destinationSend.state !== 'sent') {
    return 'rejected';
  }
  // A legitimate destination was checked before Session rebind. Keep the same fence in recovery
  // so an old/corrupt durable row can never turn a Worker conversation into the new Prime.
  if (isWorkerConversation(toConversationId)) return 'rejected';

  // Goal/Loop state is chat-owned in canonical COS. Replaying these idempotent moves during
  // forward recovery closes the crash window after Session A→B but before their delayed flush.
  moveGoalObjective(current.from, toConversationId);
  moveGoalSwitch(current.from, toConversationId);

  const sourceOwner = agentForOwnedConversation(current.from);
  const destinationOwner = agentForOwnedConversation(toConversationId);
  const repaired = repairPrimeConversationAfterRecovery(current.from, toConversationId);
  if (repaired) {
    await persistConvergedPrimeAuthority();
  } else if (sourceOwner || destinationOwner) {
    // Some Agent authority still exists, but the existing recovery authority could not prove
    // that it belongs to this exact A→B move. Refuse rather than adopting or discarding it.
    return 'rejected';
  }

  const candidate = clone(current);
  candidate.state = 'committed';
  candidate.to = toConversationId;
  candidate.destinationSend = {
    state: 'sent',
    conversationId: toConversationId,
    messageId: messageId ? messageId.slice(0, 300) : candidate.destinationSend.messageId
  };
  candidate.error = null;
  candidate.updatedAt = Date.now();
  await persistCandidate(candidate);
  return 'committed';
}

async function commitCosContinuationUnlocked(
  token: string,
  toConversationId: string,
  messageId: string | null
): Promise<'committed' | 'already-committed' | 'rejected'> {
  const current = byToken.get(token);
  if (!current || !validId(toConversationId) || toConversationId === current.from) return 'rejected';
  if (current.state === 'committed') return current.to === toConversationId ? 'already-committed' : 'rejected';
  if (current.state !== 'awaiting-chat' || current.destinationSend.state !== 'dispatched-unresolved') return 'rejected';
  const session = cosSessionById(current.sessionId);
  if (!session) return 'rejected';
  if (session.conversationId !== current.from && session.conversationId !== toConversationId) return 'rejected';
  let frozen: 'absent' | 'unavailable' | 'frozen' = 'absent';
  if (session.conversationId === current.from) {
    if (agentForOwnedConversation(toConversationId) || isWorkerConversation(toConversationId)) return 'rejected';
    frozen = freezePrimeTransfer(current.from);
    if (frozen === 'unavailable') return 'rejected';
    try {
      await rebindCosSessionConversationNow(current.sessionId, current.from, toConversationId);
    } catch (error) {
      if (frozen === 'frozen') thawPrimeTransfer(current.from);
      throw error;
    }
    if (frozen === 'frozen') {
      commitPrimeTransfer(current.from, toConversationId);
    }
  }
  return await commitAfterSessionRebind(current, toConversationId, messageId);
}

export async function commitCosContinuationFromAckNow(
  token: string,
  toConversationId: string
): Promise<'committed' | 'already-committed' | 'rejected'> {
  return await serialized(async () => await commitCosContinuationUnlocked(token, toConversationId, null));
}

export async function bindCosContinuationDestinationMessageNow(
  token: string,
  toConversationId: string,
  messageId: string
): Promise<'committed' | 'already-committed' | 'rejected'> {
  if (!messageId) return 'rejected';
  return await serialized(async () => {
    const current = byToken.get(token);
    if (current?.state === 'committed') {
      if (current.to !== toConversationId) return 'rejected';
      if (current.destinationSend.messageId && current.destinationSend.messageId !== messageId) return 'rejected';
      if (!current.destinationSend.messageId) {
        const candidate = clone(current);
        candidate.destinationSend.messageId = messageId.slice(0, 300);
        candidate.updatedAt = Date.now();
        await persistCandidate(candidate);
      }
      return 'already-committed';
    }
    return await commitCosContinuationUnlocked(token, toConversationId, messageId);
  });
}

export async function abortCosContinuationNow(token: string, reason: string): Promise<boolean> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state === 'committed' || current.state === 'aborted') return false;
    const session = cosSessionById(current.sessionId);
    if (!session) return false;
    if (session.conversationId !== current.from) {
      // Session=B is already a durable authority cut. A timeout, failed browser ACK or explicit
      // cancel arriving after that cut must recover forward; writing `aborted` here is the exact
      // split-brain terminal state this transaction is designed to make impossible.
      if (current.state !== 'awaiting-chat') return false;
      await commitAfterSessionRebind(current, session.conversationId, current.destinationSend.messageId);
      return false;
    }
    // `dispatched-unresolved` is immediately before the native Send click. Past this checkpoint
    // the destination may already have accepted the bootstrap, so rollback is no longer safe.
    if (current.destinationSend.state === 'dispatched-unresolved' || current.destinationSend.state === 'sent') return false;
    const candidate = clone(current);
    candidate.state = 'aborted';
    candidate.error = reason.slice(0, 500);
    candidate.updatedAt = Date.now();
    await persistCandidate(candidate);
    // run.transfer is deliberately volatile and is not part of SwarmSnapshot. With Session
    // still owned by A, the durable Prime owner is already A; clearing only this liveness fence
    // cannot create a second durable authority and restart never restores it.
    cancelPrimeTransfer(current.from);
    return true;
  });
}

export async function releaseCosContinuationSourceBeforeSendNow(token: string): Promise<boolean> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-summary') return false;
    const session = cosSessionById(current.sessionId);
    if (!session || session.conversationId !== current.from) return false;
    if (current.sourceSend.state !== 'not-attempted' && current.sourceSend.state !== 'attempted-unresolved') return false;
    const candidate = clone(current);
    candidate.state = 'aborted';
    candidate.error = 'handoff_never_sent';
    candidate.updatedAt = Date.now();
    await persistCandidate(candidate);
    cancelPrimeTransfer(current.from);
    return true;
  });
}

export async function releaseCosContinuationDestinationBeforeSendNow(token: string): Promise<boolean> {
  return await serialized(async () => {
    const current = byToken.get(token);
    if (!current || current.state !== 'awaiting-chat') return false;
    if (current.destinationSend.state !== 'not-attempted'
      && current.destinationSend.state !== 'attempted-unresolved') return false;
    const candidate = clone(current);
    candidate.destinationSend = { state: 'not-attempted', messageId: null, conversationId: null };
    candidate.updatedAt = Date.now();
    await persistCandidate(candidate);
    return true;
  });
}

export function cosNativeHandoffPrompt(token: string): string {
  return (
    '[[CLF-HANDOFF:' + token + ']]\n' +
    'Write a compact handoff for the replacement conversation. Preserve the current Goal, verified evidence, ' +
    'open obligations, material unknowns and the next safe action. Do not claim completion unless the evidence proves it.'
  );
}

export function cosResumeBootstrapText(summary: string, token: string): string {
  return (
    '[[CLF-RESUME:' + token + ']]\n' +
    'Continue the same COS Session from this handoff. The handoff is model context only and is not completion evidence.\n\n' +
    summary.trim().slice(0, MAX_SUMMARY_CHARS)
  );
}

export async function recoverCosContinuationRuntimeAfterSwarmRestoreNow(): Promise<void> {
  if (!initialized) throw new Error('COS continuation runtime is not initialized');
  await serialized(async () => {
    for (const current of [...byToken.values()]) {
      const session = cosSessionById(current.sessionId);
      if (!session) continue;

      if (current.state === 'committed') {
        if (!current.to || session.conversationId !== current.to) {
          throw new Error('Committed COS continuation does not match the durable Session destination');
        }
        if (isWorkerConversation(current.to)) {
          throw new Error('Committed COS continuation destination is a Worker conversation');
        }
        moveGoalObjective(current.from, current.to);
        moveGoalSwitch(current.from, current.to);
        const sourceOwner = agentForOwnedConversation(current.from);
        const destinationOwner = agentForOwnedConversation(current.to);
        const repaired = repairPrimeConversationAfterRecovery(current.from, current.to);
        if (repaired) await persistConvergedPrimeAuthority();
        else if (sourceOwner || destinationOwner) {
          throw new Error('Committed COS continuation could not converge its Prime authority');
        }
        continue;
      }

      if (session.conversationId === current.from) {
        if (current.state === 'aborted') cancelPrimeTransfer(current.from);
        else await ensureSourcePrimeTransferDurable(current.from);
        continue;
      }

      // A previous process crossed Session A→B but died before the remaining authorities became
      // durable. Even an old `aborted` row from the pre-fix ordering is not terminal here: the
      // Session cut wins and recovery must converge forward before this runtime becomes usable.
      const committed = await commitAfterSessionRebind(
        current,
        session.conversationId,
        current.destinationSend.messageId
      );
      if (committed !== 'committed') {
        throw new Error('COS continuation could not recover forward from its durable Session rebind');
      }
    }
  });
}

export function resetCosContinuationRuntimeForTests(): void {
  byToken.clear();
  tokenBySession.clear();
  initialized = false;
  mutationQueue = Promise.resolve();
}
