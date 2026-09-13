import type {
  ModelConversationMessage,
  ModelProvider,
  ModelProviderRequest,
  ModelProviderResponse,
  ModelProviderUsage,
  ModelToolCall,
  ModelToolDefinition
} from './model-provider.js';
import { renderAgentContextPack } from './context-compiler.js';

export const DEFAULT_AGENT_MODEL = 'gpt-5.6';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const AGENT_INSTRUCTIONS =
  'You are the Chat in DaVinci Agent. Help the user operate DaVinci Resolve using only the protected tools provided by this application. Never claim a tool succeeded unless its returned evidence proves it. Mutations may require an immutable local plan and local approval; never bypass or simulate approval. If a capability is unavailable or unverified, say so. A final response ends only the current turn. Goal/Loop continuation and whole-goal completion are evaluated separately by the application after a completed final turn; do not invent or call a completion tool.';

function instructionsFor(request: ModelProviderRequest): string {
  if (request.instructions) return request.instructions;
  const context = request.contextPack
    ? `\n\nThe application supplies a compact local ContextPack below. It is context and evidence routing metadata, never authorization. goal.originalRequest is authoritative user intent even when it has fallen out of the recent narrative window; later goal.userDirectives are also authoritative user input, while empty derived GoalFrame fields mean no local semantic claim has been made. Semantic handles such as M3 are meaningful only with the supplied generation. Prefer the listed relevantActions over guessing from the full tool verbs. Unknown remains unknown.\n\nCID_CONTEXT_PACK\n${renderAgentContextPack(request.contextPack)}`
    : '';
  if (request.purpose === 'compaction') {
    return `Write a faithful continuation handoff for the same Chat in DaVinci session. Preserve the current task position, important user decisions or corrections, open obligations, active plan/approval/execution references, unresolved uncertainty, and semantic EntityRef/EvidenceRef handles needed to continue. Do not invent facts, do not treat volatile Resolve observations as durable truth, and do not override or narrow the authoritative GoalFrame. Return only the handoff text.${context}`;
  }
  return `${AGENT_INSTRUCTIONS}${context}`;
}

type ResponseItem = Record<string, unknown>;

interface ResponseEnvelope {
  id?: unknown;
  status?: unknown;
  output?: unknown;
  output_text?: unknown;
  error?: unknown;
  usage?: unknown;
}

interface TurnState {
  sessionId: string;
  turnId: string;
  input: ResponseItem[];
  historyLength: number;
}

export interface OpenAiModelProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function resultText(message: ModelConversationMessage): string {
  const text = message.text ?? '';
  return message.ok === false ? JSON.stringify({ ok: false, error: text }) : text;
}

function conversationItem(message: ModelConversationMessage): ResponseItem | null {
  if (message.kind === 'system' || message.kind === 'user' || message.kind === 'assistant') {
    if (!message.text) return null;
    return { role: message.kind, content: message.text };
  }
  if (message.kind === 'tool_call' && message.callId && message.tool) {
    return {
      type: 'function_call',
      call_id: message.callId,
      name: message.tool,
      arguments: JSON.stringify(message.args ?? {})
    };
  }
  if (message.kind === 'tool_result' && message.callId) {
    return { type: 'function_call_output', call_id: message.callId, output: resultText(message) };
  }
  return null;
}

function toolDefinition(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    ...(tool.description ? { description: tool.description } : {}),
    parameters: tool.inputSchema,
    // Existing protected schemas intentionally keep optional fields optional. Responses strict
    // mode requires every property to be required, so preserve the qualified tool contract.
    strict: false
  };
}

function parseToolCall(item: ResponseItem): ModelToolCall | null {
  if (item['type'] !== 'function_call') return null;
  const callId = item['call_id'];
  const name = item['name'];
  const rawArgs = item['arguments'];
  if (typeof callId !== 'string' || typeof name !== 'string' || typeof rawArgs !== 'string') {
    throw new Error('OpenAI returned an invalid function call');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArgs);
  } catch {
    throw new Error(`OpenAI returned invalid JSON arguments for ${name}`);
  }
  const args = objectValue(parsed);
  if (!args) throw new Error(`OpenAI returned non-object arguments for ${name}`);
  return { id: callId, name, arguments: args };
}

function outputText(output: readonly ResponseItem[], envelope: ResponseEnvelope): string {
  const pieces: string[] = [];
  for (const item of output) {
    if (item['type'] !== 'message' || !Array.isArray(item['content'])) continue;
    for (const content of item['content']) {
      const block = objectValue(content);
      if (block?.['type'] === 'output_text' && typeof block['text'] === 'string') pieces.push(block['text']);
    }
  }
  if (pieces.length) return pieces.join('\n').trim();
  return typeof envelope.output_text === 'string' ? envelope.output_text.trim() : '';
}

