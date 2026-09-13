import type { DiagnosticsState, ResolveGatewayStatus, ResolveProbe, TunnelStatus } from '../shared/types.js';

const OPENAI_FRESH_MS = 90_000;

export function buildDiagnostics(
  resolve: ResolveProbe,
  tunnel: TunnelStatus,
  chatgptVerified = false,
  now = Date.now(),
  gateway?: ResolveGatewayStatus,
  requestSurface: 'raw' | 'workflow' = 'raw'
): DiagnosticsState {
  const openaiAt = tunnel.lastPollSuccessMs;
  const gatewayRequestAt = requestSurface === 'workflow'
    ? gateway?.workflowRequestAt ?? null
    : gateway?.rawRequestAt ?? null;
  const gatewayToolAt = gateway?.lastToolCallAt ?? null;
  const openaiObservedAt = gatewayRequestAt ?? openaiAt;
  const openaiStatus = gatewayRequestAt !== null || openaiAt !== null && now - openaiAt <= OPENAI_FRESH_MS
    ? 'pass'
    : tunnel.state === 'connected' && openaiAt !== null
      ? 'fail'
      : 'not-run';
  const toolObserved = tunnel.toolCallCount > 0 || tunnel.lastToolCallMs !== null;
  const chatgptStatus = chatgptVerified || gatewayRequestAt !== null || toolObserved ? 'pass' : 'not-run';
  const toolStatus = chatgptVerified || gatewayToolAt !== null || toolObserved ? 'pass' : 'not-run';

  return {
    checks: [
      {
        id: 'resolve',
        status: resolve.running === true ? 'pass' : resolve.running === false ? 'fail' : 'not-run',
        observedAt: resolve.reachable ? now : null
      },
      {
        id: 'resolveMcp',
        status: resolve.installed && resolve.reachable ? 'pass' : resolve.installed ? 'fail' : 'fail',
        observedAt: resolve.reachable ? now : null
      },
      {
        id: 'broker',
        status: gateway?.active && gateway.schemaHash ? 'pass' : 'not-run',
        observedAt: gateway?.active && gateway.schemaHash ? now : null
      },
      {
        id: 'tunnel',
        status: tunnel.state === 'connected' ? 'pass' : tunnel.state === 'error' || tunnel.state === 'offline' ? 'fail' : 'not-run',
        observedAt: tunnel.state === 'connected' ? now : null
      },
      { id: 'openai', status: openaiStatus, observedAt: openaiObservedAt },
      { id: 'chatgptRequest', status: chatgptStatus, observedAt: gatewayRequestAt ?? tunnel.lastToolCallMs },
      { id: 'toolCall', status: toolStatus, observedAt: gatewayToolAt ?? tunnel.lastToolCallMs }
    ]
  };
}
