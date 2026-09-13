import type { Tool } from '@modelcontextprotocol/server';
import type { AgentSessionEvent, AgentTurnResult } from '../shared/agent-session.js';
import type { AgentContextPack, AgentTurnTrace } from '../shared/agent-system.js';
import {
  completeAgentTurn,
  failAgentTurn,
  readAgentSessionEvents,
  recordAgentAssistantMessage,
  recordAgentToolIntent,
  recordAgentToolResult,
  startAgentTurn
} from './agent-session-store.js';
import type {
  ModelConversationMessage,
  ModelProvider,
  ModelProviderResponse,
  ModelToolCall,
  ModelToolDefinition
} from './model-provider.js';
import type { ToolKernelAccess } from './tool-kernel.js';
import type { AgentContextCompilerAccess } from './context-compiler.js';
import { isRegisteredWorkflowId } from './workflow-registry.js';
import { deriveAgentGoalFrame } from './agent-goal-frame.js';
import { bindAgentSemanticDispatchArgs, explicitMutationPlanningWorkflowIds } from './agent-action-catalog.js';

const MAX_TOOL_ROUNDS = 8;
const MAX_TOOL_CALLS_PER_ROUND = 8;
const MAX_NARRATIVE_MESSAGES = 16;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toolDefinition(tool: Tool): ModelToolDefinition {
  return {
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema: structuredClone(tool.inputSchema) as Record<string, unknown>
  };
}

function parseArgs(text: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(text)) ?? {};
  } catch {
    return {};
  }
}

function modelHistory(events: readonly AgentSessionEvent[], currentTurnId: string): ModelConversationMessage[] {
  const handoff = [...events].reverse().find((event): event is Extract<AgentSessionEvent, { kind: 'handoff' }> => event.kind === 'handoff') ?? null;
  const afterSeq = handoff?.throughSeq ?? 0;
  let narrativeRemaining = MAX_NARRATIVE_MESSAGES;
  const selected: AgentSessionEvent[] = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.seq <= afterSeq) continue;
    if (event.kind === 'user_message' || event.kind === 'assistant_message') {
      if (narrativeRemaining <= 0) continue;
      narrativeRemaining -= 1;
      selected.push(event);
      continue;
    }
    if (event.turnId === currentTurnId && (event.kind === 'tool_call_intent' || event.kind === 'tool_call_result')) selected.push(event);
  }
  selected.reverse();
  const history = selected.flatMap((event): ModelConversationMessage[] => {
    if (event.kind === 'user_message') return [{ kind: 'user', text: event.message.text }];
    if (event.kind === 'assistant_message') return [{ kind: 'assistant', text: event.message.text }];
    if (event.kind === 'tool_call_intent') {
      return [{ kind: 'tool_call', callId: event.callId, tool: event.tool, args: parseArgs(event.args.text) }];
    }
    if (event.kind === 'tool_call_result') {
      return [{ kind: 'tool_result', callId: event.callId, tool: event.tool, ok: event.ok, text: event.result.text }];
    }
    return [];
  });
  if (handoff) history.unshift({ kind: 'assistant', text: `CID_COMPACT_RESUME\n${handoff.text.text}` });
  return history;
}

function validToolCall(call: ModelToolCall): boolean {
  return typeof call.id === 'string' && call.id.length >= 1 && call.id.length <= 128
    && typeof call.name === 'string' && call.name.length >= 1 && call.name.length <= 100
    && objectValue(call.arguments) !== null;
}

