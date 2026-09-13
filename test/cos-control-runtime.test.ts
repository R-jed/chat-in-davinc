import type { CallToolResult } from '@modelcontextprotocol/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CosControlRuntime } from '../src/main/cos-control-tools.js';
import {
  attachCosControlRuntime,
  cosControlRuntimeBridge,
  detachCosControlRuntime,
  resetCosControlRuntimeForTests
} from '../src/main/cos-control-runtime.js';

function result(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

afterEach(() => resetCosControlRuntimeForTests());

describe('COS control runtime binding', () => {
  it('has one host owner, preserves exact caller context, and fails closed after detach', async () => {
    const session = vi.fn(async () => result('session'));
    const runtime: CosControlRuntime = {
      session,
      agents: vi.fn(async () => result('agents')),
      sessionFinish: vi.fn(async () => result('finish'))
    };
    const other: CosControlRuntime = {
      session: vi.fn(async () => result('other')),
      agents: vi.fn(async () => result('other')),
      sessionFinish: vi.fn(async () => result('other'))
    };
    const context = { transportSessionId: 'mcp-session', requestId: 'wfr_exact', startedAt: 4567 };

    await expect(cosControlRuntimeBridge.session({ action: 'search' }, context)).rejects.toThrow('not attached');
    attachCosControlRuntime(runtime);
    expect(() => attachCosControlRuntime(other)).toThrow('already attached');
    await expect(cosControlRuntimeBridge.session({ action: 'search' }, context)).resolves.toEqual(result('session'));
    expect(session).toHaveBeenCalledWith({ action: 'search' }, context);
    expect(detachCosControlRuntime(other)).toBe(false);
    expect(detachCosControlRuntime(runtime)).toBe(true);
    await expect(cosControlRuntimeBridge.session({ action: 'search' }, context)).rejects.toThrow('not attached');
  });

  it('does not substitute missing session or finish ownership from CID', async () => {
    const agentOnly = { agents: vi.fn(async () => result('agents')) };
    const context = { transportSessionId: null, requestId: 'wfr_exact', startedAt: 4567 };
    attachCosControlRuntime(agentOnly);

    await expect(cosControlRuntimeBridge.agents({ action: 'status' }, context)).resolves.toEqual(result('agents'));
    await expect(cosControlRuntimeBridge.session({ action: 'search' }, context)).rejects.toThrow(
      'does not own session; refusing to use a CID fallback'
    );
    await expect(cosControlRuntimeBridge.sessionFinish({ summary: 'done' }, context)).rejects.toThrow(
      'does not own sessionFinish; refusing to use a CID fallback'
    );
  });
});
