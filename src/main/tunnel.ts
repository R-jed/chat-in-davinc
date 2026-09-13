import { rmSync } from 'node:fs';
import { access, constants, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { app } from 'electron';
import type { TunnelStatus } from '../shared/types.js';
import { TUNNEL_ID_PATTERN } from './config.js';
import { logError, logInfo, logWarn, redact } from './log.js';
import { spawnOwned, terminateProcessTree } from './process.js';

const DEFAULT_STATUS: TunnelStatus = {
  state: 'disconnected', binaryPath: null, clientVersion: null, healthBase: null,
  health: null, ready: null, probe: null, lastPollSuccessMs: null, toolCallCount: 0,
  lastToolCallMs: null, lastToolName: null, pid: null, detail: ''
};

interface TunnelRuntime {
  child: ChildProcess | null;
  workDir: string | null;
  status: TunnelStatus;
  listeners: Set<(status: TunnelStatus) => void>;
}

function newRuntime(): TunnelRuntime {
  return {
    child: null,
    workDir: null,
    status: { ...DEFAULT_STATUS },
    listeners: new Set<(status: TunnelStatus) => void>()
  };
}

// One product tunnel runtime. Raw/protected separation now lives inside the CID gateway.
const productRuntime = newRuntime();
const surfaceLabel = 'Product';

async function executable(candidate: string): Promise<boolean> {
  try { await access(candidate, constants.X_OK); return true; } catch { return false; }
}

export async function locateTunnelClient(): Promise<string | null> {
  const executableName = process.platform === 'win32' ? 'tunnel-client.exe' : 'tunnel-client';
  const bundled = process.resourcesPath ? path.join(process.resourcesPath, 'tunnel', executableName) : '';
  const candidates = app.isPackaged
    ? [bundled]
    : [
        process.env['CID_TUNNEL_CLIENT'] ?? '',
        path.join(app.getAppPath(), 'resources', 'tunnel', executableName),
        bundled,
        process.platform === 'darwin' ? '/opt/homebrew/bin/tunnel-client' : '',
        '/usr/local/bin/tunnel-client'
      ];
  for (const candidate of candidates) if (await executable(candidate)) return candidate;
  return null;
}

async function commandVersion(binary: string): Promise<string | null> {
  return await new Promise((resolve) => {
    const proc = spawnOwned(binary, ['--version']);
    let output = '';
    const timer = setTimeout(() => { if (proc.pid) void terminateProcessTree(proc.pid); resolve(null); }, 3000);
    proc.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    proc.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    proc.once('close', () => { clearTimeout(timer); resolve(output.trim().split('\n')[0] || null); });
    proc.once('error', () => { clearTimeout(timer); resolve(null); });
  });
}

const versionCache = new Map<string, string | null>();
export async function getTunnelClientVersion(binary: string): Promise<string | null> {
  if (versionCache.has(binary)) return versionCache.get(binary) ?? null;
  const version = await commandVersion(binary);
  versionCache.set(binary, version);
  return version;
}

async function fetchOk(url: string): Promise<boolean | null> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).ok; } catch { return null; }
}

