/**
 * COS upper-runtime host seam for Chat in DaVinci.
 *
 * The broker below is the current Chat On Steroids multi-agent broker source, kept under
 * `src/cos-host/agents.ts`. This file adapts only product boundaries: exact ChatGPT caller
 * identity, durable persistence and browser worker side effects. It deliberately does not import
 * COS filesystem/terminal/Desktop/plugin authority and does not fall back to CID's legacy Agent
 * session store.
 */
import type { CallToolResult } from '@modelcontextprotocol/server';
import { createHash } from 'node:crypto';
import type { AgentCompletionReport, AgentDecisionFrame } from '../shared/agent-system.js';
import {
  PRIME_ID,
  acknowledgeOffersForConversation,
  agentConversation,
  agentForConversation,
  bindConversation,
  claimWorkerRevival,
  currentRunId,
  failAgent,
  failWorkerRevival,
  noteAgentAlive,
  noteWorkerRevived,
  onRetiredWorkersPersist,
  onRetiredWorkersPersistNow,
  onReviveRequest,
  onSpawnRequest,
  onSwarmPersist,
  onSwarmPersistNow,
  offerMessagesForConversation,
  persistCriticalSwarmNow,
  requestWorkerBootstraps,
  requestWorkerRevivals,
  pendingWorkerRevivals,
  releaseWorkerRevivalReservation,
  restoreRetiredWorkers,
  restoreSwarm,
  rollbackWorkerRevivalClaim,
  reusableWorkersForCaller,
  snapshotRetiredWorkers,
  snapshotSwarm,
  stageFinishAgent,
  stageQueuedWorkerRevivals,
  stageWorkerConversationFinish,
  stageMessages,
  stageSpawn,
  statusForCaller,
  primeConversationGone,
  workerConversationGone,
  workerRevivalClaimOwnedBy,
  workerRevivalDeliveredByCommand,
  type Caller,
  type RetiredWorkersSnapshot,
  type SwarmSnapshot,
  type WorkerRevival,
  type WorkerSpawn
} from './agents.js';
import type {
  CosAgentsInput,
  CosControlCallContext,
  CosControlRuntimeDelegate,
  CosSessionFinishInput,
  CosSessionInput
} from '../main/cos-control-tools.js';
import { attachCosControlRuntime, detachCosControlRuntime } from '../main/cos-control-runtime.js';
import { cosRequestIdentityRuntime, restoreCosRequestCorrelations } from './identity.js';
import { admitExactCosCaller } from './caller-admission.js';
import {
  durableStoreReady,
  readDurable,
  writeDurableNow,
  writeDurableSoon
} from '../main/durable.js';
import { logWarn } from '../main/log.js';
import {
  cosSessionById,
  currentCosSessionForConversation,
  goalFrameForCosSession,
  initCosSessionRuntime,
  listCosSessions,
  type CosSessionEvent,
  type CosSessionView
} from './session-runtime.js';
import {
  initCosContinuationRuntime,
  recoverCosContinuationRuntimeAfterSwarmRestoreNow
} from './continuation-runtime.js';
import { goalObjectiveFor, goalSwitchFor, initCanonicalGoalState } from './canonical/goal.js';
import { initDecisionInputTransport } from './canonical/input.js';

const COS_SWARM_STATE = 'cos-swarm';
const COS_RETIRED_WORKERS_STATE = 'cos-retired-workers';

export interface CosHostResolvedCaller {
  conversationId: string;
  sessionId?: string | null;
  turnId?: string | null;
  messageId?: string | null;
  tool?: string | null;
}

export interface CosHostIdentityRuntime {
  /**
   * Resolve one MCP call to exact browser/ChatGPT evidence. Returning null is a refusal, never a
   * cue to guess from timing or whichever chat is active.
   */
  resolveCaller(
    context: CosControlCallContext,
    tool: 'agents' | 'session' | 'session_finish'
  ): Promise<CosHostResolvedCaller | null>;
}

