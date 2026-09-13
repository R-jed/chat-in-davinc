import { randomUUID } from 'node:crypto';
import type { AgentCompactionResult, AgentSessionEvent } from '../shared/agent-session.js';
import { deriveAgentGoalFrame } from './agent-goal-frame.js';
import {
  getAgentSession,
  readAgentSessionEvents,
  recordAgentHandoff
} from './agent-session-store.js';
import type { AgentContextCompilerAccess } from './context-compiler.js';
import type { ModelConversationMessage, ModelProvider } from './model-provider.js';

const MAX_COMPACTION_NARRATIVE_MESSAGES = 32;

function latestHandoff(events: readonly AgentSessionEvent[]): Extract<AgentSessionEvent, { kind: 'handoff' }> | null {
  return [...events].reverse().find((event): event is Extract<AgentSessionEvent, { kind: 'handoff' }> => event.kind === 'handoff') ?? null;
}

function narrativeForCompaction(events: readonly AgentSessionEvent[]): ModelConversationMessage[] {
  const handoff = latestHandoff(events);
  const afterSeq = handoff?.throughSeq ?? 0;
  const narrative = events
    .filter((event): event is Extract<AgentSessionEvent, { kind: 'user_message' | 'assistant_message' }> =>
      event.seq > afterSeq && (event.kind === 'user_message' || event.kind === 'assistant_message'))
    .slice(-MAX_COMPACTION_NARRATIVE_MESSAGES)
    .map((event): ModelConversationMessage => ({ kind: event.kind === 'user_message' ? 'user' : 'assistant', text: event.message.text }));
  if (handoff) narrative.unshift({ kind: 'assistant', text: `CID_COMPACT_RESUME\n${handoff.text.text}` });
  return narrative;
}

export async function compactAgentSession(
  sessionId: string,
  provider: ModelProvider,
  compiler: AgentContextCompilerAccess,
  signal?: AbortSignal
): Promise<AgentCompactionResult> {
  const summary = getAgentSession(sessionId);
  if (!summary) throw new Error('Agent session was not found');
  if (summary.state !== 'idle') throw new Error('Agent session cannot compact while a turn is running');
  const events = await readAgentSessionEvents(sessionId);
  const throughSeq = events.at(-1)?.seq ?? 0;
  if (throughSeq < 1) throw new Error('Agent session has no durable history to compact');
  const history = narrativeForCompaction(events);
  const sourceNarrativeMessages = history.filter((message) => message.kind === 'user' || message.kind === 'assistant').length;
  if (sourceNarrativeMessages < 2) throw new Error('Agent session does not have enough narrative history to compact');
  const goal = deriveAgentGoalFrame(events);
  const turnId = `compact-${randomUUID()}`;
  const contextPack = compiler.compile({
    sessionId,
    turnId,
    input: 'Compact this session for faithful continuation.',
    narrativeMessages: sourceNarrativeMessages,
    goal
  });
  const response = await provider.complete({
    sessionId,
    turnId,
    history,
    tools: [],
    contextPack,
    purpose: 'compaction',
    ...(signal ? { signal } : {})
  });
  if (response.kind !== 'final') throw new Error('Agent compaction returned tool calls instead of a handoff');
  return await recordAgentHandoff(
    sessionId,
    throughSeq,
    response.text,
    goal,
    sourceNarrativeMessages,
    response.usage ?? null
  );
}