function validateProviderResponse(response: ModelProviderResponse, seenCallIds: Set<string>): void {
  if (response.kind === 'final') {
    if (typeof response.text !== 'string' || response.text.trim().length === 0) throw new Error('Model provider returned an empty final response');
    return;
  }
  if (response.kind !== 'tool_calls' || !Array.isArray(response.calls) || response.calls.length < 1 || response.calls.length > MAX_TOOL_CALLS_PER_ROUND) {
    throw new Error('Model provider returned an invalid tool-call response');
  }
  for (const call of response.calls) {
    if (!validToolCall(call)) throw new Error('Model provider returned an invalid tool call');
    if (seenCallIds.has(call.id)) throw new Error(`Model provider reused tool call id: ${call.id}`);
    seenCallIds.add(call.id);
  }
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const row = objectValue(value);
  if (!row) return value;
  return Object.fromEntries(Object.keys(row).sort().map((key) => [key, canonical(row[key])]));
}

function operationFromResult(result: Awaited<ReturnType<ToolKernelAccess['call']>>): {
  workflowId: string | null;
  verificationStatus: string | null;
} {
  const text = result.content.find((item) => item.type === 'text')?.text;
  if (!text) return { workflowId: null, verificationStatus: null };
  try {
    const envelope = objectValue(JSON.parse(text));
    const operation = objectValue(envelope?.['operation']);
    const verification = objectValue(operation?.['verification']);
    return {
      workflowId: typeof operation?.['workflow_id'] === 'string' ? operation['workflow_id'] : null,
      verificationStatus: typeof verification?.['status'] === 'string' ? verification['status'] : null
    };
  } catch {
    return { workflowId: null, verificationStatus: null };
  }
}

function maxContextBudget(target: AgentTurnTrace['maxContextBudget'], pack?: AgentContextPack): void {
  if (!pack) return;
  target.narrativeMessages = Math.max(target.narrativeMessages, pack.budget.narrativeMessages);
  target.goalChars = Math.max(target.goalChars, pack.budget.goalChars);
  target.worldFacts = Math.max(target.worldFacts, pack.budget.worldFacts);
  target.evidenceRefs = Math.max(target.evidenceRefs, pack.budget.evidenceRefs);
  target.semanticDeltas = Math.max(target.semanticDeltas, pack.budget.semanticDeltas);
  target.actionDescriptors = Math.max(target.actionDescriptors, pack.budget.actionDescriptors);
}

export class TurnRunner {
  constructor(
    private readonly provider: ModelProvider,
    private readonly kernel: ToolKernelAccess,
    private readonly contextCompiler?: AgentContextCompilerAccess
  ) {}

