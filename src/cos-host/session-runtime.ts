import { createHash, randomUUID } from 'node:crypto';
import type { AgentGoalFrame } from '../shared/agent-system.js';
import { readDurable, writeDurableNow } from '../main/durable.js';

const STATE = 'cos-sessions';
const STATE_VERSION = 1;
const MAX_SESSIONS = 200;
const MAX_EVENTS_PER_SESSION = 1200;
const MAX_TEXT = 120_000;

export type CosTurnOutcome = 'completed' | 'failed' | 'stopped' | 'interrupted' | 'stalled' | 'unknown';

export type CosSessionEvent =
  | { key: string; kind: 'conversation_title'; time: number; text: string }
  | { key: string; kind: 'user_message'; time: number; turnId: string | null; messageId: string | null; text: string }
  | { key: string; kind: 'assistant_message'; time: number; turnId: string | null; messageId: string | null; text: string; final: boolean }
  | { key: string; kind: 'turn_start'; time: number; turnId: string }
  | { key: string; kind: 'turn_end'; time: number; turnId: string; outcome: CosTurnOutcome }
  | { key: string; kind: 'chat_error'; time: number; turnId: string | null; detail: string }
  | {
      key: string;
      kind: 'tool_call';
      time: number;
      turnId: string;
      requestId: string;
      tool: string;
      args: string;
      ok: boolean;
      result: string;
    };

export interface CosSessionView {
  sessionId: string;
  conversationId: string;
  conversationIds: string[];
  createdAt: number;
  updatedAt: number;
  title: string | null;
  activeTurnId: string | null;
  activeTurnStartedAt: number | null;
  lastTurnOutcome: CosTurnOutcome | null;
  events: CosSessionEvent[];
  continuationCount: number;
}

interface StoredSession extends CosSessionView {}

interface SessionSnapshot {
  version: 1;
  savedAt: number;
  sessions: StoredSession[];
}

const sessionsById = new Map<string, StoredSession>();
const sessionIdByConversation = new Map<string, string>();
let initialized = false;

function validConversationId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-z-]{8,256}$/i.test(value);
}

function validSessionId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-z-]{8,128}$/i.test(value);
}

function clone(session: StoredSession): CosSessionView {
  return structuredClone(session);
}

function eventKey(event: Omit<CosSessionEvent, 'key'>): string {
  return createHash('sha256').update(JSON.stringify(event)).digest('base64url').slice(0, 32);
}

function finiteTime(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Date.now();
}

function cleanText(value: unknown, limit = MAX_TEXT): string {
  return typeof value === 'string' ? value.slice(0, limit) : '';
}

function cleanTurnId(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-z_.:-]{1,100}$/i.test(value) ? value : null;
}

function cleanMessageId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value.slice(0, 300) : null;
}

function parseEvent(raw: unknown): CosSessionEvent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const kind = row['kind'];
  const time = finiteTime(row['time']);
  const turnId = cleanTurnId(row['turnId']);
  const messageId = cleanMessageId(row['messageId'] ?? row['providerMessageId']);
  if (kind === 'conversation_title') {
    const text = cleanText(row['text'], 500).trim();
    if (!text) return null;
    const event = { kind, time, text } as const;
    return { key: eventKey(event), ...event };
  }
  if (kind === 'user_message' || kind === 'assistant_message') {
    const text = cleanText(row['text']).trim();
    if (!text) return null;
    const event = kind === 'assistant_message'
      ? { kind, time, turnId, messageId, text, final: row['final'] === true && row['state'] === 'final' } as const
      : { kind, time, turnId, messageId, text } as const;
    return { key: eventKey(event), ...event };
  }
  if (kind === 'turn_start' && turnId) {
    const event = { kind, time, turnId } as const;
    return { key: eventKey(event), ...event };
  }
  if (kind === 'turn_end' && turnId) {
    const value = row['outcome'];
    const outcome: CosTurnOutcome =
      value === 'completed' || value === 'failed' || value === 'stopped' || value === 'interrupted'
        || value === 'stalled' || value === 'unknown'
        ? value
        : 'unknown';
    const event = { kind, time, turnId, outcome } as const;
    return { key: eventKey(event), ...event };
  }
  if (kind === 'chat_error') {
    const detail = cleanText(row['detail'] ?? row['text'], 2_000).trim();
    if (!detail) return null;
    const event = { kind, time, turnId, detail } as const;
    return { key: eventKey(event), ...event };
  }
  return null;
}

function createSession(conversationId: string): StoredSession {
  const now = Date.now();
  return {
    sessionId: randomUUID(),
    conversationId,
    conversationIds: [conversationId],
    createdAt: now,
    updatedAt: now,
    title: null,
    activeTurnId: null,
    activeTurnStartedAt: null,
    lastTurnOutcome: null,
    events: [],
    continuationCount: 0
  };
}

function snapshot(): SessionSnapshot {
  return {
    version: STATE_VERSION,
    savedAt: Date.now(),
    sessions: [...sessionsById.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS)
      .map((session) => clone(session))
  };
}

