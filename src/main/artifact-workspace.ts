import type {
  AgentActionOffer,
  AgentArtifactKind,
  AgentArtifactLens,
  AgentArtifactLensId,
  AgentArtifactPlanSummary,
  AgentColorInspectorDetail,
  AgentDeliverInspectorDetail,
  AgentEditInspectorDetail,
  AgentFairlightInspectorDetail,
  AgentFusionInspectorDetail,
  AgentMediaInspectorProjection,
  AgentProjectInspectorDetail,
  AgentArtifactSummary,
  AgentArtifactWorkspaceProjection,
  AgentEntityMention,
  AgentEvidenceRef,
  AgentModelFact,
  AgentSituationFrame,
  AgentSystemSpineProjection
} from '../shared/agent-system.js';
import type { ProtectedWorkflowId, WorkflowPlanProjection } from '../shared/types.js';
import { projectCosSessionDecisionNow } from '../cos-host/runtime.js';
import {
  getAgentEditInspectorProjection,
  getAgentColorInspectorProjection,
  getAgentDeliverInspectorProjection,
  getAgentFairlightInspectorProjection,
  getAgentFusionInspectorProjection,
  getAgentHistoricalDeliverInspectorForProject,
  getAgentHistoricalColorInspectorForProject,
  getAgentHistoricalEditInspectorForProject,
  getAgentHistoricalFairlightInspectorForProject,
  getAgentHistoricalFusionInspectorForProject,
  getAgentHistoricalMediaInspectorForProject,
  getAgentHistoricalSituationForProject,
  getAgentHistoricalProjectInspectorForProject,
  getAgentMediaInspectorProjection,
  getAgentProjectInspectorDetail,
  getAgentSituationFrame,
  getAgentWorldIdentitySnapshot,
  mentionAgentEntityByExactId
} from './connection.js';
import { getSystemSpineProjection } from './system-spine.js';
import { getLatestWorkflowTimelineForProject, getRecentWorkflowPlansForScope } from './workflow-engine.js';
import { workspaceForSession } from './workspace-identity.js';

const ALL_LENSES: readonly AgentArtifactLensId[] = [
  'summary', 'project', 'media', 'edit', 'fusion', 'color', 'fairlight', 'deliver'
];

const LENSES_BY_KIND: Record<AgentArtifactKind, readonly AgentArtifactLensId[]> = {
  project: ['summary', 'project', 'media', 'deliver'],
  media_pool: ['summary', 'media'],
  media_item: ['summary', 'media'],
  timeline: ['summary', 'edit', 'fusion', 'color', 'fairlight'],
  timeline_item: ['summary', 'edit', 'fusion', 'color', 'fairlight'],
  fusion_composition: ['summary', 'fusion'],
  color_graph: ['summary', 'color'],
  grade_version: ['summary', 'color'],
  fairlight: ['summary', 'fairlight'],
  deliver: ['summary', 'deliver']
};

const WORKFLOW_LENS: Partial<Record<ProtectedWorkflowId, AgentArtifactLensId>> = {
  'project.identity.v1': 'project',
  'project.settings_summary.v1': 'project',
  'project.preflight.v1': 'project',
  'media.inventory_summary.v1': 'media',
  'media.clip_inspect.v1': 'media',
  'media.link_status.v1': 'media',
  'edit.timeline_summary.v1': 'edit',
  'edit.structure_inspect.v1': 'edit',
  'edit.gaps_overlaps.v1': 'edit',
  'edit.source_range_report.v1': 'edit',
  'edit.transition_inspect.v1': 'edit',
  'edit.review_annotations_inspect.v1': 'edit',
  'edit.review_marker_add.v1': 'edit',
  'fusion.composition_inspect.v1': 'fusion',
  'fusion.graph_inspect.v1': 'fusion',
  'color.pipeline_inspect.v1': 'color',
  'color.graph_inventory.v1': 'color',
  'color.grade_version_inspect.v1': 'color',
  'color.grade_version_create.v1': 'color',
  'fairlight.mapping_inspect.v1': 'fairlight',
  'fairlight.clip_processing_inspect.v1': 'fairlight',
  'deliver.capability_matrix.v1': 'deliver',
  'deliver.settings_inspect.v1': 'deliver'
};

