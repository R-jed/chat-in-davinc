import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppConfig, NavigationLayoutPreference, ProjectLocation, UiLanguagePreference } from '../shared/types.js';

const DEFAULT_CONFIG: AppConfig = {
  tunnelId: '',
  workflowTunnelId: '',
  projectLocations: [],
  chatgptVerified: false,
  workflowChatgptVerified: false,
  language: 'system',
  navigationLayout: 'sidebar',
  sidebarCollapsed: false,
  autoConnectOnLaunch: false,
  keepRunningOnWindowClose: true,
  showMenuBarIcon: true,
  launchAtLogin: false,
  developerMode: false
};
let configPath = '';
let current: AppConfig = { ...DEFAULT_CONFIG, projectLocations: [] };
let mutationQueue: Promise<void> = Promise.resolve();

export const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;
export const PROJECT_LOCATION_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,31}$/;

/**
 * Resolves the one product Tunnel ID while reading a pre-reset dual-tunnel config.
 *
 * Protected Workflow used to be the production surface, so an existing Workflow ID wins
 * over the old Raw ID during the one-tunnel migration. New writes mirror the chosen ID into
 * both legacy fields only so the old renderer can survive until the COS shell replaces it.
 */
export function productTunnelId(config: Pick<AppConfig, 'tunnelId' | 'workflowTunnelId'> = current): string {
  if (TUNNEL_ID_PATTERN.test(config.workflowTunnelId)) return config.workflowTunnelId;
  if (TUNNEL_ID_PATTERN.test(config.tunnelId)) return config.tunnelId;
  return config.workflowTunnelId || config.tunnelId;
}

export function initConfig(userData: string): void {
  configPath = path.join(userData, 'config.json');
}

function parseConfig(value: unknown): AppConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_CONFIG, projectLocations: [] };
  const obj = value as Record<string, unknown>;
  const languageRaw = obj['language'];
  const language: UiLanguagePreference = languageRaw === 'en' || languageRaw === 'zh-CN' ? languageRaw : 'system';
  const navigationLayout: NavigationLayoutPreference = obj['navigationLayout'] === 'topbar' ? 'topbar' : 'sidebar';
  const projectLocations = Array.isArray(obj['projectLocations'])
    ? obj['projectLocations']
        .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
        .map((entry) => ({
          name: typeof entry['name'] === 'string' ? entry['name'].trim() : '',
          path: typeof entry['path'] === 'string' ? entry['path'].trim() : ''
        }))
        .filter((entry) => PROJECT_LOCATION_NAME_PATTERN.test(entry.name) && path.isAbsolute(entry.path))
        .filter((entry, index, all) => all.findIndex((candidate) => candidate.name === entry.name || candidate.path === entry.path) === index)
        .slice(0, 32)
    : [];
  const rawTunnelId = typeof obj['tunnelId'] === 'string' ? obj['tunnelId'].trim() : '';
  const legacyWorkflowTunnelId = typeof obj['workflowTunnelId'] === 'string' ? obj['workflowTunnelId'].trim() : '';
  const canonicalTunnelId = TUNNEL_ID_PATTERN.test(legacyWorkflowTunnelId)
    ? legacyWorkflowTunnelId
    : rawTunnelId;
  const canonicalVerified = TUNNEL_ID_PATTERN.test(legacyWorkflowTunnelId)
    ? obj['workflowChatgptVerified'] === true
    : obj['chatgptVerified'] === true;
  return {
    tunnelId: canonicalTunnelId,
    workflowTunnelId: canonicalTunnelId,
    projectLocations,
    chatgptVerified: canonicalVerified,
    workflowChatgptVerified: canonicalVerified,
    language,
    navigationLayout,
    sidebarCollapsed: obj['sidebarCollapsed'] === true,
    autoConnectOnLaunch: obj['autoConnectOnLaunch'] === true,
    keepRunningOnWindowClose: obj['keepRunningOnWindowClose'] !== false,
    showMenuBarIcon: obj['showMenuBarIcon'] !== false,
    launchAtLogin: obj['launchAtLogin'] === true,
    developerMode: obj['developerMode'] === true
  };
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw: unknown = JSON.parse(await fs.readFile(configPath, 'utf8'));
    current = parseConfig(raw);
    if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'tunnelClientPath')) {
      await persist(current);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    current = { ...DEFAULT_CONFIG, projectLocations: [] };
  }
  return { ...current, projectLocations: [...current.projectLocations] };
}

