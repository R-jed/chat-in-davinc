import { describe, expect, it } from 'vitest';
import { buildDiagnostics } from '../src/main/diagnostics.js';
import type { ResolveProbe, TunnelStatus } from '../src/shared/types.js';

const resolve: ResolveProbe = {
  installed: true,
  mcpPath: '/Applications/DaVinci Resolve/ResolveMCP',
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  tools: ['get_resolve_status'],
  running: true,
  reachable: true,
  detail: 'ok'
};

const tunnel: TunnelStatus = {
  state: 'connected',
  binaryPath: '/app/tunnel-client',
  clientVersion: '0.0.14',
  healthBase: 'http://127.0.0.1:1234',
  health: true,
  ready: true,
  probe: 'ok',
  lastPollSuccessMs: 99_000,
  toolCallCount: 0,
  lastToolCallMs: null,
  lastToolName: null,
  pid: 123,
  detail: 'ready'
};

describe('DaVinci diagnostics projection', () => {
  it('separates verified links from Phase 0 evidence that is not observable', () => {
    const state = buildDiagnostics(resolve, tunnel, false, 100_000);
    const byId = new Map(state.checks.map((check) => [check.id, check.status]));
    expect(byId.get('resolve')).toBe('pass');
    expect(byId.get('resolveMcp')).toBe('pass');
    expect(byId.get('tunnel')).toBe('pass');
    expect(byId.get('openai')).toBe('pass');
    expect(byId.get('broker')).toBe('not-run');
    expect(byId.get('chatgptRequest')).toBe('not-run');
    expect(byId.get('toolCall')).toBe('not-run');
  });

  it('projects the saved setup confirmation as verified ChatGPT request and tool call evidence', () => {
    const state = buildDiagnostics(resolve, tunnel, true, 100_000);
    const byId = new Map(state.checks.map((check) => [check.id, check.status]));
    expect(byId.get('chatgptRequest')).toBe('pass');
    expect(byId.get('toolCall')).toBe('pass');
  });

  it('projects a tunnel-observed Resolve tool completion as automatic request and tool evidence', () => {
    const state = buildDiagnostics(resolve, { ...tunnel, toolCallCount: 1, lastToolCallMs: 99_500, lastToolName: 'get_resolve_status' }, false, 100_000);
    const byId = new Map(state.checks.map((check) => [check.id, check.status]));
    expect(byId.get('chatgptRequest')).toBe('pass');
    expect(byId.get('toolCall')).toBe('pass');
  });

  it('projects tunnel-client tools/call metrics as automatic request and tool evidence', () => {
    const state = buildDiagnostics(resolve, { ...tunnel, toolCallCount: 8, lastToolCallMs: 99_500 }, false, 100_000);
    const byId = new Map(state.checks.map((check) => [check.id, check.status]));
    expect(byId.get('chatgptRequest')).toBe('pass');
    expect(byId.get('toolCall')).toBe('pass');
  });

  it('projects real gateway ingress and tool activity without waiting for tunnel metrics', () => {
    const state = buildDiagnostics(resolve, tunnel, false, 100_000, {
      active: true,
      rawRequestAt: 99_900,
      workflowRequestAt: null,
      lastToolCallAt: 99_950,
      lastToolName: 'get_resolve_status',
      schemaHash: 'abc123'
    });
    const byId = new Map(state.checks.map((check) => [check.id, check]));
    expect(byId.get('broker')).toEqual({ id: 'broker', status: 'pass', observedAt: 100_000 });
    expect(byId.get('openai')).toEqual({ id: 'openai', status: 'pass', observedAt: 99_900 });
    expect(byId.get('chatgptRequest')).toEqual({ id: 'chatgptRequest', status: 'pass', observedAt: 99_900 });
    expect(byId.get('toolCall')).toEqual({ id: 'toolCall', status: 'pass', observedAt: 99_950 });
  });
});