function lenses(kind: AgentArtifactKind): AgentArtifactLens[] {
  const available = new Set(LENSES_BY_KIND[kind]);
  return ALL_LENSES.map((id) => ({
    id,
    availability: available.has(id) ? 'available' : 'unavailable',
    reason: available.has(id) ? null : 'This lens is not applicable to the active Artifact.'
  }));
}

function entityArtifactKind(kind: AgentEntityMention['kind']): AgentArtifactKind | null {
  switch (kind) {
    case 'project': return 'project';
    case 'timeline': return 'timeline';
    case 'media_pool_item': return 'media_item';
    case 'timeline_item': return 'timeline_item';
    case 'fusion_composition': return 'fusion_composition';
    case 'grade_version': return 'grade_version';
    case 'render_job':
    case 'deliverable': return 'deliver';
    default: return null;
  }
}

function artifactLens(kind: AgentArtifactKind): AgentArtifactLensId | null {
  switch (kind) {
    case 'project': return 'project';
    case 'media_pool':
    case 'media_item': return 'media';
    case 'timeline':
    case 'timeline_item': return 'edit';
    case 'fusion_composition': return 'fusion';
    case 'color_graph':
    case 'grade_version': return 'color';
    case 'fairlight': return 'fairlight';
    case 'deliver': return 'deliver';
  }
}

function evidenceMatchesArtifact(evidence: AgentEvidenceRef, artifact: Pick<AgentArtifactSummary, 'kind' | 'semanticHandle'>): boolean {
  if (artifact.semanticHandle && evidence.targetHandle === artifact.semanticHandle) return true;
  const lens = evidence.workflowId ? WORKFLOW_LENS[evidence.workflowId] ?? null : null;
  if (lens === null) return false;
  if (evidence.workflowId === 'project.preflight.v1' && artifact.kind === 'deliver') {
    return evidence.preflightProfile === 'delivery';
  }
  if (evidence.workflowId === 'project.preflight.v1' && artifact.kind === 'project') {
    return (evidence.preflightProfile ?? 'general') === 'general';
  }
  return lens === artifactLens(artifact.kind) && evidence.targetHandle === null;
}

function factsForEvidence(facts: readonly AgentModelFact[], evidence: readonly AgentEvidenceRef[]): AgentModelFact[] {
  const evidenceIds = new Set(evidence.map((item) => item.id));
  return facts
    .filter((fact) => fact.evidenceIds.some((id) => evidenceIds.has(id)))
    .slice(0, 6)
    .map((fact) => structuredClone(fact));
}

function artifactFromMention(options: {
  entity: AgentEntityMention;
  kind: AgentArtifactKind;
  workspaceId: string;
  situation: AgentSituationFrame;
  offers: readonly AgentActionOffer[];
  source?: 'world_entity' | 'cached_projection';
}): AgentArtifactSummary {
  const focus = options.situation.sharedFocus?.entity.handle ?? null;
  const evidenceRefs = options.situation.evidence
    .filter((item) => evidenceMatchesArtifact(item, { kind: options.kind, semanticHandle: options.entity.handle }))
    .slice(-6)
    .map((item) => structuredClone(item));
  const relationship = focus === options.entity.handle
    ? 'shared_focus'
    : options.kind === 'project'
      ? 'workspace'
      : options.entity.parentHandle && options.entity.parentHandle === focus
        ? 'related'
        : 'none';
  return {
    artifactId: options.entity.handle,
    semanticHandle: options.entity.handle,
    kind: options.kind,
    label: options.entity.label,
    workspaceId: options.workspaceId,
    generation: options.entity.generation,
    source: options.source ?? 'world_entity',
    focusRelationship: relationship,
    lenses: lenses(options.kind),
    summaryFacts: factsForEvidence(options.situation.facts, evidenceRefs),
    evidenceRefs,
    actionOffers: options.offers.filter((offer) => offerMatchesArtifact(offer, {
      artifactId: options.entity.handle,
      semanticHandle: options.entity.handle,
      kind: options.kind,
      label: options.entity.label,
      workspaceId: options.workspaceId,
      generation: options.entity.generation,
      source: options.source ?? 'world_entity',
      focusRelationship: 'none',
      lenses: [],
      summaryFacts: [],
      evidenceRefs: [],
      actionOffers: []
    })).map((offer) => structuredClone(offer))
  };
}

