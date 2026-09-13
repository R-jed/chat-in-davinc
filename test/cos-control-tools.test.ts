import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';
import {
  buildCosControlToolSurface,
  cosRequestIdFromHeader,
  registerCosControlTools,
  type CosControlCallContext,
  type CosControlRuntime
} from '../src/main/cos-control-tools.js';

function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

describe('COS control-tool adapter', () => {
  it('registers only the COS control surface and delegates valid calls without taking ownership of COS state', async () => {
    const runtime: CosControlRuntime = {
      session: vi.fn(async () => textResult('session-ok')),
      agents: vi.fn(async () => textResult('agents-ok')),
      sessionFinish: vi.fn(async () => textResult('finish-ok'))
    };
    const registered = new Map<string, {
      tool: Tool;
      call: (args: unknown, context: CosControlCallContext) => Promise<CallToolResult>;
    }>();
    registerCosControlTools((tool, call) => registered.set(tool.name, { tool, call }), runtime);

    expect([...registered.keys()]).toEqual(['session', 'agents', 'session_finish']);
    expect(registered.get('session')?.tool.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(registered.get('agents')?.tool.annotations).toMatchObject({ readOnlyHint: false, idempotentHint: false });

    const callContext = { transportSessionId: 'mcp-session', requestId: 'wfr_abc123', startedAt: 1234 };
    await expect(registered.get('session')!.call({ action: 'search', query: 'grade' }, callContext)).resolves.toEqual(textResult('session-ok'));
    await expect(registered.get('agents')!.call({ action: 'message', to: 'worker-1', text: 'Continue' }, callContext)).resolves.toEqual(textResult('agents-ok'));
    await expect(registered.get('session_finish')!.call({ summary: 'Done with the requested work.' }, callContext)).resolves.toEqual(textResult('finish-ok'));

    expect(runtime.session).toHaveBeenCalledWith({ action: 'search', query: 'grade' }, callContext);
    expect(runtime.agents).toHaveBeenCalledWith(
      { action: 'message', to: 'worker-1', text: 'Continue' },
      callContext
    );
    expect(runtime.sessionFinish).toHaveBeenCalledWith(
      { summary: 'Done with the requested work.' },
      callContext
    );
  });

  it('normalizes the COS x-request-id join key and fails closed on ambiguous headers', () => {
    expect(cosRequestIdFromHeader('wfr_01a014bdd7cd7a15b6b533d3ce2b42f2/yqy1')).toBe(
      'wfr_01a014bdd7cd7a15b6b533d3ce2b42f2'
    );
    expect(cosRequestIdFromHeader(['wfr_one/1'])).toBe('wfr_one');
    expect(cosRequestIdFromHeader(['wfr_one/1', 'wfr_two/2'])).toBeNull();
    expect(cosRequestIdFromHeader('bad request/id')).toBeNull();
  });

  it('fails closed before delegation when the COS runtime is absent or COS argument semantics are invalid', async () => {
    const surface = buildCosControlToolSurface();
    const context = { transportSessionId: null, requestId: null, startedAt: 1234 };
    await expect(surface.call('session', { action: 'search' }, context)).rejects.toThrow('COS control runtime is unavailable for session');
    await expect(surface.call('agents', { action: 'spawn' }, context)).rejects.toThrow('agents action=spawn requires workers');
    await expect(surface.call('agents', { action: 'status', spawn_mode: 'fresh' }, context)).rejects.toThrow('spawn_mode is only valid');
    await expect(surface.call('agents', { action: 'message', to: 'worker-1' }, context)).rejects.toThrow('requires to and text');
    await expect(surface.call('session', { action: 'read' }, context)).rejects.toThrow('session_id is required with action=read');
    await expect(surface.call('session_finish', { summary: '' }, context)).rejects.toThrow('Invalid session_finish arguments');
    await expect(surface.call('read', {}, context)).rejects.toThrow('Unknown COS control tool');
  });
});
