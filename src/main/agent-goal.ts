import type { AgentSessionEvent } from '../shared/agent-session.js';
import type { AgentContextPack } from '../shared/agent-system.js';
import {
  AGENT_GOAL_LOOP_PROMPT,
  AGENT_GOAL_LOOP_STOP_REFUSED,
  AGENT_GOAL_LOOP_TRAILER,
  AGENT_GOAL_OBJECTIVE_PROMPT,
  AGENT_GOAL_OBJECTIVE_TRAILER,
  AGENT_GOAL_OUTPUT_PROTOCOL,
  AGENT_GOAL_RESPONSE_FORMAT,
  AGENT_LOOP_OUTPUT_PROTOCOL,
  AGENT_LOOP_RESPONSE_FORMAT,
  agentGoalObjectiveMessage,
  type AgentGoalMode
} from '../shared/agent-goal-policy.js';
import {
  getAgentSession,
  readAgentSessionEvents,
  recordAgentGoalCompleted
} from './agent-session-store.js';
import { deriveAgentGoalFrame } from './agent-goal-frame.js';
import type {
  ModelConversationMessage,
  ModelProvider
} from './model-provider.js';
import type { AgentContextCompilerAccess } from './context-compiler.js';
import { getWorkflowDefinition } from './workflow-registry.js';

const MAX_GOAL_MESSAGES = 120;
const MAX_GOAL_REPLY_CHARS = 12_000;
const LOOP_ATTEMPTS = 3;
const NO_REPLY = /^no[\s_-]?reply[\s.!]*$/i;
const NO_REPLY_TOKEN = /(?:^|[^\p{L}\p{N}])no[\s_-]?reply[\s.!]*(?=$|[^\p{L}\p{N}])/iu;
const MODEL_CONTROL_TOKEN = /<\|[^|\r\n]{1,100}\|>|<\/?s>|\[\/?INST\]|<<\/?SYS>>/giu;
const UNSAFE_REASONING_TAG = /<\/?(?:think|analysis|reasoning)\b[^>]*>/iu;
const REASONING_BLOCK = /<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const CODE_FENCE = /^\s*```[a-z]*\s*([\s\S]*?)\s*```\s*$/iu;

type AgentGoalDecision =
  | { action: 'stop' }
  | { action: 'continue'; reply: string }
  | { action: 'invalid'; error: string };

export type AgentGoalEvaluation =
  | { action: 'stop'; evidenceIds: string[] }
  | { action: 'continue'; reply: string }
  | { action: 'blocked'; blockers: string[] };

interface ProtectedResultState {
  workflowId: string | null;
  executionId: string | null;
  planId: string | null;
  verificationStatus: string | null;
}