  async run(sessionId: string, input: string, signal?: AbortSignal): Promise<AgentTurnResult> {
    const traceStartedAt = Date.now();
    const started = await startAgentTurn(sessionId, input);
    const turnId = started.turnId;
    const context = { caller: 'agent' as const, sessionId, turnId };
    const tools = this.kernel.tools(context).map(toolDefinition);
    const seenCallIds = new Set<string>();
    const seenToolIntents = new Set<string>();
    const workflowIds = new Set<AgentTurnTrace['workflowIds'][number]>();
    let modelCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalTokens = 0;
    let usageComplete = true;
    let protectedToolCalls = 0;
    let protectedToolFailures = 0;
    let invalidToolCalls = 0;
    let redundantToolCalls = 0;
    let staleTargetFailures = 0;
    let verificationFailures = 0;
    const contextBudget: AgentTurnTrace['maxContextBudget'] = {
      narrativeMessages: 0,
      goalChars: 0,
      worldFacts: 0,
      evidenceRefs: 0,
      semanticDeltas: 0,
      actionDescriptors: 0
    };
    const trace = (outcome: AgentTurnTrace['outcome']): AgentTurnTrace => {
      const metrics = this.kernel.metrics ? this.kernel.metrics(context) : null;
      return {
        schemaVersion: 1,
        sessionId,
        turnId,
        startedAt: traceStartedAt,
        endedAt: Date.now(),
        outcome,
        modelCalls,
        providerUsage: {
          complete: usageComplete && modelCalls > 0,
          inputTokens: usageComplete && modelCalls > 0 ? inputTokens : null,
          outputTokens: usageComplete && modelCalls > 0 ? outputTokens : null,
          totalTokens: usageComplete && modelCalls > 0 ? totalTokens : null
        },
        protectedToolCalls,
        protectedToolFailures,
        invalidToolCalls,
        redundantToolCalls,
        workflowIds: [...workflowIds],
        resolveMetricsAvailable: metrics !== null,
        resolveCalls: metrics?.resolveCalls ?? null,
        resolveDurationMs: metrics?.resolveDurationMs ?? null,
        staleTargetFailures,
        verificationFailures,
        maxContextBudget: { ...contextBudget }
      };
    };
    try {
      for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
        signal?.throwIfAborted();
        const events = await readAgentSessionEvents(sessionId);
        const history = modelHistory(events, turnId);
        const goal = deriveAgentGoalFrame(events);
        const contextPack = this.contextCompiler?.compile({
          sessionId,
          turnId,
          input,
          narrativeMessages: history.filter((message) => message.kind === 'user' || message.kind === 'assistant').length,
          goal,
          mutationPlanningWorkflowIds: explicitMutationPlanningWorkflowIds(input)
        });
        maxContextBudget(contextBudget, contextPack);
        modelCalls += 1;
        const response = await this.provider.complete({
          sessionId,
          turnId,
          history,
          tools,
          ...(contextPack ? { contextPack } : {}),
          ...(signal ? { signal } : {})
        });
        if (response.usage) {
          inputTokens += response.usage.inputTokens;
          outputTokens += response.usage.outputTokens;
          totalTokens += response.usage.totalTokens;
        } else usageComplete = false;
        validateProviderResponse(response, seenCallIds);
        if (contextPack) this.contextCompiler?.acknowledge(contextPack);
        if (response.kind === 'final') {
          const text = response.text.trim();
          await completeAgentTurn(sessionId, turnId, text, trace('completed'));
          return { sessionId, turnId, text };
        }
        if (round === MAX_TOOL_ROUNDS) throw new Error('Agent turn exceeded the tool-call round limit');
        if (response.text?.trim()) await recordAgentAssistantMessage(sessionId, turnId, response.text.trim());
        for (const call of response.calls) {
          signal?.throwIfAborted();
          protectedToolCalls += 1;
          const intentKey = `${call.name}:${JSON.stringify(canonical(call.arguments))}`;
          if (seenToolIntents.has(intentKey)) redundantToolCalls += 1;
          else seenToolIntents.add(intentKey);
          await recordAgentToolIntent(sessionId, turnId, call.id, call.name, call.arguments);
          try {
            const dispatchArgs = bindAgentSemanticDispatchArgs(contextPack?.actionOffers ?? [], call.name, call.arguments);
            const result = await this.kernel.call({ ...context, callId: call.id }, call.name, dispatchArgs);
            const operation = operationFromResult(result);
            if (operation.workflowId && isRegisteredWorkflowId(operation.workflowId)) workflowIds.add(operation.workflowId);
            if (operation.verificationStatus === 'failed' || operation.verificationStatus === 'contradiction') verificationFailures += 1;
            const resultText = this.contextCompiler?.projectToolResult(result) ?? JSON.stringify(result);
            await recordAgentToolResult(sessionId, turnId, call.id, call.name, true, resultText);
          } catch (error) {
            protectedToolFailures += 1;
            const message = (error as Error).message;
            if (/invalid|unsupported|does not accept|only supported|requires/i.test(message)) invalidToolCalls += 1;
            if (/stale|semantic entity|itemRef|world-model generation/i.test(message)) staleTargetFailures += 1;
            await recordAgentToolResult(
              sessionId,
              turnId,
              call.id,
              call.name,
              false,
              this.contextCompiler?.projectToolError(message) ?? message
            );
          }
        }
      }
      throw new Error('Agent turn ended without a final response');
    } catch (error) {
      await failAgentTurn(sessionId, turnId, (error as Error).message, trace('failed')).catch(() => undefined);
      throw error;
    } finally {
      this.kernel.releaseMetrics?.(context);
    }
  }
}
