/**
 * CID-owned browser companion bridge, rebased from the COS bridge protocol.
 *
 * This is a local loopback control channel for the browser companion. It is not a second MCP
 * Tunnel and it exposes no filesystem, terminal, Desktop, plugin or Resolve scripting authority.
 * Its live product responsibilities are exact request correlation, COS Session/Goal/continuation
 * browser transport and the durable Worker browser lifecycle.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  agentConversation,
  agentForConversation,
  currentRunId,
  isWorkerConversation,
  pendingWorkerRevivals,
  pendingWorkerSpawns,
  swarmRunning,
  workerRevivalClaimOwnedBy,
  workerRevivalClaimedAt,
  workerRevivalDeliveredByCommand,
  type WorkerSpawn
} from './agents.js';
import {
  acknowledgeCosWorkerRevival,
  attachCosHostBrowserRuntime,
  bindCosWorkerConversationNow,
  closeCosBrowserConversationNow,
  cosWorkerConversation,
  failCosWorkerBootstrapNow,
  finishCosWorkerConversationNow,
  observeCosBrowserConversationNow,
  projectCosSessionDecisionNow,
  releaseCosWorkerRevivalNow,
  claimCosWorkerRevival,
  type CosHostBrowserRuntime,
  type CosWorkerRevivalRequest
} from './runtime.js';
import {
  CID_COMPANION_BRIDGE_PORTS,
  CID_COMPANION_BRIDGE_PROTOCOL,
  CID_COMPANION_EXTENSION_ORIGIN
} from './companion-identity.js';
import { cosRequestCorrelation, observeCosRequestCorrelationNow } from './identity.js';
import { admitExactCosCaller } from './caller-admission.js';
import { readDurable, writeDurableNow } from '../main/durable.js';
import { logInfo, logWarn } from '../main/log.js';
import { getCosBrowserBridgeToken, setCosBrowserBridgeToken } from '../main/secrets.js';
import {
  currentCosSessionForConversation,
  cosSessionForConversation,
  ensureCosSessionNow,
  recordCosBrowserEventsNow
} from './session-runtime.js';
import {
  acceptGoalReplyNow,
  ackGoalDraftNow,
  beginGoalDraft,
  discardPreparedGoalDraft,
  draftOpeningMessage,
  goalArmedFor,
  goalPendingReplyFor,
  goalProjection,
  goalProviderStatus,
  goalViewFor,
  isGoalDecisionChat,
  registerGoalDecisionChat,
  retireGoalDraftsFor,
  retryGoalBrowserHelper,
  setGoalObjectiveNow,
  setGoalSwitchNow,
  startGoalDraft,
  type GoalConversationMessage
} from './canonical/goal.js';
import {
  acknowledgeBrowserDecision,
  authorizeBrowserDecision,
  claimBrowserDecision,
  completeBrowserDecision,
  configureDecisionInputWake,
  failBrowserDecision,
  listDecisionInputs,
  pausedBrowserHelpers,
  pendingBrowserDecisions,
  publishBrowserDecision
} from './canonical/input.js';
import {
  abortCosContinuationNow,
  beginCosContinuationDestinationSendNow,
  beginCosContinuationSourceSendNow,
  bindCosContinuationDestinationMessageNow,
  bindCosContinuationSourceMessageNow,
  captureCosContinuationSummaryNow,
  commitCosContinuationFromAckNow,
  continuationByToken,
  continuationForConversation,
  continuationJobForConversation,
  cosNativeHandoffPrompt,
  cosResumeBootstrapText,
  dispatchCosContinuationDestinationSendNow,
  dispatchCosContinuationSourceSendNow,
  openCosContinuationNow,
  releaseCosContinuationDestinationBeforeSendNow,
  releaseCosContinuationSourceBeforeSendNow
} from './continuation-runtime.js';
import { cosProtectedToolActivityCount } from './tool-activity.js';

const APP_VERSION = '0.1.0';
const STATE = 'cos-browser-commands';
const STATE_VERSION = 1;
const COMMAND_TTL_MS = 30 * 60_000;
const WORKER_LIMIT_MS = 120_000;
const REVIVAL_LIMIT_MS = 90_000;
const MAX_COMMANDS = 20;
const MAX_RECEIPTS = 64;
const MAX_BODY_BYTES = 1024 * 1024;

type BrowserOpener = (url: string) => Promise<void>;

type WorkerCommandSpec = {
  type: 'worker';
  agent: string;
  task: string;
  model: string | null;
  reasoningEffort: string | null;
  runId: string;
};

type RevivalCommandSpec = {
  type: 'revive';
  agent: string;
  conversationId: string;
  runId: string;
  wakeKey: string;
};

type ResumeCommandSpec = {
  type: 'resume';
  sessionId: string;
  token: string;
  summary: string;
  homeConversationId: string;
};

type CommandSpec = WorkerCommandSpec | RevivalCommandSpec | ResumeCommandSpec;

interface Command {
  id: string;
  spec: CommandSpec;
  createdAt: number;
  claimedAt: number | null;
  owner: string | null;
  lastError: string | null;
  timer: NodeJS.Timeout | null;
}

interface CommandReceipt {
  id: string;
  client: string | null;
  conversationId: string | null;
  outcome: 'committed' | 'terminal-failure';
  committed: boolean;
  error: string | null;
  completedAt: number;
}

interface DurableCommand {
  id: string;
  spec: CommandSpec;
  createdAt: number;
  claimedAt: number | null;
  owner: string | null;
  lastError: string | null;
}

interface Snapshot {
  version: number;
  commands: DurableCommand[];
  receipts: CommandReceipt[];
}

interface BridgeStatus {
  running: boolean;
  port: number | null;
  paired: boolean;
  present: boolean;
  lastSeenAt: number | null;
}

let server: http.Server | null = null;
let port: number | null = null;
let bridgeToken: string | null = null;
let lastSeenAt: number | null = null;
let commands: Command[] = [];
let receipts: CommandReceipt[] = [];
let openExternal: BrowserOpener = defaultOpenExternal;
let started = false;
const commandLocks = new Map<string, Promise<void>>();
const wakeSockets = new Set<Duplex>();
let ledgerQueue: Promise<void> = Promise.resolve();
let pairQueue: Promise<void> = Promise.resolve();

function durable(command: Command): DurableCommand {
  return {
    id: command.id,
    spec: command.spec,
    createdAt: command.createdAt,
    claimedAt: command.claimedAt,
    owner: command.owner,
    lastError: command.lastError
  };
}

function snapshot(nextCommands = commands, nextReceipts = receipts): Snapshot {
  const now = Date.now();
  return {
    version: STATE_VERSION,
    commands: nextCommands.map(durable),
    receipts: nextReceipts
      .filter((receipt) => now - receipt.completedAt <= COMMAND_TTL_MS)
      .slice(-MAX_RECEIPTS)
      .map((receipt) => ({ ...receipt }))
  };
}

async function writeTransition(next: Snapshot): Promise<void> {
  try {
    await writeDurableNow(STATE, next);
  } catch (error) {
    // Supersede durable.ts's retained failed generation with the still-authoritative live state.
    try {
      await writeDurableNow(STATE, snapshot());
    } catch {
      // The newer safe generation remains the retry target even when storage is still down.
    }
    throw error;
  }
}

async function withLedgerLock<T>(work: () => Promise<T>): Promise<T> {
  const run = ledgerQueue.then(work, work);
  ledgerQueue = run.then(() => undefined, () => undefined);
  return await run;
}

async function withPairLock<T>(work: () => Promise<T>): Promise<T> {
  const run = pairQueue.then(work, work);
  pairQueue = run.then(() => undefined, () => undefined);
  return await run;
}

function validConversationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return /^[0-9a-f-]{8,64}$/i.test(value) ? value : null;
}

function goalWorkerBlocked(conversationId: string): boolean {
  return isWorkerConversation(conversationId) || isGoalDecisionChat(conversationId);
}

function validCommandId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 128 ? id : '';
}

function validClient(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 64) : '';
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function originOf(req: IncomingMessage): { ok: boolean; origin: string | null } {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || origin === '') return { ok: true, origin: null };
  return origin === CID_COMPANION_EXTENSION_ORIGIN ? { ok: true, origin } : { ok: false, origin: null };
}

function protocolCompatible(req: IncomingMessage): boolean {
  const protocol = Number(req.headers['x-extension-protocol'] ?? NaN);
  return Number.isSafeInteger(protocol) && protocol === CID_COMPANION_BRIDGE_PROTOCOL;
}

function json(res: ServerResponse, status: number, body: unknown, origin: string | null): void {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(payload)),
    'cache-control': 'no-store'
  };
  if (origin) {
    headers['access-control-allow-origin'] = origin;
    headers['access-control-allow-headers'] = 'authorization, content-type, x-extension-version, x-extension-protocol';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
    headers['access-control-allow-private-network'] = 'true';
  }
  res.writeHead(status, headers);
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body_too_large'));
        req.destroy();
        return;
      }
      chunks.push(bytes);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

function authorised(req: IncomingMessage): boolean {
  if (!bridgeToken) return false;
  const header = req.headers.authorization;
  return typeof header === 'string' && header.startsWith('Bearer ') && safeEqual(header.slice(7), bridgeToken);
}

function noteBrowserSeen(): void {
  lastSeenAt = Date.now();
}

function keyOf(spec: CommandSpec): string {
  if (spec.type === 'resume') return `resume:${spec.sessionId}:${spec.token}`;
  return `${spec.type}:${spec.runId}:${spec.agent}`;
}

function wakeKey(messageIds: readonly string[]): string {
  return createHash('sha256').update(messageIds.join('\0')).digest('base64url').slice(0, 32);
}

function workerBootstrapText(spec: WorkerCommandSpec): string {
  return (
    `${spec.task}\n\n` +
    `(Chat On Steroids: you are ${spec.agent}, a worker. Report to prime through the agents tool — ` +
    'action=message to="prime" as you go, action=finish once at the end. Workers cannot reach each other. ultrathink)'
  );
}

function wireCommand(command: Command, text: string) {
  const spec = command.spec;
  return {
    id: command.id,
    kind: 'open-chat',
    type: spec.type,
    text,
    agent: spec.type === 'resume' ? null : spec.agent,
    model: spec.type === 'worker' ? spec.model : null,
    reasoningEffort: spec.type === 'worker' ? spec.reasoningEffort : null,
    conversationId: spec.type === 'revive' ? spec.conversationId : null
  };
}

function commandUrl(command: Command): string {
  const marker = `clf=${encodeURIComponent(command.id)}`;
  const params = [marker];
  if (command.spec.type === 'worker' && command.spec.model) params.push(`model=${encodeURIComponent(command.spec.model)}`);
  if (command.spec.type === 'worker' && command.spec.reasoningEffort) {
    params.push(`reasoning_effort=${encodeURIComponent(command.spec.reasoningEffort)}`);
  }
  return `https://chatgpt.com/?${params.join('&')}#${marker}`;
}

function resumePlacement(command: Command) {
  if (command.spec.type !== 'resume') return null;
  return {
    id: command.id,
    homeConversationId: command.spec.homeConversationId,
    active: true,
    project: null
  };
}

function receiptFor(id: string): CommandReceipt | null {
  const now = Date.now();
  receipts = receipts.filter((receipt) => now - receipt.completedAt <= COMMAND_TTL_MS).slice(-MAX_RECEIPTS);
  return receipts.find((receipt) => receipt.id === id) ?? null;
}

function receiptReply(receipt: CommandReceipt) {
  return {
    ok: true,
    final: true,
    committed: receipt.committed,
    outcome: receipt.outcome,
    conversationId: receipt.conversationId,
    error: receipt.error
  };
}

async function withCommandLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  const earlier = commandLocks.get(id);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  commandLocks.set(id, gate);
  try {
    if (earlier) await earlier;
    return await work();
  } finally {
    release();
    if (commandLocks.get(id) === gate) commandLocks.delete(id);
  }
}

async function persistLease(command: Command, owner: string | null, claimedAt: number): Promise<boolean> {
  return await withLedgerLock(async () => {
    if (!commands.includes(command)) return false;
    if (command.claimedAt !== null && !owner) return false;
    if (owner && command.owner && command.owner !== owner) return false;
    const next = commands.map((entry) => entry === command ? { ...entry, owner, claimedAt, timer: entry.timer } : entry);
    try {
      await writeTransition(snapshot(next, receipts));
    } catch (error) {
      logWarn(`COS browser bridge could not persist command lease ${command.id}: ${(error as Error).message}`);
      return false;
    }
    if (!commands.includes(command)) return false;
    command.owner = owner;
    command.claimedAt = claimedAt;
    armDeadline(command);
    return true;
  });
}

async function finalizeCommand(command: Command, receipt: CommandReceipt): Promise<boolean> {
  return await withLedgerLock(async () => {
    if (!commands.includes(command)) return receiptFor(receipt.id) !== null;
    const nextCommands = commands.filter((entry) => entry !== command);
    const nextReceipts = [...receipts.filter((entry) => entry.id !== receipt.id), receipt].slice(-MAX_RECEIPTS);
    try {
      await writeTransition(snapshot(nextCommands, nextReceipts));
    } catch (error) {
      logWarn(`COS browser bridge could not persist command receipt ${command.id}: ${(error as Error).message}`);
      return false;
    }
    if (command.timer) clearTimeout(command.timer);
    command.timer = null;
    commands = nextCommands;
    receipts = nextReceipts;
    void deliverNextFreshWorker();
    notifyWake();
    return true;
  });
}

function deadlineAt(command: Command): number {
  return command.createdAt + (command.spec.type === 'revive' ? REVIVAL_LIMIT_MS : WORKER_LIMIT_MS);
}

function armDeadline(command: Command, overrideDelay?: number): void {
  if (command.timer) clearTimeout(command.timer);
  const delay = Math.max(1, overrideDelay ?? (deadlineAt(command) - Date.now()));
  command.timer = setTimeout(() => {
    command.timer = null;
    void withCommandLock(command.id, async () => {
      await expireCommand(command);
    });
  }, delay);
  command.timer.unref?.();
}

async function expireCommand(command: Command): Promise<void> {
  if (!commands.includes(command)) return;
  const spec = command.spec;
  let receipt: CommandReceipt;
  if (spec.type === 'resume') {
    const continuation = continuationByToken(spec.token);
    if (continuation?.state === 'committed' && continuation.to) {
      receipt = {
        id: command.id,
        client: command.owner,
        conversationId: continuation.to,
        outcome: 'committed',
        committed: true,
        error: null,
        completedAt: Date.now()
      };
    } else {
      const why = 'the browser did not commit this Compact & Resume before its command deadline';
      let aborted = false;
      try {
        aborted = await abortCosContinuationNow(spec.token, why);
      } catch (error) {
        logWarn(`COS browser bridge could not durably abort resume ${command.id}: ${(error as Error).message}`);
        if (commands.includes(command)) armDeadline(command, 5_000);
        return;
      }
      const settled = continuationByToken(spec.token);
      if (settled?.state === 'committed' && settled.to) {
        receipt = {
          id: command.id,
          client: command.owner,
          conversationId: settled.to,
          outcome: 'committed',
          committed: true,
          error: null,
          completedAt: Date.now()
        };
      } else if (!settled || settled.state === 'aborted') {
        receipt = {
          id: command.id,
          client: command.owner,
          conversationId: null,
          outcome: 'terminal-failure',
          committed: false,
          error: settled?.error ?? why,
          completedAt: Date.now()
        };
      } else if (!aborted) {
        // Destination dispatch is an irreversible ambiguity fence. Do not retire the only durable
        // browser command while ChatGPT may still surface the exact marked resume message.
        if (commands.includes(command)) armDeadline(command, 30_000);
        return;
      } else {
        receipt = {
          id: command.id,
          client: command.owner,
          conversationId: null,
          outcome: 'terminal-failure',
          committed: false,
          error: why,
          completedAt: Date.now()
        };
      }
    }
  } else if (spec.type === 'worker') {
    const bound = cosWorkerConversation(spec.agent, spec.runId);
    if (bound) {
      receipt = {
        id: command.id,
        client: command.owner,
        conversationId: bound,
        outcome: 'committed',
        committed: true,
        error: null,
        completedAt: Date.now()
      };
    } else {
      const why = 'the browser did not bind the fresh worker chat before its command deadline';
      try {
        await failCosWorkerBootstrapNow(spec.agent, why, spec.runId);
      } catch (error) {
        logWarn(`COS browser bridge could not durably fail ${spec.agent}: ${(error as Error).message}`);
        if (commands.includes(command)) armDeadline(command, 5_000);
        return;
      }
      receipt = {
        id: command.id,
        client: command.owner,
        conversationId: null,
        outcome: 'terminal-failure',
        committed: false,
        error: why,
        completedAt: Date.now()
      };
    }
  } else {
    const delivered = workerRevivalDeliveredByCommand(spec.agent, spec.conversationId, command.id, spec.runId);
    if (delivered) {
      receipt = {
        id: command.id,
        client: command.owner,
        conversationId: spec.conversationId,
        outcome: 'committed',
        committed: true,
        error: null,
        completedAt: Date.now()
      };
    } else {
      const why = 'the browser did not complete this worker revival before its command deadline';
      try {
        if (workerRevivalClaimOwnedBy(spec.agent, spec.conversationId, command.id, spec.runId)) {
          const settled = await acknowledgeCosWorkerRevival({
            workerId: spec.agent,
            conversationId: spec.conversationId,
            runId: spec.runId,
            commandId: command.id,
            status: 'failed',
            error: why
          });
          if (!settled) await releaseCosWorkerRevivalNow(spec.agent, spec.conversationId, why, spec.runId);
        } else {
          await releaseCosWorkerRevivalNow(spec.agent, spec.conversationId, why, spec.runId);
        }
      } catch (error) {
        logWarn(`COS browser bridge could not durably settle revival ${command.id}: ${(error as Error).message}`);
        if (commands.includes(command)) armDeadline(command, 5_000);
        return;
      }
      receipt = {
        id: command.id,
        client: command.owner,
        conversationId: spec.conversationId,
        outcome: 'terminal-failure',
        committed: false,
        error: why,
        completedAt: Date.now()
      };
    }
  }
  if (!(await finalizeCommand(command, receipt)) && commands.includes(command)) armDeadline(command, 5_000);
}

async function queueCommand(spec: CommandSpec): Promise<Command> {
  return await withLedgerLock(async () => await queueCommandUnlocked(spec));
}

async function queueCommandUnlocked(spec: CommandSpec): Promise<Command> {
  const key = keyOf(spec);
  const existing = commands.find((entry) => keyOf(entry.spec) === key);
  if (existing) {
    if (JSON.stringify(existing.spec) !== JSON.stringify(spec)) {
      // A worker can finish one wake and be assigned another before a lost old browser receipt
      // has retired its transport. The global ledger lock is the sole shared-state serialization
      // point here; request paths keep command->ledger ordering and therefore cannot deadlock.
      if (existing.spec.type !== 'revive' || spec.type !== 'revive') {
        throw new Error(`Conflicting browser command already exists for ${key}`);
      }
      const current = pendingWorkerRevivals().find(
        (revival) =>
          revival.id === spec.agent &&
          revival.runId === spec.runId &&
          revival.conversationId === spec.conversationId &&
          wakeKey(revival.messageIds) === spec.wakeKey
      );
      if (!current) throw new Error(`Refusing to supersede ${key} without the exact current broker wake`);
      const replacement: Command = {
        ...existing,
        spec,
        createdAt: Date.now(),
        claimedAt: null,
        owner: null,
        lastError: null,
        timer: existing.timer
      };
      const next = commands.map((entry) => entry === existing ? replacement : entry);
      await writeTransition(snapshot(next, receipts));
      if (existing.timer) clearTimeout(existing.timer);
      existing.spec = spec;
      existing.createdAt = replacement.createdAt;
      existing.claimedAt = null;
      existing.owner = null;
      existing.lastError = null;
      existing.timer = null;
      armDeadline(existing);
    }
    return existing;
  }
  if (commands.length >= MAX_COMMANDS) throw new Error('COS browser command queue is full');
  const command: Command = {
    id: randomUUID(),
    spec,
    createdAt: Date.now(),
    claimedAt: null,
    owner: null,
    lastError: null,
    timer: null
  };
  const next = [...commands, command];
  await writeTransition(snapshot(next, receipts));
  commands = next;
  armDeadline(command);
  return command;
}

async function queueWorkers(workers: readonly WorkerSpawn[]): Promise<void> {
  for (const worker of workers) {
    if (!swarmRunning(worker.runId)) continue;
    await queueCommand({
      type: 'worker',
      agent: worker.id,
      task: worker.task,
      model: worker.model,
      reasoningEffort: worker.reasoningEffort,
      runId: worker.runId
    });
  }
  await deliverNextFreshWorker();
}

async function queueRevivals(revivals: readonly CosWorkerRevivalRequest[]): Promise<void> {
  for (const revival of revivals) {
    if (!swarmRunning(revival.runId)) continue;
    await queueCommand({
      type: 'revive',
      agent: revival.id,
      conversationId: revival.conversationId,
      runId: revival.runId,
      wakeKey: revival.wakeKey
    });
  }
  notifyWake();
}

async function queueResumeCommand(options: {
  sessionId: string;
  token: string;
  summary: string;
  homeConversationId: string;
}): Promise<Command> {
  return await queueCommand({
    type: 'resume',
    sessionId: options.sessionId,
    token: options.token,
    summary: options.summary,
    homeConversationId: options.homeConversationId
  });
}

async function claimResumePlacement(command: Command): Promise<ReturnType<typeof resumePlacement>> {
  if (command.spec.type !== 'resume') return null;
  return await withLedgerLock(async () => {
    if (!commands.includes(command) || command.spec.type !== 'resume') return null;
    if (command.claimedAt !== null) return null;
    const claimedAt = Date.now();
    const next = commands.map((entry) =>
      entry === command ? { ...entry, claimedAt, timer: entry.timer } : entry
    );
    await writeTransition(snapshot(next, receipts));
    command.claimedAt = claimedAt;
    armDeadline(command);
    return resumePlacement(command);
  });
}

async function retireResumeCommand(
  token: string,
  conversationId: string | null,
  committed: boolean,
  error: string | null
): Promise<void> {
  const command = commands.find((entry) => entry.spec.type === 'resume' && entry.spec.token === token);
  if (!command) return;
  await withCommandLock(command.id, async () => {
    if (!commands.includes(command)) return;
    await finalizeCommand(command, {
      id: command.id,
      client: command.owner,
      conversationId,
      outcome: committed ? 'committed' : 'terminal-failure',
      committed,
      error: committed ? null : error,
      completedAt: Date.now()
    });
  });
}

async function handleCompact(body: Record<string, unknown>) {
  if (body.automatic === true) {
    return { status: 409, body: { error: 'automatic_compaction_disabled' } };
  }
  const token = typeof body.token === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(body.token)
    ? body.token
    : '';

  if (body.destinationAttempt === true) {
    const result = await beginCosContinuationDestinationSendNow(token);
    return result
      ? { status: 200, body: { allowed: result.allowed, destinationSend: result.checkpoint } }
      : { status: 409, body: { error: 'destination_send_not_available' } };
  }
  if (body.destinationDispatch === true) {
    const armed = await dispatchCosContinuationDestinationSendNow(token);
    return {
      status: armed ? 200 : 409,
      body: armed ? { armed: true } : { error: 'destination_send_reclaimed' }
    };
  }
  if (body.destinationLost === true) {
    const released = await releaseCosContinuationDestinationBeforeSendNow(token);
    if (!released) return { status: 409, body: { error: 'destination_send_not_releasable' } };
    const entry = continuationByToken(token);
    if (!entry) return { status: 409, body: { error: 'no_such_continuation' } };
    await retireResumeCommand(token, null, false, 'the replacement draft was lost before Send');
    const next = await queueResumeCommand({
      sessionId: entry.sessionId,
      token,
      summary: entry.summary,
      homeConversationId: entry.from
    });
    return {
      status: 200,
      body: { released: true, placement: await claimResumePlacement(next), job: continuationJobForConversation(entry.from) }
    };
  }

  const conversationId = validConversationId(body.conversationId);
  if (!conversationId) return { status: 400, body: { error: 'bad_conversation_id' } };

  if (typeof body.destinationMessageId === 'string') {
    const entry = continuationByToken(token);
    if (!entry) return { status: 409, body: { error: 'no_such_continuation' } };
    const result = await bindCosContinuationDestinationMessageNow(
      token,
      conversationId,
      body.destinationMessageId.slice(0, 300)
    );
    if (result === 'rejected') return { status: 409, body: { error: 'resume_commit_rejected' } };
    await retireResumeCommand(token, conversationId, true, null);
    return {
      status: 200,
      body: { committed: true, conversationId, job: continuationJobForConversation(conversationId) }
    };
  }

  const session = cosSessionForConversation(conversationId);
  if (!session) return { status: 409, body: { error: 'session_not_recorded' } };
  if (session.conversationId !== conversationId) {
    return { status: 409, body: { error: 'conversation_superseded' } };
  }
  const agent = agentForConversation(conversationId);
  if (agent && agent !== 'prime') {
    return {
      status: 409,
      body: {
        error: 'worker_compaction_disabled',
        message: 'Worker chats stay in their existing conversation so the prime can revive them safely.'
      }
    };
  }

  const existing = token ? continuationByToken(token) : continuationForConversation(conversationId);
  if (token && (!existing || existing.sessionId !== session.sessionId)) {
    return { status: 409, body: { error: 'no_such_continuation' } };
  }

  if (body.cancel === true) {
    const target = existing;
    if (!target) return { status: 200, body: { cancelled: false, sessionId: session.sessionId, job: null } };
    const cancelled = await abortCosContinuationNow(target.token, 'cancelled');
    if (cancelled) await retireResumeCommand(target.token, null, false, 'cancelled');
    return {
      status: 200,
      body: { cancelled, sessionId: session.sessionId, job: continuationJobForConversation(conversationId) }
    };
  }
  if (body.sourceLost === true) {
    if (!existing || existing.from !== conversationId) return { status: 409, body: { error: 'no_such_continuation' } };
    const aborted = await releaseCosContinuationSourceBeforeSendNow(existing.token);
    return {
      status: aborted ? 200 : 409,
      body: aborted
        ? { aborted: true, sessionId: session.sessionId, job: continuationJobForConversation(conversationId) }
        : { error: 'source_send_not_releasable' }
    };
  }
  if (body.sourceAttempt === true) {
    if (!existing || existing.from !== conversationId) return { status: 409, body: { error: 'no_such_continuation' } };
    const result = await beginCosContinuationSourceSendNow(existing.token);
    return result
      ? { status: 200, body: { allowed: result.allowed, sourceSend: result.checkpoint } }
      : { status: 409, body: { error: 'source_send_not_available' } };
  }
  if (body.sourceDispatch === true) {
    if (!existing || existing.from !== conversationId) return { status: 409, body: { error: 'no_such_continuation' } };
    const armed = await dispatchCosContinuationSourceSendNow(existing.token);
    return {
      status: armed ? 200 : 409,
      body: armed ? { armed: true } : { error: 'source_send_reclaimed' }
    };
  }
  if (typeof body.sourceMessageId === 'string') {
    if (!existing || existing.from !== conversationId) return { status: 409, body: { error: 'no_such_continuation' } };
    const bound = await bindCosContinuationSourceMessageNow(
      existing.token,
      body.sourceMessageId.slice(0, 300),
      typeof body.sourceProgress === 'number' ? body.sourceProgress : undefined
    );
    return bound
      ? { status: 200, body: { bound: true, job: continuationJobForConversation(conversationId) } }
      : { status: 409, body: { error: 'source_message_conflict' } };
  }
  if (typeof body.summary === 'string') {
    if (!existing || existing.from !== conversationId) return { status: 409, body: { error: 'no_such_continuation' } };
    const captured = await captureCosContinuationSummaryNow(existing.token, body.summary);
    if (!captured) return { status: 409, body: { error: 'brief_not_stored' } };
    const command = await queueResumeCommand({
      sessionId: captured.sessionId,
      token: captured.token,
      summary: captured.summary,
      homeConversationId: captured.from
    });
    return {
      status: 200,
      body: {
        stored: true,
        sessionId: captured.sessionId,
        commandId: command.id,
        placement: await claimResumePlacement(command),
        job: continuationJobForConversation(conversationId)
      }
    };
  }

  if (body.ticket === true) {
    const opened = await openCosContinuationNow(session.sessionId, conversationId);
    return {
      status: 202,
      body: {
        started: opened.started,
        filed: true,
        sessionId: session.sessionId,
        token: opened.continuation.token,
        sourceSend: opened.continuation.sourceSend,
        prompt: null,
        job: continuationJobForConversation(conversationId)
      }
    };
  }

  if (session.activeTurnId) {
    return {
      status: 409,
      body: {
        error: 'active_turn_running',
        message: 'Compact & Resume requires the current COS turn to settle before the handoff prompt is released.'
      }
    };
  }

  if (cosProtectedToolActivityCount(session.sessionId) > 0) {
    return {
      status: 409,
      body: {
        error: 'local_tools_running',
        message: 'Protected Resolve calls are still running; Compact & Resume stayed in the current conversation.'
      }
    };
  }

  const opened = await openCosContinuationNow(session.sessionId, conversationId);
  const continuation = opened.continuation;
  const prompt = continuation.state === 'awaiting-summary'
    && (continuation.sourceSend.state === 'not-attempted' || continuation.sourceSend.state === 'attempted-unresolved')
    ? cosNativeHandoffPrompt(continuation.token)
    : null;
  return {
    status: prompt ? 202 : 200,
    body: {
      started: opened.started,
      sessionId: session.sessionId,
      token: continuation.token,
      sourceSend: continuation.sourceSend,
      prompt,
      job: continuationJobForConversation(conversationId)
    }
  };
}

async function replayOwedBrowserWork(): Promise<void> {
  const spawns = pendingWorkerSpawns();
  if (spawns.length > 0) await queueWorkers(spawns);
  const revivals = pendingWorkerRevivals().map((revival) => ({
    primeConversationId: revival.primeConversationId,
    id: revival.id,
    conversationId: revival.conversationId,
    runId: revival.runId,
    wakeKey: wakeKey(revival.messageIds)
  }));
  if (revivals.length > 0) await queueRevivals(revivals);
}

async function deliverNextFreshWorker(): Promise<void> {
  if (!started) return;
  if (commands.some((command) => command.spec.type === 'worker' && command.claimedAt !== null)) return;
  const command = commands.find((entry) => entry.spec.type === 'worker' && entry.claimedAt === null);
  if (!command || command.spec.type !== 'worker') return;
  if (Date.now() >= deadlineAt(command)) {
    await withCommandLock(command.id, async () => { await expireCommand(command); });
    return;
  }
  if (!(await persistLease(command, null, Date.now()))) return;
  try {
    await openExternal(commandUrl(command));
  } catch (error) {
    const why = `the browser could not be opened (${error instanceof Error ? error.message : String(error)})`;
    try {
      await failCosWorkerBootstrapNow(command.spec.agent, why, command.spec.runId);
    } catch (persistError) {
      logWarn(`COS browser bridge could not durably fail ${command.spec.agent}: ${(persistError as Error).message}`);
      if (commands.includes(command)) armDeadline(command, 5_000);
      return;
    }
    if (!(await finalizeCommand(command, {
      id: command.id,
      client: null,
      conversationId: null,
      outcome: 'terminal-failure',
      committed: false,
      error: why,
      completedAt: Date.now()
    })) && commands.includes(command)) armDeadline(command, 5_000);
  }
}

function pendingRevivalCommand(): Command | null {
  for (const command of commands) {
    if (command.spec.type !== 'revive') continue;
    const spec = command.spec;
    const current = pendingWorkerRevivals().find(
      (revival) =>
        revival.id === spec.agent &&
        revival.runId === spec.runId &&
        revival.conversationId === spec.conversationId &&
        wakeKey(revival.messageIds) === spec.wakeKey
    );
    if (current) return command;
  }
  return null;
}

function parseCorrelationCalls(input: unknown): Array<{ requestId: string; messageId: string; turnId: string; tool: string }> {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  const out: Array<{ requestId: string; messageId: string; turnId: string; tool: string }> = [];
  for (const raw of input.slice(0, 100)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const requestId = typeof item.requestId === 'string' && /^[a-z0-9_-]{1,100}$/i.test(item.requestId) ? item.requestId : '';
    const messageId = typeof item.messageId === 'string' ? item.messageId.slice(0, 300) : '';
    const turnId = typeof item.turnId === 'string' && /^[0-9a-z_.:-]{1,100}$/i.test(item.turnId) ? item.turnId : '';
    const tool = typeof item.tool === 'string' && /^[a-z0-9_.-]{1,100}$/i.test(item.tool) ? item.tool : '';
    if (!requestId || !messageId || !turnId || !tool) continue;
    if (seen.has(messageId)) {
      duplicated.add(messageId);
      continue;
    }
    seen.add(messageId);
    out.push({ requestId, messageId, turnId, tool });
  }
  return out.filter((entry) => !duplicated.has(entry.messageId));
}

function parseWorkerEvents(input: unknown): {
  turnStarts: Array<{ at: number }>;
  settledFinalAnswer: string | null;
  settledTurnStartedAt: number | null;
} {
  if (!Array.isArray(input)) return { turnStarts: [], settledFinalAnswer: null, settledTurnStartedAt: null };
  const rows = input.slice(0, 500);
  const turnStarts: Array<{ at: number }> = [];
  const starts: Array<{ index: number; turnId: string; at: number }> = [];
  const ends = new Map<string, number>();
  const finals: Array<{ index: number; turnId: string; text: string }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (item.kind === 'turn_start') {
      const at = typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : Date.now();
      turnStarts.push({ at });
      if (typeof item.turnId === 'string' && item.turnId) starts.push({ index, turnId: item.turnId, at });
      continue;
    }
    if (
      item.kind === 'turn_end' &&
      item.outcome === 'completed' &&
      typeof item.turnId === 'string' &&
      item.turnId
    ) {
      ends.set(item.turnId, index);
      continue;
    }
    if (
      item.kind === 'assistant_message' &&
      item.final === true &&
      item.state === 'final' &&
      item.activeNow === true &&
      typeof item.turnId === 'string' &&
      item.turnId &&
      typeof item.text === 'string' &&
      item.text.trim()
    ) {
      finals.push({ index, turnId: item.turnId, text: item.text.slice(0, 512 * 1024) });
    }
  }
  // Browser completion is intentionally stricter than transcript ingestion. A replayed historical
  // final may still carry the old activeNow bit in the extension journal; it may not sleep a
  // worker that has since begun a newer turn. Require the same batch to contain this exact turn's
  // start, active final and completed end, with no later turn start overtaking it.
  let settledFinalAnswer: string | null = null;
  let settledTurnStartedAt: number | null = null;
  for (const final of finals) {
    const start = [...starts].reverse().find((entry) => entry.turnId === final.turnId && entry.index <= final.index);
    const end = ends.get(final.turnId);
    if (!start || end === undefined || end < final.index) continue;
    const laterStart = starts.some((entry) => entry.index > end && entry.turnId !== final.turnId);
    if (laterStart) continue;
    settledFinalAnswer = final.text;
    settledTurnStartedAt = start.at;
  }
  return { turnStarts, settledFinalAnswer, settledTurnStartedAt };
}

async function handleCorrelations(body: Record<string, unknown>) {
  const conversationId = validConversationId(body.conversationId);
  const calls = parseCorrelationCalls(body.calls);
  if (!conversationId || calls.length === 0) return { status: 400, body: { error: 'bad_request_evidence' } };
  const session = await ensureCosSessionNow(conversationId);
  if (session.conversationId !== conversationId) {
    return { status: 409, body: { error: 'conversation_superseded' } };
  }
  const requestIds = [...new Set(calls.map((call) => call.requestId))];
  const conflicts = new Set<string>();
  for (const call of calls) {
    try {
      admitExactCosCaller({
        conversationId,
        sessionId: session.sessionId,
        turnId: call.turnId,
        messageId: call.messageId,
        tool: call.tool
      }, call.tool);
    } catch {
      conflicts.add(call.requestId);
      continue;
    }
    const result = await observeCosRequestCorrelationNow({
      requestId: call.requestId,
      conversationId,
      sessionId: session.sessionId,
      turnId: call.turnId,
      messageId: call.messageId,
      tool: call.tool,
      observedAt: Date.now()
    });
    if (result === 'refused') conflicts.add(call.requestId);
  }
  const confirmed = requestIds.filter((requestId) => {
    if (conflicts.has(requestId)) return false;
    const held = cosRequestCorrelation(requestId);
    return Boolean(held && held.conversationId === conversationId && held.sessionId === session.sessionId);
  });
  return {
    status: 200,
    body: {
      ok: true,
      conversationId,
      sessionId: session.sessionId,
      requestIds,
      confirmed,
      conflicts: [...conflicts],
      complete: conflicts.size === 0 && confirmed.length === requestIds.length
    }
  };
}

async function handleEvents(body: Record<string, unknown>) {
  const conversationId = validConversationId(body.conversationId);
  if (!conversationId) return { status: 400, body: { error: 'bad_conversation_id' } };
  // COS Session durability is the acknowledgement boundary for the browser journal. Worker
  // lifecycle is applied only after the same observations are safely recorded; a later failure
  // causes a retry and the Session recorder is idempotent.
  const session = await recordCosBrowserEventsNow(conversationId, body.events);
  const agent = typeof body.agent === 'string' && /^[a-z0-9-]{1,40}$/i.test(body.agent) ? body.agent : null;
  const agentCommandId = validCommandId(body.agentCommandId);
  if (agent && agentCommandId) {
    const command = commands.find(
      (entry) => entry.id === agentCommandId && entry.spec.type === 'worker' && entry.spec.agent === agent && entry.claimedAt !== null
    );
    if (command?.spec.type === 'worker' && swarmRunning(command.spec.runId)) {
      await withCommandLock(command.id, async () => {
        if (!commands.includes(command) || command.spec.type !== 'worker') return;
        const bound = await bindCosWorkerConversationNow(agent, conversationId, command.spec.runId);
        if (bound && commands.includes(command)) {
          await finalizeCommand(command, {
            id: command.id,
            client: command.owner,
            conversationId,
            outcome: 'committed',
            committed: true,
            error: null,
            completedAt: Date.now()
          });
        }
      });
    }
  }
  await observeCosBrowserConversationNow(conversationId, 'page');
  const parsed = parseWorkerEvents(body.events);
  for (const turn of parsed.turnStarts) await observeCosBrowserConversationNow(conversationId, 'turn', turn.at);
  const workerId = agentForConversation(conversationId);
  const runId = currentRunId(conversationId);
  const revivalCut = runId ? workerRevivalClaimedAt(conversationId, runId) : null;
  if (
    parsed.settledFinalAnswer &&
    parsed.settledTurnStartedAt !== null &&
    workerId &&
    workerId !== 'prime' &&
    runId &&
    (revivalCut === null || parsed.settledTurnStartedAt >= revivalCut)
  ) {
    await finishCosWorkerConversationNow(conversationId, parsed.settledFinalAnswer);
  }
  return { status: 200, body: { ok: true, sessionId: session.sessionId } };
}

async function handleRedeem(body: Record<string, unknown>) {
  const id = validCommandId(body.id);
  const client = validClient(body.client);
  const reportedConversation = body.conversationId === undefined ? null : validConversationId(body.conversationId);
  if (!id || !client) return { status: 400, body: { error: 'bad_command_identity' } };
  if (body.conversationId !== undefined && !reportedConversation) return { status: 400, body: { error: 'bad_conversation_id' } };

  return await withCommandLock(id, async () => {
    const command = commands.find((entry) => entry.id === id);
    if (!command) return { status: 404, body: { error: 'no_such_command' } };
    if (command.owner && command.owner !== client) return { status: 409, body: { error: 'command_taken' } };
    if (reportedConversation && (command.spec.type !== 'revive' || command.spec.conversationId !== reportedConversation)) {
      return { status: 409, body: { error: 'command_wrong_conversation' } };
    }
    if (command.spec.type === 'resume') {
      if (reportedConversation) return { status: 409, body: { error: 'resume_destination_not_assigned_yet' } };
      const continuation = continuationByToken(command.spec.token);
      if (!continuation || continuation.sessionId !== command.spec.sessionId || continuation.state !== 'awaiting-chat') {
        return { status: 404, body: { error: 'no_such_command' } };
      }
      if (!(await persistLease(command, client, Date.now()))) {
        return { status: 503, body: { error: 'command_lease_not_durable', retryable: true } };
      }
      return {
        status: 200,
        body: { command: wireCommand(command, cosResumeBootstrapText(command.spec.summary, command.spec.token)) }
      };
    }
    if (command.spec.type === 'revive') {
      const spec = command.spec;
      const revival = pendingWorkerRevivals().find(
        (entry) =>
          entry.id === spec.agent &&
          entry.runId === spec.runId &&
          entry.conversationId === spec.conversationId &&
          wakeKey(entry.messageIds) === spec.wakeKey
      );
      if (!revival || reportedConversation !== spec.conversationId) {
        return { status: 404, body: { error: 'no_such_command' } };
      }
      let payload;
      try {
        payload = await claimCosWorkerRevival(spec.agent, spec.conversationId, command.id, spec.runId);
      } catch {
        return { status: 503, body: { error: 'worker_revival_claim_not_durable', retryable: true } };
      }
      if (!payload) return { status: 404, body: { error: 'no_such_command' } };
      if (!(await persistLease(command, client, Date.now()))) {
        return { status: 503, body: { error: 'command_lease_not_durable', retryable: true } };
      }
      return { status: 200, body: { command: wireCommand(command, payload.text) } };
    }
    if (!(await persistLease(command, client, Date.now()))) {
      return { status: 503, body: { error: 'command_lease_not_durable', retryable: true } };
    }
    return { status: 200, body: { command: wireCommand(command, workerBootstrapText(command.spec)) } };
  });
}

async function handleAck(body: Record<string, unknown>) {
  const id = validCommandId(body.id);
  const client = validClient(body.client);
  const status = body.status === 'failed' ? 'failed' : 'sent';
  const error = typeof body.error === 'string' ? body.error.slice(0, 200) : null;
  const conversation = validConversationId(body.conversationId);
  if (!id) return { status: 400, body: { error: 'bad_command_identity' } };

  return await withCommandLock(id, async () => {
    const prior = receiptFor(id);
    if (prior) {
      if ((prior.client ?? '') !== client) return { status: 409, body: { error: 'receipt_client_changed' } };
      if ((prior.conversationId ?? null) !== conversation) return { status: 409, body: { error: 'receipt_conversation_changed' } };
      return { status: 200, body: receiptReply(prior) };
    }
    const command = commands.find((entry) => entry.id === id);
    if (!command) return { status: 404, body: { error: 'no_such_command' } };
    if (client && command.owner !== client) return { status: 409, body: { error: 'command_owner_changed' } };
    if (command.claimedAt === null) return { status: 409, body: { error: 'command_not_leased' } };

    let receipt: CommandReceipt;
    if (command.spec.type === 'revive') {
      const target = command.spec.conversationId;
      if (status === 'sent') {
        if (!conversation) return { status: 503, body: { error: 'conversation_required', retryable: true } };
        if (conversation !== target) return { status: 409, body: { error: 'command_wrong_conversation' } };
      } else if (conversation && conversation !== target) {
        return { status: 409, body: { error: 'command_wrong_conversation' } };
      }
      let accepted = false;
      try {
        accepted = await acknowledgeCosWorkerRevival({
          workerId: command.spec.agent,
          conversationId: target,
          runId: command.spec.runId,
          commandId: command.id,
          status,
          error
        });
      } catch {
        return { status: 503, body: { error: 'worker_revival_ack_not_durable', retryable: true } };
      }
      if (!accepted) return { status: 409, body: { error: 'worker_revival_not_owned' } };
      receipt = {
        id,
        client: client || command.owner,
        conversationId: target,
        outcome: status === 'sent' ? 'committed' : 'terminal-failure',
        committed: status === 'sent',
        error: status === 'sent' ? null : error || 'the browser could not reopen the worker chat',
        completedAt: Date.now()
      };
    } else if (command.spec.type === 'resume') {
      if (status === 'sent') {
        if (!conversation) return { status: 503, body: { error: 'conversation_required', retryable: true } };
        let committed: 'committed' | 'already-committed' | 'rejected';
        try {
          committed = await commitCosContinuationFromAckNow(command.spec.token, conversation);
        } catch {
          return { status: 503, body: { error: 'resume_commit_not_durable', retryable: true } };
        }
        if (committed === 'rejected') return { status: 409, body: { error: 'resume_commit_rejected' } };
        receipt = {
          id,
          client: client || command.owner,
          conversationId: conversation,
          outcome: 'committed',
          committed: true,
          error: null,
          completedAt: Date.now()
        };
      } else {
        const why = error || 'the browser could not start the replacement COS conversation';
        let aborted = false;
        try {
          aborted = await abortCosContinuationNow(command.spec.token, why);
        } catch {
          return { status: 503, body: { error: 'resume_abort_not_durable', retryable: true } };
        }
        const settled = continuationByToken(command.spec.token);
        if (settled?.state === 'committed' && settled.to) {
          receipt = {
            id,
            client: client || command.owner,
            conversationId: settled.to,
            outcome: 'committed',
            committed: true,
            error: null,
            completedAt: Date.now()
          };
        } else if (!settled || settled.state === 'aborted') {
          receipt = {
            id,
            client: client || command.owner,
            conversationId: conversation,
            outcome: 'terminal-failure',
            committed: false,
            error: settled?.error ?? why,
            completedAt: Date.now()
          };
        } else if (!aborted) {
          return {
            status: 503,
            body: { error: 'resume_send_outcome_unresolved', retryable: true }
          };
        } else {
          receipt = {
            id,
            client: client || command.owner,
            conversationId: conversation,
            outcome: 'terminal-failure',
            committed: false,
            error: why,
            completedAt: Date.now()
          };
        }
      }
    } else if (status === 'sent') {
      if (!conversation) return { status: 503, body: { error: 'conversation_required', retryable: true } };
      if (!swarmRunning(command.spec.runId)) return { status: 409, body: { error: 'worker_run_changed' } };
      let bound = false;
      try {
        bound = await bindCosWorkerConversationNow(command.spec.agent, conversation, command.spec.runId);
      } catch {
        return { status: 503, body: { error: 'worker_binding_not_durable', retryable: true } };
      }
      if (!bound && agentConversation(command.spec.agent, command.spec.runId) !== conversation) {
        return { status: 409, body: { error: 'worker_binding_refused' } };
      }
      receipt = {
        id,
        client: client || command.owner,
        conversationId: conversation,
        outcome: 'committed',
        committed: true,
        error: null,
        completedAt: Date.now()
      };
    } else {
      const why = error ? `the browser could not start the worker chat — ${error}` : 'the browser could not start the worker chat';
      try {
        await failCosWorkerBootstrapNow(command.spec.agent, why, command.spec.runId);
      } catch {
        return { status: 503, body: { error: 'worker_failure_not_durable', retryable: true } };
      }
      receipt = {
        id,
        client: client || command.owner,
        conversationId: conversation,
        outcome: 'terminal-failure',
        committed: false,
        error: why,
        completedAt: Date.now()
      };
    }
    if (!(await finalizeCommand(command, receipt))) {
      return { status: 503, body: { error: 'command_receipt_not_durable', retryable: true } };
    }
    return { status: 200, body: receiptReply(receipt) };
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const { ok: originAllowed, origin } = originOf(req);
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const route = url.pathname;
  if (!originAllowed) return json(res, 403, { error: 'forbidden_origin' }, null);
  if (req.method === 'OPTIONS') {
    if (!origin) return json(res, 403, { error: 'forbidden_origin' }, null);
    res.writeHead(204, {
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, content-type, x-extension-version, x-extension-protocol',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-private-network': 'true',
      'access-control-max-age': '600'
    });
    res.end();
    return;
  }
  if (route === '/hello') {
    return json(res, 200, {
      app: 'chat-in-davinci',
      version: APP_VERSION,
      bridge: CID_COMPANION_BRIDGE_PROTOCOL,
      compatible: protocolCompatible(req),
      paired: bridgeToken !== null,
      disconnected: false
    }, origin);
  }
  if (route === '/pair' && req.method === 'POST') {
    if (origin !== CID_COMPANION_EXTENSION_ORIGIN) return json(res, 403, { error: 'forbidden_origin' }, null);
    if (!protocolCompatible(req)) {
      return json(res, 426, { error: 'incompatible_extension', bridge: CID_COMPANION_BRIDGE_PROTOCOL, version: APP_VERSION }, origin);
    }
    const paired = await withPairLock(async () => {
      // Continuity check and token rotation are one transaction. Two requests carrying the
      // same old bearer cannot both mint different accepted successor tokens.
      if (bridgeToken && !authorised(req)) {
        return { status: 401, body: { error: 'pairing_continuity_required' } };
      }
      const token = randomBytes(32).toString('base64url');
      try {
        await setCosBrowserBridgeToken(token);
      } catch {
        return { status: 503, body: { error: 'secure_storage_unavailable' } };
      }
      bridgeToken = token;
      noteBrowserSeen();
      logInfo('COS browser companion connected to Chat in DaVinci');
      return { status: 200, body: { token } };
    });
    return json(res, paired.status, paired.body, origin);
  }
  if (!authorised(req)) return json(res, 401, { error: 'unauthorised' }, origin);
  if (!protocolCompatible(req)) return json(res, 426, { error: 'incompatible_extension', bridge: CID_COMPANION_BRIDGE_PROTOCOL }, origin);
  noteBrowserSeen();

  if (route === '/status') {
    const revival = pendingRevivalCommand();
    const inputRows = listDecisionInputs();
    return json(res, 200, {
      ok: true,
      conversations: [],
      stopTurns: [],
      modelCatalogRequest: null,
      pluginRefreshRequests: [],
      browserPreferenceRequest: null,
      inputOpeningIds: inputRows.filter((row) => !['sent', 'failed', 'cancelled'].includes(row.state)).map((row) => row.id),
      inputs: [
        ...pendingBrowserDecisions(),
        ...inputRows.filter((row) => row.lifetime === 'temporary-planner' && ['sent', 'failed', 'cancelled'].includes(row.state))
          .map((row) => ({ id: row.id, owner: row.owner, lifetime: row.lifetime, close: true, retire: true, replacements: [] }))
      ],
      background: false,
      browserOnly: false,
      browserWorkArea: null,
      browserWindowBounds: null,
      commands: commands.length,
      revival: revival?.spec.type === 'revive' ? { id: revival.id, conversationId: revival.spec.conversationId } : null,
      placement: null,
      repairs: [],
      recoveryMonitoring: commands.length > 0,
      nonDiscardableConversations: [],
      closableConversations: [],
      managedConversations: [],
      reusableConversations: []
    }, origin);
  }

  let body: Record<string, unknown> = {};
  if (req.method === 'POST') {
    try {
      const raw = await readBody(req);
      body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    } catch (error) {
      return json(res, (error as Error).message === 'body_too_large' ? 413 : 400, { error: (error as Error).message }, origin);
    }
  }

  if (['/input/claim', '/input/ack', '/input/fail', '/input/progress', '/input/answer'].includes(route) && req.method === 'POST') {
    const id = typeof body.id === 'string' && /^[a-f0-9-]{36}$/i.test(body.id) ? body.id : '';
    const owner = typeof body.owner === 'string' && body.owner.length <= 160 ? body.owner : '';
    if (!id || !owner) return json(res, 400, { error: 'invalid_input_claim' }, origin);
    const entry = listDecisionInputs().find((row) => row.id === id && row.owner === owner);
    if (route === '/input/fail') {
      return json(res, 200, { ok: await failBrowserDecision(id, owner, typeof body.error === 'string' ? body.error : 'Unable to prepare ChatGPT') }, origin);
    }
    const target = body.conversationId === null || body.conversationId === undefined ? null : validConversationId(body.conversationId);
    if (body.conversationId !== null && body.conversationId !== undefined && !target) {
      return json(res, 400, { error: 'bad_conversation_id' }, origin);
    }
    if (route === '/input/progress') {
      return json(res, 200, { ok: typeof body.partial === 'string' && await publishBrowserDecision(id, owner, target, body.partial) }, origin);
    }
    if (route === '/input/ack' || route === '/input/answer') {
      if (!entry) return json(res, 409, { error: 'input_not_owned' }, origin);
      if (entry.lifetime !== 'temporary-planner') {
        if (!target) return json(res, 409, { error: 'helper_conversation_not_ready' }, origin);
        if (entry.decisionSourceSessionId) {
          try {
            await registerGoalDecisionChat(target, entry.decisionSourceSessionId);
          } catch (error) {
            return json(res, 409, { error: error instanceof Error ? error.message : 'goal_helper_binding_failed' }, origin);
          }
        }
      }
      if (route === '/input/answer') {
        return json(res, 200, { ok: typeof body.response === 'string' && await completeBrowserDecision(id, owner, body.response, target) }, origin);
      }
      return json(res, 200, {
        ok: await acknowledgeBrowserDecision(id, owner, target, typeof body.messageId === 'string' ? body.messageId : undefined)
      }, origin);
    }
    if (body.authorize === true) {
      return json(res, 200, { ok: await authorizeBrowserDecision(id, owner, target) }, origin);
    }
    const input = await claimBrowserDecision(id, owner, target, body.requiresAuthorization === true);
    return json(res, 200, { input }, origin);
  }

  if (route === '/correlations' && req.method === 'POST') {
    try {
      const result = await handleCorrelations(body);
      return json(res, result.status, result.body, origin);
    } catch {
      return json(res, 503, { error: 'correlation_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/worker-events' && req.method === 'POST') {
    try {
      const result = await handleEvents(body);
      return json(res, result.status, result.body, origin);
    } catch {
      return json(res, 503, { error: 'worker_observation_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/events' && req.method === 'POST') {
    try {
      const result = await handleEvents(body);
      return json(res, result.status, result.body, origin);
    } catch {
      return json(res, 503, { error: 'cos_session_recording_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/compact' && req.method === 'POST') {
    try {
      const result = await handleCompact(body);
      return json(res, result.status, result.body, origin);
    } catch (error) {
      logWarn(`COS Compact & Resume transaction failed: ${error instanceof Error ? error.message : String(error)}`);
      return json(res, 503, { error: 'continuation_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/goal/draft' && req.method === 'POST') {
    const conversationId = validConversationId(body.conversationId);
    const turnId = typeof body.turnId === 'string' ? body.turnId.slice(0, 200) : '';
    const clientId = validClient(body.clientId);
    if (!conversationId) return json(res, 400, { error: 'bad_conversation_id' }, origin);
    if (!turnId) return json(res, 400, { error: 'bad_turn_id' }, origin);
    if (!clientId) return json(res, 400, { error: 'bad_goal_client' }, origin);
    if (goalWorkerBlocked(conversationId)) return json(res, 409, { error: 'goal_worker_chat', retryable: false }, origin);
    const session = currentCosSessionForConversation(conversationId);
    if (!session) return json(res, 409, { error: 'session_not_recorded', retryable: false }, origin);
    if (!goalArmedFor(conversationId) || isGoalDecisionChat(conversationId)) {
      return json(res, 409, { error: 'goal_disabled', retryable: false }, origin);
    }
    const terminalIndex = session.events.findIndex((event) =>
      event.kind === 'turn_end' && event.turnId === turnId && event.outcome === 'completed'
    );
    if (terminalIndex < 0 || session.activeTurnId) {
      return json(res, 409, { error: 'goal_reply_not_pending', retryable: true }, origin);
    }
    try {
      const goal = startGoalDraft({
        sessionId: session.sessionId,
        conversationId,
        turnId,
        clientId,
        deferStart: true,
        loadConversation: () => {
          const current = currentCosSessionForConversation(conversationId);
          if (!current || current.sessionId !== session.sessionId) return null;
          return {
            conversationId: current.conversationId,
            messages: current.events.flatMap((event): GoalConversationMessage[] => {
              if (event.kind === 'user_message') return [{ role: 'user', content: event.text }];
              if (event.kind === 'assistant_message') return [{ role: 'assistant', content: event.text }];
              return [];
            })
          };
        },
        stopGate: async () => {
          const current = currentCosSessionForConversation(conversationId);
          if (!current || current.sessionId !== session.sessionId) return 'unavailable';
          const end = current.events.findIndex((event) => event.kind === 'turn_end' && event.turnId === turnId);
          if (end < 0 || current.events.slice(end + 1).some((event) => event.kind === 'user_message')) return 'incomplete';
          const projection = await projectCosSessionDecisionNow(session.sessionId);
          return !projection ? 'unavailable' : projection.completion.complete ? 'complete' : 'incomplete';
        }
      });
      try {
        await acceptGoalReplyNow({
          conversationId,
          sessionId: session.sessionId,
          replyId: `turn:${turnId}`.slice(0, 200),
          turnId,
          eventSeq: terminalIndex + 1,
          blocked: false
        });
      } catch (error) {
        discardPreparedGoalDraft(conversationId, goal.token);
        throw error;
      }
      beginGoalDraft(conversationId, goal.token);
      return json(res, 200, { goal, sessionId: session.sessionId }, origin);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'goal_draft_failed';
      const conflict = ['conversation_superseded', 'goal_reply_not_pending', 'goal_owned_elsewhere', 'goal_turn_already_handled'].includes(reason);
      return json(res, reason === 'goal_provider_unavailable' ? 503 : conflict ? 409 : 503, {
        error: reason,
        retryable: reason === 'goal_provider_unavailable' || reason === 'goal_reply_not_pending'
      }, origin);
    }
  }
  if (route === '/goal/ack' && req.method === 'POST') {
    const conversationId = validConversationId(body.conversationId);
    const token = typeof body.token === 'string' ? body.token.slice(0, 100) : '';
    const clientId = validClient(body.clientId);
    if (!conversationId) return json(res, 400, { error: 'bad_conversation_id' }, origin);
    if (!token || !clientId) return json(res, 400, { error: 'bad_goal_ack' }, origin);
    if (!currentCosSessionForConversation(conversationId)) {
      return json(res, 409, { error: 'conversation_superseded', retryable: false }, origin);
    }
    try {
      return json(res, 200, { acknowledged: await ackGoalDraftNow(conversationId, token, clientId) }, origin);
    } catch {
      return json(res, 503, { error: 'goal_ack_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/goal/helper/retry' && req.method === 'POST') {
    const conversationId = validConversationId(body.conversationId);
    const inputId = validCommandId(body.inputId);
    const clientId = validClient(body.clientId);
    if (!conversationId || !inputId || !clientId) return json(res, 400, { error: 'bad_goal_helper_retry' }, origin);
    if (goalWorkerBlocked(conversationId)) return json(res, 409, { error: 'goal_worker_chat', retryable: false }, origin);
    const session = currentCosSessionForConversation(conversationId);
    if (!session) return json(res, 409, { error: 'conversation_superseded', retryable: false }, origin);
    try {
      const accepted = await retryGoalBrowserHelper({
        conversationId,
        sourceSessionId: session.sessionId,
        inputId,
        clientId
      });
      return json(res, 200, { accepted }, origin);
    } catch {
      return json(res, 503, { error: 'goal_helper_retry_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/goal/open' && req.method === 'POST') {
    const text = typeof body.text === 'string' ? body.text : '';
    const mode = body.mode === 'loop' ? 'loop' : 'goal';
    if (!text.trim()) return json(res, 400, { error: 'no_objective' }, origin);
    const drafted = await draftOpeningMessage(text, mode);
    if ('error' in drafted) {
      return json(res, drafted.error === 'goal_provider_unavailable' ? 503 : 502, drafted, origin);
    }
    return json(res, 200, drafted, origin);
  }
  if (route === '/goal/objective' && req.method === 'POST') {
    const conversationId = validConversationId(body.conversationId);
    if (!conversationId || typeof body.text !== 'string') {
      return json(res, 400, { error: 'bad_goal_objective' }, origin);
    }
    const mode = body.mode === 'loop' ? 'loop' : body.mode === 'goal' ? 'goal' : undefined;
    if (goalWorkerBlocked(conversationId)) return json(res, 409, { error: 'goal_worker_chat' }, origin);
    try {
      const session = await ensureCosSessionNow(conversationId);
      if (session.conversationId !== conversationId) return json(res, 409, { error: 'conversation_superseded' }, origin);
      retireGoalDraftsFor(conversationId);
      if (mode) {
        const held = goalProjection(conversationId);
        const on = body.text.trim().length > 0;
        const which = on ? mode : held.enabled ? held.mode : mode;
        await setGoalSwitchNow(conversationId, which, on);
      }
      const objective = await setGoalObjectiveNow(conversationId, body.text);
      return json(res, 200, { ...goalProjection(conversationId), objective, own: true }, origin);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'cos_goal_not_durable';
      return json(res, reason.includes('Superseded') ? 409 : 503, { error: reason, retryable: !reason.includes('Superseded') }, origin);
    }
  }
  if (route === '/activity' && req.method === 'GET') {
    const conversationId = validConversationId(url.searchParams.get('conversationId'));
    if (!conversationId) return json(res, 400, { error: 'bad_conversation_id' }, origin);
    try {
      const session = await ensureCosSessionNow(conversationId);
      if (session.conversationId !== conversationId) {
        return json(res, 409, { error: 'conversation_superseded' }, origin);
      }
      const goal = goalProjection(conversationId);
      const agent = agentForConversation(conversationId);
      const workerBlocked = Boolean(agent && agent !== 'prime');
      const provider = goalProviderStatus();
      const goalClient = validClient(url.searchParams.get('goalClient'));
      const pausedHelper = pausedBrowserHelpers().find((entry) => entry.sourceSessionId === session.sessionId) ?? null;
      const revival = pendingRevivalCommand();
      const job = continuationJobForConversation(conversationId);
      return json(res, 200, {
        ok: true,
        sessionId: session.sessionId,
        events: [],
        since: Number(url.searchParams.get('since') ?? 0) || 0,
        nextSince: Number(url.searchParams.get('since') ?? 0) || 0,
        pendingTools: cosProtectedToolActivityCount(session.sessionId),
        activeTurnId: session.activeTurnId,
        bootstrap: session.continuationCount > 0 ? 'resume' : agent && agent !== 'prime' ? 'worker' : null,
        bootstrapAgent: agent && agent !== 'prime' ? agent : null,
        job,
        context: { auto: false, threshold: 0 },
        goal: {
          enabled: workerBlocked ? false : goal.enabled,
          own: true,
          mode: goal.mode,
          backend: provider.backend,
          model: provider.model,
          provider: provider.provider,
          hasKey: provider.available,
          objective: workerBlocked ? '' : goal.objective,
          blocked: workerBlocked ? 'worker' : null,
          pausedHelper: workerBlocked ? null : pausedHelper?.id ?? null,
          pending: workerBlocked ? null : goalPendingReplyFor(conversationId),
          draft: workerBlocked ? null : goalViewFor(conversationId, goalClient || undefined)
        },
        revival: revival?.spec.type === 'revive'
          ? { id: revival.id, conversationId: revival.spec.conversationId }
          : null,
        placement: null
      }, origin);
    } catch {
      return json(res, 503, { error: 'cos_session_runtime_unavailable', retryable: true }, origin);
    }
  }
  if (route === '/closed' && req.method === 'POST') {
    const conversationId = validConversationId(body.conversationId);
    if (!conversationId) return json(res, 400, { error: 'bad_conversation_id' }, origin);
    try {
      await closeCosBrowserConversationNow(conversationId);
      return json(res, 200, { ok: true }, origin);
    } catch {
      return json(res, 503, { error: 'conversation_close_not_durable', retryable: true }, origin);
    }
  }
  if (route === '/commands/revivals/pending' && req.method === 'POST') {
    const entries = Array.isArray(body.entries) ? body.entries.slice(0, 100) : null;
    if (!entries) return json(res, 400, { error: 'bad_revival_entries' }, origin);
    const pending: string[] = [];
    for (const raw of entries) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const candidate = raw as Record<string, unknown>;
      const id = validCommandId(candidate.id);
      const conversationId = validConversationId(candidate.conversationId);
      if (!id || !conversationId) continue;
      const command = commands.find((entry) => entry.id === id && entry.spec.type === 'revive');
      if (!command || command.spec.type !== 'revive' || command.spec.conversationId !== conversationId) continue;
      const spec = command.spec;
      if (workerRevivalDeliveredByCommand(spec.agent, conversationId, command.id, spec.runId)) continue;
      if (pendingWorkerRevivals().some((revival) =>
        revival.id === spec.agent &&
        revival.runId === spec.runId &&
        revival.conversationId === conversationId &&
        wakeKey(revival.messageIds) === spec.wakeKey)) {
        pending.push(id);
      }
    }
    return json(res, 200, { pending }, origin);
  }
  if (route === '/commands/redeem' && req.method === 'POST') {
    const result = await handleRedeem(body);
    return json(res, result.status, result.body, origin);
  }
  if (route === '/commands/ack' && req.method === 'POST') {
    const result = await handleAck(body);
    return json(res, result.status, result.body, origin);
  }
  if (route === '/settings' && req.method === 'GET') {
    const provider = goalProviderStatus();
    return json(res, 200, {
      ok: true,
      context: { auto: false, threshold: 0 },
      goal: {
        enabled: false,
        mode: 'goal',
        objective: '',
        backend: provider.backend,
        model: provider.model,
        provider: provider.provider,
        hasKey: provider.available
      }
    }, origin);
  }
  if (route === '/settings' && req.method === 'POST') {
    const conversationId = validConversationId(body.conversationId);
    if (body.autoCompact !== undefined) {
      return json(res, 409, { error: 'automatic_compaction_disabled', retryable: false }, origin);
    }
    if (!conversationId || (typeof body.goal !== 'boolean' && typeof body.loop !== 'boolean')) {
      return json(res, 400, { error: 'bad_goal_settings' }, origin);
    }
    const mode = typeof body.loop === 'boolean' ? 'loop' : 'goal';
    const enabled = typeof body.loop === 'boolean' ? body.loop : Boolean(body.goal);
    if (goalWorkerBlocked(conversationId)) return json(res, 409, { error: 'goal_worker_chat' }, origin);
    try {
      const session = await ensureCosSessionNow(conversationId);
      if (session.conversationId !== conversationId) return json(res, 409, { error: 'conversation_superseded' }, origin);
      retireGoalDraftsFor(conversationId);
      const goal = await setGoalSwitchNow(conversationId, mode, enabled);
      return json(res, 200, {
        ok: true,
        context: { auto: false, threshold: 0 },
        goal: { ...goal, own: true }
      }, origin);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'cos_goal_not_durable';
      return json(res, reason.includes('Superseded') ? 409 : 503, { error: reason, retryable: !reason.includes('Superseded') }, origin);
    }
  }
  return json(res, 404, { error: 'not_found' }, origin);
}

function webSocketFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  const header = Buffer.alloc(4);
  header[0] = 0x81;
  header[1] = 126;
  header.writeUInt16BE(payload.length, 2);
  return Buffer.concat([header, payload]);
}

function decodeClientFrame(buffer: Buffer<ArrayBufferLike>): { text: string | null; rest: Buffer<ArrayBufferLike>; close: boolean } | null {
  if (buffer.length < 2) return null;
  const opcode = buffer[0]! & 0x0f;
  const masked = (buffer[1]! & 0x80) !== 0;
  let length = buffer[1]! & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    return { text: null, rest: Buffer.alloc(0), close: true };
  }
  if (!masked || length > 4096 || buffer.length < offset + 4 + length) return null;
  const mask = buffer.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  for (let index = 0; index < payload.length; index += 1) payload[index] = payload[index]! ^ mask[index % 4]!;
  return {
    text: opcode === 0x1 ? payload.toString('utf8') : null,
    rest: buffer.subarray(offset + length),
    close: opcode === 0x8
  };
}

async function handleUpgrade(req: IncomingMessage, socket: Duplex): Promise<void> {
  const { ok, origin } = originOf(req);
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const key = req.headers['sec-websocket-key'];
  if (!ok || origin !== CID_COMPANION_EXTENSION_ORIGIN || url.pathname !== '/wake' || typeof key !== 'string') {
    socket.destroy();
    return;
  }
  const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  let authorisedSocket = false;
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  const authTimer = setTimeout(() => { if (!authorisedSocket) socket.destroy(); }, 5_000);
  authTimer.unref?.();
  socket.on('data', (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk]);
    for (;;) {
      const frame = decodeClientFrame(buffered);
      if (!frame) break;
      buffered = frame.rest;
      if (frame.close) {
        socket.destroy();
        return;
      }
      if (frame.text === null) continue;
      if (!authorisedSocket) {
        if (!bridgeToken || !safeEqual(frame.text, bridgeToken)) {
          socket.destroy();
          return;
        }
        authorisedSocket = true;
        clearTimeout(authTimer);
        wakeSockets.add(socket);
        noteBrowserSeen();
        if (pendingRevivalCommand()) socket.write(webSocketFrame('wake'));
      }
    }
  });
  const release = () => {
    clearTimeout(authTimer);
    wakeSockets.delete(socket);
  };
  socket.on('close', release);
  socket.on('error', release);
}

function notifyWake(force = false): void {
  if (!force && !pendingRevivalCommand()) return;
  for (const socket of wakeSockets) {
    if (!socket.destroyed) socket.write(webSocketFrame('wake'));
  }
}

async function defaultOpenExternal(url: string): Promise<void> {
  const { shell } = await import('electron');
  await shell.openExternal(url);
}

function listen(instance: http.Server, wantedPort: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      instance.off('listening', onListening);
      if (error.code === 'EADDRINUSE') resolve(null);
      else reject(error);
    };
    const onListening = () => {
      instance.off('error', onError);
      const address = instance.address();
      resolve(address && typeof address === 'object' ? address.port : wantedPort);
    };
    instance.once('error', onError);
    instance.once('listening', onListening);
    instance.listen(wantedPort, '127.0.0.1');
  });
}

function restoredSpec(raw: unknown): CommandSpec | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  if (item.type === 'resume') {
    const sessionId = typeof item.sessionId === 'string' ? item.sessionId : '';
    const token = typeof item.token === 'string' ? item.token : '';
    const summary = typeof item.summary === 'string' ? item.summary.slice(0, 96_000) : '';
    const homeConversationId = validConversationId(item.homeConversationId);
    if (!sessionId || sessionId.length > 128 || !/^[A-Za-z0-9_-]{16,64}$/.test(token)
      || !summary || !homeConversationId) return null;
    return { type: 'resume', sessionId, token, summary, homeConversationId };
  }
  const agent = typeof item.agent === 'string' && /^[a-z0-9-]{1,40}$/i.test(item.agent) ? item.agent : '';
  const runId = typeof item.runId === 'string' ? item.runId : '';
  if (!agent || !runId) return null;
  if (item.type === 'worker') {
    if (typeof item.task !== 'string') return null;
    return {
      type: 'worker',
      agent,
      task: item.task.slice(0, 512 * 1024),
      model: typeof item.model === 'string' ? item.model : null,
      reasoningEffort: typeof item.reasoningEffort === 'string' ? item.reasoningEffort : null,
      runId
    };
  }
  if (item.type === 'revive') {
    const conversationId = validConversationId(item.conversationId);
    const storedWakeKey = typeof item.wakeKey === 'string' ? item.wakeKey : '';
    if (!conversationId || !storedWakeKey) return null;
    return { type: 'revive', agent, conversationId, runId, wakeKey: storedWakeKey };
  }
  return null;
}

async function restoreCommands(): Promise<void> {
  const saved = await readDurable<Snapshot>(STATE);
  const now = Date.now();
  receipts = Array.isArray(saved?.receipts)
    ? saved!.receipts.filter((receipt) => receipt && now - Number(receipt.completedAt) <= COMMAND_TTL_MS).slice(-MAX_RECEIPTS)
    : [];
  commands = [];
  if (saved?.version === STATE_VERSION && Array.isArray(saved.commands)) {
    for (const raw of saved.commands.slice(-MAX_COMMANDS)) {
      if (!raw || typeof raw !== 'object') continue;
      const record = raw as DurableCommand;
      const spec = restoredSpec(record.spec);
      if (!spec || typeof record.id !== 'string' || !record.id || record.id.length > 128) continue;
      // Broker truth decides whether an old transport still needs semantic settlement. An
      // arbitrarily old command may not reopen a browser, but dropping its row before converting
      // an equally old durable `invited`/`waking` broker state would strand that slot forever.
      // Reconstruct still-current broker work and let its already-expired deadline settle it
      // immediately after publication; only transport rows with no broker owner are discarded.
      const createdAt = typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? Math.min(record.createdAt, now)
        : now - (spec.type === 'revive' ? REVIVAL_LIMIT_MS : WORKER_LIMIT_MS);
      if (spec.type === 'worker') {
        const bound = agentConversation(spec.agent, spec.runId);
        if (bound) {
          receipts.push({
            id: record.id,
            client: typeof record.owner === 'string' ? record.owner : null,
            conversationId: bound,
            outcome: 'committed',
            committed: true,
            error: null,
            completedAt: now
          });
          continue;
        }
        if (!pendingWorkerSpawns().some((worker) => worker.id === spec.agent && worker.runId === spec.runId)) continue;
      } else if (spec.type === 'revive') {
        if (workerRevivalDeliveredByCommand(spec.agent, spec.conversationId, record.id, spec.runId)) {
          receipts.push({
            id: record.id,
            client: typeof record.owner === 'string' ? record.owner : null,
            conversationId: spec.conversationId,
            outcome: 'committed',
            committed: true,
            error: null,
            completedAt: now
          });
          continue;
        }
        const pending = pendingWorkerRevivals().find(
          (revival) =>
            revival.id === spec.agent && revival.runId === spec.runId && revival.conversationId === spec.conversationId &&
            wakeKey(revival.messageIds) === spec.wakeKey
        );
        if (!pending) continue;
      } else {
        const continuation = continuationByToken(spec.token);
        if (!continuation || continuation.sessionId !== spec.sessionId) continue;
        if (continuation.state === 'committed' && continuation.to) {
          receipts.push({
            id: record.id,
            client: typeof record.owner === 'string' ? record.owner : null,
            conversationId: continuation.to,
            outcome: 'committed',
            committed: true,
            error: null,
            completedAt: now
          });
          continue;
        }
        if (continuation.state !== 'awaiting-chat') continue;
      }
      const command: Command = {
        id: record.id,
        spec,
        createdAt,
        claimedAt: typeof record.claimedAt === 'number' && Number.isFinite(record.claimedAt) ? record.claimedAt : null,
        owner: typeof record.owner === 'string' ? record.owner.slice(0, 64) : null,
        lastError: typeof record.lastError === 'string' ? record.lastError.slice(0, 200) : null,
        timer: null
      };
      commands.push(command);
    }
  }
  receipts = receipts.slice(-MAX_RECEIPTS);
  await writeDurableNow(STATE, snapshot());
  for (const command of [...commands]) {
    if (Date.now() >= deadlineAt(command)) {
      await withCommandLock(command.id, async () => { await expireCommand(command); });
    } else {
      armDeadline(command);
    }
  }
}

export async function startCosBrowserBridge(options: { openExternal?: BrowserOpener; ports?: readonly number[] } = {}): Promise<BridgeStatus> {
  if (started && server) return cosBrowserBridgeStatus();
  openExternal = options.openExternal ?? defaultOpenExternal;
  bridgeToken = await getCosBrowserBridgeToken();
  configureDecisionInputWake(() => notifyWake(true));
  await restoreCommands();
  const instance = http.createServer((req, res) => {
    void handle(req, res).catch((error) => {
      logWarn(`COS browser bridge request failed: ${(error as Error).message}`);
      if (!res.headersSent) json(res, 500, { error: 'internal_error' }, null);
      else res.end();
    });
  });
  instance.on('upgrade', (req, socket) => {
    void handleUpgrade(req, socket).catch(() => socket.destroy());
  });
  let boundPort: number | null = null;
  for (const candidate of options.ports ?? CID_COMPANION_BRIDGE_PORTS) {
    const actual = await listen(instance, candidate);
    if (actual !== null) {
      boundPort = actual;
      break;
    }
  }
  if (boundPort === null) {
    instance.close();
    throw new Error('No CID browser companion loopback port is available');
  }
  server = instance;
  port = boundPort;
  started = true;
  try {
    // Reconstruct browser transport from broker truth before publishing the runtime attachment.
    // This closes the crash window where broker `invited`/`waking` was durable but its command
    // file had not been written yet. The listener registration below replays the same owed rows
    // again, and queueCommand's exact idempotence turns that replay into a no-op.
    await replayOwedBrowserWork();
    attachCosHostBrowserRuntime(cosBrowserRuntime);
    logInfo(`COS browser companion bridge listening on 127.0.0.1:${boundPort}`);
    notifyWake();
    return cosBrowserBridgeStatus();
  } catch (error) {
    started = false;
    server = null;
    port = null;
    await new Promise<void>((resolve) => instance.close(() => resolve()));
    throw error;
  }
}

export async function stopCosBrowserBridge(): Promise<void> {
  attachCosHostBrowserRuntime(null);
  configureDecisionInputWake(null);
  started = false;
  for (const command of commands) {
    if (command.timer) clearTimeout(command.timer);
    command.timer = null;
  }
  for (const socket of wakeSockets) socket.destroy();
  wakeSockets.clear();
  const instance = server;
  server = null;
  port = null;
  if (instance) await new Promise<void>((resolve) => instance.close(() => resolve()));
}

export function cosBrowserBridgeStatus(): BridgeStatus {
  return {
    running: server !== null,
    port,
    paired: bridgeToken !== null,
    present: lastSeenAt !== null && Date.now() - lastSeenAt < 60_000,
    lastSeenAt
  };
}

export const cosBrowserRuntime: CosHostBrowserRuntime = {
  available: () => started && server !== null,
  openWorkers: queueWorkers,
  reviveWorkers: queueRevivals
};

export function resetCosBrowserBridgeForTests(): void {
  for (const command of commands) if (command.timer) clearTimeout(command.timer);
  commands = [];
  receipts = [];
  bridgeToken = null;
  lastSeenAt = null;
  started = false;
  openExternal = defaultOpenExternal;
  for (const socket of wakeSockets) socket.destroy();
  wakeSockets.clear();
  commandLocks.clear();
  ledgerQueue = Promise.resolve();
  pairQueue = Promise.resolve();
}