function syntheticArtifact(options: {
  id: string;
  kind: AgentArtifactKind;
  label: string;
  workspaceId: string;
  generation: number;
  situation: AgentSituationFrame;
  offers: readonly AgentActionOffer[];
  source?: 'semantic_projection' | 'cached_projection';
}): AgentArtifactSummary {
  const evidenceRefs = options.situation.evidence
    .filter((item) => evidenceMatchesArtifact(item, { kind: options.kind, semanticHandle: null }))
    .slice(-6)
    .map((item) => structuredClone(item));
  return {
    artifactId: options.id,
    semanticHandle: null,
    kind: options.kind,
    label: options.label,
    workspaceId: options.workspaceId,
    generation: options.generation,
    source: options.source ?? 'semantic_projection',
    focusRelationship: options.kind === 'project' ? 'workspace' : 'none',
    lenses: lenses(options.kind),
    summaryFacts: factsForEvidence(options.situation.facts, evidenceRefs),
    evidenceRefs,
    actionOffers: options.offers.filter((offer) => offerMatchesArtifact(offer, {
      artifactId: options.id,
      semanticHandle: null,
      kind: options.kind,
      label: options.label,
      workspaceId: options.workspaceId,
      generation: options.generation,
      source: options.source ?? 'semantic_projection',
      focusRelationship: 'none',
      lenses: [],
      summaryFacts: [],
      evidenceRefs: [],
      actionOffers: []
    })).map((offer) => structuredClone(offer))
  };
}

function addUnique(target: AgentArtifactSummary[], artifact: AgentArtifactSummary): void {
  if (!target.some((item) => item.artifactId === artifact.artifactId)) target.push(artifact);
}

function planApprovalState(plan: WorkflowPlanProjection): AgentArtifactPlanSummary['approvalState'] {
  if (plan.approval) return 'approved';
  if (plan.state === 'rejected') return 'rejected';
  if (plan.state === 'ready') return 'awaiting';
  return 'closed';
}

function planSummary(
  projection: WorkflowPlanProjection,
  resolveTarget: (exactId: string) => AgentEntityMention | null,
  authority: AgentArtifactPlanSummary['authority']
): AgentArtifactPlanSummary {
  const target = authority === 'current' ? resolveTarget(projection.plan.target_ids[0]) : null;
  return {
    planId: projection.plan.plan_id,
    workflowId: projection.plan.workflow_id,
    state: projection.state,
    authority,
    risk: projection.plan.risk_level,
    approvalState: planApprovalState(projection),
    targetHandle: target?.handle ?? null,
    targetLabel: target?.label ?? null,
    proposedChanges: projection.plan.proposed_changes.slice(0, 8).map((change) => change.kind === 'add_review_marker'
      ? {
        kind: 'add_review_marker' as const,
        name: change.name,
        frameOffset: change.frame_offset,
        color: change.color,
        duration: change.duration
      }
      : change.kind === 'structural_edit'
        ? {
        kind: 'structural_edit' as const,
        summary: change.summary
        }
        : change.kind === 'add_track'
          ? {
          kind: 'add_track' as const,
          trackType: change.track_type,
          placement: change.placement,
          expectedTrackIndex: change.expected_track_index
          }
          : {
            kind: 'create_grade_version' as const,
            name: change.name
          }),
    executionState: projection.execution?.state ?? null,
    changeSet: {
      id: projection.change_set.changeset_id,
      state: projection.change_set.state,
      verificationStatus: projection.change_set.verification_status,
      verificationLevel: projection.change_set.verification_level,
      recoveryStatus: projection.change_set.recovery_status,
      actualMarkerPresent: projection.change_set.actual_observation?.kind === 'review_marker_state'
        ? projection.change_set.actual_observation.present
        : null,
      actualTrackPresent: projection.change_set.actual_observation?.kind === 'track_add_state'
        ? projection.change_set.actual_observation.present
        : null,
      backupAvailable: projection.change_set.backup !== null
    },
    verificationRequirement: projection.plan.verification_level,
    recoveryType: projection.plan.recovery_class,
    blockingReason: projection.reason
  };
}

function offerMatchesArtifact(offer: AgentActionOffer, artifact: AgentArtifactSummary): boolean {
  if (offer.targetHandle) return offer.targetHandle === artifact.semanticHandle;
  const implementation = offer.implementation?.implementationId ?? null;
  if (!implementation) return artifact.kind === 'project';
  if (implementation === 'project.preflight.v1' && artifact.kind === 'deliver') {
    return offer.dispatch?.profile === 'delivery';
  }
  if (implementation === 'project.preflight.v1' && artifact.kind === 'project') {
    return (offer.dispatch?.profile ?? 'general') === 'general';
  }
  return (WORKFLOW_LENS[implementation] ?? null) === artifactLens(artifact.kind);
}