export interface CosHostBrowserRuntime {
  /** Whether a concrete browser companion can currently own browser side effects. */
  available?(): boolean;
  /**
   * Open fresh worker chats only after the broker's critical revision is durable. A rejected
   * promise means this batch was not accepted for delivery; partial acceptance must be reported
   * through the browser command/ACK layer instead of rejecting this queue handoff.
   */
  openWorkers(workers: readonly WorkerSpawn[]): Promise<void> | void;
  /**
   * Queue only exact revival identity. The queued user text is deliberately absent here and may
   * be obtained only through claimCosWorkerRevival() after its browser-ownership claim is durable.
   */
  reviveWorkers(revivals: readonly CosWorkerRevivalRequest[]): Promise<void> | void;
}

export interface CosWorkerRevivalRequest {
  primeConversationId: string;
  id: string;
  conversationId: string;
  runId: string;
  /** Stable identity of this wake without exposing its queued message ids or text. */
  wakeKey: string;
}

export interface CosWorkerRevivalAck {
  workerId: string;
  conversationId: string;
  runId: string;
  commandId: string;
  status: 'sent' | 'failed';
  error?: string | null;
}

export interface CosHostDecisionProjection {
  decision: AgentDecisionFrame;
  completion: AgentCompletionReport;
}

/** CID-owned derived projection. COS remains the Session/Goal/Finish authority. */
export interface CosHostDecisionRuntime {
  projectSession(session: CosSessionView, options?: { publish?: boolean }): Promise<CosHostDecisionProjection>;
}

let identityRuntime: CosHostIdentityRuntime = cosRequestIdentityRuntime;
let browserRuntime: CosHostBrowserRuntime | null = null;
let decisionRuntime: CosHostDecisionRuntime | null = null;
let detachSpawn: (() => void) | null = null;
let detachRevive: (() => void) | null = null;
let initialized = false;

function textResult(text: string, structuredContent?: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent ? { structuredContent } : {})
  };
}

function scheduleDurableMirrors(): void {
  writeDurableSoon(COS_SWARM_STATE, snapshotSwarm());
  writeDurableSoon(COS_RETIRED_WORKERS_STATE, snapshotRetiredWorkers());
}

function installPersistenceHooks(): void {
  onSwarmPersist(() => writeDurableSoon(COS_SWARM_STATE, snapshotSwarm()));
  onSwarmPersistNow(async (snapshot) => await writeDurableNow(COS_SWARM_STATE, snapshot));
  onRetiredWorkersPersist(() => writeDurableSoon(COS_RETIRED_WORKERS_STATE, snapshotRetiredWorkers()));
  onRetiredWorkersPersistNow(async (snapshot) => await writeDurableNow(COS_RETIRED_WORKERS_STATE, snapshot));
}

function detachBrowserHooks(): void {
  detachSpawn?.();
  detachRevive?.();
  detachSpawn = null;
  detachRevive = null;
}

function installBrowserHooks(): void {
  detachBrowserHooks();
  if (!browserRuntime) return;
  detachSpawn = onSpawnRequest((workers) => {
    const runtime = browserRuntime;
    if (!runtime) return;
    void Promise.resolve(runtime.openWorkers(workers)).catch((error) => {
      const why = `browser bootstrap queue rejected the worker batch: ${(error as Error).message}`;
      logWarn(`COS worker bootstrap failed: ${why}`);
      for (const worker of workers) failAgent(worker.id, why, undefined, {}, worker.runId);
      void criticalBarrier('COS worker bootstrap failure state is not durable yet').catch((persistError) => {
        logWarn(`COS worker bootstrap failure could not be persisted: ${(persistError as Error).message}`);
      });
    });
  });
  detachRevive = onReviveRequest((revivals) => {
    const runtime = browserRuntime;
    if (!runtime) return;
    const requests = revivals.map(({ primeConversationId, id, conversationId, runId, messageIds }) => ({
      primeConversationId,
      id,
      conversationId,
      runId,
      wakeKey: createHash('sha256').update(messageIds.join('\0')).digest('base64url').slice(0, 32)
    }));
    void Promise.resolve(runtime.reviveWorkers(requests)).catch((error) => {
      const why = `browser revival queue rejected the worker batch: ${(error as Error).message}`;
      logWarn(`COS worker revival failed: ${why}`);
      const pending = pendingWorkerRevivals();
      for (const revival of revivals) {
        if (pending.some((item) => item.id === revival.id && item.conversationId === revival.conversationId && item.runId === revival.runId)) {
          releaseWorkerRevivalReservation(revival.id, revival.conversationId, why, revival.runId);
        }
      }
      void criticalBarrier('COS worker revival failure state is not durable yet').catch((persistError) => {
        logWarn(`COS worker revival failure could not be persisted: ${(persistError as Error).message}`);
      });
    });
  });
}