async function persist(): Promise<void> {
  await writeDurableNow(STATE, snapshot());
}

function publish(session: StoredSession): void {
  sessionsById.set(session.sessionId, session);
  for (const conversationId of session.conversationIds) sessionIdByConversation.set(conversationId, session.sessionId);
}

export async function initCosSessionRuntime(): Promise<void> {
  if (initialized) return;
  sessionsById.clear();
  sessionIdByConversation.clear();
  const saved = await readDurable<SessionSnapshot>(STATE);
  if (saved?.version === STATE_VERSION && Array.isArray(saved.sessions)) {
    for (const raw of saved.sessions.slice(0, MAX_SESSIONS)) {
      if (!raw || !validSessionId(raw.sessionId) || !validConversationId(raw.conversationId)) continue;
      const conversationIds = Array.isArray(raw.conversationIds)
        ? [...new Set(raw.conversationIds.filter(validConversationId))].slice(-32)
        : [raw.conversationId];
      if (!conversationIds.includes(raw.conversationId)) conversationIds.push(raw.conversationId);
      const events = Array.isArray(raw.events)
        ? raw.events.filter((event): event is CosSessionEvent =>
            Boolean(event && typeof event === 'object' && typeof event.key === 'string' && typeof event.kind === 'string')
          ).slice(-MAX_EVENTS_PER_SESSION)
        : [];
      const session: StoredSession = {
        sessionId: raw.sessionId,
        conversationId: raw.conversationId,
        conversationIds,
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
        title: typeof raw.title === 'string' ? raw.title.slice(0, 500) : null,
        activeTurnId: cleanTurnId(raw.activeTurnId),
        activeTurnStartedAt: typeof raw.activeTurnStartedAt === 'number' && Number.isFinite(raw.activeTurnStartedAt)
          ? raw.activeTurnStartedAt
          : null,
        lastTurnOutcome:
          raw.lastTurnOutcome === 'completed' || raw.lastTurnOutcome === 'failed' || raw.lastTurnOutcome === 'stopped'
            || raw.lastTurnOutcome === 'interrupted' || raw.lastTurnOutcome === 'stalled' || raw.lastTurnOutcome === 'unknown'
            ? raw.lastTurnOutcome
            : null,
        events,
        continuationCount: Number.isInteger(raw.continuationCount) && raw.continuationCount >= 0 ? raw.continuationCount : 0
      };
      publish(session);
    }
  }
  initialized = true;
}

async function ensureSessionNow(conversationId: string): Promise<StoredSession> {
  if (!initialized) throw new Error('COS Session runtime is not initialized');
  if (!validConversationId(conversationId)) throw new Error('Invalid COS conversation identity');
  const existingId = sessionIdByConversation.get(conversationId);
  const existing = existingId ? sessionsById.get(existingId) : null;
  if (existing) return existing;
  const session = createSession(conversationId);
  publish(session);
  try {
    await persist();
  } catch (error) {
    sessionsById.delete(session.sessionId);
    sessionIdByConversation.delete(conversationId);
    throw error;
  }
  return session;
}

export async function ensureCosSessionNow(conversationId: string): Promise<CosSessionView> {
  return clone(await ensureSessionNow(conversationId));
}

export async function recordCosBrowserEventsNow(
  conversationId: string,
  rawEvents: unknown
): Promise<CosSessionView> {
  const session = await ensureSessionNow(conversationId);
  if (session.conversationId !== conversationId) {
    throw new Error('Superseded COS conversation cannot mutate the current Session');
  }
  const before = clone(session);
  const known = new Set(session.events.map((event) => event.key));
  const parsed = Array.isArray(rawEvents) ? rawEvents.slice(0, 500).map(parseEvent).filter((event): event is CosSessionEvent => Boolean(event)) : [];
  let changed = false;
  for (const event of parsed) {
    if (known.has(event.key)) continue;
    known.add(event.key);
    session.events.push(event);
    changed = true;
    if (event.kind === 'conversation_title') session.title = event.text;
    if (event.kind === 'turn_start') {
      if (session.activeTurnStartedAt === null || event.time >= session.activeTurnStartedAt) {
        session.activeTurnId = event.turnId;
        session.activeTurnStartedAt = event.time;
      }
    }
    if (event.kind === 'turn_end') {
      session.lastTurnOutcome = event.outcome;
      if (session.activeTurnId === event.turnId) {
        session.activeTurnId = null;
        session.activeTurnStartedAt = null;
      }
    }
  }
  if (!changed) return clone(session);
  session.events = session.events.slice(-MAX_EVENTS_PER_SESSION);
  session.updatedAt = Date.now();
  try {
    await persist();
  } catch (error) {
    Object.assign(session, before);
    publish(session);
    throw error;
  }
  return clone(session);
}

