import type { AgentContextPack } from '../shared/agent-system.js';

export interface ModelConversationMessage {
  kind: 'system' | 'user' | 'assistant' | 'tool_call' | 'tool_result';
  text?: string;
  callId?: string;
  tool?: string;
  args?: Record<string, unknown>;
  ok?: boolean;
}

export interface ModelToolDefinition {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ModelToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ModelProviderUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ModelProviderRequest {
  sessionId: string;
  turnId: string;
  history: ModelConversationMessage[];
  tools: ModelToolDefinition[];
  contextPack?: AgentContextPack;
  purpose?: 'agent_turn' | 'compaction' | 'goal_decision' | 'goal_loop';
  instructions?: string;
  responseFormat?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type ModelProviderResponse =
  | { kind: 'final'; text: string; usage?: ModelProviderUsage }
  | { kind: 'tool_calls'; calls: ModelToolCall[]; text?: string; usage?: ModelProviderUsage };

export interface ModelProvider {
  complete(request: ModelProviderRequest): Promise<ModelProviderResponse>;
}