export async function initCosHostRuntime(): Promise<void> {
  if (initialized) return;
  if (!durableStoreReady()) throw new Error('CID durable store must be initialized before the COS host runtime');
  attachCosControlRuntime(cosHostControlRuntime);
  try {
    installPersistenceHooks();
    const [swarm, retired] = await Promise.all([
      readDurable<SwarmSnapshot>(COS_SWARM_STATE),
      readDurable<RetiredWorkersSnapshot>(COS_RETIRED_WORKERS_STATE)
    ]);
    await restoreCosRequestCorrelations();
    await initCosSessionRuntime();
    await Promise.all([initCanonicalGoalState(), initDecisionInputTransport()]);
    await initCosContinuationRuntime();
    restoreRetiredWorkers(retired);
    restoreSwarm(swarm);
    await recoverCosContinuationRuntimeAfterSwarmRestoreNow();
    initialized = true;
    installBrowserHooks();
  } catch (error) {
    detachCosControlRuntime(cosHostControlRuntime);
    onSwarmPersist(null);
    onSwarmPersistNow(null);
    onRetiredWorkersPersist(null);
    onRetiredWorkersPersistNow(null);
    throw error;
  }
}

export function shutdownCosHostRuntime(): void {
  detachCosControlRuntime(cosHostControlRuntime);
  detachBrowserHooks();
  identityRuntime = cosRequestIdentityRuntime;
  browserRuntime = null;
  decisionRuntime = null;
  onSwarmPersist(null);
  onSwarmPersistNow(null);
  onRetiredWorkersPersist(null);
  onRetiredWorkersPersistNow(null);
  initialized = false;
}

export function attachCosHostIdentityRuntime(runtime: CosHostIdentityRuntime | null): void {
  identityRuntime = runtime ?? cosRequestIdentityRuntime;
}

export function attachCosHostDecisionRuntime(runtime: CosHostDecisionRuntime | null): void {
  decisionRuntime = runtime;
}

export async function projectCosSessionDecisionNow(sessionId: string): Promise<CosHostDecisionProjection | null> {
  if (!decisionRuntime) return null;
  const session = cosSessionById(sessionId);
  if (!session) return null;
  return await decisionRuntime.projectSession(session, { publish: true });
}

export function attachCosHostBrowserRuntime(runtime: CosHostBrowserRuntime | null): void {
  browserRuntime = runtime;
  installBrowserHooks();
}

/**
 * Browser/extension acknowledgement seam. The COS browser companion owns these calls once it is
 * physically rebased; exposing them here avoids giving the model any identity field.
 */
export function bindCosWorkerConversation(workerId: string, conversationId: string, runId?: string): boolean {
  return bindConversation(workerId, conversationId, runId);
}

/** Browser ACK boundary for a fresh Worker binding. Do not return success before it is durable. */
export async function bindCosWorkerConversationNow(
  workerId: string,
  conversationId: string,
  runId?: string
): Promise<boolean> {
  const bound = bindConversation(workerId, conversationId, runId);
  if (!bound) return false;
  await criticalBarrier('The fresh worker conversation binding is not durable yet; retry the same browser acknowledgement.');
  return true;
}

/** Browser transport failure for a fresh worker command. */
export async function failCosWorkerBootstrapNow(workerId: string, why: string, runId: string): Promise<boolean> {
  const failed = failAgent(workerId, why, undefined, {}, runId);
  // Even when an earlier attempt already changed the process-local broker row, a lost durable
  // write must be retryable. Re-fsync the current authoritative broker snapshot before browser
  // transport is ever allowed to disappear.
  await criticalBarrier('The failed worker bootstrap is not durable yet; keep its browser command retryable.');
  return failed !== null;
}

/** Exact browser page/turn evidence. Only a true state revival needs an immediate durable cut. */
export async function observeCosBrowserConversationNow(
  conversationId: string,
  source: 'page' | 'turn' = 'page',
  at = Date.now()
): Promise<boolean> {
  const alive = noteAgentAlive(conversationId, source, at);
  if (!alive) return false;
  if (alive.revived) {
    await criticalBarrier('The browser-proved worker revival is not durable yet.');
  }
  return true;
}

