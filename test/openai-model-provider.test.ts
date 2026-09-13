import { describe, expect, it } from 'vitest';
import { OpenAiModelProvider } from '../src/main/openai-model-provider.js';
import type { ModelProviderRequest } from '../src/main/model-provider.js';

const baseRequest: ModelProviderRequest = {
  sessionId: 'session-11111111-1111-1111-1111-111111111111',
  turnId: 'turn-22222222-2222-2222-2222-222222222222',
  history: [{ kind: 'user', text: 'Check Resolve' }],
  tools: [{
    name: 'inspect',
    description: 'Inspect protected Resolve state',
    inputSchema: {
      type: 'object',
      properties: { target: { type: 'string' } },
      required: ['target']
    }
  }]
};

function response(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('OpenAI Responses model provider', () => {
  it('carries response output and local function result through one stateless tool round', async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return response({
          id: 'resp-1',
          status: 'completed',
          usage: { input_tokens: 20, output_tokens: 7, total_tokens: 27 },
          output: [
            { type: 'reasoning', encrypted_content: 'encrypted-reasoning' },
            { type: 'function_call', call_id: 'call-1', name: 'inspect', arguments: '{"target":"connection"}' }
          ]
        });
      }
      return response({
        id: 'resp-2',
        status: 'completed',
        usage: { input_tokens: 24, output_tokens: 5, total_tokens: 29 },
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'Resolve is connected.' }] }]
      });
    }) as typeof fetch;
    const provider = new OpenAiModelProvider({ apiKey: 'sk-test', fetchImpl });

    await expect(provider.complete(baseRequest)).resolves.toEqual({
      kind: 'tool_calls',
      calls: [{ id: 'call-1', name: 'inspect', arguments: { target: 'connection' } }],
      usage: { inputTokens: 20, outputTokens: 7, totalTokens: 27 }
    });
    await expect(provider.complete({
      ...baseRequest,
      history: [
        ...baseRequest.history,
        { kind: 'tool_call', callId: 'call-1', tool: 'inspect', args: { target: 'connection' } },
        { kind: 'tool_result', callId: 'call-1', tool: 'inspect', ok: true, text: '{"running":true}' }
      ]
    })).resolves.toEqual({
      kind: 'final',
      text: 'Resolve is connected.',
      usage: { inputTokens: 24, outputTokens: 5, totalTokens: 29 }
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({ model: 'gpt-5.6', store: false, parallel_tool_calls: false });
    expect((requests[0]?.['tools'] as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'inspect', strict: false });
    expect(requests[0]?.['include']).toEqual(['reasoning.encrypted_content']);
    expect(requests[1]?.['input']).toEqual([
      { role: 'user', content: 'Check Resolve' },
      { type: 'reasoning', encrypted_content: 'encrypted-reasoning' },
      { type: 'function_call', call_id: 'call-1', name: 'inspect', arguments: '{"target":"connection"}' },
      { type: 'function_call_output', call_id: 'call-1', output: '{"running":true}' }
    ]);
  });

  it('rejects malformed function arguments before they can become a ToolKernel call', async () => {
    const provider = new OpenAiModelProvider({
      apiKey: 'sk-test',
      fetchImpl: (async () => response({
        status: 'completed',
        output: [{ type: 'function_call', call_id: 'call-bad', name: 'inspect', arguments: '[]' }]
      })) as typeof fetch
    });

    await expect(provider.complete(baseRequest)).rejects.toThrow('non-object arguments');
  });
});
