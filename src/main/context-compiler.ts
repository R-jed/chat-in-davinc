import type { CallToolResult } from '@modelcontextprotocol/server';
import type {
  AgentContextPack,
  AgentDecisionFrame,
  AgentDecisionKind,
  AgentEvidenceRef,
  AgentGoalFrame,
  AgentWorkspaceMention
} from '../shared/agent-system.js';
import type { ResolveCapabilityEvidence } from '../shared/types.js';
import type { ProtectedWorkflowId } from '../shared/types.js';
import type { AgentWorldModel } from './agent-world-model.js';
import {
  agentActionDescriptors,
  deriveAgentActionOffers,
  domainForAgentEntityKind
} from './agent-action-catalog.js';

export interface AgentContextCompileRequest {
  sessionId: string;
  turnId: string;
  input: string;
  narrativeMessages: number;
  goal: AgentGoalFrame;
  workspace?: AgentWorkspaceMention | null;
  capabilityEvidence?: readonly ResolveCapabilityEvidence[];
  mutationPlanningWorkflowIds?: readonly ProtectedWorkflowId[];
  decisionKind?: AgentDecisionKind;
}

export interface AgentContextCompilerAccess {
  compile(request: AgentContextCompileRequest): AgentContextPack;
  acknowledge(pack: AgentContextPack): void;
  completionEvidence(): AgentEvidenceRef[];
  projectToolResult(result: CallToolResult): string;
  projectToolError(message: string): string;
}

export class AgentContextCompiler implements AgentContextCompilerAccess {
  private readonly seenRevision = new Map<string, number>();

  constructor(private readonly world: AgentWorldModel) {}