/** Last browser view of one exact conversation disappeared. */
export async function closeCosBrowserConversationNow(conversationId: string): Promise<boolean> {
  const changed = workerConversationGone(conversationId) || primeConversationGone(conversationId);
  if (!changed) return false;
  await criticalBarrier('The browser conversation detach is not durable yet; retry the close acknowledgement.');
  return true;
}

/** Release a wake that no browser command ever claimed; this is transport failure, not a chat strike. */
export async function releaseCosWorkerRevivalNow(
  workerId: string,
  conversationId: string,
  why: string,
  runId: string
): Promise<boolean> {
  const released = releaseWorkerRevivalReservation(workerId, conversationId, why, runId);
  // Same crash-order rule as a failed fresh bootstrap: if a previous retry already released the
  // live reservation, this call still has to make that current broker state durable before the
  // corresponding browser command may be pruned.
  await criticalBarrier('The unclaimed worker revival release is not durable yet.');
  return released;
}

export function cosWorkerConversation(workerId: string, runId: string): string | null {
  return agentConversation(workerId, runId);
}

/**
 * Gives the browser exclusive ownership of one exact sleeping-worker revival. The claim crosses
 * the critical durable barrier before the browser may receive or type the queued text.
 */
export async function claimCosWorkerRevival(
  workerId: string,
  conversationId: string,
  commandId: string,
  runId?: string
): Promise<WorkerRevival | null> {
  if (!commandId) throw new Error('COS worker revival claim requires a command id');
  const revival = pendingWorkerRevivals().find(
    (item) => item.id === workerId && item.conversationId === conversationId && (!runId || item.runId === runId)
  );
  if (!revival || !claimWorkerRevival(workerId, conversationId, commandId, runId)) return null;
  try {
    await criticalBarrier('The worker revival claim is not durable yet; no browser payload may be released.');
    return { ...revival, messageIds: [...revival.messageIds] };
  } catch (error) {
    if (rollbackWorkerRevivalClaim(workerId, conversationId, commandId, runId)) {
      try {
        const rolledBack = await persistCriticalSwarmNow();
        if (!rolledBack) logWarn(`COS worker revival claim rollback for ${workerId} is not durable yet`);
      } catch (rollbackError) {
        logWarn(`COS worker revival claim rollback for ${workerId} could not be persisted: ${(rollbackError as Error).message}`);
      }
    }
    throw error;
  }
}

/** Browser send/failure ACK for an already-claimed revival. */
export async function acknowledgeCosWorkerRevival(ack: CosWorkerRevivalAck): Promise<boolean> {
  if (!ack.commandId) throw new Error('COS worker revival acknowledgement requires a command id');

  if (ack.status === 'sent') {
    if (workerRevivalDeliveredByCommand(ack.workerId, ack.conversationId, ack.commandId, ack.runId)) return true;
    if (!workerRevivalClaimOwnedBy(ack.workerId, ack.conversationId, ack.commandId, ack.runId)) return false;
    const owed = pendingWorkerRevivals().some(
      (item) => item.id === ack.workerId && item.conversationId === ack.conversationId && item.runId === ack.runId
    );
    if (!owed) return false;
    const revival = pendingWorkerRevivals().find(
      (item) => item.id === ack.workerId && item.conversationId === ack.conversationId && item.runId === ack.runId
    );
    if (!revival || !noteWorkerRevived(ack.workerId, ack.conversationId, revival.messageIds, ack.commandId, ack.runId)) {
      return false;
    }
  } else {
    if (!workerRevivalClaimOwnedBy(ack.workerId, ack.conversationId, ack.commandId, ack.runId)) return false;
    const owed = pendingWorkerRevivals().some(
      (item) => item.id === ack.workerId && item.conversationId === ack.conversationId && item.runId === ack.runId
    );
    if (!owed) return false;
    failWorkerRevival(
      ack.workerId,
      ack.error || 'the browser could not reopen the worker chat',
      ack.runId,
      ack.commandId
    );
  }

  await criticalBarrier('The worker revival acknowledgement is not durable yet; browser must retry this acknowledgement.');
  return true;
}

