import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import type {
  AppConfig,
  AppState,
  RendererWorkflowObservationReceipt,
  Reply,
  WorkflowInspectResult,
  WorkflowInspectTarget
} from '../shared/types.js';
import { addProjectLocation, getConfig, productTunnelId, removeProjectLocation, saveConfig, setChatgptVerified, setWorkflowChatgptVerified } from './config.js';
import { getLog, logInfo } from './log.js';
import { probeResolveMcp } from './resolve.js';
import { getTunnelApiKey, getTunnelApiKeyStorageState, getTunnelApiKeySuffix, hasTunnelApiKey, secureStorageAvailable, setTunnelApiKey } from './secrets.js';
import {
  getTunnelClientVersion,
  getTunnelStatus,
  locateTunnelClient,
  refreshTunnelHealth
} from './tunnel.js';
import { buildDiagnostics } from './diagnostics.js';
import {
  connectResolveConnection,
  disconnectResolveConnection,
  getResolveGatewayStatus,
  getAgentSituationFrame,
  getResolveWorkflowAudit,
  inspectResolveWorkflow,
  inspectResolveWorkflowRisk,
  mentionAgentEntityByExactId,
  resolveAgentEntity,
  setAgentSharedFocus
} from './connection.js';
import {
  getRecentWorkflowPlans,
  getWorkflowPlan,
  grantWorkflowPlanApproval,
  rejectWorkflowPlan
} from './workflow-engine.js';
import { projectWorkflowPlanForRenderer } from './workflow-plan-view.js';
import {
  agentModelId,
  listAgentChatSessions,
  readAgentChatSession
} from './agent-chat.js';
import { getSystemSpineProjection } from './system-spine.js';
import { getArtifactWorkspaceProjection } from './artifact-workspace.js';

let getState: () => Promise<AppState>;
let refreshResolve: () => Promise<AppState>;

function handler<T>(fn: () => Promise<T>): Promise<Reply<T>> {
  return fn().then((data) => ({ ok: true as const, data }), (err: unknown) => ({ ok: false as const, error: (err as Error).message }));
}

function rendererObservationReceipt(result: WorkflowInspectResult): RendererWorkflowObservationReceipt {
  if (result.target !== 'fusion' && result.target !== 'color' && result.target !== 'fairlight' && result.target !== 'deliver') {
    throw new Error('Workflow observation is not renderer-canonical');
  }
  return { target: result.target, schemaHash: result.schemaHash };
}