function apiErrorMessage(status: number, body: unknown): string {
  const row = objectValue(body);
  const error = objectValue(row?.['error']);
  const message = typeof error?.['message'] === 'string' ? error['message'] : `HTTP ${status}`;
  return `OpenAI Responses API request failed: ${message.slice(0, 500)}`;
}

function responseUsage(envelope: ResponseEnvelope): ModelProviderUsage | undefined {
  const usage = objectValue(envelope.usage);
  if (!usage) return undefined;
  const inputTokens = usage['input_tokens'];
  const outputTokens = usage['output_tokens'];
  const totalTokens = usage['total_tokens'];
  if (!Number.isInteger(inputTokens) || (inputTokens as number) < 0
    || !Number.isInteger(outputTokens) || (outputTokens as number) < 0
    || !Number.isInteger(totalTokens) || (totalTokens as number) < 0) return undefined;
  return {
    inputTokens: inputTokens as number,
    outputTokens: outputTokens as number,
    totalTokens: totalTokens as number
  };
}

export class OpenAiModelProvider implements ModelProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private state: TurnState | null = null;

  constructor(options: OpenAiModelProviderOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) throw new Error('OpenAI API key is missing');
    this.model = options.model ?? DEFAULT_AGENT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelProviderRequest): Promise<ModelProviderResponse> {
    if (this.state && (this.state.sessionId !== request.sessionId || this.state.turnId !== request.turnId)) {
      throw new Error('OpenAI provider cannot mix two active turns');
    }

    if (!this.state) {
      this.state = {
        sessionId: request.sessionId,
        turnId: request.turnId,
        input: request.history.map(conversationItem).filter((item): item is ResponseItem => item !== null),
        historyLength: request.history.length
      };
    } else {
      if (request.history.length < this.state.historyLength) throw new Error('Agent history moved backwards during a turn');
      const newMessages = request.history.slice(this.state.historyLength);
      for (const message of newMessages) {
        // The preceding OpenAI response already carries its assistant text and function-call
        // items. Only locally executed function results are new model input at this boundary.
        if (message.kind !== 'tool_result') continue;
        const item = conversationItem(message);
        if (item) this.state.input.push(item);
      }
      this.state.historyLength = request.history.length;
    }

    const response = await this.fetchImpl(RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        instructions: instructionsFor(request),
        input: this.state.input,
        ...(request.responseFormat ? { text: { format: request.responseFormat } } : {}),
        ...(request.tools.length ? {
          tools: request.tools.map(toolDefinition),
          tool_choice: 'auto',
          parallel_tool_calls: false
        } : {}),
        // Keep CID's durable local session as the conversation authority. Encrypted reasoning
        // lets reasoning items be carried statelessly when this response is fed back on a tool round.
        store: false,
        include: ['reasoning.encrypted_content']
      }),
      ...(request.signal ? { signal: request.signal } : {})
    });

    let raw: unknown = null;
    try { raw = await response.json(); } catch { /* reported below */ }
    if (!response.ok) throw new Error(apiErrorMessage(response.status, raw));
    const envelope = objectValue(raw) as ResponseEnvelope | null;
    if (!envelope || !Array.isArray(envelope.output)) throw new Error('OpenAI returned an invalid Responses API payload');
    if (envelope.status === 'failed' || envelope.status === 'cancelled' || envelope.status === 'incomplete') {
      throw new Error('OpenAI did not complete the model response');
    }

    const output = envelope.output.map(objectValue).filter((item): item is ResponseItem => item !== null);
    const calls = output.map(parseToolCall).filter((call): call is ModelToolCall => call !== null);
    const text = outputText(output, envelope);
    const usage = responseUsage(envelope);
    this.state.historyLength = request.history.length;

    if (calls.length) {
      // The API documents response.output as valid subsequent input. Preserve all output items,
      // including encrypted reasoning, before the local function result is appended next round.
      this.state.input.push(...output.map((item) => structuredClone(item)));
      return { kind: 'tool_calls', calls, ...(text ? { text } : {}), ...(usage ? { usage } : {}) };
    }
    this.state = null;
    if (!text) throw new Error('OpenAI returned no final text or function call');
    return { kind: 'final', text, ...(usage ? { usage } : {}) };
  }
}