async function reviveQueuedWorkerWork(conversationId: string): Promise<boolean> {
  const runtime = browserRuntime;
  if (!runtime || runtime.available?.() === false) return false;
  const workerId = agentForConversation(conversationId);
  const runId = currentRunId(conversationId);
  if (!workerId || workerId === PRIME_ID || !runId) return false;
  const staged = stageQueuedWorkerRevivals([workerId], runId);
  if (staged.waking.length === 0) return false;
  try {
    await criticalBarrier('The queued worker follow-up could not cross its durable revival barrier.');
    staged.commit();
  } catch (error) {
    staged.rollback();
    throw error;
  }
  requestWorkerRevivals(staged.waking, runId);
  return true;
}

/** Browser-observed settled final answer. The durable staged finish lands before the live commit. */
export async function finishCosWorkerConversationNow(conversationId: string, result: string): Promise<boolean> {
  const staged = stageWorkerConversationFinish(conversationId, result);
  let finished = false;
  if (staged && !staged.repeat) {
    try {
      await criticalBarrier('The browser-observed worker finish is not durable yet; keep this final observation retryable.');
      staged.commit();
      finished = true;
    } catch (error) {
      staged.rollback();
      throw error;
    }
  }
  const wokeQueuedWork = await reviveQueuedWorkerWork(conversationId);
  return finished || wokeQueuedWork;
}

async function exactControlCaller(
  context: CosControlCallContext,
  tool: 'agents' | 'session_finish'
): Promise<{ conversationId: string; session: CosSessionView; turnId: string; messageId: string }> {
  const resolved = await identityRuntime.resolveCaller(context, tool);
  return admitExactCosCaller(resolved, tool);
}

async function resolvedSessionCaller(
  context: CosControlCallContext,
  tool: 'session' | 'session_finish',
  required: boolean
): Promise<{ conversationId: string; session: CosSessionView } | null> {
  const resolved = await identityRuntime.resolveCaller(context, tool);
  if (!resolved?.conversationId) {
    if (required) throw new Error('Exact ChatGPT conversation identity is required for ' + tool);
    return null;
  }
  const session = currentCosSessionForConversation(resolved.conversationId);
  if (!session) {
    if (required) throw new Error('Exact COS Session identity is required for ' + tool);
    return null;
  }
  if (resolved.sessionId && resolved.sessionId !== session.sessionId) {
    throw new Error('COS caller Session identity conflicts with the recorded conversation owner');
  }
  return { conversationId: resolved.conversationId, session };
}

function eventText(event: CosSessionEvent): string {
  if (event.kind === 'user_message') return 'USER: ' + event.text;
  if (event.kind === 'assistant_message') return 'ASSISTANT: ' + event.text;
  if (event.kind === 'chat_error') return 'ERROR: ' + event.detail;
  if (event.kind === 'turn_start') return 'TURN START: ' + event.turnId;
  if (event.kind === 'turn_end') return 'TURN END: ' + event.turnId + ' (' + event.outcome + ')';
  if (event.kind === 'tool_call') return 'TOOL: ' + event.tool + ' (' + (event.ok ? 'ok' : 'failed') + ')';
  return 'TITLE: ' + event.text;
}

function filteredSessionEvents(session: CosSessionView, input: CosSessionInput): CosSessionEvent[] {
  const include = new Set(input.include ?? ['user', 'assistant', 'tools', 'errors', 'agents']);
  return session.events.filter((event) => {
    if (event.kind === 'user_message') return include.has('user');
    if (event.kind === 'assistant_message') return include.has('assistant');
    if (event.kind === 'chat_error') return include.has('errors');
    if (event.kind === 'tool_call') return include.has('tools');
    return false;
  }).slice(-500);
}

