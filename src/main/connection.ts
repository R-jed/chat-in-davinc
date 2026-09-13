import type {
  ResolveCapabilityEvidence,
  ResolveGatewayStatus,
  ResolveProbe,
  WorkflowAuditEntry,
  WorkflowInspectResult,
  WorkflowInspectTarget,
  WorkflowRiskAssessment
} from '../shared/types.js';
import type {
  AgentEntityMention,
  AgentEntityRef,
  AgentColorInspectorDetail,
  AgentDeliverInspectorDetail,
  AgentEditInspectorDetail,
  AgentFairlightInspectorDetail,
  AgentFocusRequest,
  AgentFocusSource,
  AgentFusionInspectorDetail,
  AgentMediaInspectorProjection,
  AgentProjectInspectorDetail,
  AgentSharedFocus,
  AgentSituationFrame
} from '../shared/agent-system.js';
import { AgentWorldModel } from './agent-world-model.js';
import { AgentContextCompiler, type AgentContextCompilerAccess } from './context-compiler.js';
import { getConfig, productTunnelId, TUNNEL_ID_PATTERN } from './config.js';
import { logError, logInfo } from './log.js';
import { ResolveBroker } from './resolve-broker.js';
import { ResolveScheduler } from './resolve-scheduler.js';
import { startResolveGateway, type ResolveGateway } from './resolve-gateway.js';
import { probeResolveMcp, RESOLVE_MCP_PATH } from './resolve.js';
import { getTunnelApiKey } from './secrets.js';
import {
  getTunnelStatus,
  startProductTunnel,
  stopProductTunnel
} from './tunnel.js';
import {
  establishWorkflowAuthority,
  initWorkflowEngine,
  invalidateWorkflowAuthority,
  revokeWorkflowApprovalsForAuthorityLoss
} from './workflow-engine.js';
import type { ToolKernelAccess, ToolKernelObservation } from './tool-kernel.js';
import { resolveCapabilityRegistry } from './resolve-capabilities.js';

const broker = new ResolveBroker();
const scheduler = new ResolveScheduler(broker);
const agentWorldModel = new AgentWorldModel();
const agentContextCompiler = new AgentContextCompiler(agentWorldModel);
let gateway: ResolveGateway | null = null;
let lifecycleQueue: Promise<void> = Promise.resolve();
let generation = 0;
let shutdownRequested = false;

export function initializeResolveWorkflowEngine(): void {
  initWorkflowEngine(scheduler);
  invalidateWorkflowAuthority();
}

export function workflowGatewayUrlForQualification(): string {
  if (process.env['CID_COLOR_GRADE_VERSION_VERTICAL_ACCEPTANCE'] !== '1') {
    throw new Error('Color grade-version vertical acceptance is disabled');
  }
  if (!gateway) throw new Error('Protected workflow gateway is not active');
  return gateway.productUrl;
}

export async function runResolveQualificationScript(script: string): Promise<Record<string, unknown>> {
  if (process.env['CID_COLOR_GRADE_VERSION_VERTICAL_ACCEPTANCE'] !== '1') {
    throw new Error('Color grade-version vertical acceptance is disabled');
  }
  if (!gateway) throw new Error('Protected workflow gateway is not active');
  const raw = await scheduler.callTool('run_script', { script, timeout: 20 }, 22_000);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Qualification script returned an invalid MCP result');
  const content = Array.isArray((raw as Record<string, unknown>)['content'])
    ? (raw as Record<string, unknown>)['content'] as unknown[]
    : [];
  const text = content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .find((item) => item['type'] === 'text' && typeof item['text'] === 'string')?.['text'];
  if (typeof text !== 'string') throw new Error('Qualification script returned no text result');
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const result = parsed['result'];
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Qualification script returned no structured result');
  return result as Record<string, unknown>;
}

const EMPTY_GATEWAY_STATUS: ResolveGatewayStatus = {
  active: false,
  rawRequestAt: null,
  workflowRequestAt: null,
  lastToolCallAt: null,
  lastToolName: null,
  schemaHash: null
};

function enqueueLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const run = lifecycleQueue.then(operation, operation);
  lifecycleQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function disconnectImpl(forceAfterMs?: number): Promise<void> {
  invalidateWorkflowAuthority();
  generation += 1;
  try {
    await stopProductTunnel();
  } finally {
    const stopping = gateway;
    gateway = null;
    try {
      if (stopping) await stopping.stop(forceAfterMs === undefined ? {} : { forceAfterMs });
    } finally {
      try {
        await revokeWorkflowApprovalsForAuthorityLoss();
      } catch (error) {
        logError(`Workflow approval revocation on authority loss failed closed: ${(error as Error).message}`);
      } finally {
        agentWorldModel.invalidate('Resolve authority disconnected');
      }
    }
  }
}