export function getConfig(): AppConfig { return { ...current, projectLocations: [...current.projectLocations] }; }

async function persist(next: AppConfig): Promise<AppConfig> {
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  const tmp = `${configPath}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(tmp, configPath);
  current = next;
  return getConfig();
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = mutationQueue.then(operation);
  mutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

export function saveConfig(next: AppConfig): Promise<AppConfig> {
  return enqueue(async () => {
    const previousTunnelId = productTunnelId(current);
    const requestedRaw = typeof next.tunnelId === 'string' ? next.tunnelId.trim() : '';
    const requestedWorkflow = typeof next.workflowTunnelId === 'string' ? next.workflowTunnelId.trim() : '';
    const rawChanged = requestedRaw !== current.tunnelId;
    const workflowChanged = requestedWorkflow !== current.workflowTunnelId;
    let canonicalTunnelId: string;
    if (rawChanged && !workflowChanged) canonicalTunnelId = requestedRaw;
    else if (workflowChanged && !rawChanged) canonicalTunnelId = requestedWorkflow;
    else if (rawChanged && workflowChanged && requestedRaw !== requestedWorkflow) {
      // A pre-reset config can arrive with two independent ids on its first migration write.
      // Protected Workflow was the production connector, so preserve it once. After a
      // canonical id exists, two conflicting edits are ambiguous and must fail closed.
      if (previousTunnelId) throw new Error('Only one product Tunnel ID may be configured');
      canonicalTunnelId = requestedWorkflow || requestedRaw;
    } else canonicalTunnelId = requestedWorkflow || requestedRaw;
    if (canonicalTunnelId && !TUNNEL_ID_PATTERN.test(canonicalTunnelId)) {
      throw new Error('Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters');
    }
    const clean = parseConfig({ ...next, tunnelId: canonicalTunnelId, workflowTunnelId: canonicalTunnelId });
    clean.tunnelId = canonicalTunnelId;
    clean.workflowTunnelId = canonicalTunnelId;
    if (canonicalTunnelId !== previousTunnelId) {
      clean.chatgptVerified = false;
      clean.workflowChatgptVerified = false;
    } else {
      const verified = clean.chatgptVerified || clean.workflowChatgptVerified;
      clean.chatgptVerified = verified;
      clean.workflowChatgptVerified = verified;
    }
    return await persist(clean);
  });
}

function safeLocationName(locationPath: string): string {
  const base = path.basename(locationPath).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
  const used = new Set(current.projectLocations.map((location) => location.name));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const suffix = `-${n}`;
    const candidate = `${base.slice(0, Math.max(1, 32 - suffix.length))}${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a unique project location name');
}

export function addProjectLocation(selectedPath: string): Promise<AppConfig> {
  return enqueue(async () => {
    const canonical = await fs.realpath(selectedPath);
    const stat = await fs.stat(canonical);
    if (!stat.isDirectory()) throw new Error('Project location must be a folder');
    if (current.projectLocations.some((location) => location.path === canonical)) return getConfig();
    const location: ProjectLocation = { name: safeLocationName(canonical), path: canonical };
    return await persist({ ...current, projectLocations: [...current.projectLocations, location] });
  });
}

export function removeProjectLocation(name: string): Promise<AppConfig> {
  return enqueue(async () => await persist({
    ...current,
    projectLocations: current.projectLocations.filter((location) => location.name !== name)
  }));
}

export function setChatgptVerified(verified: boolean): Promise<AppConfig> {
  return enqueue(async () => await persist({
    ...current,
    chatgptVerified: verified,
    workflowChatgptVerified: verified
  }));
}

export function setWorkflowChatgptVerified(verified: boolean): Promise<AppConfig> {
  return setChatgptVerified(verified);
}