async function runSession(input: CosSessionInput, context: CosControlCallContext): Promise<CallToolResult> {
  const caller = await resolvedSessionCaller(context, 'session', false);
  if (input.action === 'search') {
    const sessions = listCosSessions(input.query, goalObjectiveFor);
    const current = caller?.session ?? null;
    const currentProjection = current && decisionRuntime ? await decisionRuntime.projectSession(current) : null;
    return textResult(
      sessions.length > 0
        ? sessions.map((session) =>
            session.sessionId + '  ' + (session.title ?? (goalObjectiveFor(session.conversationId).slice(0, 80) || 'Untitled Session'))
          ).join('\n')
        : 'No COS Sessions matched this search.',
      {
        action: 'search',
        current_session_id: current?.sessionId ?? null,
        sessions: sessions.map((session) => ({
          session_id: session.sessionId,
          title: session.title,
          updated_at: session.updatedAt,
          conversation_id: session.conversationId,
          goal: goalObjectiveFor(session.conversationId) || null
        })),
        ...(currentProjection ? {
          decision_frame: currentProjection.decision,
          completion_report: currentProjection.completion
        } : {})
      }
    );
  }
  const session = input.session_id ? cosSessionById(input.session_id) : null;
  if (!session) throw new Error('COS Session was not found');
  const events = filteredSessionEvents(session, input);
  const projection = decisionRuntime ? await decisionRuntime.projectSession(session) : null;
  return textResult(
    events.length > 0 ? events.map(eventText).join('\n\n') : 'This Session has no matching recorded rows.',
    {
      action: 'read',
      session_id: session.sessionId,
      conversation_id: session.conversationId,
      active_turn_id: session.activeTurnId,
      goal: goalFrameForCosSession(session, goalObjectiveFor(session.conversationId)),
      events,
      ...(projection ? {
        decision_frame: projection.decision,
        completion_report: projection.completion
      } : {})
    }
  );
}

async function runSessionFinish(
  input: CosSessionFinishInput,
  context: CosControlCallContext
): Promise<CallToolResult> {
  const caller = await exactControlCaller(context, 'session_finish');
  const session = caller.session;
  if (!decisionRuntime) {
    throw new Error('CID completion projection is unavailable; COS will not infer completion from model prose');
  }
  const projection = await decisionRuntime.projectSession(session);
  const current = currentCosSessionForConversation(caller.conversationId);
  if (!current || current.sessionId !== session.sessionId || current.activeTurnId !== caller.turnId) {
    throw new Error('The active COS turn changed after this session_finish call started');
  }
  const completion = projection.completion;
  const heldGoal = goalSwitchFor(session.conversationId);
  const loopHeld = heldGoal.enabled && heldGoal.mode === 'loop';
  if (completion.complete && !loopHeld) {
    return textResult(
      'RELEASED: CID verified every current Goal criterion from Resolve evidence. COS may finish this exact turn.',
      {
        action: 'session_finish',
        state: 'released',
        session_id: session.sessionId,
        turn_id: caller.turnId,
        summary_is_evidence: false,
        decision_frame: projection.decision,
        completion_report: completion
      }
    );
  }
  const gaps = [
    ...completion.criteria.filter((criterion) => criterion.status !== 'satisfied').map((criterion) =>
      criterion.criterion + ': ' + (criterion.blockingReason ?? criterion.status)
    ),
    ...completion.blockers,
    ...completion.materialUnknowns
  ];
  return textResult(
    'HELD: Keep this COS turn open. ' +
      (loopHeld
        ? 'Loop is enabled for this Session and does not stop on a completion checkpoint.'
        : 'Resolve completion evidence is incomplete: ' + (gaps.join('; ') || 'no verified completion criterion')),
    {
      action: 'session_finish',
      state: 'held',
      session_id: session.sessionId,
      turn_id: session.activeTurnId,
      summary_is_evidence: false,
      supplied_summary: input.summary,
      decision_frame: projection.decision,
      completion_report: completion
    }
  );
}

async function criticalBarrier(errorText: string): Promise<void> {
  let durable = false;
  try {
    durable = await persistCriticalSwarmNow();
  } catch (error) {
    throw new Error(`${errorText} (${error instanceof Error ? error.message : String(error)})`);
  }
  if (!durable) throw new Error(errorText);
}

function withBrokerInbox(
  caller: Caller,
  result: CallToolResult,
  finishing: boolean,
  startedAt: number
): CallToolResult {
  acknowledgeOffersForConversation(caller.conversationId, finishing, startedAt, finishing);
  const scoped = offerMessagesForConversation(caller.conversationId, finishing, finishing);
  const messages = scoped?.messages ?? [];
  if (messages.length === 0) return result;
  const lines = messages
    .map(
      (message) =>
        `• [${message.id}] from ${message.from}${message.offers > 1 ? ' (repeat — you may have seen this)' : ''}: ${message.text}`
    )
    .join('\n');
  return {
    ...result,
    content: [
      ...result.content,
      { type: 'text', text: `\n--- ${messages.length} message(s) for ${scoped?.agentId ?? 'this conversation'} ---\n${lines}` }
    ]
  };
}

