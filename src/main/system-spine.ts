import type {
  AgentActionOffer,
  AgentCompletionReport,
  AgentContextPack,
  AgentEvidenceRef,
  AgentSystemSpineProjection,
  AgentWorkspaceMention
} from '../shared/agent-system.js';
import type { CosSessionView } from '../cos-host/session-runtime.js';
import { cosSessionById, goalFrameForCosSession } from '../cos-host/session-runtime.js';
import { goalObjectiveFor } from '../cos-host/canonical/goal.js';
import {
  attachCosHostDecisionRuntime,
  type CosHostDecisionProjection
} from '../cos-host/runtime.js';
import {
  getAgentContextCompiler,
  getAgentResolveCapabilityEvidence,
  getAgentWorldIdentitySnapshot
} from './connection.js';
import { deriveAgentCompletionReport, deriveDecisionKindFromCompletion } from './completion-report.js';
import {
  activeWorkspace,
  bindCosSessionToWorkspace,
  initCidWorkspaceRegistry,
  observeCidWorkspaceProject,
  workspaceForSession,
  workspaceMention
} from './workspace-identity.js';
import { explicitMutationPlanningWorkflowIds } from './agent-action-catalog.js';

let initialized = false;
const projectionsByTurn = new Map<string, AgentSystemSpineProjection>();
let activeCockpitKey: string | null = null;

function projectionKey(sessionId: string, turnId: string): string {
  return sessionId + '\u0000' + turnId;
}

function currentTurnUserInput(session: CosSessionView): string {
  if (!session.activeTurnId) return '';
  const latest = [...session.events].reverse().find((event) =>
    event.kind === 'user_message' && event.turnId === session.activeTurnId
  );
  return latest?.kind === 'user_message' ? latest.text : '';
}

async function workspaceProjection(session: CosSessionView): Promise<{
  mention: AgentWorkspaceMention | null;
  blocker: string | null;
}> {
  const identity = getAgentWorldIdentitySnapshot();
  const bound = workspaceForSession(session.sessionId);
  if (!identity.project) {
    const workspace = bound ?? activeWorkspace();
    return {
      mention: workspace
        ? workspaceMention({
            workspace,
            project: null,
            online: false,
            observedAt: identity.observedAt,
            bindingStatus: bound ? 'bound' : 'unbound'
          })
        : null,
      blocker: bound
        ? 'Resolve is offline or the exact Project identity is not currently observed. Cached Workspace evidence remains read-only.'
        : 'No exact Resolve Project identity is currently available for Workspace binding.'
    };
  }

  const active = await observeCidWorkspaceProject({
    project: identity.project,
    observedAt: identity.observedAt,
    semanticHistoryRevision: identity.revision,
    worldGeneration: identity.generation,
    timeline: identity.timeline
  });
  if (identity.resolveRunning === false) {
    const workspace = bound ?? active;
    return {
      mention: workspaceMention({
        workspace,
        project: identity.project,
        online: false,
        observedAt: identity.observedAt,
        bindingStatus: bound
          ? bound.workspaceId !== active.workspaceId ? 'mismatch' : 'bound'
          : 'unbound'
      }),
      blocker: 'Resolve is offline. Cached Workspace evidence remains read-only until the exact bound Project is observed online again.'
    };
  }
  if (bound && bound.workspaceId !== active.workspaceId) {
    return {
      mention: workspaceMention({
        workspace: bound,
        project: identity.project,
        online: true,
        observedAt: identity.observedAt,
        bindingStatus: 'mismatch'
      }),
      blocker: 'This COS Session is bound to a different CID Workspace/Resolve Project. It will not silently carry authority into the active Project.'
    };
  }
  const binding = await bindCosSessionToWorkspace(session.sessionId, active.workspaceId);
  if (binding === 'mismatch') {
    return {
      mention: workspaceMention({
        workspace: bound ?? active,
        project: identity.project,
        online: true,
        observedAt: identity.observedAt,
        bindingStatus: 'mismatch'
      }),
      blocker: 'COS Session/Workspace binding changed underneath this decision.'
    };
  }
  return {
    mention: workspaceMention({
      workspace: active,
      project: identity.project,
      online: true,
      observedAt: identity.observedAt,
      bindingStatus: 'bound'
    }),
    blocker: null
  };
}

function blockOffers(
  offers: readonly AgentActionOffer[],
  reason: string
): AgentActionOffer[] {
  return offers.map((offer) => ({
    ...offer,
    applicability: 'blocked',
    blockingReason: reason,
    remediation: 'Return to the Session’s bound Workspace or explicitly start a new Session for the active Project.'
  }));
}

/**
 * Criterion completion is evaluated only from the current semantic evidence projection.
 * Workspace freshness is a broad UX signal; it is not a second evidence epoch.
 */