export async function recordCosProtectedToolCallNow(options: {
  sessionId: string;
  turnId: string;
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: string;
}): Promise<CosSessionView> {
  const session = sessionsById.get(options.sessionId);
  if (!session) throw new Error('COS Session was not found for protected tool recording');
  if (!session.events.some((event) => event.kind === 'turn_start' && event.turnId === options.turnId)) {
    throw new Error('Protected tool result does not belong to a recorded COS turn');
  }
  const base = {
    kind: 'tool_call' as const,
    time: Date.now(),
    turnId: options.turnId,
    requestId: options.requestId.slice(0, 100),
    tool: options.tool.slice(0, 100),
    args: JSON.stringify(options.args).slice(0, 32_000),
    ok: options.ok,
    result: options.result.slice(0, MAX_TEXT)
  };
  const event: CosSessionEvent = { key: eventKey(base), ...base };
  if (session.events.some((row) =>
    row.kind === 'tool_call'
    && row.requestId === event.requestId
    && row.turnId === event.turnId
    && row.tool === event.tool
  )) return clone(session);
  const before = clone(session);
  session.events.push(event);
  session.events = session.events.slice(-MAX_EVENTS_PER_SESSION);
  session.updatedAt = Date.now();
  try {
    await persist();
  } catch (error) {
    Object.assign(session, before);
    publish(session);
    throw error;
  }
  return clone(session);
}

export function cosSessionForConversation(conversationId: string): CosSessionView | null {
  const id = sessionIdByConversation.get(conversationId);
  const session = id ? sessionsById.get(id) : null;
  return session ? clone(session) : null;
}

export function currentCosSessionForConversation(conversationId: string): CosSessionView | null {
  const session = cosSessionForConversation(conversationId);
  return session?.conversationId === conversationId ? session : null;
}

export function cosSessionById(sessionId: string): CosSessionView | null {
  const session = sessionsById.get(sessionId);
  return session ? clone(session) : null;
}

export function listCosSessions(query?: string, goalObjective?: (conversationId: string) => string): CosSessionView[] {
  const normalized = query?.trim().toLocaleLowerCase() ?? '';
  return [...sessionsById.values()]
    .filter((session) => {
      if (!normalized) return true;
      if (session.title?.toLocaleLowerCase().includes(normalized)) return true;
      if (goalObjective?.(session.conversationId).toLocaleLowerCase().includes(normalized)) return true;
      return session.events.some((event) =>
        ('text' in event && event.text.toLocaleLowerCase().includes(normalized))
        || ('detail' in event && event.detail.toLocaleLowerCase().includes(normalized))
      );
    })
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 30)
    .map(clone);
}

export async function rebindCosSessionConversationNow(
  sessionId: string,
  fromConversationId: string,
  toConversationId: string
): Promise<CosSessionView> {
  const session = sessionsById.get(sessionId);
  if (!session || session.conversationId !== fromConversationId) throw new Error('COS continuation source session does not match');
  if (!validConversationId(toConversationId)) throw new Error('Invalid COS continuation destination');
  const occupied = sessionIdByConversation.get(toConversationId);
  if (occupied && occupied !== sessionId) throw new Error('COS continuation destination already belongs to another Session');
  const before = clone(session);
  session.conversationId = toConversationId;
  session.conversationIds = [...new Set([...session.conversationIds, toConversationId])].slice(-32);
  session.continuationCount += 1;
  session.updatedAt = Date.now();
  session.activeTurnId = null;
  session.activeTurnStartedAt = null;
  sessionIdByConversation.set(toConversationId, sessionId);
  try {
    await persist();
  } catch (error) {
    Object.assign(session, before);
    sessionIdByConversation.delete(toConversationId);
    publish(session);
    throw error;
  }
  return clone(session);
}

export function goalFrameForCosSession(session: CosSessionView, canonicalObjective = ''): AgentGoalFrame {
  const userRows = session.events.filter((event): event is Extract<CosSessionEvent, { kind: 'user_message' }> => event.kind === 'user_message');
  const directives = userRows.map((event, index) => ({
    turnId: event.turnId ?? '',
    seq: index + 1,
    text: event.text,
    chars: event.text.length,
    truncated: false
  }));
  const originalRequest = directives[0] ?? null;
  const explicitObjective = canonicalObjective.trim();
  const objective = explicitObjective || originalRequest?.text.trim() || null;
  return {
    schemaVersion: 1,
    originalRequest,
    userDirectives: directives.slice(1).slice(-32),
    sourceUserMessages: directives.length,
    omittedUserDirectives: Math.max(0, directives.length - 33),
    desiredOutcome: objective,
    hardConstraints: [],
    userPreferences: [],
    explicitNonGoals: [],
    completionCriteria: objective ? [objective] : [],
    requiredEvidence: objective ? ['qualified CID Resolve evidence'] : [],
    assumptions: [],
    decisions: [],
    corrections: [],
    openObligations: objective ? [objective] : []
  };
}

export function resetCosSessionRuntimeForTests(): void {
  sessionsById.clear();
  sessionIdByConversation.clear();
  initialized = false;
}