async function runAgentsForCaller(input: CosAgentsInput, caller: Caller): Promise<CallToolResult> {

  if (input.action === 'spawn') {
    const workers = input.workers;
    if (!workers) throw new Error('agents action=spawn requires workers.');

    if ((input.spawn_mode ?? 'reuse-first') !== 'fresh') {
      const reusable = reusableWorkersForCaller(caller);
      if (reusable.length > 0) {
        const shown = [...reusable]
          .sort(
            (left, right) =>
              Math.max(right.sleptAt ?? 0, right.lastSeenAt ?? 0, right.activatedAt ?? 0, right.createdAt) -
              Math.max(left.sleptAt ?? 0, left.lastSeenAt ?? 0, left.activatedAt ?? 0, left.createdAt)
          )
          .slice(0, Math.max(8, workers.length));
        return textResult(
          'No new worker chats were opened. Reusable sleeping workers are available: ' +
            shown.map((info) => `${info.id} (${info.label})`).join(', ') +
            '. Reuse suitable workers with agents action=message. Only use spawn_mode="fresh" when a new independent context is intentional.',
          {
            action: 'spawn',
            outcome: 'reuse_available',
            requested_workers: workers.length,
            reusable_total: reusable.length,
            reusable_workers: shown.map((info) => ({
              id: info.id,
              label: info.label,
              task_preview: info.task.slice(0, 600),
              latest_result_preview: info.result?.slice(0, 600) ?? null,
              model: info.model,
              reasoning_effort: info.reasoningEffort
            }))
          }
        );
      }
    }

    if (!browserRuntime || browserRuntime.available?.() === false) {
      throw new Error('COS browser worker runtime is unavailable; refusing to create worker state without a chat bootstrap owner');
    }
    const staged = stageSpawn({ workers, context: input.context ?? null, caller });
    let accepted = false;
    try {
      await criticalBarrier('The worker run could not cross its durable acceptance barrier. The spawn was rolled back; retry this same request.');
      staged.commit();
      accepted = true;
    } catch (error) {
      if (!accepted) staged.rollback();
      throw error;
    }
    requestWorkerBootstraps(staged.created.map((worker) => worker.id), staged.runId);
    return textResult(
      (staged.becamePrime ? `This conversation is now the prime agent of run ${staged.runId}. ` : '') +
        `${staged.created.length} worker(s) matched: ${staged.created.map((info) => `${info.id} (${info.label}, ${info.state})`).join(', ')}. ` +
        'Carry on with your own work; later results and messages arrive through this same broker.',
      {
        action: 'spawn',
        run_id: staged.runId,
        self: PRIME_ID,
        became_prime: staged.becamePrime,
        workers: staged.created.map((info) => ({
          id: info.id,
          label: info.label,
          state: info.state,
          model: info.model,
          reasoning_effort: info.reasoningEffort
        }))
      }
    );
  }

  if (input.action === 'message') {
    const batch = input.messages ?? [];
    const single = input.to && input.text ? [{ to: input.to, text: input.text }] : [];
    if (batch.length > 0 && single.length > 0) throw new Error('agents action=message takes either to+text or messages, not both.');
    const items = batch.length > 0 ? batch : single;
    if (items.length === 0) throw new Error('agents action=message requires to and text, or a messages array.');

    const staged = stageMessages(caller, items);
    if (staged.waking.length > 0 && (!browserRuntime || browserRuntime.available?.() === false)) {
      staged.rollback();
      throw new Error('COS browser worker runtime is unavailable; refusing to reserve a sleeping worker without a revival owner');
    }
    let accepted = false;
    try {
      await criticalBarrier('The agent message could not cross its durable acceptance barrier. Nothing was queued; retry the same message request.');
      staged.commit();
      accepted = true;
    } catch (error) {
      if (!accepted) staged.rollback();
      throw error;
    }
    const runId = currentRunId(caller.conversationId ?? undefined);
    if (staged.waking.length > 0 && runId) requestWorkerRevivals(staged.waking, runId);
    return textResult(
      `Queued for ${staged.messages.map((message) => message.to).join(', ')}. ` +
        (staged.waking.length > 0
          ? `${staged.waking.join(', ')} ${staged.waking.length === 1 ? 'is' : 'are'} being woken in the same existing chat. `
          : '') +
        'Carry on with the work; replies arrive through later tool results.',
      {
        action: 'message',
        queued: staged.messages.map((message) => ({ id: message.id, to: message.to })),
        waking: staged.waking
      }
    );
  }

  if (input.action === 'finish') {
    if (!input.result) throw new Error('agents action=finish requires result.');
    const staged = stageFinishAgent(caller, input.result);
    let accepted = staged.repeat;
    try {
      if (!staged.repeat) {
        await criticalBarrier('The worker finish could not cross its durable acceptance barrier. Nothing was published; retry the same finish result.');
        staged.commit();
        accepted = true;
      }
    } catch (error) {
      if (!accepted) staged.rollback();
      throw error;
    }
    return textResult(
      staged.repeat
        ? `${staged.info.id} was already ${staged.info.state}; nothing was sent again.`
        : staged.info.state === 'finished'
          ? `${staged.info.id} is finished and cannot be reused.`
          : `${staged.info.id} reported and is now sleeping and reusable. Reuse this same worker with agents action=message before spawning a replacement.`,
      { action: 'finish', self: staged.info.id, state: staged.info.state, repeat: staged.repeat }
    );
  }

  const status = statusForCaller(caller);
  const asleep = status.state.agents.filter((info) => info.state === 'sleeping' && info.revivable);
  const shown = (state: string, revivable: boolean): string =>
    state === 'sleeping' && revivable ? 'sleeping (reusable; wake with action=message)' : state;
  return textResult(
    `You are ${status.self.id}.\n` +
      status.state.agents
        .map((info) =>
          `${info.id}  ${info.role}  ${shown(info.state, info.revivable)}  waiting ${info.pending}  ${info.label}` +
          (info.result ? `\n    latest result: ${info.result.slice(0, 300)}` : '')
        )
        .join('\n') +
      (status.self.id === PRIME_ID
        ? `\n\n${status.freeWorkerSlots} worker slot(s) free.` +
          (asleep.length > 0
            ? ` REUSE FIRST: ${asleep.map((info) => info.id).join(', ')} can be woken with agents action=message before action=spawn.`
            : '')
        : '') +
      '\n\nThis is the current stats, keep working.',
    {
      action: 'status',
      run_id: status.runId,
      self: status.self.id,
      free_worker_slots: status.freeWorkerSlots,
      agents: status.state.agents.map((info) => ({
        id: info.id,
        role: info.role,
        label: info.label,
        model: info.model,
        reasoning_effort: info.reasoningEffort,
        state: info.state,
        revivable: info.revivable,
        waiting: info.pending,
        result: info.result ?? null
      }))
    }
  );
}

