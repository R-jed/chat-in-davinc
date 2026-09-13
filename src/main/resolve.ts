import { access, constants } from 'node:fs/promises';
import { spawnOwned, terminateProcessTree } from './process.js';
import type { ResolveProbe } from '../shared/types.js';

export const RESOLVE_MCP_PATH = '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/ResolveMCP';

interface RpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

async function executable(path: string): Promise<boolean> {
  try { await access(path, constants.X_OK); return true; } catch { return false; }
}

export async function probeResolveMcp(timeoutMs = 8000): Promise<ResolveProbe> {
  if (!(await executable(RESOLVE_MCP_PATH))) {
    return {
      installed: false, mcpPath: RESOLVE_MCP_PATH, serverName: null, serverVersion: null,
      protocolVersion: null, tools: [], running: null, reachable: false,
      detail: 'Blackmagic ResolveMCP was not found in the DaVinci Resolve application bundle.'
    };
  }

  return await new Promise<ResolveProbe>((resolve) => {
    const child = spawnOwned(RESOLVE_MCP_PATH, []);
    let carry = '';
    let serverName: string | null = null;
    let serverVersion: string | null = null;
    let protocolVersion: string | null = null;
    let tools: string[] = [];
    let running: boolean | null = null;
    let stderr = '';
    let settled = false;

    const finish = async (reachable: boolean, detail: string): Promise<void> => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.pid !== undefined) await terminateProcessTree(child.pid).catch(() => undefined);
      resolve({
        installed: true, mcpPath: RESOLVE_MCP_PATH, serverName, serverVersion, protocolVersion,
        tools, running, reachable, detail
      });
    };

    const send = (message: unknown): void => {
      if (child.stdin?.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };

    const onMessage = (message: RpcResponse): void => {
      if (message.error) {
        void finish(false, message.error.message ?? 'ResolveMCP returned an MCP error');
        return;
      }
      if (message.id === 1) {
        const result = (message.result ?? {}) as Record<string, unknown>;
        protocolVersion = typeof result['protocolVersion'] === 'string' ? result['protocolVersion'] : null;
        const info = (result['serverInfo'] ?? {}) as Record<string, unknown>;
        serverName = typeof info['name'] === 'string' ? info['name'] : null;
        serverVersion = typeof info['version'] === 'string' ? info['version'] : null;
        send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
        send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
        return;
      }
      if (message.id === 2) {
        const result = (message.result ?? {}) as Record<string, unknown>;
        const rows = Array.isArray(result['tools']) ? result['tools'] : [];
        tools = rows.flatMap((tool) => {
          const name = tool && typeof tool === 'object' ? (tool as Record<string, unknown>)['name'] : null;
          return typeof name === 'string' ? [name] : [];
        });
        send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_resolve_status', arguments: {} } });
        return;
      }
      if (message.id === 3) {
        const result = (message.result ?? {}) as Record<string, unknown>;
        const content = Array.isArray(result['content']) ? result['content'] : [];
        const text = content.flatMap((item) => {
          const value = item && typeof item === 'object' ? (item as Record<string, unknown>)['text'] : null;
          return typeof value === 'string' ? [value] : [];
        })[0];
        if (text) {
          try {
            const status = JSON.parse(text) as Record<string, unknown>;
            running = typeof status['running'] === 'boolean' ? status['running'] : null;
          } catch { /* keep unknown */ }
        }
        void finish(true, running ? 'ResolveMCP is reachable and DaVinci Resolve is running.' : 'ResolveMCP is reachable. DaVinci Resolve is not currently running.');
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      carry += chunk.toString('utf8');
      let end = carry.indexOf('\n');
      while (end !== -1) {
        const line = carry.slice(0, end).trim();
        carry = carry.slice(end + 1);
        if (line.startsWith('{')) {
          try { onMessage(JSON.parse(line) as RpcResponse); } catch { /* stderr carries diagnostics */ }
        }
        end = carry.indexOf('\n');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
    child.once('error', (err) => { void finish(false, `Could not start ResolveMCP: ${err.message}`); });
    child.once('close', () => {
      if (!settled) void finish(false, stderr.trim() || 'ResolveMCP exited before completing the read-only probe.');
    });

    const timer = setTimeout(() => { void finish(false, 'ResolveMCP did not complete the read-only probe in time.'); }, timeoutMs);
    send({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chat-in-davinci', version: '0.1.0' } }
    });
  });
}
