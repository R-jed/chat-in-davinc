import { randomUUID } from 'node:crypto';
import type { AgentEntityRef, AgentWorkspaceMention } from '../shared/agent-system.js';
import { readDurable, writeDurableNow } from './durable.js';

const STATE = 'cid-workspaces';
const STATE_VERSION = 1;
const MAX_WORKSPACES = 200;
const MAX_SESSION_BINDINGS = 1000;

export interface CidWorkspaceRecord {
  workspaceId: string;
  projectIdentity: string;
  projectLabel: string;
  createdAt: number;
  updatedAt: number;
  lastObservedAt: number;
  workspaceRoot: string | null;
  analysisArtifactIds: string[];
  jobIds: string[];
  semanticHistoryRevision: number;
  lastKnownWorldGeneration: number | null;
  lastKnownTimelineIdentity: string | null;
  lastKnownTimelineLabel: string | null;
}

interface WorkspaceSnapshot {
  version: 1;
  savedAt: number;
  activeWorkspaceId: string | null;
  workspaces: CidWorkspaceRecord[];
  sessionBindings: Array<{ sessionId: string; workspaceId: string; boundAt: number }>;
}

const workspacesByProject = new Map<string, CidWorkspaceRecord>();
const workspaceById = new Map<string, CidWorkspaceRecord>();
const sessionBindings = new Map<string, { workspaceId: string; boundAt: number }>();
let activeWorkspaceId: string | null = null;
let initialized = false;

function validId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-z_-]{8,128}$/i.test(value);
}

function clone(record: CidWorkspaceRecord): CidWorkspaceRecord {
  return structuredClone(record);
}

function boundedSnapshot(): WorkspaceSnapshot {
  const workspaces = [...workspaceById.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_WORKSPACES);
  const retained = new Set(workspaces.map((workspace) => workspace.workspaceId));
  const bindings = [...sessionBindings.entries()]
    .filter(([, binding]) => retained.has(binding.workspaceId))
    .sort((left, right) => right[1].boundAt - left[1].boundAt)
    .slice(0, MAX_SESSION_BINDINGS)
    .map(([sessionId, binding]) => ({ sessionId, ...binding }));
  return {
    version: STATE_VERSION,
    savedAt: Date.now(),
    activeWorkspaceId: activeWorkspaceId && retained.has(activeWorkspaceId) ? activeWorkspaceId : null,
    workspaces: workspaces.map(clone),
    sessionBindings: bindings
  };
}

async function persist(): Promise<void> {
  await writeDurableNow(STATE, boundedSnapshot());
}

export async function initCidWorkspaceRegistry(): Promise<void> {
  if (initialized) return;
  const saved = await readDurable<WorkspaceSnapshot>(STATE);
  workspacesByProject.clear();
  workspaceById.clear();
  sessionBindings.clear();
  activeWorkspaceId = null;
  if (saved?.version === STATE_VERSION && Array.isArray(saved.workspaces)) {
    for (const raw of saved.workspaces.slice(0, MAX_WORKSPACES)) {
      if (!raw || !validId(raw.workspaceId) || !validId(raw.projectIdentity) || typeof raw.projectLabel !== 'string') continue;
      const record: CidWorkspaceRecord = {
        workspaceId: raw.workspaceId,
        projectIdentity: raw.projectIdentity,
        projectLabel: raw.projectLabel.slice(0, 500),
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
        updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
        lastObservedAt: Number.isFinite(raw.lastObservedAt) ? raw.lastObservedAt : 0,
        workspaceRoot: typeof raw.workspaceRoot === 'string' ? raw.workspaceRoot : null,
        analysisArtifactIds: Array.isArray(raw.analysisArtifactIds) ? raw.analysisArtifactIds.filter(validId).slice(-500) : [],
        jobIds: Array.isArray(raw.jobIds) ? raw.jobIds.filter(validId).slice(-500) : [],
        semanticHistoryRevision: Number.isInteger(raw.semanticHistoryRevision) && raw.semanticHistoryRevision >= 0
          ? raw.semanticHistoryRevision
          : 0,
        lastKnownWorldGeneration: typeof raw.lastKnownWorldGeneration === 'number'
          && Number.isInteger(raw.lastKnownWorldGeneration) && raw.lastKnownWorldGeneration > 0
          ? raw.lastKnownWorldGeneration
          : null,
        lastKnownTimelineIdentity: validId(raw.lastKnownTimelineIdentity) ? raw.lastKnownTimelineIdentity : null,
        lastKnownTimelineLabel: typeof raw.lastKnownTimelineLabel === 'string' ? raw.lastKnownTimelineLabel.slice(0, 500) : null
      };
      workspacesByProject.set(record.projectIdentity, record);
      workspaceById.set(record.workspaceId, record);
    }
    if (Array.isArray(saved.sessionBindings)) {
      for (const raw of saved.sessionBindings.slice(0, MAX_SESSION_BINDINGS)) {
        if (!raw || !validId(raw.sessionId) || !validId(raw.workspaceId) || !workspaceById.has(raw.workspaceId)) continue;
        sessionBindings.set(raw.sessionId, {
          workspaceId: raw.workspaceId,
          boundAt: Number.isFinite(raw.boundAt) ? raw.boundAt : Date.now()
        });
      }
    }
    if (validId(saved.activeWorkspaceId) && workspaceById.has(saved.activeWorkspaceId)) {
      activeWorkspaceId = saved.activeWorkspaceId;
    }
  }
  initialized = true;
}

