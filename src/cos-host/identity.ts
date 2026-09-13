/**
 * Exact request-id -> ChatGPT conversation ownership for the COS host.
 *
 * Adapted from Chat On Steroids `src/main/session/correlation.ts`: the browser page proves
 * ownership by reporting the same ChatGPT `metadata.request_id` that arrived on the MCP
 * `x-request-id` header. First proof wins permanently. Timestamps, active tabs, tool names and
 * "only chat generating" heuristics are never identity evidence.
 */
import { readDurable, writeDurableNow, writeDurableSoon } from '../main/durable.js';
import type { CosControlCallContext } from '../main/cos-control-tools.js';
import type { CosHostIdentityRuntime, CosHostResolvedCaller } from './runtime.js';

const STATE = 'cos-request-correlations';
const VERSION = 3;
const MAX = 50_000;

export interface CosRequestCorrelation {
  requestId: string;
  conversationId: string;
  sessionId: string;
  turnId: string;
  messageId: string;
  tool: string;
  observedAt: number;
}

interface Snapshot {
  version: number;
  entries: CosRequestCorrelation[];
}

const byRequest = new Map<string, CosRequestCorrelation>();
let restored = false;

function valid(value: unknown): value is CosRequestCorrelation {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<CosRequestCorrelation>;
  return Boolean(
    typeof item.requestId === 'string' && /^[a-z0-9_-]{1,100}$/i.test(item.requestId) &&
    typeof item.conversationId === 'string' && item.conversationId.length > 0 && item.conversationId.length <= 200 &&
    typeof item.sessionId === 'string' && item.sessionId.length > 0 && item.sessionId.length <= 200 &&
    typeof item.turnId === 'string' && /^[0-9a-z_.:-]{1,100}$/i.test(item.turnId) &&
    typeof item.messageId === 'string' && item.messageId.length > 0 && item.messageId.length <= 300 &&
    typeof item.tool === 'string' && /^[a-z0-9_.-]{1,100}$/i.test(item.tool) &&
    typeof item.observedAt === 'number' && Number.isFinite(item.observedAt)
  );
}

function snapshot(): Snapshot {
  return { version: VERSION, entries: [...byRequest.values()].map((entry) => ({ ...entry })) };
}

function trim(): void {
  while (byRequest.size > MAX) {
    const first = byRequest.keys().next().value as string | undefined;
    if (!first) return;
    byRequest.delete(first);
  }
}

function merge(input: CosRequestCorrelation): 'stored' | 'same' | 'refused' {
  const prior = byRequest.get(input.requestId);
  if (!prior) {
    byRequest.set(input.requestId, { ...input });
    trim();
    return 'stored';
  }
  if (
    prior.conversationId !== input.conversationId ||
    prior.sessionId !== input.sessionId ||
    prior.turnId !== input.turnId ||
    prior.messageId !== input.messageId ||
    prior.tool !== input.tool
  ) return 'refused';
  if (input.observedAt > prior.observedAt) {
    prior.observedAt = input.observedAt;
    byRequest.delete(input.requestId);
    byRequest.set(input.requestId, prior);
  }
  return 'same';
}

export async function restoreCosRequestCorrelations(): Promise<void> {
  if (restored) return;
  const saved = await readDurable<Snapshot>(STATE);
  if (saved?.version === VERSION && Array.isArray(saved.entries)) {
    for (const raw of saved.entries.slice(-MAX)) {
      if (valid(raw)) merge(raw);
    }
  }
  restored = true;
}

export function cosRequestCorrelation(requestId: string | null | undefined): CosRequestCorrelation | null {
  if (!requestId) return null;
  const held = byRequest.get(requestId);
  return held ? { ...held } : null;
}

export function observeCosRequestCorrelation(input: CosRequestCorrelation): 'stored' | 'same' | 'refused' {
  if (!valid(input)) throw new Error('Invalid COS request correlation evidence');
  const result = merge(input);
  if (result !== 'refused') writeDurableSoon(STATE, snapshot());
  return result;
}

/** Browser ACK boundary: do not confirm an exact ownership proof until it is durable. */
export async function observeCosRequestCorrelationNow(input: CosRequestCorrelation): Promise<'stored' | 'same' | 'refused'> {
  if (!valid(input)) throw new Error('Invalid COS request correlation evidence');
  const held = byRequest.get(input.requestId);
  const previous = held ? { ...held } : null;
  const result = merge(input);
  if (result === 'refused') return result;
  try {
    await writeDurableNow(STATE, snapshot());
    return result;
  } catch (error) {
    // A newly admitted proof must not become process-local authority when the browser was told
    // persistence failed. writeDurableNow() retains a failed generation for retry, so deleting
    // only the in-memory row is insufficient: supersede that pending unsafe snapshot with a newer
    // safe generation as well. Even if this second write also fails, durable.ts keeps the newer
    // safe snapshot as the retry target.
    if (previous) {
      byRequest.delete(input.requestId);
      byRequest.set(input.requestId, previous);
    } else if (result === 'stored') {
      byRequest.delete(input.requestId);
    }
    try {
      await writeDurableNow(STATE, snapshot());
    } catch {
      // The newer safe generation remains queued for durable retry.
    }
    throw error;
  }
}

export const cosRequestIdentityRuntime: CosHostIdentityRuntime = {
  async resolveCaller(context: CosControlCallContext): Promise<CosHostResolvedCaller | null> {
    const held = cosRequestCorrelation(context.requestId);
    if (!held) return null;
    return {
      conversationId: held.conversationId,
      sessionId: held.sessionId,
      turnId: held.turnId,
      messageId: held.messageId,
      tool: held.tool
    };
  }
};

export function resetCosRequestCorrelationsForTests(): void {
  byRequest.clear();
  restored = false;
}