  compile(request: AgentContextCompileRequest): AgentContextPack {
    const previousRevision = this.seenRevision.get(request.sessionId) ?? 0;
    const situation = this.world.situation(previousRevision);
    const goalCriterion =
      request.goal.openObligations[0]
      ?? request.goal.completionCriteria[0]
      ?? request.goal.desiredOutcome
      ?? request.goal.originalRequest?.text
      ?? null;
    const focusHandle = situation.sharedFocus?.entity.handle ?? null;
    const actionOffers = deriveAgentActionOffers({
      input: request.input,
      focusedKind: situation.sharedFocus?.entity.kind ?? null,
      focusedHandle: focusHandle,
      goalCriterion,
      capabilityEvidence: request.capabilityEvidence ?? [],
      readOnlySlice: (request.mutationPlanningWorkflowIds?.length ?? 0) === 0,
      allowedMutationWorkflowIds: request.mutationPlanningWorkflowIds ?? []
    });
    const offeredImplementations = new Set(
      actionOffers.flatMap((offer) => offer.implementation ? [offer.implementation.implementationId] : [])
    );
    const actions = agentActionDescriptors().filter((action) => offeredImplementations.has(action.actionId));
    const relevantDomains = new Set(actions.map((action) => action.domain));
    situation.entities = situation.entities.filter((entity) =>
      entity.handle === focusHandle || relevantDomains.has(domainForAgentEntityKind(entity.kind) ?? '')
    );
    const minimumFacts = situation.facts
      .filter((fact) => {
        if (fact.subjectHandle === null || fact.subjectHandle === focusHandle) return true;
        const entity = situation.entities.find((row) => row.handle === fact.subjectHandle);
        return Boolean(entity && relevantDomains.has(domainForAgentEntityKind(entity.kind) ?? ''));
      })
      .slice(0, 8);
    const evidenceIds = new Set(minimumFacts.flatMap((fact) => fact.evidenceIds));
    const evidenceRefs = situation.evidence.filter((evidence) => evidenceIds.has(evidence.id)).slice(0, 8);
    const applicable = actionOffers.filter((offer) => offer.applicability === 'applicable');
    const unknownOffers = actionOffers.filter((offer) => offer.applicability === 'unknown');
    const blockedOffers = actionOffers.filter((offer) => offer.applicability === 'blocked' || offer.applicability === 'unavailable');
    const completionGap = goalCriterion && evidenceRefs.length === 0
      ? 'Qualified evidence has not yet been collected for the current Goal criterion.'
      : goalCriterion
        ? 'Re-evaluate the current Goal criterion against the available qualified evidence.'
        : 'No explicit Goal criterion is available.';
    const materialUncertainty = situation.unknowns[0]
      ?? unknownOffers[0]?.blockingReason
      ?? blockedOffers[0]?.blockingReason
      ?? null;
    const decisionKind: AgentDecisionKind = request.decisionKind
      ?? (materialUncertainty && applicable.length === 0
        ? 'clarify'
        : 'observe');
    const decision: AgentDecisionFrame = {
      schemaVersion: 1,
      sessionId: request.sessionId,
      turnId: request.turnId || null,
      compiledAt: Date.now(),
      generation: situation.generation,
      provenanceRevision: situation.revision,
      decisionKind,
      goalCriterion,
      openObligation: request.goal.openObligations[0] ?? null,
      completionGap,
      materialUncertainty,
      minimumFacts,
      evidenceRefs,
      staleDependencies: situation.recentDeltas
        .flatMap((delta) => delta.invalidatedFactKeys)
        .slice(0, 8),
      sharedFocus: situation.sharedFocus,
      actionOffers,
      riskHints: actionOffers.some((offer) => offer.risk !== 'low')
        ? ['One or more relevant capabilities require elevated risk handling.']
        : [],
      costHints: actionOffers.some((offer) => offer.estimatedCost.latency === 'medium' || offer.estimatedCost.latency === 'high')
        ? ['Prefer fresh existing evidence before dispatching another Resolve observation.']
        : [],
      workspace: request.workspace ?? null
    };
    return {
      schemaVersion: 1,
      sessionId: request.sessionId,
      turnId: request.turnId,
      compiledAt: Date.now(),
      goal: structuredClone(request.goal),
      situation,
      relevantActions: actions,
      decision,
      actionOffers,
      budget: {
        narrativeMessages: request.narrativeMessages,
        goalChars: (request.goal.originalRequest?.text.length ?? 0)
          + request.goal.userDirectives.reduce((sum, directive) => sum + directive.text.length, 0),
        worldFacts: situation.facts.length,
        evidenceRefs: situation.evidence.length,
        semanticDeltas: situation.recentDeltas.length,
        actionDescriptors: actions.length
      }
    };
  }

  acknowledge(pack: AgentContextPack): void {
    const current = this.seenRevision.get(pack.sessionId) ?? 0;
    if (pack.situation.revision > current) this.seenRevision.set(pack.sessionId, pack.situation.revision);
  }

  completionEvidence(): AgentEvidenceRef[] {
    return this.world.currentEvidence();
  }

  resetForTests(): void {
    this.seenRevision.clear();
  }

  projectToolResult(result: CallToolResult): string {
    return this.world.projectToolResult(result);
  }

  projectToolError(message: string): string {
    return this.world.projectText(message);
  }
}

export function renderAgentContextPack(pack: AgentContextPack): string {
  return JSON.stringify({
    generation: pack.situation.generation,
    revision: pack.situation.revision,
    goal: pack.goal,
    project: pack.situation.project,
    timeline: pack.situation.timeline,
    focus: pack.situation.sharedFocus,
    entities: pack.situation.entities,
    facts: pack.situation.facts,
    evidence: pack.situation.evidence,
    deltas: pack.situation.recentDeltas,
    unknowns: pack.situation.unknowns,
    decision: {
      kind: pack.decision.decisionKind,
      criterion: pack.decision.goalCriterion,
      gap: pack.decision.completionGap,
      uncertainty: pack.decision.materialUncertainty,
      facts: pack.decision.minimumFacts,
      evidence: pack.decision.evidenceRefs,
      stale: pack.decision.staleDependencies,
      focus: pack.decision.sharedFocus,
      workspace: pack.decision.workspace,
      actionOffers: pack.actionOffers
    }
  });
}