export async function observeCidWorkspaceProject(options: {
  project: AgentEntityRef;
  observedAt: number;
  semanticHistoryRevision: number;
  worldGeneration?: number;
  timeline?: AgentEntityRef | null;
}): Promise<CidWorkspaceRecord> {
  if (!initialized) throw new Error('CID Workspace registry is not initialized');
  if (options.project.kind !== 'project' || !validId(options.project.exactId)) {
    throw new Error('CID Workspace requires one exact Resolve Project identity');
  }
  const existing = workspacesByProject.get(options.project.exactId);
  if (existing) {
    const before = clone(existing);
    existing.projectLabel = options.project.label;
    existing.updatedAt = Date.now();
    existing.lastObservedAt = Math.max(existing.lastObservedAt, options.observedAt);
    existing.semanticHistoryRevision = Math.max(existing.semanticHistoryRevision, options.semanticHistoryRevision);
    if (Number.isInteger(options.worldGeneration) && (options.worldGeneration ?? 0) > 0) {
      existing.lastKnownWorldGeneration = options.worldGeneration!;
    }
    if (options.timeline !== undefined) {
      existing.lastKnownTimelineIdentity = options.timeline && options.timeline.kind === 'timeline' && validId(options.timeline.exactId)
        ? options.timeline.exactId
        : null;
      existing.lastKnownTimelineLabel = options.timeline?.kind === 'timeline' ? options.timeline.label.slice(0, 500) : null;
    }
    activeWorkspaceId = existing.workspaceId;
    try {
      await persist();
    } catch (error) {
      Object.assign(existing, before);
      throw error;
    }
    return clone(existing);
  }
  const now = Date.now();
  const record: CidWorkspaceRecord = {
    workspaceId: randomUUID(),
    projectIdentity: options.project.exactId,
    projectLabel: options.project.label,
    createdAt: now,
    updatedAt: now,
    lastObservedAt: options.observedAt,
    workspaceRoot: null,
    analysisArtifactIds: [],
    jobIds: [],
    semanticHistoryRevision: options.semanticHistoryRevision,
    lastKnownWorldGeneration: Number.isInteger(options.worldGeneration) && (options.worldGeneration ?? 0) > 0
      ? options.worldGeneration!
      : null,
    lastKnownTimelineIdentity: options.timeline && options.timeline.kind === 'timeline' && validId(options.timeline.exactId)
      ? options.timeline.exactId
      : null,
    lastKnownTimelineLabel: options.timeline?.kind === 'timeline' ? options.timeline.label.slice(0, 500) : null
  };
  workspacesByProject.set(record.projectIdentity, record);
  workspaceById.set(record.workspaceId, record);
  const previousActive = activeWorkspaceId;
  activeWorkspaceId = record.workspaceId;
  try {
    await persist();
  } catch (error) {
    workspacesByProject.delete(record.projectIdentity);
    workspaceById.delete(record.workspaceId);
    activeWorkspaceId = previousActive;
    throw error;
  }
  return clone(record);
}

export async function bindCosSessionToWorkspace(
  sessionId: string,
  workspaceId: string
): Promise<'bound' | 'already_bound' | 'mismatch'> {
  if (!initialized) throw new Error('CID Workspace registry is not initialized');
  if (!validId(sessionId) || !validId(workspaceId) || !workspaceById.has(workspaceId)) {
    throw new Error('Invalid Session/Workspace binding');
  }
  const existing = sessionBindings.get(sessionId);
  if (existing) return existing.workspaceId === workspaceId ? 'already_bound' : 'mismatch';
  const binding = { workspaceId, boundAt: Date.now() };
  sessionBindings.set(sessionId, binding);
  try {
    await persist();
  } catch (error) {
    if (sessionBindings.get(sessionId) === binding) sessionBindings.delete(sessionId);
    throw error;
  }
  return 'bound';
}

export function workspaceForSession(sessionId: string): CidWorkspaceRecord | null {
  const binding = sessionBindings.get(sessionId);
  const workspace = binding ? workspaceById.get(binding.workspaceId) : null;
  return workspace ? clone(workspace) : null;
}

export function activeWorkspace(): CidWorkspaceRecord | null {
  const workspace = activeWorkspaceId ? workspaceById.get(activeWorkspaceId) : null;
  return workspace ? clone(workspace) : null;
}

export function workspaceMention(options: {
  workspace: CidWorkspaceRecord;
  project: AgentEntityRef | null;
  online: boolean;
  observedAt: number;
  bindingStatus: AgentWorkspaceMention['bindingStatus'];
}): AgentWorkspaceMention {
  const sameProject = options.project?.exactId === options.workspace.projectIdentity;
  const age = options.observedAt > 0 ? Math.max(0, Date.now() - options.observedAt) : Number.POSITIVE_INFINITY;
  return {
    workspaceId: options.workspace.workspaceId,
    projectHandle: sameProject ? options.project?.handle ?? null : null,
    projectLabel: options.workspace.projectLabel,
    online: options.online && sameProject,
    freshness: !options.online || !sameProject ? 'offline' : age > 60_000 ? 'stale' : 'fresh',
    bindingStatus: options.bindingStatus
  };
}

export function resetCidWorkspaceRegistryForTests(): void {
  workspacesByProject.clear();
  workspaceById.clear();
  sessionBindings.clear();
  activeWorkspaceId = null;
  initialized = false;
}
