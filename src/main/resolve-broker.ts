import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';
import type { Tool } from '@modelcontextprotocol/server';
import { spawnOwned, terminateProcessTree } from './process.js';
import { RESOLVE_MCP_PATH } from './resolve.js';

interface RpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
  dispatched: boolean;
}

export type OfficialToolDeclaration = Tool;

export interface ResolveBrokerSnapshot {
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  instructions: string | null;
  tools: OfficialToolDeclaration[];
  schemaHash: string;
}

export class ResolveBrokerError extends Error {
  readonly ambiguous: boolean;

  constructor(message: string, ambiguous = false) {
    super(message);
    this.name = 'ResolveBrokerError';
    this.ambiguous = ambiguous;
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function cloneSnapshot(snapshot: ResolveBrokerSnapshot): ResolveBrokerSnapshot {
  return structuredClone(snapshot);
}

export class ResolveBroker {
  private child: ChildProcess | null = null;
  private carry = '';
  private stderr = '';
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private snapshot: ResolveBrokerSnapshot | null = null;
  private starting: Promise<ResolveBrokerSnapshot> | null = null;

  async start(timeoutMs = 8000): Promise<ResolveBrokerSnapshot> {
    if (this.child && this.snapshot) return cloneSnapshot(this.snapshot);
    if (this.starting) return await this.starting;
    this.starting = this.startInternal(timeoutMs);
    try { return await this.starting; }
    finally { this.starting = null; }
  }

  getSnapshot(): ResolveBrokerSnapshot | null {
    return this.snapshot ? cloneSnapshot(this.snapshot) : null;
  }

  async callTool(name: string, args: Record<string, unknown> = {}, timeoutMs = 8000): Promise<unknown> {
    const snapshot = await this.start(timeoutMs);
    if (!snapshot.tools.some((tool) => tool.name === name)) {
      throw new ResolveBrokerError(`ResolveMCP tool is not present in the current snapshot: ${name}`);
    }
    return await this.request('tools/call', { name, arguments: args }, timeoutMs);
  }

  async getResolveStatus(timeoutMs = 8000): Promise<Record<string, unknown>> {
    const result = await this.callTool('get_resolve_status', {}, timeoutMs) as Record<string, unknown>;
    const content = Array.isArray(result['content']) ? result['content'] : [];
    const text = content.flatMap((item) => {
      const value = item && typeof item === 'object' ? (item as Record<string, unknown>)['text'] : null;
      return typeof value === 'string' ? [value] : [];
    })[0];
    if (!text) throw new ResolveBrokerError('get_resolve_status returned no text result');
    try { return JSON.parse(text) as Record<string, unknown>; }
    catch { throw new ResolveBrokerError('get_resolve_status returned invalid JSON'); }
  }

  async stop(): Promise<void> {
    const stopping = this.child;
    this.child = null;
    this.snapshot = null;
    this.failPending('ResolveBroker stopped while a request was pending');
    if (stopping?.pid !== undefined) await terminateProcessTree(stopping.pid, true);
  }

  private async startInternal(timeoutMs: number): Promise<ResolveBrokerSnapshot> {
    const child = spawnOwned(RESOLVE_MCP_PATH, []);
    this.child = child;
    this.carry = '';
    this.stderr = '';

    child.stdout?.on('data', (chunk: Buffer) => this.captureStdout(chunk));
    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString('utf8')}`.slice(-2000);
    });
    child.once('error', (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.snapshot = null;
      this.failPending(`ResolveMCP failed to start: ${error.message}`);
    });
    child.once('close', () => {
      if (this.child !== child) return;
      this.child = null;
      this.snapshot = null;
      this.failPending(this.stderr.trim() || 'ResolveMCP exited while a broker request was pending');
    });

    try {
      const initialized = await this.request('initialize', {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'chat-in-davinci-broker', version: '0.1.0' }
      }, timeoutMs) as Record<string, unknown>;
      this.notify('notifications/initialized', {});
      const listed = await this.request('tools/list', {}, timeoutMs) as Record<string, unknown>;
      const rows = Array.isArray(listed['tools']) ? listed['tools'] : [];
      const tools = rows.flatMap((tool) => {
        if (!tool || typeof tool !== 'object' || Array.isArray(tool)) return [];
        const declaration = tool as Record<string, unknown>;
        return typeof declaration['name'] === 'string'
          && declaration['inputSchema'] !== null
          && typeof declaration['inputSchema'] === 'object'
          && !Array.isArray(declaration['inputSchema'])
          ? [structuredClone(declaration) as unknown as OfficialToolDeclaration]
          : [];
      });
      const info = (initialized['serverInfo'] ?? {}) as Record<string, unknown>;
      const snapshot: ResolveBrokerSnapshot = {
        serverName: typeof info['name'] === 'string' ? info['name'] : null,
        serverVersion: typeof info['version'] === 'string' ? info['version'] : null,
        protocolVersion: typeof initialized['protocolVersion'] === 'string' ? initialized['protocolVersion'] : null,
        instructions: typeof initialized['instructions'] === 'string' ? initialized['instructions'] : null,
        tools,
        schemaHash: createHash('sha256').update(canonical(tools)).digest('hex')
      };
      this.snapshot = snapshot;
      return cloneSnapshot(snapshot);
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    const child = this.child;
    if (!child?.stdin?.writable) return Promise.reject(new ResolveBrokerError('ResolveBroker is not connected'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        reject(new ResolveBrokerError(`ResolveMCP request timed out: ${method}`, pending.dispatched));
      }, timeoutMs);
      const pending: PendingCall = { resolve, reject, timer, dispatched: false };
      this.pending.set(id, pending);
      pending.dispatched = true;
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (error) => {
        if (!error) return;
        const current = this.pending.get(id);
        if (!current) return;
        clearTimeout(current.timer);
        this.pending.delete(id);
        reject(new ResolveBrokerError(`ResolveMCP write failed: ${error.message}`, current.dispatched));
      });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    if (!this.child?.stdin?.writable) throw new ResolveBrokerError('ResolveBroker is not connected');
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
  }

  private captureStdout(chunk: Buffer): void {
    this.carry += chunk.toString('utf8');
    let end = this.carry.indexOf('\n');
    while (end !== -1) {
      const line = this.carry.slice(0, end).trim();
      this.carry = this.carry.slice(end + 1);
      if (line.startsWith('{')) {
        try { this.onMessage(JSON.parse(line) as RpcResponse); } catch { /* protocol stdout stays isolated */ }
      }
      end = this.carry.indexOf('\n');
    }
  }

  private onMessage(message: RpcResponse): void {
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) {
      pending.reject(new ResolveBrokerError(message.error.message ?? 'ResolveMCP returned an MCP error'));
      return;
    }
    pending.resolve(message.result);
  }

  private failPending(message: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new ResolveBrokerError(message, pending.dispatched));
    }
    this.pending.clear();
  }
}