export function registerIpc(
  stateReader: () => Promise<AppState>,
  resolveRefresher: () => Promise<AppState>,
  configSaved: (config: AppConfig) => Promise<void> | void,
  zoomReader: () => number,
  zoomSetter: (percent: number) => number,
  trustedSender: (event: IpcMainInvokeEvent) => boolean
): void {
  getState = stateReader;
  refreshResolve = resolveRefresher;
  const trusted = <T>(event: IpcMainInvokeEvent, fn: () => Promise<T>): Promise<Reply<T>> => {
    if (!trustedSender(event)) return Promise.resolve({ ok: false as const, error: 'Untrusted IPC sender' });
    return handler(fn);
  };
  ipcMain.handle('state:get', (event) => trusted(event, getState));
  ipcMain.handle('config:save', (event, config: AppConfig) => trusted(event, async () => {
    const before = getConfig();
    const saved = await saveConfig(config);
    if (productTunnelId(before) !== productTunnelId(saved)) {
      await disconnectResolveConnection();
    }
    await configSaved(saved);
    return await getState();
  }));
  ipcMain.handle('secret:set', (event, value: string) => trusted(event, async () => { await setTunnelApiKey(value); return await getState(); }));
  ipcMain.handle('locations:add', (event) => trusted(event, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    const selected = result.filePaths[0];
    if (!selected) return await getState();
    await addProjectLocation(selected);
    return await getState();
  }));
  ipcMain.handle('locations:remove', (event, name: string) => trusted(event, async () => {
    await removeProjectLocation(name);
    return await getState();
  }));
  ipcMain.handle('verification:set', (event, verified: boolean) => trusted(event, async () => {
    const nextVerified = verified === true;
    const wasVerified = getConfig().chatgptVerified;
    await setChatgptVerified(nextVerified);
    if (!wasVerified && nextVerified) logInfo('ChatGPT request and tool call manually confirmed.');
    return await getState();
  }));
  ipcMain.handle('workflow-verification:set', (event, verified: boolean) => trusted(event, async () => {
    const nextVerified = verified === true;
    const wasVerified = getConfig().workflowChatgptVerified;
    await setWorkflowChatgptVerified(nextVerified);
    if (!wasVerified && nextVerified) logInfo('Protected Workflow ChatGPT request and tool call manually confirmed.');
    return await getState();
  }));
  ipcMain.handle('resolve:probe', (event) => trusted(event, refreshResolve));
  ipcMain.handle('tunnel:connect', (event) => trusted(event, async () => {
    const key = await getTunnelApiKey();
    if (!key) throw new Error('Add the OpenAI API key first');
    await connectResolveConnection();
    return await getState();
  }));
  ipcMain.handle('tunnel:disconnect', (event) => trusted(event, async () => { await disconnectResolveConnection(); return await getState(); }));
  ipcMain.handle('tunnel:health', (event) => trusted(event, async () => {
    await refreshTunnelHealth();
    return await getState();
  }));
  ipcMain.handle('workflow:inspect', (event, target: WorkflowInspectTarget) => trusted(event, async () => {
    const result = await inspectResolveWorkflow(target);
    return target === 'fusion' || target === 'color' || target === 'fairlight' || target === 'deliver'
      ? rendererObservationReceipt(result)
      : result;
  }));
  ipcMain.handle('workflow:media-clip', (event, payload: unknown) => trusted(event, async () => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Media Artifact request');
    const row = payload as Record<string, unknown>;
    const handle = row['handle'];
    const generation = row['generation'];
    if (typeof handle !== 'string' || handle.length < 1 || handle.length > 32) throw new Error('Invalid Media Artifact handle');
    if (!Number.isInteger(generation) || (generation as number) < 1) throw new Error('Invalid Media Artifact generation');
    const entity = resolveAgentEntity(handle, generation as number);
    if (entity.kind !== 'media_pool_item') throw new Error('Media Artifact is not a Media Pool item');
    return await inspectResolveWorkflow('media', entity.exactId);
  }));
  ipcMain.handle('workflow:media-link-status', (event, payload?: unknown) => trusted(event, async () => {
    let itemId: string | undefined;
    if (payload !== undefined) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Media Artifact request');
      const row = payload as Record<string, unknown>;
      const handle = row['handle'];
      const generation = row['generation'];
      if (typeof handle !== 'string' || handle.length < 1 || handle.length > 32) throw new Error('Invalid Media Artifact handle');
      if (!Number.isInteger(generation) || (generation as number) < 1) throw new Error('Invalid Media Artifact generation');
      const entity = resolveAgentEntity(handle, generation as number);
      if (entity.kind !== 'media_pool_item') throw new Error('Media Artifact is not a Media Pool item');
      itemId = entity.exactId;
    }
    return await inspectResolveWorkflow('media', itemId, 'link_status');
  }));
  ipcMain.handle('workflow:edit-structure', (event) => trusted(event, async () => {
    return await inspectResolveWorkflow('edit', undefined, 'structure');
  }));
  ipcMain.handle('workflow:edit-gaps-overlaps', (event) => trusted(event, async () => {
    return await inspectResolveWorkflow('edit', undefined, 'gaps_overlaps');
  }));
  ipcMain.handle('workflow:edit-source-ranges', (event) => trusted(event, async () => {
    return await inspectResolveWorkflow('edit', undefined, 'source_ranges');
  }));
  ipcMain.handle('workflow:edit-transitions', (event) => trusted(event, async () => {
    return await inspectResolveWorkflow('edit', undefined, 'transitions');
  }));
  ipcMain.handle('workflow:edit-annotations', (event) => trusted(event, async () => {
    return await inspectResolveWorkflow('edit', undefined, 'annotations');
  }));
  ipcMain.handle('workflow:fusion-graph', (event) => trusted(event, async () => {
    return rendererObservationReceipt(await inspectResolveWorkflow('fusion', undefined, 'graph'));
  }));
  ipcMain.handle('workflow:color-graph', (event) => trusted(event, async () => {
    return rendererObservationReceipt(await inspectResolveWorkflow('color', undefined, 'graph'));
  }));
  ipcMain.handle('workflow:color-versions', (event) => trusted(event, async () => {
    return rendererObservationReceipt(await inspectResolveWorkflow('color', undefined, 'versions'));
  }));
  ipcMain.handle('workflow:fairlight-processing', (event) => trusted(event, async () => {
    return rendererObservationReceipt(await inspectResolveWorkflow('fairlight', undefined, 'audio_processing'));
  }));
  ipcMain.handle('workflow:risk', (event, tool: string) => trusted(event, async () => inspectResolveWorkflowRisk(tool)));
  ipcMain.handle('workflow:audit', (event, limit: number) => trusted(event, async () => getResolveWorkflowAudit(limit)));
  ipcMain.handle('workflow:plan:get', (event, planId: string) => trusted(event, async () => {
    if (typeof planId !== 'string' || planId.length < 1 || planId.length > 128) throw new Error('Invalid workflow plan ID');
    const projection = getWorkflowPlan(planId);
    return projection ? projectWorkflowPlanForRenderer(projection, mentionAgentEntityByExactId) : null;
  }));
  ipcMain.handle('workflow:plans:recent', (event, limit: number) => trusted(event, async () => {
    const bounded = Number.isInteger(limit) ? Math.max(1, Math.min(20, limit)) : 10;
    return getRecentWorkflowPlans(bounded).map((projection) => projectWorkflowPlanForRenderer(projection, mentionAgentEntityByExactId));
  }));
  ipcMain.handle('workflow:approval:grant', (event, planId: string) => trusted(event, async () => {
    if (typeof planId !== 'string' || planId.length < 1 || planId.length > 128) throw new Error('Invalid workflow plan ID');
    return projectWorkflowPlanForRenderer(await grantWorkflowPlanApproval(planId), mentionAgentEntityByExactId);
  }));
  ipcMain.handle('workflow:approval:reject', (event, planId: string) => trusted(event, async () => {
    if (typeof planId !== 'string' || planId.length < 1 || planId.length > 128) throw new Error('Invalid workflow plan ID');
    return projectWorkflowPlanForRenderer(await rejectWorkflowPlan(planId), mentionAgentEntityByExactId);
  }));
  ipcMain.handle('agent:model', (event) => trusted(event, async () => agentModelId()));
  ipcMain.handle('agent:sessions:list', (event) => trusted(event, async () => listAgentChatSessions()));
  ipcMain.handle('agent:session:create', (event) => trusted(event, async () => {
    throw new Error('COS owns Conversation/Session creation. The legacy CID Agent session stack is migration-only.');
  }));
  ipcMain.handle('agent:session:get', (event, sessionId: string) => trusted(event, async () => {
    if (typeof sessionId !== 'string' || sessionId.length < 8 || sessionId.length > 80) throw new Error('Invalid Agent session ID');
    return await readAgentChatSession(sessionId);
  }));
  ipcMain.handle('agent:turn:run', (event) => trusted(event, async () => {
    throw new Error('COS owns Agent turns. The legacy CID TurnRunner is migration-only.');
  }));
  ipcMain.handle('agent:session:compact', (event) => trusted(event, async () => {
    throw new Error('COS owns Compact & Resume. The legacy CID compactor is migration-only.');
  }));
  ipcMain.handle('agent:focus:timeline-artifact', (event, payload: unknown) => trusted(event, async () => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Timeline Artifact focus request');
    const row = payload as Record<string, unknown>;
    const handle = row['handle'];
    const generation = row['generation'];
    if (typeof handle !== 'string' || handle.length < 1 || handle.length > 32) throw new Error('Invalid Timeline Artifact handle');
    if (!Number.isInteger(generation) || (generation as number) < 1) throw new Error('Invalid Timeline Artifact generation');
    const entity = resolveAgentEntity(handle, generation as number);
    if (entity.kind !== 'timeline_item') throw new Error('Timeline Artifact is not a TimelineItem');
    return setAgentSharedFocus({ kind: 'timeline_item', exactId: entity.exactId });
  }));
  ipcMain.handle('agent:focus:media-artifact', (event, payload: unknown) => trusted(event, async () => {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Invalid Media Artifact focus request');
    const row = payload as Record<string, unknown>;
    const handle = row['handle'];
    const generation = row['generation'];
    if (typeof handle !== 'string' || handle.length < 1 || handle.length > 32) throw new Error('Invalid Media Artifact handle');
    if (!Number.isInteger(generation) || (generation as number) < 1) throw new Error('Invalid Media Artifact generation');
    const entity = resolveAgentEntity(handle, generation as number);
    if (entity.kind !== 'media_pool_item') throw new Error('Media Artifact is not a Media Pool item');
    return setAgentSharedFocus({ kind: 'media_pool_item', exactId: entity.exactId });
  }));
  ipcMain.handle('agent:focus:plan', (event, planId: string) => trusted(event, async () => {
    if (typeof planId !== 'string' || planId.length < 1 || planId.length > 128) throw new Error('Invalid workflow plan ID');
    const projection = getWorkflowPlan(planId);
    if (!projection) throw new Error('Workflow plan was not found');
    if (projection.plan.plan_kind !== 'review_marker_add' && projection.plan.plan_kind !== 'color_grade_version_create') {
      throw new Error('Workflow plan has no timeline-item focus target');
    }
    const targetId = projection.plan.target_ids[0];
    return setAgentSharedFocus({ kind: 'timeline_item', exactId: targetId }, 'plan');
  }));
  ipcMain.handle('agent:situation:get', (event) => trusted(event, async () => getAgentSituationFrame()));
  ipcMain.handle('agent:spine:get', (event) => trusted(event, async () => getSystemSpineProjection()));
  ipcMain.handle('agent:artifact-workspace:get', (event) => trusted(event, async () => getArtifactWorkspaceProjection()));
  ipcMain.handle('log:get', (event) => trusted(event, async () => getLog()));
  ipcMain.handle('zoom:get', (event) => trusted(event, async () => zoomReader()));
  ipcMain.handle('zoom:set', (event, percent: number) => trusted(event, async () => zoomSetter(percent)));
  ipcMain.handle('clipboard:write', (event, value: string) => trusted(event, async () => { clipboard.writeText(value); return true; }));
  ipcMain.handle('link:open', (event, value: string) => trusted(event, async () => {
    const allowed = new Set([
      'https://platform.openai.com/settings/organization/tunnels',
      'https://platform.openai.com/settings/organization/api-keys',
      'https://chatgpt.com/#settings/Apps'
    ]);
    if (!allowed.has(value)) throw new Error('That external link is not allowed');
    await shell.openExternal(value);
    return true;
  }));
}