export function evaluateSystemSpineCompletion(options: {
  pack: AgentContextPack;
  evidence: readonly AgentEvidenceRef[];
  blockers?: readonly string[];
  materialUnknowns?: readonly string[];
}): AgentCompletionReport {
  const completion = deriveAgentCompletionReport({
    sessionId: options.pack.sessionId,
    generation: options.pack.situation.generation,
    goal: options.pack.goal,
    actionOffers: options.pack.actionOffers,
    evidence: options.evidence,
    blockers: options.blockers,
    materialUnknowns: options.materialUnknowns
  });
  options.pack.decision.decisionKind = deriveDecisionKindFromCompletion({
    completion,
    actionOffers: options.pack.actionOffers,
    materialUncertainty: options.pack.decision.materialUncertainty
  });
  if (completion.complete) {
    options.pack.decision.completionGap = null;
    options.pack.decision.materialUncertainty = null;
  } else {
    options.pack.decision.completionGap = completion.criteria.find((criterion) => criterion.status !== 'satisfied')?.blockingReason
      ?? options.pack.decision.completionGap;
  }
  return completion;
}

async function projectSession(
  session: CosSessionView,
  options: { publish?: boolean } = {}
): Promise<CosHostDecisionProjection> {
  if (!initialized) throw new Error('CID System Spine is not initialized');
  const compiler = getAgentContextCompiler();
  const objective = goalObjectiveFor(session.conversationId);
  const currentUserInput = currentTurnUserInput(session);
  const goal = goalFrameForCosSession(session, objective);
  const workspace = await workspaceProjection(session);
  const pack = compiler.compile({
    sessionId: session.sessionId,
    turnId: session.activeTurnId ?? '',
    input: currentUserInput || objective,
    narrativeMessages: session.events.filter((event) =>
      event.kind === 'user_message' || event.kind === 'assistant_message'
    ).length,
    goal,
    workspace: workspace.mention,
    capabilityEvidence: getAgentResolveCapabilityEvidence(),
    mutationPlanningWorkflowIds: currentUserInput ? explicitMutationPlanningWorkflowIds(currentUserInput) : []
  });
  if (workspace.blocker && workspace.mention?.bindingStatus === 'mismatch') {
    pack.actionOffers = blockOffers(pack.actionOffers, workspace.blocker);
    pack.decision.actionOffers = structuredClone(pack.actionOffers);
    pack.decision.decisionKind = 'clarify';
    pack.decision.materialUncertainty = workspace.blocker;
    pack.decision.completionGap = workspace.blocker;
  } else if (workspace.blocker && workspace.mention?.freshness === 'offline') {
    pack.actionOffers = pack.actionOffers.map((offer) =>
      offer.estimatedCost.resolve === 'none'
        ? offer
        : {
            ...offer,
            applicability: 'blocked',
            blockingReason: workspace.blocker,
            remediation: 'Reconnect the exact bound Resolve Project, then derive a fresh decision. No write Plan auto-resumes.'
          }
    );
    pack.decision.actionOffers = structuredClone(pack.actionOffers);
  }
  const hardWorkspaceBlocker = workspace.blocker
    && (workspace.mention?.bindingStatus === 'mismatch' || workspace.mention?.freshness === 'offline')
    ? workspace.blocker
    : null;
  const completion = evaluateSystemSpineCompletion({
    pack,
    evidence: compiler.completionEvidence(),
    blockers: hardWorkspaceBlocker ? [hardWorkspaceBlocker] : [],
    materialUnknowns: pack.decision.materialUncertainty ? [pack.decision.materialUncertainty] : []
  });
  compiler.acknowledge(pack);
  if (options.publish === true && session.activeTurnId) {
    const projection: AgentSystemSpineProjection = {
      sessionId: session.sessionId,
      turnId: session.activeTurnId,
      workspace: workspace.mention,
      decision: structuredClone(pack.decision),
      actionOffers: structuredClone(pack.actionOffers),
      completion: structuredClone(completion)
    };
    const key = projectionKey(session.sessionId, session.activeTurnId);
    projectionsByTurn.set(key, projection);
    activeCockpitKey = key;
  }
  return { decision: pack.decision, completion };
}

const decisionRuntime = { projectSession };

export async function initSystemSpineRuntime(): Promise<void> {
  if (initialized) {
    attachCosHostDecisionRuntime(decisionRuntime);
    return;
  }
  await initCidWorkspaceRegistry();
  initialized = true;
  attachCosHostDecisionRuntime(decisionRuntime);
}

export function shutdownSystemSpineRuntime(): void {
  if (!initialized) return;
  attachCosHostDecisionRuntime(null);
  initialized = false;
  projectionsByTurn.clear();
  activeCockpitKey = null;
}

export function getSystemSpineProjection(): AgentSystemSpineProjection | null {
  if (!activeCockpitKey) return null;
  const activeProjection = projectionsByTurn.get(activeCockpitKey) ?? null;
  if (!activeProjection) {
    activeCockpitKey = null;
    return null;
  }
  const session = cosSessionById(activeProjection.sessionId);
  if (!session?.activeTurnId || session.activeTurnId !== activeProjection.turnId) {
    projectionsByTurn.delete(activeCockpitKey);
    activeCockpitKey = null;
    return null;
  }
  return structuredClone(activeProjection);
}

export function getSystemSpineProjectionForTurn(
  sessionId: string,
  turnId: string
): AgentSystemSpineProjection | null {
  const held = projectionsByTurn.get(projectionKey(sessionId, turnId));
  return held ? structuredClone(held) : null;
}

export const systemSpineDecisionRuntime = decisionRuntime;