async function connectImpl(): Promise<void> {
  if (shutdownRequested) return;
  const config = getConfig();
  const tunnelId = productTunnelId(config);
  if (!TUNNEL_ID_PATTERN.test(tunnelId)) throw new Error('Tunnel setup is incomplete');
  const tunnelState = getTunnelStatus().state;
  const active = (state: string): boolean => state === 'connected' || state === 'starting';
  if (gateway && active(tunnelState)) return;

  await disconnectImpl();
  if (shutdownRequested) return;
  const currentGeneration = ++generation;
  const apiKey = await getTunnelApiKey();
  if (!apiKey) throw new Error('Tunnel setup is incomplete');

  const startedGateway = await startResolveGateway(broker, scheduler, agentWorldModel);
  if (shutdownRequested || currentGeneration !== generation) {
    await startedGateway.stop({ forceAfterMs: 30_000 }).catch(() => undefined);
    return;
  }
  gateway = startedGateway;
  try {
    // The one external product Tunnel always publishes the protected product surface.
    // Raw remains a localhost-only developer/qualification endpoint inside the same gateway.
    await startProductTunnel({
      tunnelId,
      apiKey,
      localUrl: startedGateway.productUrl,
      discoveryHeaders: startedGateway.tunnelProbeHeaders()
    });
    establishWorkflowAuthority();
  } catch (error) {
    invalidateWorkflowAuthority();
    gateway = null;
    await stopProductTunnel().catch(() => undefined);
    await startedGateway.stop({ forceAfterMs: 30_000 }).catch(() => undefined);
    throw error;
  }
  if (shutdownRequested || currentGeneration !== generation) await disconnectImpl(30_000);
}

export function connectResolveConnection(): Promise<void> {
  return enqueueLifecycle(connectImpl);
}

export function disconnectResolveConnection(): Promise<void> {
  return enqueueLifecycle(async () => await disconnectImpl());
}

export function shutdownResolveConnection(): Promise<void> {
  shutdownRequested = true;
  generation += 1;
  return enqueueLifecycle(async () => await disconnectImpl(30_000));
}

export function getResolveGatewayStatus(): ResolveGatewayStatus {
  return gateway?.status() ?? { ...EMPTY_GATEWAY_STATUS };
}

export async function inspectResolveWorkflow(
  target: WorkflowInspectTarget,
  itemId?: string,
  view: 'default' | 'link_status' | 'structure' | 'gaps_overlaps' | 'source_ranges' | 'transitions' | 'annotations' | 'graph' | 'versions' | 'audio_processing' = 'default'
): Promise<WorkflowInspectResult> {
  if (!gateway) throw new Error('Protected workflow connection is not active');
  return await gateway.workflowInspect({ target, itemId, view });
}

export function inspectResolveWorkflowRisk(tool: string): WorkflowRiskAssessment {
  if (!gateway) throw new Error('Protected workflow connection is not active');
  return gateway.workflowRisk(tool);
}

export function getResolveWorkflowAudit(limit = 10): WorkflowAuditEntry[] {
  if (!gateway) return [];
  return gateway.workflowAudit(limit);
}

/**
 * Starts only the local Resolve authority when the built-in Agent needs protected tools.
 * This does not create an OpenAI tunnel and never creates a second broker/session.
 */
export function getAgentToolKernel(): Promise<ToolKernelAccess> {
  return enqueueLifecycle(async () => {
    if (shutdownRequested) throw new Error('Resolve connection is shutting down');
    if (!gateway) {
      gateway = await startResolveGateway(broker, scheduler, agentWorldModel);
      establishWorkflowAuthority();
    }
    return gateway.agentKernel;
  });
}

export function getAgentContextCompiler(): AgentContextCompilerAccess {
  return agentContextCompiler;
}

export function setAgentSharedFocus(request: AgentFocusRequest, source: AgentFocusSource = 'user'): AgentSharedFocus {
  return agentWorldModel.setFocus(request, source);
}

export function getAgentSituationFrame(): AgentSituationFrame {
  return agentWorldModel.situation();
}

export function getAgentProjectInspectorDetail(): AgentProjectInspectorDetail | null {
  return agentWorldModel.projectInspectorDetail();
}

export function getAgentMediaInspectorProjection(): AgentMediaInspectorProjection {
  return agentWorldModel.mediaInspectorProjection();
}

export function getAgentEditInspectorProjection(): AgentEditInspectorDetail {
  return agentWorldModel.editInspectorProjection();
}

export function getAgentFusionInspectorProjection(): AgentFusionInspectorDetail {
  return agentWorldModel.fusionInspectorProjection();
}

