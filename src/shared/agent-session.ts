import type { AgentGoalFrame, AgentTurnTrace } from './agent-system.js';

export type AgentTurnOutcome = 'completed' | 'failed' | 'interrupted';
export type AgentSessionState = 'idle' | 'running';

export interface AgentStoredText {
  text: string;
  chars: number;
  truncated: boolean;
}

export interface AgentSessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  state: AgentSessionState;
  activeTurnId: string | null;
  lastTurnOutcome: AgentTurnOutcome | null;
}

export interface AgentSessionView {
  summary: AgentSessionSummary;
  events: AgentSessionEvent[];
  eventsTruncated: boolean;
}

export interface AgentTurnResult {
  sessionId: string;
  turnId: string;
  text: string;
}

export interface AgentCompactionResult {
  handoffId: string;
  throughSeq: number;
  text: string;
  sourceNarrativeMessages: number;
}

interface AgentSessionEventBase {
  seq: number;
  time: number;
  sessionId: string;
  turnId: string | null;
}

export type AgentSessionEvent =
  | (AgentSessionEventBase & { kind: 'session_created'; title: string })
  | (AgentSessionEventBase & { kind: 'turn_started' })
  | (AgentSessionEventBase & { kind: 'user_message'; message: AgentStoredText })
  | (AgentSessionEventBase & { kind: 'assistant_message'; message: AgentStoredText })
  | (AgentSessionEventBase & {
      kind: 'tool_call_intent';
      callId: string;
      tool: string;
      args: AgentStoredText;
    })
  | (AgentSessionEventBase & {
      kind: 'tool_call_result';
      callId: string;
      tool: string;
      ok: boolean;
      result: AgentStoredText;
    })
  | (AgentSessionEventBase & { kind: 'turn_trace'; trace: AgentTurnTrace })
  | (AgentSessionEventBase & {
      kind: 'goal_completed';
      generation: number;
      evidenceIds: string[];
    })
  | (AgentSessionEventBase & {
      kind: 'handoff';
      handoffId: string;
      throughSeq: number;
      text: AgentStoredText;
      goal: AgentGoalFrame;
      sourceNarrativeMessages: number;
      providerUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | null;
    })
  | (AgentSessionEventBase & { kind: 'turn_completed' })
  | (AgentSessionEventBase & { kind: 'turn_failed'; error: AgentStoredText })
  | (AgentSessionEventBase & { kind: 'turn_interrupted'; reason: AgentStoredText });
