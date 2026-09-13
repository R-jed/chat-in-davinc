import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AgentCompactionResult,
  AgentSessionEvent,
  AgentSessionSummary,
  AgentStoredText,
  AgentTurnOutcome
} from '../shared/agent-session.js';
import type { AgentTurnTrace } from '../shared/agent-system.js';
import type { AgentGoalFrame } from '../shared/agent-system.js';
import { readDurable, writeDurableNow, writeDurableSoon } from './durable.js';
import { logWarn } from './log.js';

const INDEX_STATE = 'agent-session-index';
const INDEX_VERSION = 1;
const MAX_TEXT_CHARS = 128_000;
const MAX_SESSIONS = 500;

interface SessionRecord extends AgentSessionSummary {
  nextSeq: number;
}

interface SessionIndex {
  version: 1;
  sessions: SessionRecord[];
}

type NewAgentSessionEvent = AgentSessionEvent extends infer Event
  ? Event extends AgentSessionEvent
    ? Omit<Event, 'seq' | 'time' | 'sessionId'>
    : never
  : never;

let root = '';
const records = new Map<string, SessionRecord>();
const queues = new Map<string, Promise<void>>();

function assertReady(): void {
  if (!root) throw new Error('Agent session store is not initialized');
}

function cloneSummary(record: SessionRecord): AgentSessionSummary {
  const { nextSeq: _nextSeq, ...summary } = record;
  return structuredClone(summary);
}

function validId(value: unknown, prefix: 'session' | 'turn'): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}-[0-9a-f-]{36}$`, 'i').test(value);
}

function validRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<SessionRecord>;
  return validId(row.id, 'session')
    && typeof row.title === 'string' && row.title.length >= 1 && row.title.length <= 120
    && typeof row.createdAt === 'number' && Number.isFinite(row.createdAt)
    && typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt)
    && (row.state === 'idle' || row.state === 'running')
    && (row.activeTurnId === null || validId(row.activeTurnId, 'turn'))
    && (row.lastTurnOutcome === null || row.lastTurnOutcome === 'completed' || row.lastTurnOutcome === 'failed' || row.lastTurnOutcome === 'interrupted')
    && typeof row.nextSeq === 'number' && Number.isInteger(row.nextSeq) && row.nextSeq >= 1;
}

function eventFile(sessionId: string): string {
  if (!validId(sessionId, 'session')) throw new Error('Invalid agent session ID');
  assertReady();
  return path.join(root, `${sessionId}.jsonl`);
}

function storedText(text: string): AgentStoredText {
  return {
    text: text.slice(0, MAX_TEXT_CHARS),
    chars: text.length,
    truncated: text.length > MAX_TEXT_CHARS
  };
}

function indexSnapshot(): SessionIndex {
  return {
    version: INDEX_VERSION,
    sessions: [...records.values()]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SESSIONS)
      .map((record) => structuredClone(record))
  };
}

function serial<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
  const previous = queues.get(sessionId) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(sessionId, tail);
  void tail.then(() => {
    if (queues.get(sessionId) === tail) queues.delete(sessionId);
  });
  return run;
}

async function appendLocked(record: SessionRecord, events: readonly NewAgentSessionEvent[]): Promise<AgentSessionEvent[]> {
  await fs.mkdir(root, { recursive: true });
  const rows = events.map((event, index) => ({
    ...event,
    seq: record.nextSeq + index,
    time: Date.now(),
    sessionId: record.id
  })) as AgentSessionEvent[];
  const handle = await fs.open(eventFile(record.id), 'a');
  try {
    await handle.writeFile(`${rows.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  record.nextSeq += rows.length;
  record.updatedAt = rows.at(-1)?.time ?? record.updatedAt;
  return rows;
}

function parseEvent(value: unknown): AgentSessionEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!Number.isInteger(row['seq']) || typeof row['time'] !== 'number' || !Number.isFinite(row['time'])) return null;
  if (!validId(row['sessionId'], 'session')) return null;
  if (row['turnId'] !== null && !validId(row['turnId'], 'turn')) return null;
  if (typeof row['kind'] !== 'string') return null;
  return value as AgentSessionEvent;
}

