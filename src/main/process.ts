import { spawn, type ChildProcess } from 'node:child_process';

const ownedProcessGroups = new Set<number>();

const SECRET_ENV_KEYS = [
  'CONTROL_PLANE_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_ADMIN_KEY',
  'CLOUDFLARED_TOKEN',
  'CLOUDFLARED_TUNNEL_TOKEN',
  'CID_OPENAI_TUNNEL_KEY'
];

export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete env[key];
  for (const [key, value] of Object.entries(extra)) env[key] = value;
  return env;
}

export function spawnOwned(file: string, args: readonly string[], extraEnv: Record<string, string> = {}): ChildProcess {
  const child = spawn(file, [...args], {
    shell: false,
    windowsHide: true,
    detached: process.platform !== 'win32',
    env: childEnv(extraEnv),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pid = child.pid;
  if (pid !== undefined) {
    ownedProcessGroups.add(pid);
    child.once('close', () => {
      void terminateProcessTree(pid, true).finally(() => ownedProcessGroups.delete(pid));
    });
  }
  return child;
}

export async function terminateProcessTree(pid: number, force = false): Promise<void> {
  const signal: NodeJS.Signals = force ? 'SIGKILL' : 'SIGTERM';
  if (process.platform === 'win32') {
    try { process.kill(pid, signal); } catch { /* already gone */ }
    return;
  }
  try { process.kill(-pid, signal); return; } catch { /* no process group */ }
  try { process.kill(pid, signal); } catch { /* already gone */ }
}

export async function terminateAllOwnedProcessTrees(): Promise<void> {
  const pids = [...ownedProcessGroups];
  await Promise.all(pids.map((pid) => terminateProcessTree(pid, false)));
  if (pids.length > 0) await new Promise((resolve) => setTimeout(resolve, 250));
  await Promise.all(pids.map((pid) => terminateProcessTree(pid, true)));
  for (const pid of pids) ownedProcessGroups.delete(pid);
}

export function terminateAllOwnedProcessTreesNow(): void {
  const pids = [...ownedProcessGroups];
  for (const pid of pids) {
    if (process.platform === 'win32') {
      try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      continue;
    }
    try { process.kill(-pid, 'SIGKILL'); continue; } catch { /* no process group */ }
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  ownedProcessGroups.clear();
}