async function runAgents(input: CosAgentsInput, context: CosControlCallContext): Promise<CallToolResult> {
  const startedAt = context.startedAt;
  const exact = await exactControlCaller(context, 'agents');
  const caller: Caller = { conversationId: exact.conversationId };
  noteAgentAlive(caller.conversationId, 'call', startedAt);
  const result = await runAgentsForCaller(input, caller);
  return withBrokerInbox(caller, result, input.action === 'finish', startedAt);
}

/**
 * The currently rebased COS host control runtime. Session recording and session_finish remain
 * absent until their actual COS recorder/Finish ownership modules land; the product adapter then
 * fails closed for those tools instead of routing into CID's legacy Agent session implementation.
 */
export const cosHostControlRuntime: CosControlRuntimeDelegate = {
  session: runSession,
  agents: runAgents,
  sessionFinish: runSessionFinish
};

/** Useful for source-level migration tests and future browser bridge binding. */
export const cosHostAgentBroker = {
  bindConversation: bindCosWorkerConversation,
  bindConversationNow: bindCosWorkerConversationNow,
  claimWorkerRevival: claimCosWorkerRevival,
  acknowledgeWorkerRevival: acknowledgeCosWorkerRevival,
  finishWorkerConversationNow: finishCosWorkerConversationNow,
  scheduleDurableMirrors
};