export function deriveArtifactWorkspaceProjection(options: {
  spine: AgentSystemSpineProjection;
  situation: AgentSituationFrame;
  cachedSituation?: AgentSituationFrame | null;
  projectInspector?: AgentProjectInspectorDetail | null;
  cachedProjectInspector?: AgentProjectInspectorDetail | null;
  mediaInspector?: AgentMediaInspectorProjection | null;
  cachedMediaInspector?: AgentMediaInspectorProjection | null;
  editInspector?: AgentEditInspectorDetail | null;
  cachedEditInspector?: AgentEditInspectorDetail | null;
  fusionInspector?: AgentFusionInspectorDetail | null;
  cachedFusionInspector?: AgentFusionInspectorDetail | null;
  colorInspector?: AgentColorInspectorDetail | null;
  cachedColorInspector?: AgentColorInspectorDetail | null;
  fairlightInspector?: AgentFairlightInspectorDetail | null;
  cachedFairlightInspector?: AgentFairlightInspectorDetail | null;
  deliverInspector?: AgentDeliverInspectorDetail | null;
  cachedDeliverInspector?: AgentDeliverInspectorDetail | null;
  plans?: readonly WorkflowPlanProjection[];
  workspaceProjectIdentity?: string | null;
  workspaceTimelineIdentity?: string | null;
  resolvePlanTarget?: (exactId: string) => AgentEntityMention | null;
}): AgentArtifactWorkspaceProjection {
  if (options.spine.decision.generation !== options.situation.generation
    || options.spine.decision.provenanceRevision !== options.situation.revision) {
    throw new Error('Artifact Workspace requires a DecisionFrame from the current World Model revision');
  }
  const workspaceId = options.spine.workspace?.workspaceId ?? 'unbound';
  const artifacts: AgentArtifactSummary[] = [];
  const currentProjectionAllowed = !options.spine.workspace
    || (options.spine.workspace.online && options.spine.workspace.bindingStatus === 'bound');
  const cachedSituation = currentProjectionAllowed ? null : options.cachedSituation ?? null;
  const project = currentProjectionAllowed ? options.situation.project : null;
  if (project) {
    addUnique(artifacts, artifactFromMention({ entity: project, kind: 'project', workspaceId, situation: options.situation, offers: options.spine.actionOffers }));
  } else if (options.spine.workspace && !cachedSituation?.project) {
    addUnique(artifacts, syntheticArtifact({
      id: `workspace:${workspaceId}:project`,
      kind: 'project',
      label: options.spine.workspace.projectLabel ?? 'Resolve Project',
      workspaceId,
      generation: options.situation.generation,
      situation: options.situation,
      offers: options.spine.actionOffers
    }));
  }
  if (currentProjectionAllowed && options.situation.timeline) {
    addUnique(artifacts, artifactFromMention({ entity: options.situation.timeline, kind: 'timeline', workspaceId, situation: options.situation, offers: options.spine.actionOffers }));
  }
  const entityMentions = currentProjectionAllowed ? [...options.situation.entities] : [];
  const focusMention = currentProjectionAllowed ? options.situation.sharedFocus?.entity ?? null : null;
  if (focusMention && !entityMentions.some((item) => item.handle === focusMention.handle)) entityMentions.push(focusMention);
  for (const entity of entityMentions) {
    const kind = entityArtifactKind(entity.kind);
    if (!kind) continue;
    addUnique(artifacts, artifactFromMention({ entity, kind, workspaceId, situation: options.situation, offers: options.spine.actionOffers }));
  }

  if (options.spine.workspace && !cachedSituation) {
    const synthetic: Array<[string, AgentArtifactKind, string]> = [
      [`workspace:${workspaceId}:media`, 'media_pool', 'Media Pool'],
      [`workspace:${workspaceId}:color`, 'color_graph', 'Color Graph'],
      [`workspace:${workspaceId}:fairlight`, 'fairlight', 'Fairlight Mapping / Clip Processing'],
      [`workspace:${workspaceId}:deliver`, 'deliver', 'Deliver Settings / Queue']
    ];
    for (const [id, kind, label] of synthetic) {
      addUnique(artifacts, syntheticArtifact({
        id,
        kind,
        label,
        workspaceId,
        generation: options.situation.generation,
        situation: options.situation,
        offers: options.spine.actionOffers
      }));
    }
  }

  if (cachedSituation) {
    const cachedMentions: AgentEntityMention[] = [];
    if (cachedSituation.project) cachedMentions.push(cachedSituation.project);
    if (cachedSituation.timeline) cachedMentions.push(cachedSituation.timeline);
    cachedMentions.push(...cachedSituation.entities);
    const cachedFocus = cachedSituation.sharedFocus?.entity ?? null;
    if (cachedFocus && !cachedMentions.some((item) => item.handle === cachedFocus.handle)) cachedMentions.push(cachedFocus);
    for (const entity of cachedMentions) {
      const kind = entityArtifactKind(entity.kind);
      if (!kind) continue;
      addUnique(artifacts, artifactFromMention({
        entity,
        kind,
        workspaceId,
        situation: cachedSituation,
        offers: [],
        source: 'cached_projection'
      }));
    }
    const cachedSynthetic: Array<[string, AgentArtifactKind, string]> = [
      [`workspace:${workspaceId}:media`, 'media_pool', 'Media Pool'],
      [`workspace:${workspaceId}:color`, 'color_graph', 'Color Graph'],
      [`workspace:${workspaceId}:fairlight`, 'fairlight', 'Fairlight Mapping / Clip Processing'],
      [`workspace:${workspaceId}:deliver`, 'deliver', 'Deliver Settings / Queue']
    ];
    for (const [id, kind, label] of cachedSynthetic) {
      addUnique(artifacts, syntheticArtifact({
        id,
        kind,
        label,
        workspaceId,
        generation: cachedSituation.generation,
        situation: cachedSituation,
        offers: [],
        source: 'cached_projection'
      }));
    }
  }

  const projectedMediaInspector = currentProjectionAllowed
    ? options.mediaInspector ?? null
    : options.cachedMediaInspector ?? null;
  const mediaInventoryRows = projectedMediaInspector?.pool?.inventory?.items ?? [];
  const projectedMediaItems = [
    ...mediaInventoryRows
      .filter((item) => !item.isTimeline)
      .map((item) => ({
        semanticHandle: item.semanticHandle,
        generation: item.generation,
        label: item.name,
        locator: item.folderLabel
      })),
    ...(projectedMediaInspector?.items ?? []).map((item) => ({
      semanticHandle: item.semanticHandle,
      generation: item.generation,
      label: item.label,
      locator: item.locator
    }))
  ];
  for (const item of projectedMediaItems) {
    if (artifacts.some((artifact) => artifact.semanticHandle === item.semanticHandle)) continue;
    const situationForItem = currentProjectionAllowed ? options.situation : cachedSituation;
    if (!situationForItem) continue;
    addUnique(artifacts, artifactFromMention({
      entity: {
        kind: 'media_pool_item',
        handle: item.semanticHandle,
        label: item.label,
        generation: item.generation,
        parentHandle: null,
        locator: item.locator
      },
      kind: 'media_item',
      workspaceId,
      situation: situationForItem,
      offers: currentProjectionAllowed ? options.spine.actionOffers : [],
      ...(currentProjectionAllowed ? {} : { source: 'cached_projection' as const })
    }));
  }

  const projectedProjectInspector = currentProjectionAllowed
    ? options.projectInspector ?? null
    : options.cachedProjectInspector ?? null;
  const projectArtifact = artifacts.find((artifact) => artifact.kind === 'project');
  if (projectArtifact) projectArtifact.projectInspector = projectedProjectInspector
    ? structuredClone(projectedProjectInspector)
    : null;
  const mediaPoolArtifact = artifacts.find((artifact) => artifact.kind === 'media_pool');
  if (mediaPoolArtifact) mediaPoolArtifact.mediaInspector = projectedMediaInspector?.pool
    ? structuredClone(projectedMediaInspector.pool)
    : null;
  for (const item of projectedMediaInspector?.items ?? []) {
    const artifact = artifacts.find((candidate) => candidate.semanticHandle === item.semanticHandle && candidate.kind === 'media_item');
    if (artifact) artifact.mediaInspector = structuredClone(item.detail);
  }
  const projectedEditInspector = currentProjectionAllowed
    ? options.editInspector ?? null
    : options.cachedEditInspector ?? null;
  const timelineArtifact = artifacts.find((artifact) => artifact.kind === 'timeline');
  if (timelineArtifact) timelineArtifact.editInspector = projectedEditInspector
    ? structuredClone(projectedEditInspector)
    : null;
  const projectedFusionInspector = currentProjectionAllowed
    ? options.fusionInspector ?? null
    : options.cachedFusionInspector ?? null;
  if (timelineArtifact) timelineArtifact.fusionInspector = projectedFusionInspector
    ? structuredClone(projectedFusionInspector)
    : null;
  const projectedColorInspector = currentProjectionAllowed
    ? options.colorInspector ?? null
    : options.cachedColorInspector ?? null;
  const colorArtifact = artifacts.find((artifact) => artifact.kind === 'color_graph');
  if (colorArtifact) colorArtifact.colorInspector = projectedColorInspector
    ? structuredClone(projectedColorInspector)
    : null;
  const projectedFairlightInspector = currentProjectionAllowed
    ? options.fairlightInspector ?? null
    : options.cachedFairlightInspector ?? null;
  const fairlightArtifact = artifacts.find((artifact) => artifact.kind === 'fairlight');
  if (fairlightArtifact) fairlightArtifact.fairlightInspector = projectedFairlightInspector
    ? structuredClone(projectedFairlightInspector)
    : null;
  const projectedDeliverInspector = currentProjectionAllowed
    ? options.deliverInspector ?? null
    : options.cachedDeliverInspector ?? null;
  const deliverArtifact = artifacts.find((artifact) => artifact.kind === 'deliver');
  if (deliverArtifact) deliverArtifact.deliverInspector = projectedDeliverInspector
    ? structuredClone(projectedDeliverInspector)
    : null;

  const presentationFocus = focusMention ?? cachedSituation?.sharedFocus?.entity ?? null;
  const presentationTimeline = currentProjectionAllowed ? options.situation.timeline : cachedSituation?.timeline ?? null;
  const suggestedArtifactId = presentationFocus
    ? artifacts.find((artifact) => artifact.semanticHandle === presentationFocus.handle)?.artifactId ?? null
    : presentationTimeline
      ? presentationTimeline.handle
      : artifacts.find((artifact) => artifact.kind === 'project')?.artifactId ?? null;

  const planAuthority: AgentArtifactPlanSummary['authority'] = options.spine.workspace?.online
    && options.spine.workspace.bindingStatus === 'bound'
    ? 'current'
    : 'cached_read_only';
  const visiblePlans = (!options.spine.workspace
    || !options.workspaceProjectIdentity
    || !options.workspaceTimelineIdentity)
    ? []
    : (options.plans ?? []).filter((projection) =>
      projection.plan.project_unique_id === options.workspaceProjectIdentity
      && projection.plan.timeline_unique_id === options.workspaceTimelineIdentity
    ).slice(0, 8).map((projection) => planSummary(
      projection,
      options.resolvePlanTarget ?? (() => null),
      planAuthority
    ));

  const protectedResolveActionsBlocked = !options.spine.workspace?.online
    || options.spine.workspace.bindingStatus !== 'bound';
  const presentationSituation = currentProjectionAllowed
    ? options.situation
    : cachedSituation;

  return {
    schemaVersion: 1,
    sessionId: options.spine.sessionId,
    turnId: options.spine.turnId,
    generation: options.situation.generation,
    workspace: options.spine.workspace ? structuredClone(options.spine.workspace) : null,
    context: {
      project: presentationSituation?.project ? structuredClone(presentationSituation.project) : null,
      timeline: presentationSituation?.timeline ? structuredClone(presentationSituation.timeline) : null,
      sharedFocus: presentationSituation?.sharedFocus ? structuredClone(presentationSituation.sharedFocus) : null,
      goalCriterion: options.spine.decision.goalCriterion,
      openObligation: options.spine.decision.openObligation,
      decisionKind: options.spine.decision.decisionKind,
      completionGap: options.spine.decision.completionGap,
      blockers: [...options.spine.completion.blockers],
      materialUncertainty: options.spine.decision.materialUncertainty,
      unknowns: (presentationSituation?.unknowns ?? []).slice(0, 8)
    },
    artifacts,
    suggestedArtifactId,
    actionOffers: currentProjectionAllowed ? structuredClone(options.spine.actionOffers) : [],
    plans: visiblePlans,
    recentDeltas: (presentationSituation?.recentDeltas ?? []).slice(-6).map((delta) => structuredClone(delta)),
    protectedResolveActionsBlocked
  };
}

