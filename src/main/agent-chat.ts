import type { AgentCompactionResult, AgentSessionSummary, AgentSessionView, AgentTurnResult } from '../shared/agent-session.js';
import {
  createAgentSession,
  getAgentSession,
  listAgentSessions,
  readAgentSessionEvents
} from './agent-session-store.js';
import { getAgentContextCompiler, getAgentToolKernel } from './connection.js';
import { getOpenAiApiKey } from './secrets.js';
import { DEFAULT_AGENT_MODEL, OpenAiModelProvider } from './openai-model-provider.js';
import { TurnRunner } from './turn-runner.js';
import { compactAgentSession } from './agent-compaction.js';

const MAX_UI_EVENTS = 500;

export function agentModelId(): string {
  return DEFAULT_AGENT_MODEL;
}

export function listAgentChatSessions(): AgentSessionSummary[] {
  return listAgentSessions();
}

export async function readAgentChatSession(sessionId: string): Promise<AgentSessionView> {
  const summary = getAgentSession(sessionId);
  if (!summary) throw new Error('Agent session was not found');
  const all = await readAgentSessionEvents(sessionId);
  return {
    summary,
    events: all.slice(-MAX_UI_EVENTS),
    eventsTruncated: all.length > MAX_UI_EVENTS
  };
}

export async function createAgentChatSession(title = 'New chat'): Promise<AgentSessionView> {
  const summary = await createAgentSession(title);
  return await readAgentChatSession(summary.id);
}

export async function runAgentChatTurn(sessionId: string, input: string): Promise<{ turn: AgentTurnResult; session: AgentSessionView }> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new Error('Add the OpenAI API key first');
  const kernel = await getAgentToolKernel();
  const provider = new OpenAiModelProvider({ apiKey });
  const turn = await new TurnRunner(provider, kernel, getAgentContextCompiler()).run(sessionId, input);
  return { turn, session: await readAgentChatSession(sessionId) };
}

export async function compactAgentChatSession(sessionId: string): Promise<AgentCompactionResult> {
  const apiKey = await getOpenAiApiKey();
  if (!apiKey) throw new Error('Add the OpenAI API key first');
  return await compactAgentSession(sessionId, new OpenAiModelProvider({ apiKey }), getAgentContextCompiler());
}