export function getAgentColorInspectorProjection(): AgentColorInspectorDetail {
  return agentWorldModel.colorInspectorProjection();
}

export function getAgentFairlightInspectorProjection(): AgentFairlightInspectorDetail {
  return agentWorldModel.fairlightInspectorProjection();
}

export function getAgentDeliverInspectorProjection(): AgentDeliverInspectorDetail {
  return agentWorldModel.deliverInspectorProjection();
}

export function getAgentWorldIdentitySnapshot(): ReturnType<AgentWorldModel['identitySnapshot']> {
  return agentWorldModel.identitySnapshot();
}

export function getAgentHistoricalSituationForProject(
  projectExactId: string,
  generation?: number
): AgentSituationFrame | null {
  return agentWorldModel.historicalSituationForProject(projectExactId, generation);
}

export function getAgentHistoricalProjectInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentProjectInspectorDetail | null {
  return agentWorldModel.historicalProjectInspectorForProject(projectExactId, generation);
}

export function getAgentHistoricalMediaInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentMediaInspectorProjection | null {
  return agentWorldModel.historicalMediaInspectorForProject(projectExactId, generation);
}

export function getAgentHistoricalEditInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentEditInspectorDetail | null {
  return agentWorldModel.historicalEditInspectorForProject(projectExactId, generation);
}

export function getAgentHistoricalFusionInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentFusionInspectorDetail | null {
  return agentWorldModel.historicalFusionInspectorForProject(projectExactId, generation);
}

export function getAgentHistoricalColorInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentColorInspectorDetail | null {
  return agentWorldModel.historicalColorInspectorForProject(projectExactId, generation);
}

export function getAgentHistoricalFairlightInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentFairlightInspectorDetail | null {
  return agentWorldModel.historicalFairlightInspectorForProject(projectExactId, generation);
}

export function getAgentHistoricalDeliverInspectorForProject(
  projectExactId: string,
  generation?: number
): AgentDeliverInspectorDetail | null {
  return agentWorldModel.historicalDeliverInspectorForProject(projectExactId, generation);
}

/**
 * Pure runtime qualification snapshot. This never probes Resolve on its own; missing build/tool
 * evidence stays unknown so DecisionFrame can request one targeted observation when it matters.
 */
export function getAgentResolveCapabilityEvidence(): ResolveCapabilityEvidence[] {
  const snapshot = broker.getSnapshot();
  if (!snapshot) return [];
  return resolveCapabilityRegistry(snapshot, agentWorldModel.identitySnapshot().resolveVersion);
}

export function resolveAgentEntity(handle: string, generation: number): AgentEntityRef {
  return agentWorldModel.resolveEntity(handle, generation);
}

export function mentionAgentEntityByExactId(exactId: string): AgentEntityMention | null {
  return agentWorldModel.mentionEntityByExactId(exactId);
}

export function observeAgentWorldForTests(observation: ToolKernelObservation): void {
  agentWorldModel.observe(observation);
}

export function invalidateAgentWorldForTests(reason = 'test Resolve authority reset'): void {
  agentWorldModel.invalidate(reason);
}

export async function probeResolveConnection(): Promise<ResolveProbe> {
  const snapshot = broker.getSnapshot();
  if (!gateway || !snapshot) return await probeResolveMcp();
  try {
    const status = await scheduler.getResolveStatus();
    const running = typeof status['running'] === 'boolean' ? status['running'] : null;
    return {
      installed: true,
      mcpPath: RESOLVE_MCP_PATH,
      serverName: snapshot.serverName,
      serverVersion: snapshot.serverVersion,
      protocolVersion: snapshot.protocolVersion,
      tools: snapshot.tools.map((tool) => tool.name),
      running,
      reachable: true,
      detail: running
        ? 'ResolveMCP is reachable and DaVinci Resolve is running.'
        : 'ResolveMCP is reachable. DaVinci Resolve is not currently running.'
    };
  } catch (error) {
    logError(`ResolveBroker status check failed: ${(error as Error).message}`);
    return {
      installed: true,
      mcpPath: RESOLVE_MCP_PATH,
      serverName: snapshot.serverName,
      serverVersion: snapshot.serverVersion,
      protocolVersion: snapshot.protocolVersion,
      tools: snapshot.tools.map((tool) => tool.name),
      running: null,
      reachable: false,
      detail: 'ResolveMCP is connected through the local broker, but the status check failed.'
    };
  }
}

export function resetConnectionForTests(): void {
  shutdownRequested = false;
  generation = 0;
  lifecycleQueue = Promise.resolve();
  gateway = null;
  agentWorldModel.resetForTests();
  agentContextCompiler.resetForTests();
  logInfo('Resolve connection test state reset');
}