async function readEventsFile(sessionId: string): Promise<AgentSessionEvent[]> {
  try {
    const raw = await fs.readFile(eventFile(sessionId), 'utf8');
    const events: AgentSessionEvent[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const event = parseEvent(JSON.parse(line));
        if (event) events.push(event);
        else logWarn(`Ignored malformed agent session event in ${sessionId}`);
      } catch {
        logWarn(`Ignored malformed agent session JSON in ${sessionId}`);
      }
    }
    return events.sort((left, right) => left.seq - right.seq);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function outcomeFor(event: AgentSessionEvent): AgentTurnOutcome | null {
  if (event.kind === 'turn_completed') return 'completed';
  if (event.kind === 'turn_failed') return 'failed';
  if (event.kind === 'turn_interrupted') return 'interrupted';
  return null;
}

function recordFromEvents(sessionId: string, events: readonly AgentSessionEvent[]): SessionRecord | null {
  const created = events.find((event) => event.kind === 'session_created');
  if (!created || created.kind !== 'session_created') return null;
  const lastSeq = events.at(-1)?.seq ?? 0;
  const lastTurnStart = [...events].reverse().find((event) => event.kind === 'turn_started');
  const lastTerminal = [...events].reverse().find((event) => outcomeFor(event) !== null);
  const running = !!lastTurnStart
    && (!lastTerminal || lastTerminal.seq < lastTurnStart.seq)
    && lastTurnStart.turnId !== null;
  return {
    id: sessionId,
    title: created.title.slice(0, 120),
    createdAt: created.time,
    updatedAt: events.at(-1)?.time ?? created.time,
    state: running ? 'running' : 'idle',
    activeTurnId: running ? lastTurnStart?.turnId ?? null : null,
    lastTurnOutcome: lastTerminal ? outcomeFor(lastTerminal) : null,
    nextSeq: lastSeq + 1
  };
}

async function rebuildFromEventFiles(): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const names = (await fs.readdir(root)).filter((name) => /^session-[0-9a-f-]{36}\.jsonl$/i.test(name));
  for (const name of names.slice(0, MAX_SESSIONS)) {
    const sessionId = name.slice(0, -'.jsonl'.length);
    const events = await readEventsFile(sessionId);
    const record = recordFromEvents(sessionId, events);
    if (record) records.set(record.id, record);
  }
}

async function reconcileRecord(record: SessionRecord): Promise<void> {
  const events = await readEventsFile(record.id);
  const maxSeq = events.reduce((maximum, event) => Math.max(maximum, event.seq), 0);
  record.nextSeq = Math.max(record.nextSeq, maxSeq + 1);
  record.updatedAt = Math.max(record.updatedAt, events.at(-1)?.time ?? record.updatedAt);
  if (record.state !== 'running' || !record.activeTurnId) return;
  const terminal = [...events].reverse().find((event) => event.turnId === record.activeTurnId && outcomeFor(event) !== null);
  if (terminal) {
    record.state = 'idle';
    record.lastTurnOutcome = outcomeFor(terminal);
    record.activeTurnId = null;
    return;
  }
  await appendLocked(record, [{
    kind: 'turn_interrupted',
    turnId: record.activeTurnId,
    reason: storedText('Application restarted before the turn reached a durable terminal event.')
  }]);
  record.state = 'idle';
  record.lastTurnOutcome = 'interrupted';
  record.activeTurnId = null;
}

export function initAgentSessionStore(userDataDir: string): void {
  root = path.join(userDataDir, 'agent-sessions');
  records.clear();
  queues.clear();
}

export async function restoreAgentSessionStore(): Promise<void> {
  assertReady();
  records.clear();
  const raw = await readDurable<unknown>(INDEX_STATE);
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const index = raw as Partial<SessionIndex>;
    if (index.version === INDEX_VERSION && Array.isArray(index.sessions)) {
      for (const candidate of index.sessions.slice(0, MAX_SESSIONS)) {
        if (validRecord(candidate)) records.set(candidate.id, structuredClone(candidate));
      }
    }
  }
  if (records.size === 0) await rebuildFromEventFiles();
  for (const record of records.values()) await reconcileRecord(record);
  await writeDurableNow(INDEX_STATE, indexSnapshot());
}