export async function buildState(resolve?: Awaited<ReturnType<typeof probeResolveMcp>>): Promise<AppState> {
  const resolvedTunnelClient = await locateTunnelClient();
  const resolveState = resolve ?? await probeResolveMcp();
  const tunnel = getTunnelStatus();
  const gateway = getResolveGatewayStatus();
  const apiKeyStorageState = await getTunnelApiKeyStorageState();
  const config = getConfig();
  const diagnosticsVerified = config.chatgptVerified || config.workflowChatgptVerified;
  return {
    config,
    hasApiKey: await hasTunnelApiKey(),
    apiKeySuffix: await getTunnelApiKeySuffix(),
    apiKeyStorageState,
    secureStorageAvailable: await secureStorageAvailable(),
    resolvedTunnelClient,
    resolvedTunnelClientVersion: resolvedTunnelClient ? await getTunnelClientVersion(resolvedTunnelClient) : null,
    preferredSystemLanguages: app.getPreferredSystemLanguages(),
    resolve: resolveState,
    tunnel,
    // Legacy renderer compatibility until the COS shell replaces the migration UI.
    workflowTunnel: tunnel,
    gateway,
    diagnostics: buildDiagnostics(resolveState, tunnel, diagnosticsVerified, Date.now(), gateway, 'workflow')
  };
}