export async function getArtifactWorkspaceProjection(): Promise<AgentArtifactWorkspaceProjection | null> {
  let spine = getSystemSpineProjection();
  if (!spine) return null;
  let situation = getAgentSituationFrame();
  if (spine.decision.generation !== situation.generation
    || spine.decision.provenanceRevision !== situation.revision) {
    await projectCosSessionDecisionNow(spine.sessionId);
    spine = getSystemSpineProjection();
    if (!spine) return null;
    situation = getAgentSituationFrame();
    if (spine.decision.generation !== situation.generation
      || spine.decision.provenanceRevision !== situation.revision) return null;
  }
  const workspace = workspaceForSession(spine.sessionId);
  const identity = getAgentWorldIdentitySnapshot();
  const projectIdentity = workspace?.projectIdentity ?? null;
  const currentScopeMatchesWorkspace = Boolean(
    spine.workspace?.online
    && spine.workspace.bindingStatus === 'bound'
    && projectIdentity
    && identity.project?.exactId === projectIdentity
  );
  const timelineIdentity = currentScopeMatchesWorkspace
    ? identity.timeline?.exactId
      ?? workspace?.lastKnownTimelineIdentity
      ?? (projectIdentity ? getLatestWorkflowTimelineForProject(projectIdentity) : null)
    : workspace?.lastKnownTimelineIdentity
      ?? (projectIdentity ? getLatestWorkflowTimelineForProject(projectIdentity) : null);
  const cachedSituation = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalSituationForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalSituationForProject(projectIdentity)
    : null;
  const projectInspector = currentScopeMatchesWorkspace ? getAgentProjectInspectorDetail() : null;
  const cachedProjectInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalProjectInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalProjectInspectorForProject(projectIdentity)
    : null;
  const mediaInspector = currentScopeMatchesWorkspace ? getAgentMediaInspectorProjection() : null;
  const cachedMediaInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalMediaInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalMediaInspectorForProject(projectIdentity)
    : null;
  const editInspector = currentScopeMatchesWorkspace ? getAgentEditInspectorProjection() : null;
  const cachedEditInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalEditInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalEditInspectorForProject(projectIdentity)
    : null;
  const fusionInspector = currentScopeMatchesWorkspace ? getAgentFusionInspectorProjection() : null;
  const cachedFusionInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalFusionInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalFusionInspectorForProject(projectIdentity)
    : null;
  const colorInspector = currentScopeMatchesWorkspace ? getAgentColorInspectorProjection() : null;
  const cachedColorInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalColorInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalColorInspectorForProject(projectIdentity)
    : null;
  const fairlightInspector = currentScopeMatchesWorkspace ? getAgentFairlightInspectorProjection() : null;
  const cachedFairlightInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalFairlightInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalFairlightInspectorForProject(projectIdentity)
    : null;
  const deliverInspector = currentScopeMatchesWorkspace ? getAgentDeliverInspectorProjection() : null;
  const cachedDeliverInspector = !currentScopeMatchesWorkspace && projectIdentity
    ? getAgentHistoricalDeliverInspectorForProject(projectIdentity, workspace?.lastKnownWorldGeneration ?? undefined)
      ?? getAgentHistoricalDeliverInspectorForProject(projectIdentity)
    : null;
  return deriveArtifactWorkspaceProjection({
    spine,
    situation,
    cachedSituation,
    projectInspector,
    cachedProjectInspector,
    mediaInspector,
    cachedMediaInspector,
    editInspector,
    cachedEditInspector,
    fusionInspector,
    cachedFusionInspector,
    colorInspector,
    cachedColorInspector,
    fairlightInspector,
    cachedFairlightInspector,
    deliverInspector,
    cachedDeliverInspector,
    plans: spine.workspace
      && projectIdentity
      && timelineIdentity ? getRecentWorkflowPlansForScope({
      projectUniqueId: projectIdentity,
      timelineUniqueId: timelineIdentity,
      limit: 8
    }) : [],
    workspaceProjectIdentity: projectIdentity,
    workspaceTimelineIdentity: timelineIdentity,
    resolvePlanTarget: mentionAgentEntityByExactId
  });
}