export async function createAgentSession(title = 'New session'): Promise<AgentSessionSummary> {
  assertReady();
  const normalizedTitle = title.trim();
  if (!normalizedTitle || normalizedTitle.length > 120) throw new Error('Agent session title must be 1–120 characters');
  const now = Date.now();
  const record: SessionRecord = {
    id: `session-${randomUUID()}`,
    title: normalizedTitle,
    createdAt: now,
    updatedAt: now,
    state: 'idle',
    activeTurnId: null,
    lastTurnOutcome: null,
    nextSeq: 1
  };
  records.set(record.id, record);
  try {
    await writeDurableNow(INDEX_STATE, indexSnapshot());
    await serial(record.id, async () => {
      await appendLocked(record, [{ kind: 'session_created', turnId: null, title: record.title }]);
      writeDurableSoon(INDEX_STATE, indexSnapshot());
    });
  } catch (error) {
    records.delete(record.id);
    await writeDurableNow(INDEX_STATE, indexSnapshot()).catch(() => undefined);
    throw error;
  }
  return cloneSummary(record);
}

export function getAgentSession(sessionId: string): AgentSessionSummary | null {
  const record = records.get(sessionId);
  return record ? cloneSummary(record) : null;
}

export function listAgentSessions(): AgentSessionSummary[] {
  return [...records.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .map(cloneSummary);
}

export async function readAgentSessionEvents(sessionId: string): Promise<AgentSessionEvent[]> {
  if (!records.has(sessionId)) throw new Error('Agent session was not found');
  return await readEventsFile(sessionId);
}

export function startAgentTurn(sessionId: string, input: string): Promise<{ session: AgentSessionSummary; turnId: string }> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record) throw new Error('Agent session was not found');
    if (record.state === 'running') throw new Error('Agent session already has a running turn');
    const text = input.trim();
    if (!text || text.length > 32_000) throw new Error('Agent input must be 1–32000 characters');
    const turnId = `turn-${randomUUID()}`;
    record.state = 'running';
    record.activeTurnId = turnId;
    record.lastTurnOutcome = null;
    record.updatedAt = Date.now();
    await writeDurableNow(INDEX_STATE, indexSnapshot());
    await appendLocked(record, [
      { kind: 'turn_started', turnId },
      { kind: 'user_message', turnId, message: storedText(text) }
    ]);
    await writeDurableNow(INDEX_STATE, indexSnapshot());
    return { session: cloneSummary(record), turnId };
  });
}

export function recordAgentAssistantMessage(sessionId: string, turnId: string, text: string): Promise<void> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record || record.activeTurnId !== turnId || record.state !== 'running') throw new Error('Agent turn is not active');
    await appendLocked(record, [{ kind: 'assistant_message', turnId, message: storedText(text) }]);
    writeDurableSoon(INDEX_STATE, indexSnapshot());
  });
}

export function recordAgentToolIntent(
  sessionId: string,
  turnId: string,
  callId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<void> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record || record.activeTurnId !== turnId || record.state !== 'running') throw new Error('Agent turn is not active');
    await appendLocked(record, [{
      kind: 'tool_call_intent',
      turnId,
      callId,
      tool,
      args: storedText(JSON.stringify(args))
    }]);
    writeDurableSoon(INDEX_STATE, indexSnapshot());
  });
}

export function recordAgentToolResult(
  sessionId: string,
  turnId: string,
  callId: string,
  tool: string,
  ok: boolean,
  result: string
): Promise<void> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record || record.activeTurnId !== turnId || record.state !== 'running') throw new Error('Agent turn is not active');
    await appendLocked(record, [{
      kind: 'tool_call_result',
      turnId,
      callId,
      tool,
      ok,
      result: storedText(result)
    }]);
    writeDurableSoon(INDEX_STATE, indexSnapshot());
  });
}