interface WriterExecutionState extends ProtectedResultState {
  key: string;
  ok: boolean;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanGoalReply(value: string): { text: string; hadControl: boolean } {
  const normalized = value.normalize('NFKC');
  const withoutInvisible = normalized.replace(/[\u0000\u200B-\u200D\u2060\uFEFF]/g, '');
  const withoutControl = withoutInvisible.replace(MODEL_CONTROL_TOKEN, '');
  return { text: withoutControl.trim(), hadControl: withoutControl !== withoutInvisible };
}

function decisionObjectIn(text: string): unknown {
  const parse = (candidate: string): unknown => {
    try {
      return JSON.parse(candidate);
    } catch {
      return undefined;
    }
  };
  const direct = parse(text);
  if (direct !== undefined) return direct;
  const unwrapped = text.replace(REASONING_BLOCK, '').trim();
  const fenced = unwrapped.match(CODE_FENCE);
  const body = fenced?.[1] ?? unwrapped;
  const parsed = parse(body);
  if (parsed !== undefined) return parsed;
  const open = body.indexOf('{');
  const close = body.lastIndexOf('}');
  if (open === -1 || close <= open) return undefined;
  return parse(body.slice(open, close + 1));
}

/** COS Goal's fail-closed decision normalizer, kept local to CID's transport adapter. */
export function normalizeAgentGoalDecision(raw: string): AgentGoalDecision {
  const trimmed = raw.trim();
  if (!trimmed) return { action: 'invalid', error: 'empty_reply' };
  const decision = decisionObjectIn(trimmed);
  if (decision === undefined || !decision || typeof decision !== 'object' || Array.isArray(decision)) {
    return { action: 'invalid', error: 'invalid_goal_decision_json' };
  }
  const row = decision as Record<string, unknown>;
  if (Object.keys(row).some((key) => key !== 'action' && key !== 'reply')
      || (row['action'] !== 'stop' && row['action'] !== 'continue')
      || typeof row['reply'] !== 'string') {
    return { action: 'invalid', error: 'invalid_goal_decision_schema' };
  }
  if (row['action'] === 'stop') return { action: 'stop' };
  if (NO_REPLY_TOKEN.test(row['reply']) || NO_REPLY.test(row['reply'])) return { action: 'stop' };
  const cleaned = cleanGoalReply(row['reply']);
  if (!cleaned.text) return { action: 'invalid', error: cleaned.hadControl ? 'control_tokens_only' : 'empty_reply' };
  if (cleaned.text.includes('<|') || cleaned.text.includes('|>') || UNSAFE_REASONING_TAG.test(cleaned.text)) {
    return { action: 'invalid', error: 'unsafe_control_tokens' };
  }
  if (cleaned.text.length > MAX_GOAL_REPLY_CHARS) return { action: 'invalid', error: 'reply_too_long' };
  return { action: 'continue', reply: cleaned.text };
}

function currentGoalEvents(events: readonly AgentSessionEvent[]): AgentSessionEvent[] {
  const previousCompletion = [...events].reverse().find((event) => event.kind === 'goal_completed') ?? null;
  return previousCompletion ? events.filter((event) => event.seq > previousCompletion.seq) : [...events];
}

function authoredConversation(events: readonly AgentSessionEvent[]): ModelConversationMessage[] {
  const rows = currentGoalEvents(events).flatMap((event): ModelConversationMessage[] => {
    if (event.kind === 'user_message') return [{ kind: 'user', text: event.message.text }];
    if (event.kind === 'assistant_message') return [{ kind: 'assistant', text: event.message.text }];
    return [];
  });
  return rows.slice(-MAX_GOAL_MESSAGES);
}

function protectedResultState(text: string): ProtectedResultState {
  try {
    const envelope = objectValue(JSON.parse(text));
    const operation = objectValue(envelope?.['operation']);
    const verification = objectValue(operation?.['verification']);
    const result = objectValue(envelope?.['result']);
    const plan = objectValue(result?.['plan']);
    return {
      workflowId: typeof operation?.['workflow_id'] === 'string' ? operation['workflow_id'] : null,
      executionId: typeof operation?.['execution_id'] === 'string' ? operation['execution_id'] : null,
      planId: typeof plan?.['plan_id'] === 'string'
        ? plan['plan_id']
        : typeof result?.['plan_id'] === 'string' ? result['plan_id'] : null,
      verificationStatus: typeof verification?.['status'] === 'string' ? verification['status'] : null
    };
  } catch {
    return { workflowId: null, executionId: null, planId: null, verificationStatus: null };
  }
}

function parseArgs(text: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

function writerExecutionStates(events: readonly AgentSessionEvent[]): WriterExecutionState[] {
  const planByCall = new Map<string, string>();
  const latest = new Map<string, WriterExecutionState>();
  for (const event of currentGoalEvents(events)) {
    if (event.kind === 'tool_call_intent' && event.tool === 'execute') {
      const planId = parseArgs(event.args.text)['planId'];
      if (typeof planId === 'string' && planId) planByCall.set(event.callId, planId);
      continue;
    }
    if (event.kind !== 'tool_call_result' || event.tool !== 'execute') continue;
    const state = protectedResultState(event.result.text);
    const key = state.planId ?? planByCall.get(event.callId) ?? event.callId;
    latest.set(key, { ...state, key, ok: event.ok });
  }
  return [...latest.values()];
}

function resolveCompletionEvidence(
  events: readonly AgentSessionEvent[],
  pack: AgentContextPack,
  evidenceSnapshot: ReturnType<AgentContextCompilerAccess['completionEvidence']>
): { blockers: string[]; evidenceIds: string[] } {
  const blockers: string[] = [];
  const evidenceIds = new Set<string>();
  for (const execution of writerExecutionStates(events)) {
    if (!execution.ok) {
      blockers.push(`Protected execution ${execution.key} did not complete successfully.`);
      continue;
    }
    const definition = execution.workflowId ? getWorkflowDefinition(execution.workflowId) : null;
    if (!definition || definition.readOnly) {
      blockers.push(`Protected execution ${execution.key} has no established writer identity.`);
      continue;
    }
    if (execution.verificationStatus !== 'passed' || !execution.executionId) {
      blockers.push(`Protected execution ${execution.key} is not verified.`);
      continue;
    }
    const evidence = evidenceSnapshot.find((item) =>
      item.generation === pack.situation.generation
      && item.executionId === execution.executionId
      && item.workflowId === execution.workflowId
      && item.verificationStatus === 'passed'
    );
    if (!evidence) {
      blockers.push(`Protected execution ${execution.key} is missing its verified EvidenceRef.`);
      continue;
    }
    evidenceIds.add(evidence.id);
  }
  return { blockers, evidenceIds: [...evidenceIds] };
}

function ensureCompletedSourceTurn(events: readonly AgentSessionEvent[], turnId: string): void {
  const latestStart = [...events].reverse().find((event) => event.kind === 'turn_started');
  if (!latestStart || latestStart.turnId !== turnId) throw new Error('Goal source turn is no longer current');
  const terminal = [...events].reverse().find((event) =>
    event.turnId === turnId && (event.kind === 'turn_completed' || event.kind === 'turn_failed' || event.kind === 'turn_interrupted')
  );
  if (!terminal || terminal.kind !== 'turn_completed') throw new Error('Goal only evaluates completed final turns');
  if (events.some((event) => event.seq > terminal.seq && event.kind === 'user_message')) {
    throw new Error('New user input superseded this Goal decision');
  }
}

function goalInstructions(mode: AgentGoalMode, objective: string, stopRefused = false): string {
  if (mode === 'loop') {
    return [
      AGENT_GOAL_LOOP_PROMPT,
      agentGoalObjectiveMessage(objective),
      AGENT_LOOP_OUTPUT_PROTOCOL,
      ...(stopRefused ? [AGENT_GOAL_LOOP_STOP_REFUSED] : [])
    ].join('\n\n');
  }
  return [
    AGENT_GOAL_OBJECTIVE_PROMPT,
    agentGoalObjectiveMessage(objective),
    AGENT_GOAL_OUTPUT_PROTOCOL
  ].join('\n\n');
}

async function requestGoalDecision(
  provider: ModelProvider,
  sessionId: string,
  turnId: string,
  history: ModelConversationMessage[],
  objective: string,
  mode: AgentGoalMode,
  signal?: AbortSignal
): Promise<AgentGoalDecision> {
  for (let attempt = 0; attempt < (mode === 'loop' ? LOOP_ATTEMPTS : 1); attempt += 1) {
    const response = await provider.complete({
      sessionId,
      turnId,
      history: [
        ...history,
        {
          kind: 'system',
          text: mode === 'loop' ? AGENT_GOAL_LOOP_TRAILER : AGENT_GOAL_OBJECTIVE_TRAILER
        }
      ],
      tools: [],
      purpose: mode === 'loop' ? 'goal_loop' : 'goal_decision',
      instructions: goalInstructions(mode, objective, attempt > 0),
      responseFormat: mode === 'loop' ? AGENT_LOOP_RESPONSE_FORMAT : AGENT_GOAL_RESPONSE_FORMAT,
      ...(signal ? { signal } : {})
    });
    if (response.kind !== 'final') return { action: 'invalid', error: 'goal_returned_tool_calls' };
    const decision = normalizeAgentGoalDecision(response.text);
    if (mode !== 'loop' || decision.action !== 'stop') return decision;
  }
  return { action: 'invalid', error: 'loop_refused_to_continue' };
}

/**
 * Evaluate one already-completed Agent turn using COS Goal/Loop semantics.
 * CID's evidence gate runs only after Goal says stop; it cannot make Goal stop.
 */
export async function evaluateCompletedAgentGoal(
  sessionId: string,
  turnId: string,
  mode: AgentGoalMode,
  provider: ModelProvider,
  compiler: AgentContextCompilerAccess,
  signal?: AbortSignal
): Promise<AgentGoalEvaluation> {
  const session = getAgentSession(sessionId);
  if (!session || session.state !== 'idle') throw new Error('Goal requires an idle completed session');
  const events = await readAgentSessionEvents(sessionId);
  ensureCompletedSourceTurn(events, turnId);
  const goal = deriveAgentGoalFrame(events);
  const objective = goal.originalRequest?.text.trim();
  if (!objective) throw new Error('Goal has no authoritative user request');
  const history = authoredConversation(events);
  const decision = await requestGoalDecision(provider, sessionId, turnId, history, objective, mode, signal);
  signal?.throwIfAborted();
  const freshEvents = await readAgentSessionEvents(sessionId);
  ensureCompletedSourceTurn(freshEvents, turnId);
  if (decision.action === 'invalid') throw new Error(`Goal decision was invalid: ${decision.error}`);
  if (decision.action === 'continue') return decision;
  if (mode === 'loop') throw new Error('Loop cannot stop');

  const pack = compiler.compile({
    sessionId,
    turnId,
    input: objective,
    narrativeMessages: history.length,
    goal
  });
  const completion = resolveCompletionEvidence(freshEvents, pack, compiler.completionEvidence());
  if (completion.blockers.length) return { action: 'blocked', blockers: completion.blockers };
  await recordAgentGoalCompleted(sessionId, turnId, pack.situation.generation, completion.evidenceIds);
  compiler.acknowledge(pack);
  return { action: 'stop', evidenceIds: completion.evidenceIds };
}