function metric(text: string, name: string): number | null {
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    if (!line.startsWith(name)) continue;
    const rest = line.slice(name.length);
    if (rest && rest[0] !== ' ' && rest[0] !== '{') continue;
    const value = Number(rest.replace(/^\{[^}]*\}/, '').trim().split(/\s+/)[0]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function metricWithLabels(text: string, name: string, labels: Readonly<Record<string, string>>): number | null {
  for (const line of text.split('\n')) {
    if (!line.startsWith(`${name}{`)) continue;
    if (!Object.entries(labels).every(([key, value]) => line.includes(`${key}="${value}"`))) continue;
    const close = line.indexOf('}');
    if (close < 0) continue;
    const value = Number(line.slice(close + 1).trim().split(/\s+/)[0]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

async function refreshProductTunnelHealth(): Promise<TunnelStatus> {
  const current = productRuntime;
  if (!current.status.healthBase || !current.child) return { ...current.status };
  const base = current.status.healthBase;
  const previousProbe = current.status.probe;
  const previousPoll = current.status.lastPollSuccessMs;
  const previousToolCallCount = current.status.toolCallCount;
  const [health, ready] = await Promise.all([fetchOk(`${base}/healthz`), fetchOk(`${base}/readyz`)]);
  let probe: string | null = null;
  let lastPollSuccessMs: number | null = null;
  let toolCallCount = current.status.toolCallCount;
  let clientVersion = current.status.clientVersion;
  try {
    const [statusRes, metricsRes] = await Promise.all([
      fetch(`${base}/api/status`, { signal: AbortSignal.timeout(2500) }),
      fetch(`${base}/metrics`, { signal: AbortSignal.timeout(2500) })
    ]);
    if (statusRes.ok) {
      const body = await statusRes.json() as Record<string, unknown>;
      if (typeof body['version'] === 'string') clientVersion = body['version'];
      const channels = Array.isArray(body['channels']) ? body['channels'] : [];
      const main = channels.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>)['name'] === 'main') as Record<string, unknown> | undefined;
      probe = typeof main?.['probe_status'] === 'string' ? main['probe_status'] : null;
    }
    if (metricsRes.ok) {
      const metrics = await metricsRes.text();
      const seconds = metric(metrics, 'commands_poll_last_successful_timestamp_seconds');
      lastPollSuccessMs = seconds && seconds > 0 ? Math.round(seconds * 1000) : null;
      const completedToolCalls = metricWithLabels(metrics, 'command_end_to_end_latency_milliseconds_count', {
        latency_type: 'enqueue_to_response',
        request_kind: 'call',
        request_method: 'tools/call',
        tunnel_service_status: '200'
      });
      if (completedToolCalls !== null) toolCallCount = completedToolCalls;
    }
  } catch { /* individual health fields remain unknown */ }

  const connected = ready === true && health === true;
  const toolCallAdvanced = toolCallCount > previousToolCallCount;
  const lastToolCallMs = toolCallAdvanced ? Date.now() : current.status.lastToolCallMs;
  current.status = {
    ...current.status,
    state: connected ? 'connected' : current.status.state === 'error' ? 'error' : 'starting',
    clientVersion, health, ready, probe, lastPollSuccessMs, toolCallCount, lastToolCallMs,
    detail: connected ? 'Secure MCP Tunnel is locally ready.' : 'Tunnel client is running; waiting for readiness.'
  };
  if (previousProbe !== 'ok' && probe === 'ok') logInfo(`${surfaceLabel} ResolveMCP probe verified through tunnel-client.`);
  if (previousPoll === null && lastPollSuccessMs !== null) logInfo(`${surfaceLabel} OpenAI tunnel polling verified.`);
  if (toolCallAdvanced) logInfo(`${surfaceLabel} ChatGPT tool calls observed through tunnel-client: total=${toolCallCount}`);
  emit();
  return { ...current.status };
}

function emit(): void {
  for (const listener of productRuntime.listeners) listener({ ...productRuntime.status });
}
export function onTunnelStatus(listener: (next: TunnelStatus) => void): () => void {
  productRuntime.listeners.add(listener);
  return () => productRuntime.listeners.delete(listener);
}
/** @deprecated Migration alias. There is only one product tunnel runtime. */
export function onWorkflowTunnelStatus(listener: (next: TunnelStatus) => void): () => void {
  return onTunnelStatus(listener);
}
export function getTunnelStatus(): TunnelStatus { return { ...productRuntime.status }; }
/** @deprecated Migration alias. There is only one product tunnel runtime. */
export function getWorkflowTunnelStatus(): TunnelStatus { return getTunnelStatus(); }
export function refreshTunnelHealth(): Promise<TunnelStatus> { return refreshProductTunnelHealth(); }
/** @deprecated Migration alias. There is only one product tunnel runtime. */
export function refreshWorkflowTunnelHealth(): Promise<TunnelStatus> { return refreshProductTunnelHealth(); }

async function waitForHealthFile(file: string, timeoutMs = 15000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const value = (await readFile(file, 'utf8')).trim();
      if (value.startsWith('http://127.0.0.1:')) return value.replace(/\/$/, '');
    } catch { /* not written yet */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function startTunnel(options: {
  tunnelId: string;
  apiKey: string;
  localUrl: string;
  discoveryHeaders?: Readonly<Record<string, string>>;
}): Promise<TunnelStatus> {
  const current = productRuntime;
  if (current.child) return { ...current.status };
  if (!TUNNEL_ID_PATTERN.test(options.tunnelId)) throw new Error('Enter a valid OpenAI Secure MCP Tunnel ID');
  const binary = await locateTunnelClient();
  if (!binary) throw new Error('tunnel-client was not found');
  if (!options.apiKey.trim()) throw new Error('Add the OpenAI tunnel API key first');
  if (!options.localUrl.startsWith('http://127.0.0.1:')) throw new Error('Local MCP endpoint is unavailable');

  current.workDir = await mkdtemp(path.join(os.tmpdir(), 'chat-in-davinci-product-tunnel-'));
  const healthFile = path.join(current.workDir, 'health.url');
  const version = await getTunnelClientVersion(binary);
  current.status = { ...DEFAULT_STATUS, state: 'starting', binaryPath: binary, clientVersion: version, detail: 'Starting Chat in DaVinci Secure MCP Tunnel…' };
  emit();

  const args = [
    'run',
    '--control-plane.tunnel-id', options.tunnelId,
    '--health.listen-addr', '127.0.0.1:0',
    '--health.url-file', healthFile,
    '--log.format', 'json',
    '--log.level', 'info'
  ];
  const discoveryHeaders = Object.entries(options.discoveryHeaders ?? {})
    .map(([name, value]) => `${name}: ${value}`)
    .join(', ');
  current.child = spawnOwned(binary, args, {
    CONTROL_PLANE_API_KEY: options.apiKey.trim(),
    MCP_SERVER_URL: `url=${options.localUrl},channel=main`,
    ...(discoveryHeaders ? { MCP_DISCOVERY_EXTRA_HEADERS: discoveryHeaders } : {})
  });
  const owned = current.child;
  let lastError = '';
  let stdoutBuffer = '';
  let stderrBuffer = '';
  const captureLine = (stream: 'stdout' | 'stderr', line: string): void => {
    const text = line.trim();
    if (!text) return;
    try {
      const event = JSON.parse(text) as Record<string, unknown>;
      const level = typeof event['level'] === 'string' ? event['level'].toUpperCase() : '';
      const message = typeof event['msg'] === 'string' ? event['msg'] : '';
      const error = typeof event['error'] === 'string' ? event['error'] : '';
      if (level === 'ERROR') {
        lastError = redact(error || message || text).slice(-500);
        logError(`${surfaceLabel} tunnel-client: ${error || message || 'runtime error'}`);
      } else if (level === 'WARN' && /401|403|unauthorized|forbidden|invalid_api_key/i.test(`${error} ${message}`)) {
        lastError = redact(error || message).slice(-500);
        logWarn(`${surfaceLabel} tunnel-client: ${error || message}`);
      }
      return;
    } catch { /* stderr and non-JSON startup errors fall through */ }
    if (stream === 'stderr' && /error|failed|unauthorized|forbidden|fork\/exec|no such file/i.test(text)) {
      lastError = redact(text).slice(-500);
      logError(`${surfaceLabel} tunnel-client: ${text}`);
    }
  };
  const captureChunk = (stream: 'stdout' | 'stderr', chunk: Buffer): void => {
    let buffer = (stream === 'stdout' ? stdoutBuffer : stderrBuffer) + chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    if (stream === 'stdout') stdoutBuffer = buffer;
    else stderrBuffer = buffer;
    for (const line of lines) captureLine(stream, line);
  };
  owned.stdout?.on('data', (chunk: Buffer) => captureChunk('stdout', chunk));
  owned.stderr?.on('data', (chunk: Buffer) => captureChunk('stderr', chunk));
  owned.once('error', (err) => {
    if (current.child !== owned) return;
    current.status = { ...current.status, state: 'error', detail: `tunnel-client failed to start: ${err.message}` };
    emit();
  });
  owned.once('close', () => {
    if (current.child !== owned) return;
    captureLine('stdout', stdoutBuffer);
    captureLine('stderr', stderrBuffer);
    current.child = null;
    current.status = { ...current.status, state: 'error', pid: null, detail: lastError || 'tunnel-client exited unexpectedly.' };
    emit();
  });
  current.status = { ...current.status, pid: owned.pid ?? null };
  emit();

  const base = await waitForHealthFile(healthFile);
  if (!base) {
    await stopTunnel();
    throw new Error(lastError || 'tunnel-client did not publish its health endpoint');
  }
  current.status = { ...current.status, healthBase: base };
  logInfo(`${surfaceLabel} tunnel-client started pid=${owned.pid ?? 'unknown'}`);
  return await refreshProductTunnelHealth();
}

async function stopTunnel(): Promise<TunnelStatus> {
  const current = productRuntime;
  const stopping = current.child;
  current.child = null;
  if (stopping?.pid !== undefined) {
    await terminateProcessTree(stopping.pid, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (stopping.exitCode === null && stopping.signalCode === null) await terminateProcessTree(stopping.pid, true);
  }
  if (current.workDir) {
    await rm(current.workDir, { recursive: true, force: true }).catch((err) => logWarn(`Could not remove product tunnel temp directory: ${(err as Error).message}`));
    current.workDir = null;
  }
  current.status = { ...DEFAULT_STATUS, binaryPath: current.status.binaryPath, clientVersion: current.status.clientVersion };
  logInfo(`${surfaceLabel} Secure MCP Tunnel stopped`);
  emit();
  return { ...current.status };
}

function shutdownTunnelNow(): void {
  const current = productRuntime;
  current.child = null;
  if (current.workDir) {
    try { rmSync(current.workDir, { recursive: true, force: true }); } catch { /* process exit owns final cleanup */ }
    current.workDir = null;
  }
  current.status = { ...DEFAULT_STATUS, binaryPath: current.status.binaryPath, clientVersion: current.status.clientVersion };
}

export function startProductTunnel(options: Parameters<typeof startTunnel>[0]): Promise<TunnelStatus> {
  return startTunnel(options);
}

export function stopProductTunnel(): Promise<TunnelStatus> { return stopTunnel(); }
export function shutdownProductTunnelNow(): void { shutdownTunnelNow(); }

/** @deprecated Migration aliases. Raw is a localhost gateway policy surface, not a tunnel. */
export function startRawTunnel(options: Parameters<typeof startTunnel>[0]): Promise<TunnelStatus> { return startTunnel(options); }
/** @deprecated Migration aliases. There is no second Workflow tunnel. */
export function startWorkflowTunnel(options: Parameters<typeof startTunnel>[0]): Promise<TunnelStatus> { return startTunnel(options); }
/** @deprecated Migration aliases. */
export function stopRawTunnel(): Promise<TunnelStatus> { return stopTunnel(); }
/** @deprecated Migration aliases. */
export function stopWorkflowTunnel(): Promise<TunnelStatus> { return stopTunnel(); }
/** @deprecated Migration aliases. */
export function shutdownRawTunnelNow(): void { shutdownTunnelNow(); }
/** @deprecated Migration aliases. */
export function shutdownWorkflowTunnelNow(): void { shutdownTunnelNow(); }