export function recordAgentGoalCompleted(
  sessionId: string,
  turnId: string,
  generation: number,
  evidenceIds: readonly string[]
): Promise<void> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record) throw new Error('Agent session was not found');
    if (record.state !== 'idle' || record.activeTurnId !== null || record.lastTurnOutcome !== 'completed') {
      throw new Error('Agent Goal completion requires an idle completed turn');
    }
    if (!Number.isInteger(generation) || generation < 1) throw new Error('Agent goal completion generation is invalid');
    const refs = [...new Set(evidenceIds)];
    if (refs.length > 32 || refs.some((id) => !/^E[1-9][0-9]*$/.test(id))) throw new Error('Agent goal completion evidence is invalid');
    const events = await readEventsFile(sessionId);
    const latestStart = [...events].reverse().find((event) => event.kind === 'turn_started');
    if (!latestStart || latestStart.turnId !== turnId) throw new Error('Agent Goal source turn is no longer current');
    const terminal = [...events].reverse().find((event) =>
      event.turnId === turnId && (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_interrupted')
    );
    if (!terminal || terminal.kind !== 'turn_completed') throw new Error('Agent Goal source turn did not complete');
    if (events.some((event) => event.seq > terminal.seq && event.kind === 'user_message')) {
      throw new Error('New user input superseded this Agent Goal completion');
    }
    if (events.some((event) => event.kind === 'goal_completed' && event.turnId === turnId)) return;
    await appendLocked(record, [{
      kind: 'goal_completed',
      turnId,
      generation,
      evidenceIds: refs
    }]);
    writeDurableSoon(INDEX_STATE, indexSnapshot());
  });
}

export function recordAgentHandoff(
  sessionId: string,
  throughSeq: number,
  text: string,
  goal: AgentGoalFrame,
  sourceNarrativeMessages: number,
  providerUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null
): Promise<AgentCompactionResult> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record) throw new Error('Agent session was not found');
    if (record.state !== 'idle') throw new Error('Agent session cannot compact while a turn is running');
    if (!Number.isInteger(throughSeq) || throughSeq < 1 || throughSeq >= record.nextSeq) throw new Error('Invalid Agent handoff boundary');
    const body = text.trim();
    if (body.length < 200 || body.length > MAX_TEXT_CHARS) throw new Error('Agent handoff must be 200–128000 characters');
    if (!Number.isInteger(sourceNarrativeMessages) || sourceNarrativeMessages < 1) throw new Error('Agent handoff requires narrative source messages');
    const handoffId = `handoff-${randomUUID()}`;
    await appendLocked(record, [{
      kind: 'handoff',
      turnId: null,
      handoffId,
      throughSeq,
      text: storedText(body),
      goal: structuredClone(goal),
      sourceNarrativeMessages,
      providerUsage: providerUsage ? structuredClone(providerUsage) : null
    }]);
    await writeDurableNow(INDEX_STATE, indexSnapshot());
    return { handoffId, throughSeq, text: body, sourceNarrativeMessages };
  });
}

export function completeAgentTurn(
  sessionId: string,
  turnId: string,
  finalText: string,
  trace?: AgentTurnTrace
): Promise<AgentSessionSummary> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record || record.activeTurnId !== turnId || record.state !== 'running') throw new Error('Agent turn is not active');
    const text = finalText.trim();
    if (!text) throw new Error('Agent final response cannot be empty');
    await appendLocked(record, [
      { kind: 'assistant_message', turnId, message: storedText(text) },
      ...(trace ? [{ kind: 'turn_trace' as const, turnId, trace }] : []),
      { kind: 'turn_completed', turnId }
    ]);
    record.state = 'idle';
    record.activeTurnId = null;
    record.lastTurnOutcome = 'completed';
    await writeDurableNow(INDEX_STATE, indexSnapshot());
    return cloneSummary(record);
  });
}

export function failAgentTurn(sessionId: string, turnId: string, error: string, trace?: AgentTurnTrace): Promise<AgentSessionSummary> {
  return serial(sessionId, async () => {
    const record = records.get(sessionId);
    if (!record || record.activeTurnId !== turnId || record.state !== 'running') throw new Error('Agent turn is not active');
    await appendLocked(record, [
      ...(trace ? [{ kind: 'turn_trace' as const, turnId, trace }] : []),
      { kind: 'turn_failed', turnId, error: storedText(error) }
    ]);
    record.state = 'idle';
    record.activeTurnId = null;
    record.lastTurnOutcome = 'failed';
    await writeDurableNow(INDEX_STATE, indexSnapshot());
    return cloneSummary(record);
  });
}

export function resetAgentSessionStoreForTests(): void {
  root = '';
  records.clear();
  queues.clear();
}
