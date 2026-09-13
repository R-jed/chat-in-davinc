import type { CallToolResult } from '@modelcontextprotocol/server';
import type {
  AgentEntityKind,
  AgentEntityMention,
  AgentEntityRef,
  AgentColorGraphScopeDetail,
  AgentColorInspectorDetail,
  AgentEditAnnotationsInspectorDetail,
  AgentEditGapsInspectorDetail,
  AgentEditInspectorDetail,
  AgentEditSourceRangesInspectorDetail,
  AgentEditStructureInspectorDetail,
  AgentEditTimelineInspectorDetail,
  AgentEditTransitionsInspectorDetail,
  AgentDeliverInspectorDetail,
  AgentEpistemicState,
  AgentEvidenceRef,
  AgentFairlightInspectorDetail,
  AgentFocusRequest,
  AgentFusionInspectorDetail,
  AgentMediaClipInspectorDetail,
  AgentMediaInspectorDetail,
  AgentMediaInspectorProjection,
  AgentMediaInventoryInspectorDetail,
  AgentMediaLinkInspectorDetail,
  AgentModelFact,
  AgentProjectInspectorDetail,
  AgentSemanticDelta,
  AgentSharedFocus,
  AgentSituationFrame,
  AgentWorldFact
} from '../shared/agent-system.js';
import type {
  DeliverCapabilityMatrix,
  ProtectedVerificationLevel,
  ProtectedVerificationStatus,
  ProtectedWorkflowId,
  ProjectPreflightProfile,
  WorkflowInspectResult
} from '../shared/types.js';
import type { ToolKernelObservation, ToolKernelSemanticState } from './tool-kernel.js';

const MAX_EVIDENCE = 128;
const MAX_DELTAS = 64;
const MAX_HISTORICAL_GENERATIONS = 4;
const MAX_SITUATION_FACTS = 16;
const MAX_SITUATION_ENTITIES = 24;
const MAX_MODEL_RESULT_ARRAY = 40;
const MAX_MODEL_RESULT_KEYS = 64;
const MAX_MODEL_RESULT_STRING = 4_000;
const HANDLE_PREFIX: Record<AgentEntityKind, string> = {
  project: 'P',
  timeline: 'T',
  media_pool_folder: 'B',
  media_pool_item: 'M',
  timeline_item: 'I',
  fusion_composition: 'F',
  fusion_tool: 'U',
  color_node: 'C',
  grade_version: 'V',
  fairlight_track: 'A',
  render_job: 'R',
  deliverable: 'D'
};
const ENTITY_LABEL_FALLBACK: Record<AgentEntityKind, string> = {
  project: 'Project',
  timeline: 'Timeline',
  media_pool_folder: 'Media Folder',
  media_pool_item: 'Media Item',
  timeline_item: 'Timeline Item',
  fusion_composition: 'Fusion Composition',
  fusion_tool: 'Fusion Tool',
  color_node: 'Color Node',
  grade_version: 'Grade Version',
  fairlight_track: 'Fairlight Track',
  render_job: 'Render Job',
  deliverable: 'Deliverable'
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function deliverFormatRow(
  formats: DeliverCapabilityMatrix['videoFormats'],
  token: string | null | undefined
): DeliverCapabilityMatrix['videoFormats'][number] | null {
  if (!token) return null;
  return formats.find((row) => row.extension === token || row.name === token) ?? null;
}

function deliverCodecDisplayName(
  formats: DeliverCapabilityMatrix['videoFormats'],
  formatToken: string | null | undefined,
  codecToken: string | null | undefined
): string | null {
  if (!codecToken) return null;
  const format = deliverFormatRow(formats, formatToken);
  const exactFormatMatch = format?.codecs.find((codec) => codec.id === codecToken || codec.name === codecToken);
  if (exactFormatMatch) return exactFormatMatch.name;
  const matches = formats.flatMap((row) => row.codecs.filter((codec) => codec.id === codecToken || codec.name === codecToken));
  const names = [...new Set(matches.map((codec) => codec.name))];
  return names.length === 1 ? names[0]! : null;
}

function textContent(result: CallToolResult): string | null {
  const text = result.content.find((item) => item.type === 'text')?.text;
  return typeof text === 'string' ? text : null;
}

function protectedEnvelope(result: CallToolResult): { result: unknown; operation: Record<string, unknown> | null } | null {
  const text = textContent(result);
  if (!text) return null;
  try {
    const parsed = objectValue(JSON.parse(text));
    if (!parsed || !Object.hasOwn(parsed, 'result')) return null;
    return { result: parsed['result'], operation: objectValue(parsed['operation']) };
  } catch {
    return null;
  }
}

function mention(entity: AgentEntityRef): AgentEntityMention {
  const { exactId: _exactId, ...safe } = entity;
  return structuredClone(safe);
}

function comparable(value: unknown): string {
  try { return JSON.stringify(value); }
  catch { return String(value); }
}

function workflowIdFrom(operation: Record<string, unknown> | null): ProtectedWorkflowId | null {
  const value = operation?.['workflow_id'];
  return typeof value === 'string' ? value as ProtectedWorkflowId : null;
}

function executionIdFrom(operation: Record<string, unknown> | null): string | null {
  const value = operation?.['execution_id'];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function verificationLevelFrom(operation: Record<string, unknown> | null): ProtectedVerificationLevel | null {
  const verification = objectValue(operation?.['verification']);
  const value = verification?.['level_reached'];
  return value === 'API_READBACK' || value === 'STRUCTURAL_READBACK' || value === 'RENDER_VERIFIED'
    || value === 'AUDIO_VERIFIED' || value === 'DELIVERABLE_VERIFIED'
    ? value
    : null;
}

function verificationStatusFrom(operation: Record<string, unknown> | null): ProtectedVerificationStatus | null {
  const verification = objectValue(operation?.['verification']);
  const value = verification?.['status'];
  return value === 'passed' || value === 'partial' || value === 'failed' || value === 'contradiction' || value === 'unverified'
    ? value
    : null;
}

/**
 * One semantic freshness rule for completion evidence.
 *
 * Freshness is provenance/invalidation state, not a wall-clock TTL and not a Session-global
 * revision floor. The optional generation argument is used by callers that need the exact
 * current World Model epoch as well.
 */
export function agentEvidenceIsCurrent(item: AgentEvidenceRef, generation?: number): boolean {
  if (generation !== undefined && item.generation !== generation) return false;
  return item.invalidatedAtRevision === undefined
    || (item.provenanceRevision ?? 0) >= item.invalidatedAtRevision;
}

function sameEvidenceSlice(left: AgentEvidenceRef, right: AgentEvidenceRef): boolean {
  return left.generation === right.generation
    && left.workflowId !== null
    && left.workflowId === right.workflowId
    && left.targetHandle === right.targetHandle
    && (left.preflightProfile ?? null) === (right.preflightProfile ?? null);
}

interface AgentHistoricalWorldProjection {
  generation: number;
  revision: number;
  observedAt: number;
  projectExactId: string;
  timelineExactId: string | null;
  project: AgentEntityMention;
  timeline: AgentEntityMention | null;
  resolvePage: string | null;
  sharedFocus: AgentSharedFocus | null;
  entities: AgentEntityMention[];
  facts: AgentModelFact[];
  projectInspector: AgentProjectInspectorDetail | null;
  mediaInspector: AgentMediaInspectorProjection;
  editInspector: AgentEditInspectorDetail;
  fusionInspector: AgentFusionInspectorDetail;
  colorInspector: AgentColorInspectorDetail;
  fairlightInspector: AgentFairlightInspectorDetail;
  deliverInspector: AgentDeliverInspectorDetail;
  unknowns: string[];
}

export class AgentWorldModel implements ToolKernelSemanticState {
  private generation = 1;
  private revision = 0;
  private schemaHash: string | null = null;
  private currentProjectId: string | null = null;
  private currentTimelineId: string | null = null;
  private readonly entitiesByHandle = new Map<string, AgentEntityRef>();
  private readonly entityHandleByExact = new Map<string, string>();
  private readonly counters = new Map<AgentEntityKind, number>();
  private readonly facts = new Map<string, AgentWorldFact>();
  private readonly evidence: AgentEvidenceRef[] = [];
  private evidenceCounter = 0;
  private readonly deltas: AgentSemanticDelta[] = [];
  private readonly historicalProjections: AgentHistoricalWorldProjection[] = [];
  private projectInspectorSettings: { evidenceId: string; value: AgentProjectInspectorDetail['settings'] } | null = null;
  private projectInspectorPreflight: { evidenceId: string; value: AgentProjectInspectorDetail['preflight'] } | null = null;
  private mediaInventoryInspector: { evidenceId: string; value: AgentMediaInventoryInspectorDetail | null } | null = null;
  private mediaPoolLinkInspector: { evidenceId: string; value: AgentMediaLinkInspectorDetail } | null = null;
  private readonly mediaClipInspectors = new Map<string, { evidenceId: string; value: AgentMediaClipInspectorDetail }>();
  private readonly mediaLinkInspectors = new Map<string, { evidenceId: string; value: AgentMediaLinkInspectorDetail }>();
  private editTimelineInspector: { evidenceId: string; value: AgentEditTimelineInspectorDetail } | null = null;
  private editStructureInspector: { evidenceId: string; value: AgentEditStructureInspectorDetail } | null = null;
  private editGapsInspector: { evidenceId: string; value: AgentEditGapsInspectorDetail } | null = null;
  private editSourceRangesInspector: { evidenceId: string; value: AgentEditSourceRangesInspectorDetail } | null = null;
  private editTransitionsInspector: { evidenceId: string; value: AgentEditTransitionsInspectorDetail } | null = null;
  private editAnnotationsInspector: { evidenceId: string; value: AgentEditAnnotationsInspectorDetail } | null = null;
  private fusionCompositionInspector: { evidenceId: string; value: AgentFusionInspectorDetail['composition'] } | null = null;
  private fusionGraphInspector: { evidenceId: string; value: AgentFusionInspectorDetail['graph'] } | null = null;
  private colorPipelineInspector: { evidenceId: string; value: AgentColorInspectorDetail['pipeline'] } | null = null;
  private colorGraphInspector: { evidenceId: string; value: AgentColorInspectorDetail['graph'] } | null = null;
  private colorVersionsInspector: { evidenceId: string; value: AgentColorInspectorDetail['versions'] } | null = null;
  private fairlightMappingInspector: { evidenceId: string; value: AgentFairlightInspectorDetail['mapping'] } | null = null;
  private fairlightProcessingInspector: { evidenceId: string; value: AgentFairlightInspectorDetail['processing'] } | null = null;
  private deliverCapabilitiesInspector: { evidenceId: string; value: AgentDeliverInspectorDetail['capabilities'] } | null = null;
  private deliverSettingsInspector: { evidenceId: string; value: AgentDeliverInspectorDetail['settings'] } | null = null;
  private focus: AgentSharedFocus | null = null;
  private lastObservedAt = 0;

  private exactKey(kind: AgentEntityKind, exactId: string): string {
    return `${kind}\u0000${exactId}`;
  }

  private captureHistoricalProjection(): void {
    if (!this.currentProjectId) return;
    const situation = this.situation();
    if (!situation.project) return;
    const entities = [...situation.entities];
    const focus = situation.sharedFocus?.entity ?? null;
    if (focus
      && focus.handle !== situation.project.handle
      && focus.handle !== situation.timeline?.handle
      && !entities.some((entity) => entity.handle === focus.handle)) {
      entities.push(structuredClone(focus));
    }
    this.historicalProjections.push({
      generation: situation.generation,
      revision: situation.revision,
      observedAt: situation.observedAt,
      projectExactId: this.currentProjectId,
      timelineExactId: this.currentTimelineId,
      project: structuredClone(situation.project),
      timeline: situation.timeline ? structuredClone(situation.timeline) : null,
      resolvePage: situation.resolvePage,
      sharedFocus: situation.sharedFocus ? structuredClone(situation.sharedFocus) : null,
      entities: entities.slice(-MAX_SITUATION_ENTITIES).map((entity) => structuredClone(entity)),
      facts: situation.facts.map((fact) => structuredClone(fact)),
      projectInspector: this.projectInspectorDetail(),
      mediaInspector: this.mediaInspectorProjection(),
      editInspector: this.editInspectorProjection(),
      fusionInspector: this.fusionInspectorProjection(),
      colorInspector: this.colorInspectorProjection(),
      fairlightInspector: this.fairlightInspectorProjection(),
      deliverInspector: this.deliverInspectorProjection(),
      unknowns: [...situation.unknowns]
    });
    if (this.historicalProjections.length > MAX_HISTORICAL_GENERATIONS) {
      this.historicalProjections.splice(0, this.historicalProjections.length - MAX_HISTORICAL_GENERATIONS);
    }
  }

  private resetEpoch(reason: string): void {
    this.captureHistoricalProjection();
    const invalidated = [...this.facts.keys()];
    this.generation += 1;
    this.revision += 1;
    this.schemaHash = null;
    this.currentProjectId = null;
    this.currentTimelineId = null;
    this.entitiesByHandle.clear();
    this.entityHandleByExact.clear();
    this.counters.clear();
    this.facts.clear();
    this.projectInspectorSettings = null;
    this.projectInspectorPreflight = null;
    this.mediaInventoryInspector = null;
    this.mediaPoolLinkInspector = null;
    this.mediaClipInspectors.clear();
    this.mediaLinkInspectors.clear();
    this.editTimelineInspector = null;
    this.editStructureInspector = null;
    this.editGapsInspector = null;
    this.editSourceRangesInspector = null;
    this.editTransitionsInspector = null;
    this.editAnnotationsInspector = null;
    this.fusionCompositionInspector = null;
    this.fusionGraphInspector = null;
    this.colorPipelineInspector = null;
    this.colorGraphInspector = null;
    this.colorVersionsInspector = null;
    this.fairlightMappingInspector = null;
    this.fairlightProcessingInspector = null;
    this.deliverCapabilitiesInspector = null;
    this.deliverSettingsInspector = null;
    this.focus = null;
    this.deltas.push({
      revision: this.revision,
      generation: this.generation,
      observedAt: Date.now(),
      reason,
      changedFactKeys: [],
      invalidatedFactKeys: invalidated,
      evidenceIds: []
    });
    if (this.deltas.length > MAX_DELTAS) this.deltas.splice(0, this.deltas.length - MAX_DELTAS);
  }

  invalidate(reason = 'Resolve authority reset'): void {
    this.resetEpoch(reason);
  }

  resetForTests(): void {
    this.generation = 1;
    this.revision = 0;
    this.schemaHash = null;
    this.currentProjectId = null;
    this.currentTimelineId = null;
    this.entitiesByHandle.clear();
    this.entityHandleByExact.clear();
    this.counters.clear();
    this.facts.clear();
    this.evidence.splice(0);
    this.evidenceCounter = 0;
    this.deltas.splice(0);
    this.historicalProjections.splice(0);
    this.projectInspectorSettings = null;
    this.projectInspectorPreflight = null;
    this.mediaInventoryInspector = null;
    this.mediaPoolLinkInspector = null;
    this.mediaClipInspectors.clear();
    this.mediaLinkInspectors.clear();
    this.editTimelineInspector = null;
    this.editStructureInspector = null;
    this.editGapsInspector = null;
    this.editSourceRangesInspector = null;
    this.editTransitionsInspector = null;
    this.editAnnotationsInspector = null;
    this.fusionCompositionInspector = null;
    this.fusionGraphInspector = null;
    this.colorPipelineInspector = null;
    this.colorGraphInspector = null;
    this.colorVersionsInspector = null;
    this.fairlightMappingInspector = null;
    this.fairlightProcessingInspector = null;
    this.deliverCapabilitiesInspector = null;
    this.deliverSettingsInspector = null;
    this.focus = null;
    this.lastObservedAt = 0;
  }

  private ensureIdentity(projectId: string | null | undefined, timelineId: string | null | undefined, schemaHash: string | null): void {
    const schemaChanged = this.schemaHash !== null && schemaHash !== null && this.schemaHash !== schemaHash;
    const projectChanged = projectId !== undefined && this.currentProjectId !== null && this.currentProjectId !== projectId;
    const timelineChanged = timelineId !== undefined && this.currentTimelineId !== null && this.currentTimelineId !== timelineId;
    if (schemaChanged || projectChanged || timelineChanged) this.resetEpoch('Resolve identity/schema generation changed');
    if (schemaHash !== null) this.schemaHash = schemaHash;
    if (projectId !== undefined) this.currentProjectId = projectId;
    if (timelineId !== undefined) this.currentTimelineId = timelineId;
  }

  private bindEntity(options: {
    kind: AgentEntityKind;
    exactId: string;
    label: string;
    parentHandle?: string | null;
    locator?: string | null;
  }): AgentEntityRef {
    const suppliedLabel = options.label.trim();
    const exactKey = this.exactKey(options.kind, options.exactId);
    const existingHandle = this.entityHandleByExact.get(exactKey);
    if (existingHandle) {
      const existing = this.entitiesByHandle.get(existingHandle)!;
      if (suppliedLabel) existing.label = suppliedLabel;
      existing.parentHandle = options.parentHandle ?? existing.parentHandle;
      existing.locator = options.locator ?? existing.locator;
      return existing;
    }
    const next = (this.counters.get(options.kind) ?? 0) + 1;
    this.counters.set(options.kind, next);
    const entity: AgentEntityRef = {
      kind: options.kind,
      exactId: options.exactId,
      handle: `${HANDLE_PREFIX[options.kind]}${next}`,
      label: suppliedLabel || ENTITY_LABEL_FALLBACK[options.kind],
      generation: this.generation,
      parentHandle: options.parentHandle ?? null,
      locator: options.locator ?? null
    };
    this.entitiesByHandle.set(entity.handle, entity);
    this.entityHandleByExact.set(exactKey, entity.handle);
    return entity;
  }

  private findEntity(kind: AgentEntityKind, exactId: string): AgentEntityRef | null {
    const handle = this.entityHandleByExact.get(this.exactKey(kind, exactId));
    return handle ? this.entitiesByHandle.get(handle) ?? null : null;
  }

  private findEntityByExactId(exactId: string): AgentEntityRef | null {
    for (const entity of this.entitiesByHandle.values()) if (entity.exactId === exactId) return entity;
    return null;
  }

  private evidenceRef(
    operation: Record<string, unknown> | null,
    observedAt: number,
    limitations: string[] = [],
    targetHandle: string | null = null,
    preflightProfile?: ProjectPreflightProfile,
    supersedeSlice = true
  ): AgentEvidenceRef {
    const project = this.currentProjectId ? this.findEntity('project', this.currentProjectId) : null;
    const timeline = this.currentTimelineId ? this.findEntity('timeline', this.currentTimelineId) : null;
    const item: AgentEvidenceRef = {
      id: `E${++this.evidenceCounter}`,
      source: 'official_api',
      observedAt,
      generation: this.generation,
      provenanceRevision: this.revision + 1,
      workflowId: workflowIdFrom(operation),
      executionId: executionIdFrom(operation),
      verificationStatus: verificationStatusFrom(operation),
      verificationLevel: verificationLevelFrom(operation),
      projectHandle: project?.handle ?? null,
      timelineHandle: timeline?.handle ?? null,
      targetHandle,
      ...(preflightProfile ? { preflightProfile } : {}),
      limitations
    };
    if (supersedeSlice && item.workflowId !== null) {
      for (const prior of this.evidence) {
        if (
          sameEvidenceSlice(prior, item)
          && agentEvidenceIsCurrent(prior, this.generation)
          && (prior.provenanceRevision ?? 0) < (item.provenanceRevision ?? 0)
        ) {
          prior.invalidatedAtRevision = item.provenanceRevision;
        }
      }
    }
    this.evidence.push(item);
    if (this.evidence.length > MAX_EVIDENCE) this.evidence.splice(0, this.evidence.length - MAX_EVIDENCE);
    return item;
  }

  private setFact(
    changed: Set<string>,
    key: string,
    value: unknown,
    evidenceId: string,
    observedAt: number,
    subjectHandle: string | null = null,
    epistemicState: AgentEpistemicState = 'observed'
  ): void {
    const existing = this.facts.get(key);
    const next: AgentWorldFact = {
      key,
      subjectHandle,
      value: structuredClone(value),
      epistemicState,
      evidenceIds: [evidenceId],
      observedAt,
      generation: this.generation
    };
    if (!existing || existing.epistemicState !== epistemicState || comparable(existing.value) !== comparable(next.value)
      || existing.subjectHandle !== subjectHandle) changed.add(key);
    this.facts.set(key, next);
  }

  private currentEvidenceIds(): Set<string> {
    return new Set(
      this.evidence
        .filter((item) => agentEvidenceIsCurrent(item, this.generation))
        .map((item) => item.id)
    );
  }

  /**
   * Facts are semantic projections of EvidenceRefs, never a second freshness authority.
   *
   * Exact-slice supersession may invalidate a prior EvidenceRef without the replacement result
   * carrying every field the old result had (for example, a media item refresh can become
   * not-found). Retire any fact whose entire supporting-evidence set is no longer current so a
   * stale value cannot remain model-visible after its evidence has been fenced out.
   */
  private retireUnsupportedFacts(): string[] {
    const currentEvidenceIds = this.currentEvidenceIds();
    const retired: string[] = [];
    for (const fact of this.facts.values()) {
      if (
        fact.generation !== this.generation
        || !fact.evidenceIds.some((id) => currentEvidenceIds.has(id))
      ) {
        this.facts.delete(fact.key);
        retired.push(fact.key);
      }
    }
    return retired;
  }

  private timelineFromResult(result: WorkflowInspectResult): { id: string; name: string } | null {
    if (result.target === 'project') return result.timeline ? { id: result.timeline.id, name: result.timeline.name } : null;
    if (result.target === 'edit') {
      const timeline = result.summary?.timeline ?? result.structure?.timeline ?? result.gapsOverlaps?.timeline
        ?? result.sourceRanges?.timeline ?? result.transitions?.timeline ?? result.annotations?.timeline;
      return timeline ? { id: timeline.id, name: timeline.name } : null;
    }
    if (result.target === 'fusion') {
      const timeline = result.summary?.timeline ?? result.graph?.timeline;
      return timeline ? { id: timeline.id, name: timeline.name } : null;
    }
    if (result.target === 'color') {
      const timeline = result.graph?.timeline ?? result.versions?.timeline;
      return timeline ? { id: timeline.id, name: timeline.name } : null;
    }
    if (result.target === 'fairlight') {
      const timeline = result.summary?.timeline ?? result.clipProcessing?.timeline;
      return timeline ? { id: timeline.id, name: timeline.name } : null;
    }
    if (result.target === 'preflight') return result.preflight.timeline;
    return null;
  }

  private observeInspect(
    result: WorkflowInspectResult,
    operation: Record<string, unknown> | null,
    args: Record<string, unknown>
  ): void {
    const observedAt = result.observedAt;
    const timelineIdentity = this.timelineFromResult(result);
    const projectIdentity = result.target === 'project'
      ? result.project ? { id: result.project.id, name: result.project.name } : null
      : result.target === 'preflight' ? result.preflight.project : null;
    const observesProjectIdentity = result.target === 'project' || result.target === 'preflight';
    const observesTimelineIdentity = result.target === 'project' || result.target === 'edit' || result.target === 'fusion'
      || (result.target === 'color' && result.view !== 'pipeline') || result.target === 'fairlight' || result.target === 'preflight';
    this.ensureIdentity(
      observesProjectIdentity ? projectIdentity?.id ?? null : undefined,
      observesTimelineIdentity ? timelineIdentity?.id ?? null : undefined,
      result.schemaHash
    );

    const project = projectIdentity
      ? this.bindEntity({ kind: 'project', exactId: projectIdentity.id, label: projectIdentity.name })
      : this.currentProjectId ? this.findEntity('project', this.currentProjectId) : null;
    const timeline = timelineIdentity
      ? this.bindEntity({ kind: 'timeline', exactId: timelineIdentity.id, label: timelineIdentity.name, parentHandle: project?.handle ?? null })
      : this.currentTimelineId ? this.findEntity('timeline', this.currentTimelineId) : null;
    const requestedItemId = typeof args['itemId'] === 'string' ? args['itemId'] : null;
    const requestedClip = result.target === 'media' ? result.clip?.item ?? null : null;
    const inspectedItem = requestedItemId
      ? this.findEntity('media_pool_item', requestedItemId)
        ?? (requestedClip
          ? this.bindEntity({
              kind: 'media_pool_item',
              exactId: requestedItemId,
              label: requestedClip.name,
              parentHandle: project?.handle ?? null
            })
          : null)
      : null;
    const evidence = this.evidenceRef(
      operation,
      observedAt,
      [],
      inspectedItem?.handle ?? null,
      result.target === 'preflight' ? result.preflight.profile : undefined
    );
    const changed = new Set<string>();

    if (result.target === 'connection') {
      this.setFact(changed, 'resolve.running', result.running, evidence.id, observedAt,
        null, result.running === null ? 'unknown' : 'observed');
      this.setFact(changed, 'resolve.version', result.resolveVersion, evidence.id, observedAt,
        null, result.resolveVersion === null ? 'unknown' : 'observed');
    } else if (result.target === 'project') {
      this.setFact(changed, 'resolve.page', result.page, evidence.id, observedAt, null, result.page === null ? 'unknown' : 'observed');
      const effectiveSettings = result.settings.timeline ?? result.settings.project;
      this.projectInspectorSettings = {
        evidenceId: evidence.id,
        value: {
          timelineResolution: effectiveSettings?.timelineResolution ?? null,
          timelineFrameRate: effectiveSettings?.timelineFrameRate ?? null,
          timelinePlaybackFrameRate: effectiveSettings?.timelinePlaybackFrameRate ?? null,
          outputResolution: effectiveSettings?.outputResolution ?? null,
          frameRateMismatchBehavior: effectiveSettings?.frameRateMismatchBehavior ?? null,
          colorScienceMode: effectiveSettings?.colorScienceMode ?? null,
          videoMonitorFormat: effectiveSettings?.videoMonitorFormat ?? null,
          timelineUsesCustomSettings: result.settings.timelineUsesCustomSettings
        }
      };
      if (project) this.setFact(changed, 'project.timelineCount', result.project?.timelineCount ?? null, evidence.id, observedAt, project.handle,
        result.project?.timelineCount === null ? 'unknown' : 'observed');
      if (timeline) {
        this.setFact(changed, 'timeline.videoTracks', result.timeline?.videoTracks ?? null, evidence.id, observedAt, timeline.handle,
          result.timeline?.videoTracks === null ? 'unknown' : 'observed');
        this.setFact(changed, 'timeline.audioTracks', result.timeline?.audioTracks ?? null, evidence.id, observedAt, timeline.handle,
          result.timeline?.audioTracks === null ? 'unknown' : 'observed');
        this.setFact(changed, 'timeline.subtitleTracks', result.timeline?.subtitleTracks ?? null, evidence.id, observedAt, timeline.handle,
          result.timeline?.subtitleTracks === null ? 'unknown' : 'observed');
      }
    } else if (result.target === 'media') {
      const inventory = result.inventory;
      if (inventory) {
        const rootFolder = inventory.rootFolder
          ? this.bindEntity({ kind: 'media_pool_folder', exactId: inventory.rootFolder.id, label: inventory.rootFolder.name, parentHandle: project?.handle ?? null })
          : null;
        for (const folder of inventory.folders) {
          const parent = folder.parentId ? this.findEntity('media_pool_folder', folder.parentId) : rootFolder;
          this.bindEntity({ kind: 'media_pool_folder', exactId: folder.id, label: folder.name, parentHandle: parent?.handle ?? project?.handle ?? null });
        }
        for (const item of inventory.items) {
          const folder = this.findEntity('media_pool_folder', item.folderId);
          this.bindEntity({ kind: 'media_pool_item', exactId: item.id, label: item.name, parentHandle: folder?.handle ?? project?.handle ?? null,
            locator: item.folderName || null });
        }
        this.mediaInventoryInspector = {
          evidenceId: evidence.id,
          value: {
            rootFolderLabel: inventory.rootFolder?.name ?? null,
            currentFolderLabel: inventory.currentFolder?.name ?? null,
            folderCountObserved: inventory.folderCountObserved ?? 0,
            itemsObserved: inventory.itemsObserved ?? 0,
            sourceClipCountObserved: inventory.sourceClipCountObserved ?? 0,
            timelineItemCountObserved: inventory.timelineItemCountObserved ?? 0,
            onlineCountObserved: inventory.onlineCountObserved ?? 0,
            offlineCountObserved: inventory.offlineCountObserved ?? 0,
            onlineUnverifiedCount: inventory.onlineUnverifiedCount ?? 0,
            proxyLinkedCountObserved: inventory.proxyLinkedCountObserved ?? 0,
            proxyAbsentCountObserved: inventory.proxyAbsentCountObserved ?? 0,
            proxyUnverifiedCount: inventory.proxyUnverifiedCount ?? 0,
            resolveTypeCounts: (Array.isArray(inventory.resolveTypeCounts) ? inventory.resolveTypeCounts : [])
              .slice(0, 32)
              .map((entry) => ({ ...entry })),
            motionFrameRateMismatchCount: inventory.motionFrameRateMismatchCount ?? null,
            motionResolutionMismatchCount: inventory.motionResolutionMismatchCount ?? null,
            complete: inventory.complete === true,
            items: inventory.items.flatMap((item) => {
              const entity = this.findEntity('media_pool_item', item.id);
              if (!entity) return [];
              return [{
                semanticHandle: entity.handle,
                generation: entity.generation,
                name: item.name,
                folderLabel: item.folderName ?? '',
                resolveType: item.resolveType ?? null,
                isTimeline: item.isTimeline === true,
                duration: item.duration ?? null,
                fps: item.fps ?? null,
                resolution: item.resolution ? { ...item.resolution } : null,
                videoCodec: item.videoCodec ?? null,
                audioCodec: item.audioCodec ?? null,
                online: item.online ?? null,
                hasProxyMedia: item.hasProxyMedia ?? null
              }];
            })
          }
        };
        this.setFact(changed, 'media.itemsObserved', inventory.itemsObserved, evidence.id, observedAt, project?.handle ?? null);
        this.setFact(changed, 'media.offlineCountObserved', inventory.offlineCountObserved, evidence.id, observedAt, project?.handle ?? null);
      } else if (evidence.workflowId === 'media.inventory_summary.v1') {
        this.mediaInventoryInspector = { evidenceId: evidence.id, value: null };
      }
      const clipDetail = result.clip;
      const clip = clipDetail?.item;
      if (clip && result.requestedItemId) {
        const item = inspectedItem
          ?? this.bindEntity({ kind: 'media_pool_item', exactId: result.requestedItemId, label: clip.name, parentHandle: project?.handle ?? null });
        this.setFact(changed, 'focus.media.online', clip.online, evidence.id, observedAt, item.handle,
          clip.online === null ? 'unknown' : 'observed');
        this.setFact(changed, 'focus.media.proxy', clip.hasProxyMedia, evidence.id, observedAt, item.handle,
          clip.hasProxyMedia === null ? 'unknown' : 'observed');
        this.setFact(changed, 'focus.media.fps', clip.fps, evidence.id, observedAt, item.handle,
          clip.fps === null ? 'unknown' : 'observed');
      }
      const clipTarget = clip && result.requestedItemId
        ? inspectedItem ?? this.findEntity('media_pool_item', result.requestedItemId)
        : inspectedItem;
      if (clipDetail && clipTarget) {
        this.mediaClipInspectors.set(clipTarget.handle, {
          evidenceId: evidence.id,
          value: {
            lookup: clipDetail.lookup,
            search: {
              foldersObserved: clipDetail.search?.foldersObserved ?? 0,
              itemsObserved: clipDetail.search?.itemsObserved ?? 0,
              truncated: clipDetail.search?.truncated === true
            },
            item: clipDetail.item ? {
              semanticHandle: clipTarget.handle,
              generation: clipTarget.generation,
              name: clipDetail.item.name,
              resolveType: clipDetail.item.resolveType ?? null,
              isTimeline: clipDetail.item.isTimeline ?? null,
              duration: clipDetail.item.duration ?? null,
              fps: clipDetail.item.fps ?? null,
              resolution: clipDetail.item.resolution ? { ...clipDetail.item.resolution } : null,
              videoCodec: clipDetail.item.videoCodec ?? null,
              audioCodec: clipDetail.item.audioCodec ?? null,
              audioBitDepth: clipDetail.item.audioBitDepth ?? null,
              audioChannels: clipDetail.item.audioChannels ?? null,
              startTimecode: clipDetail.item.startTimecode ?? null,
              endTimecode: clipDetail.item.endTimecode ?? null,
              online: clipDetail.item.online ?? null,
              hasProxyMedia: clipDetail.item.hasProxyMedia ?? null,
              clipColor: clipDetail.item.clipColor ?? null,
              flags: (Array.isArray(clipDetail.item.flags) ? clipDetail.item.flags : []).slice(0, 32),
              audioMapping: clipDetail.item.audioMapping ? { ...clipDetail.item.audioMapping } : null
            } : null,
            metadata: (Array.isArray(clipDetail.metadata) ? clipDetail.metadata : []).slice(0, 64).map((entry) => ({ ...entry })),
            metadataTruncated: clipDetail.metadataTruncated === true,
            thirdPartyMetadata: (Array.isArray(clipDetail.thirdPartyMetadata) ? clipDetail.thirdPartyMetadata : []).slice(0, 64).map((entry) => ({ ...entry })),
            thirdPartyMetadataTruncated: clipDetail.thirdPartyMetadataTruncated === true,
            markers: (Array.isArray(clipDetail.markers) ? clipDetail.markers : []).slice(0, 64).map((marker) => ({
              frame: marker.frame,
              color: marker.color,
              duration: marker.duration,
              name: marker.name,
              note: marker.note
            })),
            markersTruncated: clipDetail.markersTruncated === true,
            methodEvidence: {
              checkedMethods: (Array.isArray(clipDetail.methodEvidence?.checkedMethods) ? clipDetail.methodEvidence.checkedMethods : []).slice(0, 32),
              observedMethods: (Array.isArray(clipDetail.methodEvidence?.observedMethods) ? clipDetail.methodEvidence.observedMethods : []).slice(0, 32),
              failedMethods: (Array.isArray(clipDetail.methodEvidence?.failedMethods) ? clipDetail.methodEvidence.failedMethods : []).slice(0, 32)
            }
          }
        });
      }
      const linkStatus = result.linkStatus;
      if (linkStatus) {
        const linkValue: AgentMediaLinkInspectorDetail = {
          scope: inspectedItem ? 'item' : 'pool',
          itemHandle: inspectedItem?.handle ?? null,
          itemLookup: linkStatus.itemLookup ?? 'unverified',
          methodEvidence: {
            mediaPoolProbed: linkStatus.methodEvidence?.mediaPool?.probed === true,
            mediaPoolItemProbed: linkStatus.methodEvidence?.mediaPoolItem?.probed === true
          },
          capabilities: (Array.isArray(linkStatus.capabilities) ? linkStatus.capabilities : []).slice(0, 16).map((capability) => ({
            id: capability.id,
            surface: capability.surface
          }))
        };
        if (inspectedItem) {
          this.mediaLinkInspectors.set(inspectedItem.handle, { evidenceId: evidence.id, value: linkValue });
        } else {
          this.mediaPoolLinkInspector = { evidenceId: evidence.id, value: linkValue };
        }
      }
    } else if (result.target === 'edit') {
      const summary = result.summary;
      if (summary && timeline) {
        this.setFact(changed, 'timeline.itemCountObserved', summary.timelineItemCountObserved, evidence.id, observedAt, timeline.handle);
        this.setFact(changed, 'timeline.markerCount', summary.markerCount, evidence.id, observedAt, timeline.handle);
        this.editTimelineInspector = {
          evidenceId: evidence.id,
          value: {
            timeline: {
              semanticHandle: timeline.handle,
              generation: timeline.generation,
              name: summary.timeline.name,
              startFrame: summary.timeline.startFrame ?? null,
              endFrame: summary.timeline.endFrame ?? null,
              durationFrames: summary.timeline.durationFrames ?? null,
              startTimecode: summary.timeline.startTimecode ?? null,
              frameRate: summary.timeline.frameRate ?? null
            },
            trackCounts: summary.trackCounts ? { ...summary.trackCounts } : { video: 0, audio: 0, subtitle: 0 },
            timelineItemCountObserved: summary.timelineItemCountObserved ?? 0,
            itemsScannedForSourceState: summary.itemsScannedForSourceState ?? 0,
            markerCount: summary.markerCount ?? 0,
            subtitleItemCount: summary.subtitleItemCount ?? 0,
            offlineSourceItemCountObserved: summary.offlineSourceItemCountObserved ?? 0,
            onlineStateUnverifiedItemCountObserved: summary.onlineStateUnverifiedItemCountObserved ?? 0,
            itemsWithoutMediaPoolReferenceCountObserved: summary.itemsWithoutMediaPoolReferenceCountObserved ?? 0,
            tracks: (Array.isArray(summary.tracks) ? summary.tracks : []).slice(0, 64).map((track) => ({ ...track })),
            complete: summary.complete === true
          }
        };
      } else if (evidence.workflowId === 'edit.timeline_summary.v1') {
        this.editTimelineInspector = null;
      }
      if (result.structure && timeline) {
        for (const track of result.structure.tracks) {
          for (const item of track.items) {
            this.bindEntity({
              kind: 'timeline_item',
              exactId: item.id,
              label: item.name,
              parentHandle: timeline.handle,
              locator: `${track.type[0]?.toUpperCase() ?? 'T'}${track.index}`
            });
          }
        }
        let projectedItems = 0;
        this.editStructureInspector = {
          evidenceId: evidence.id,
          value: {
            timelineHandle: timeline.handle,
            generation: timeline.generation,
            tracksObserved: result.structure.tracksObserved ?? 0,
            itemsObserved: result.structure.itemsObserved ?? 0,
            methodEvidence: {
              checkedMethodCount: Array.isArray(result.structure.methodEvidence?.checkedMethods) ? result.structure.methodEvidence.checkedMethods.length : 0,
              fullyObservedMethodCount: Array.isArray(result.structure.methodEvidence?.fullyObservedMethods) ? result.structure.methodEvidence.fullyObservedMethods.length : 0,
              failedMethodCount: Array.isArray(result.structure.methodEvidence?.failedMethods) ? result.structure.methodEvidence.failedMethods.length : 0
            },
            tracks: (Array.isArray(result.structure.tracks) ? result.structure.tracks : []).slice(0, 64).map((track) => ({
              type: track.type,
              index: track.index,
              items: (Array.isArray(track.items) ? track.items : []).flatMap((item) => {
                if (projectedItems >= 2000) return [];
                const entity = this.findEntity('timeline_item', item.id);
                if (!entity) return [];
                projectedItems += 1;
                return [{
                  semanticHandle: entity.handle,
                  generation: entity.generation,
                  name: item.name,
                  recordStart: item.recordStart,
                  recordEnd: item.recordEnd,
                  duration: item.duration,
                  sourceStart: item.sourceStart,
                  sourceEnd: item.sourceEnd,
                  mediaPoolHandle: item.mediaPoolItemId
                    ? this.findEntity('media_pool_item', item.mediaPoolItemId)?.handle ?? null
                    : null
                }];
              })
            }))
          }
        };
      } else if (evidence.workflowId === 'edit.structure_inspect.v1') {
        this.editStructureInspector = null;
      }
      if (result.gapsOverlaps && timeline) {
        this.setFact(changed, 'timeline.gapsObserved', result.gapsOverlaps.gapCountObserved, evidence.id, observedAt, timeline.handle);
        this.setFact(changed, 'timeline.overlapsObserved', result.gapsOverlaps.overlapCountObserved, evidence.id, observedAt, timeline.handle);
        this.editGapsInspector = {
          evidenceId: evidence.id,
          value: {
            adjacentPairsObserved: result.gapsOverlaps.adjacentPairsObserved ?? 0,
            comparablePairsObserved: result.gapsOverlaps.comparablePairsObserved ?? 0,
            unverifiedTrackCount: result.gapsOverlaps.unverifiedTrackCount ?? 0,
            gapCountObserved: result.gapsOverlaps.gapCountObserved ?? 0,
            overlapCountObserved: result.gapsOverlaps.overlapCountObserved ?? 0,
            boundaryAmbiguousCountObserved: result.gapsOverlaps.boundaryAmbiguousCountObserved ?? 0,
            relationships: (Array.isArray(result.gapsOverlaps.relationships) ? result.gapsOverlaps.relationships : []).slice(0, 256).map((relationship) => {
              const left = this.findEntity('timeline_item', relationship.leftItem.id)
                ?? this.bindEntity({
                  kind: 'timeline_item', exactId: relationship.leftItem.id, label: relationship.leftItem.name,
                  parentHandle: timeline.handle, locator: `${relationship.trackType[0]?.toUpperCase() ?? 'T'}${relationship.trackIndex}`
                });
              const right = this.findEntity('timeline_item', relationship.rightItem.id)
                ?? this.bindEntity({
                  kind: 'timeline_item', exactId: relationship.rightItem.id, label: relationship.rightItem.name,
                  parentHandle: timeline.handle, locator: `${relationship.trackType[0]?.toUpperCase() ?? 'T'}${relationship.trackIndex}`
                });
              return {
                kind: relationship.kind,
                trackType: relationship.trackType,
                trackIndex: relationship.trackIndex,
                leftItem: { semanticHandle: left.handle, name: relationship.leftItem.name },
                rightItem: { semanticHandle: right.handle, name: relationship.rightItem.name },
                boundaryDelta: relationship.boundaryDelta
              };
            })
          }
        };
      } else if (evidence.workflowId === 'edit.gaps_overlaps.v1') {
        this.editGapsInspector = null;
      }
      if (result.sourceRanges && timeline) {
        this.editSourceRangesInspector = {
          evidenceId: evidence.id,
          value: {
            itemsObserved: result.sourceRanges.itemsObserved ?? 0,
            itemsReported: result.sourceRanges.itemsReported ?? 0,
            itemsWithMediaPoolReference: result.sourceRanges.itemsWithMediaPoolReference ?? 0,
            itemsWithCompleteRecordGetterValues: result.sourceRanges.itemsWithCompleteRecordGetterValues ?? 0,
            itemsWithCompleteSourceGetterValues: result.sourceRanges.itemsWithCompleteSourceGetterValues ?? 0,
            items: (Array.isArray(result.sourceRanges.items) ? result.sourceRanges.items : []).slice(0, 2000).map((item) => {
              const entity = this.findEntity('timeline_item', item.timelineItemId)
                ?? this.bindEntity({
                  kind: 'timeline_item', exactId: item.timelineItemId, label: item.name,
                  parentHandle: timeline.handle, locator: `${item.trackType[0]?.toUpperCase() ?? 'T'}${item.trackIndex}`
                });
              return {
                trackType: item.trackType,
                trackIndex: item.trackIndex,
                semanticHandle: entity.handle,
                name: item.name,
                mediaPoolHandle: item.mediaPoolItemId
                  ? this.findEntity('media_pool_item', item.mediaPoolItemId)?.handle ?? null
                  : null,
                recordStartGetterValue: item.recordStartGetterValue,
                recordEndGetterValue: item.recordEndGetterValue,
                durationGetterValue: item.durationGetterValue,
                sourceStartFrameGetterValue: item.sourceStartFrameGetterValue,
                sourceEndFrameGetterValue: item.sourceEndFrameGetterValue
              };
            })
          }
        };
      } else if (evidence.workflowId === 'edit.source_range_report.v1') {
        this.editSourceRangesInspector = null;
      }
      if (result.transitions && timeline) {
        const fullyObservedMethods = Array.isArray(result.transitions.methodEvidence?.fullyObservedMethods)
          ? result.transitions.methodEvidence.fullyObservedMethods
          : [];
        this.editTransitionsInspector = {
          evidenceId: evidence.id,
          value: {
            itemsObserved: result.transitions.itemsObserved ?? 0,
            itemsReported: result.transitions.itemsReported ?? 0,
            getFadesReadbackObservedCount: result.transitions.getFadesReadbackObservedCount ?? 0,
            addTransitionSurfaceObserved: fullyObservedMethods.includes('AddTransition'),
            setFadesSurfaceObserved: fullyObservedMethods.includes('SetFades'),
            items: (Array.isArray(result.transitions.items) ? result.transitions.items : []).slice(0, 2000).map((item) => {
              const entity = this.findEntity('timeline_item', item.timelineItemId)
                ?? this.bindEntity({
                  kind: 'timeline_item', exactId: item.timelineItemId, label: item.name,
                  parentHandle: timeline.handle, locator: `${item.trackType[0]?.toUpperCase() ?? 'T'}${item.trackIndex}`
                });
              return {
                trackType: item.trackType,
                trackIndex: item.trackIndex,
                semanticHandle: entity.handle,
                name: item.name,
                fadeInGetterValue: item.fadeInGetterValue,
                fadeOutGetterValue: item.fadeOutGetterValue,
                getFadesReadback: item.getFadesReadback
              };
            })
          }
        };
      } else if (evidence.workflowId === 'edit.transition_inspect.v1') {
        this.editTransitionsInspector = null;
      }
      if (result.annotations && timeline) {
        for (const item of Array.isArray(result.annotations.mediaPoolAnnotations) ? result.annotations.mediaPoolAnnotations : []) {
          this.bindEntity({
            kind: 'media_pool_item', exactId: item.mediaPoolItemId, label: item.name, parentHandle: project?.handle ?? null
          });
        }
        const markerRows = (Array.isArray(result.annotations.markers) ? result.annotations.markers : []).slice(0, 256).map((marker) => {
          let targetHandle: string | null = null;
          if (marker.scope === 'timeline') {
            targetHandle = timeline.handle;
          } else if (marker.scope === 'timeline_item') {
            targetHandle = (this.findEntity('timeline_item', marker.targetId)
              ?? this.bindEntity({
                kind: 'timeline_item', exactId: marker.targetId, label: marker.targetName,
                parentHandle: timeline.handle,
                locator: marker.trackType && marker.trackIndex !== null
                  ? `${marker.trackType[0]?.toUpperCase() ?? 'T'}${marker.trackIndex}`
                  : null
              })).handle;
          } else if (marker.scope === 'media_pool_item') {
            targetHandle = (this.findEntity('media_pool_item', marker.targetId)
              ?? this.bindEntity({
                kind: 'media_pool_item', exactId: marker.targetId, label: marker.targetName, parentHandle: project?.handle ?? null
              })).handle;
          }
          return {
            scope: marker.scope,
            targetHandle,
            targetName: marker.targetName,
            trackType: marker.trackType,
            trackIndex: marker.trackIndex,
            frame: marker.frame,
            color: marker.color,
            duration: marker.duration,
            name: marker.name,
            note: marker.note
          };
        });
        const timelineMethods = result.annotations.methodEvidence?.timeline;
        const itemMethods = result.annotations.methodEvidence?.timelineItem;
        const mediaMethods = result.annotations.methodEvidence?.mediaPoolItem;
        const methodCounts = (entry: {
          checkedMethods?: string[];
          observedMethods?: string[];
          fullyObservedMethods?: string[];
          missingMethods?: string[];
          failedMethods?: string[];
        } | undefined): { observed: number; checked: number; missing: number; failed: number } => ({
          observed: Array.isArray(entry?.fullyObservedMethods)
            ? entry.fullyObservedMethods.length
            : Array.isArray(entry?.observedMethods) ? entry.observedMethods.length : 0,
          checked: Array.isArray(entry?.checkedMethods) ? entry.checkedMethods.length : 0,
          missing: Array.isArray(entry?.missingMethods) ? entry.missingMethods.length : 0,
          failed: Array.isArray(entry?.failedMethods) ? entry.failedMethods.length : 0
        });
        this.editAnnotationsInspector = {
          evidenceId: evidence.id,
          value: {
            timelineLabel: result.annotations.timeline?.name ?? timeline.label,
            timelineMarkerCountObserved: result.annotations.timelineMarkerCountObserved ?? 0,
            timelineItemMarkerCountObserved: result.annotations.timelineItemMarkerCountObserved ?? 0,
            mediaPoolMarkerCountObserved: result.annotations.mediaPoolMarkerCountObserved ?? 0,
            flaggedMediaPoolItemCountObserved: result.annotations.flaggedMediaPoolItemCountObserved ?? 0,
            coloredMediaPoolItemCountObserved: result.annotations.coloredMediaPoolItemCountObserved ?? 0,
            tracksTruncated: result.annotations.tracksTruncated === true,
            itemsTruncated: result.annotations.itemsTruncated === true,
            markerRowsTruncated: result.annotations.markerRowsTruncated === true,
            complete: result.annotations.complete === true,
            unverified: (Array.isArray(result.annotations.unverified) ? result.annotations.unverified : []).slice(0, 32),
            methodEvidence: {
              timeline: methodCounts(timelineMethods),
              timelineItem: methodCounts(itemMethods),
              mediaPoolItem: methodCounts(mediaMethods)
            },
            markers: markerRows,
            mediaPoolAnnotations: (Array.isArray(result.annotations.mediaPoolAnnotations) ? result.annotations.mediaPoolAnnotations : []).slice(0, 256).flatMap((item) => {
              const entity = this.findEntity('media_pool_item', item.mediaPoolItemId);
              if (!entity) return [];
              return [{
                semanticHandle: entity.handle,
                name: item.name,
                flags: (Array.isArray(item.flags) ? item.flags : []).slice(0, 32),
                flagsTruncated: item.flagsTruncated === true,
                clipColor: item.clipColor,
                markerCountObserved: item.markerCountObserved ?? 0
              }];
            })
          }
        };
      } else if (evidence.workflowId === 'edit.review_annotations_inspect.v1') {
        this.editAnnotationsInspector = null;
      }
    } else if (result.target === 'fusion' && timeline) {
      const summary = result.summary;
      if (summary) {
        this.setFact(changed, 'fusion.compositionsObserved', summary.items.reduce((sum, item) => sum + (item.compositionCountObserved ?? 0), 0), evidence.id, observedAt, timeline.handle);
        for (const item of summary.items) {
          if (item.id) this.bindEntity({ kind: 'timeline_item', exactId: item.id, label: item.name ?? 'Timeline Item', parentHandle: timeline.handle,
            locator: `V${item.trackIndex}` });
        }
        this.fusionCompositionInspector = {
          evidenceId: evidence.id,
          value: {
            timeline: { semanticHandle: timeline.handle, generation: timeline.generation, name: summary.timeline.name },
            videoTrackCount: summary.videoTrackCount,
            tracksScanned: summary.tracksScanned,
            videoItemsObserved: summary.videoItemsObserved,
            itemsReported: summary.itemsReported,
            tracksTruncated: summary.tracksTruncated,
            itemsTruncated: summary.itemsTruncated,
            namesTruncated: summary.namesTruncated,
            complete: summary.complete,
            methodEvidence: {
              checkedMethodCount: summary.methodEvidence.checkedMethods.length,
              fullyObservedMethodCount: summary.methodEvidence.fullyObservedMethods.length,
              missingMethodCount: summary.methodEvidence.missingMethods.length,
              failedMethodCount: summary.methodEvidence.failedMethods.length
            },
            unverified: summary.unverified.slice(0, 32),
            items: summary.items.slice(0, 2000).map((item) => {
              const entity = item.id ? this.findEntity('timeline_item', item.id) : null;
              return {
                trackIndex: item.trackIndex,
                semanticHandle: entity?.handle ?? null,
                generation: entity?.generation ?? null,
                name: item.name,
                compositionCountObserved: item.compositionCountObserved,
                compositionNames: item.compositionNames.slice(0, 64)
              };
            })
          }
        };
      } else if (evidence.workflowId === 'fusion.composition_inspect.v1') {
        this.fusionCompositionInspector = null;
      }
      const graph = result.graph;
      if (graph) {
        for (const composition of graph.compositions) {
          this.bindEntity({
            kind: 'timeline_item',
            exactId: composition.timelineItemId,
            label: composition.timelineItemName,
            parentHandle: timeline.handle,
            locator: `V${composition.trackIndex}`
          });
        }
        let projectedTools = 0;
        let projectedConnections = 0;
        this.fusionGraphInspector = {
          evidenceId: evidence.id,
          value: {
            timeline: { semanticHandle: timeline.handle, generation: timeline.generation, name: graph.timeline.name },
            compositionsObserved: graph.compositionsObserved,
            compositionsReported: graph.compositionsReported,
            toolsObserved: graph.toolsObserved,
            toolsReported: graph.toolsReported,
            edgesObserved: graph.edgesObserved,
            edgesReported: graph.edgesReported,
            tracksTruncated: graph.tracksTruncated,
            itemsTruncated: graph.itemsTruncated,
            compositionsTruncated: graph.compositionsTruncated,
            toolsTruncated: graph.toolsTruncated,
            portsTruncated: graph.portsTruncated,
            edgesTruncated: graph.edgesTruncated,
            complete: graph.complete,
            methodEvidence: {
              checkedMethodCount: graph.methodEvidence.checkedMethods.length,
              failedMethodCount: graph.methodEvidence.failedMethods.length
            },
            unverified: graph.unverified.slice(0, 32),
            compositions: graph.compositions.slice(0, 128).map((composition) => ({
              compositionName: composition.compositionName,
              tools: composition.tools.flatMap((tool) => {
                if (projectedTools >= 512) return [];
                projectedTools += 1;
                const connections = composition.edges.flatMap((edge) => {
                  if (projectedConnections >= 4096 || edge.sourceToolName !== tool.name || edge.sourceToolId !== tool.id) return [];
                  projectedConnections += 1;
                  return [{
                    targetToolName: edge.targetToolName,
                    bidirectionalReadback: edge.bidirectionalReadback
                  }];
                });
                return [{
                  name: tool.name,
                  inputCountObserved: tool.inputCountObserved,
                  outputCountObserved: tool.outputCountObserved,
                  connections
                }];
              })
            }))
          }
        };
      } else if (evidence.workflowId === 'fusion.graph_inspect.v1') {
        this.fusionGraphInspector = null;
      }
    } else if (result.target === 'color' && timeline) {
      const summary = result.summary;
      if (summary) {
        this.setFact(changed, 'color.nodesObserved', summary.nodeCountObserved, evidence.id, observedAt, timeline.handle);
        for (const item of summary.items) {
          this.bindEntity({ kind: 'timeline_item', exactId: item.id, label: item.name, parentHandle: timeline.handle });
        }
        this.colorPipelineInspector = {
          evidenceId: evidence.id,
          value: {
            settings: summary.settings ? {
              colorScienceMode: summary.settings.colorScienceMode,
              inputColorSpace: summary.settings.inputColorSpace,
              inputGamma: summary.settings.inputGamma,
              timelineColorSpace: summary.settings.timelineColorSpace,
              timelineGamma: summary.settings.timelineGamma,
              outputColorSpace: summary.settings.outputColorSpace,
              outputGamma: summary.settings.outputGamma,
              outputToneMapping: summary.settings.outputToneMapping,
              outputGamutMapping: summary.settings.outputGamutMapping
            } : null,
            colorGroupCount: summary.colorGroupCount,
            videoItemCountObserved: summary.videoItemCountObserved,
            videoItemsScanned: summary.videoItemsScanned,
            nodeCountObserved: summary.nodeCountObserved,
            lutReferenceCountObserved: summary.lutReferenceCountObserved,
            complete: summary.complete === true,
            items: summary.items.slice(0, 2000).map((item) => ({
              name: item.name,
              groupName: item.groupName,
              currentVersionName: item.currentVersionName,
              nodeCount: item.nodeCount,
              lutReferenceCount: item.lutReferenceCount,
              localVersionCount: item.localVersionCount,
              remoteVersionCount: item.remoteVersionCount
            }))
          }
        };
      } else if (evidence.workflowId === 'color.pipeline_inspect.v1') {
        this.colorPipelineInspector = { evidenceId: evidence.id, value: null };
      }
      if (result.graph) {
        const mapScope = (scope: typeof result.graph.timelineGraph): AgentColorGraphScopeDetail => {
          const item = scope.timelineItemId && scope.timelineItemName
            ? this.findEntity('timeline_item', scope.timelineItemId)
              ?? this.bindEntity({
                kind: 'timeline_item',
                exactId: scope.timelineItemId,
                label: scope.timelineItemName,
                parentHandle: timeline.handle,
                locator: scope.trackIndex ? `V${scope.trackIndex}` : null
              })
            : null;
          return {
            scope: scope.scope,
            trackIndex: scope.trackIndex,
            layerIndex: scope.layerIndex,
            timelineItemHandle: item?.handle ?? null,
            timelineItemName: scope.timelineItemName,
            colorGroupName: scope.colorGroupName,
            graphAccess: scope.graphAccess,
            nodeCountObserved: scope.nodeCountObserved,
            nodes: scope.nodes.slice(0, 2048).map((node, nodeOrdinal) => ({
              ordinal: nodeOrdinal + 1,
              label: node.label,
              lutReferencePresent: node.lutReferencePresent,
              cacheMode: node.cacheMode,
              cacheModeShape: node.cacheModeShape,
              toolNames: node.toolNames.slice(0, 64),
              toolListShape: node.toolListShape
            }))
          };
        };
        for (const item of result.graph.itemGraphs) {
          if (!item.timelineItemId || !item.timelineItemName) continue;
          this.bindEntity({
            kind: 'timeline_item',
            exactId: item.timelineItemId,
            label: item.timelineItemName,
            parentHandle: timeline.handle,
            locator: item.trackIndex ? `V${item.trackIndex}` : null
          });
        }
        this.colorGraphInspector = {
          evidenceId: evidence.id,
          value: {
            timelineLabel: result.graph.timeline.name,
            nodeStackLayersReadback: result.graph.nodeStackLayersReadback,
            nodeStackLayersConfigured: result.graph.nodeStackLayersConfigured,
            nodeStackLayersScanned: result.graph.nodeStackLayersScanned,
            layersTruncated: result.graph.layersTruncated === true,
            videoTrackCount: result.graph.videoTrackCount,
            tracksScanned: result.graph.tracksScanned,
            videoItemsObserved: result.graph.videoItemsObserved,
            itemsScanned: result.graph.itemsScanned,
            colorGroupsReadback: result.graph.colorGroupsReadback,
            colorGroupCountObserved: result.graph.colorGroupCountObserved,
            colorGroupsScanned: result.graph.colorGroupsScanned,
            colorGroupsTruncated: result.graph.colorGroupsTruncated === true,
            graphsObserved: result.graph.graphsObserved,
            nodesObserved: result.graph.nodesObserved,
            nodesReported: result.graph.nodesReported,
            tracksTruncated: result.graph.tracksTruncated === true,
            itemsTruncated: result.graph.itemsTruncated === true,
            nodesTruncated: result.graph.nodesTruncated === true,
            toolsTruncated: result.graph.toolsTruncated === true,
            complete: result.graph.complete === true,
            methodEvidence: {
              checkedMethodCount: result.graph.methodEvidence.checkedMethods.length,
              fullyObservedMethodCount: result.graph.methodEvidence.fullyObservedMethods.length,
              missingMethodCount: result.graph.methodEvidence.missingMethods.length,
              failedMethodCount: result.graph.methodEvidence.failedMethods.length
            },
            unverified: result.graph.unverified.slice(0, 16),
            timelineGraph: mapScope(result.graph.timelineGraph),
            itemGraphs: result.graph.itemGraphs.slice(0, 2000).map(mapScope),
            colorGroupGraphs: result.graph.colorGroupGraphs.slice(0, 64).map(mapScope)
          }
        };
      } else if (evidence.workflowId === 'color.graph_inventory.v1') {
        this.colorGraphInspector = { evidenceId: evidence.id, value: null };
      }
      if (result.versions) {
        const items: NonNullable<AgentColorInspectorDetail['versions']>['items'] = [];
        for (const item of result.versions.items) {
          const entity = this.bindEntity({
            kind: 'timeline_item',
            exactId: item.timelineItemId,
            label: item.timelineItemName,
            parentHandle: timeline.handle,
            locator: `V${item.trackIndex}`
          });
          if (items.length >= 2000) continue;
          items.push({
            trackIndex: item.trackIndex,
            timelineItemHandle: entity.handle,
            timelineItemName: item.timelineItemName,
            currentReadback: item.currentReadback,
            currentVersion: item.currentVersion ? { ...item.currentVersion } : null,
            localReadback: item.localReadback,
            localVersions: item.localVersions.slice(0, 64),
            remoteReadback: item.remoteReadback,
            remoteVersions: item.remoteVersions.slice(0, 64)
          });
        }
        this.colorVersionsInspector = {
          evidenceId: evidence.id,
          value: {
            timelineLabel: result.versions.timeline.name,
            videoTrackCount: result.versions.videoTrackCount,
            tracksScanned: result.versions.tracksScanned,
            videoItemsObserved: result.versions.videoItemsObserved,
            itemsScanned: result.versions.itemsScanned,
            tracksTruncated: result.versions.tracksTruncated === true,
            itemsTruncated: result.versions.itemsTruncated === true,
            versionNamesTruncated: result.versions.versionNamesTruncated === true,
            complete: result.versions.complete === true,
            methodEvidence: {
              checkedMethodCount: result.versions.methodEvidence.checkedMethods.length,
              fullyObservedMethodCount: result.versions.methodEvidence.fullyObservedMethods.length,
              missingMethodCount: result.versions.methodEvidence.missingMethods.length,
              failedMethodCount: result.versions.methodEvidence.failedMethods.length
            },
            unverified: result.versions.unverified.slice(0, 16),
            items
          }
        };
      } else if (evidence.workflowId === 'color.grade_version_inspect.v1') {
        this.colorVersionsInspector = { evidenceId: evidence.id, value: null };
      }
    } else if (result.target === 'fairlight' && timeline) {
      const summary = result.summary;
      if (summary) {
        this.setFact(changed, 'fairlight.audioTracks', summary.audioTrackCount, evidence.id, observedAt, timeline.handle);
        this.fairlightMappingInspector = {
          evidenceId: evidence.id,
          value: {
            timelineLabel: summary.timeline.name,
            audioTrackCount: summary.audioTrackCount,
            audioItemCountObserved: summary.audioItemCountObserved,
            itemsScanned: summary.itemsScanned,
            sourceMappingVerifiedItemCount: summary.sourceMappingVerifiedItemCount,
            sourceMappingUnverifiedItemCount: summary.sourceMappingUnverifiedItemCount,
            complete: summary.complete === true,
            tracksTruncated: summary.tracksTruncated === true,
            itemsTruncated: summary.itemsTruncated === true,
            unverified: (Array.isArray(summary.unverified) ? summary.unverified : []).slice(0, 16),
            tracks: (Array.isArray(summary.tracks) ? summary.tracks : []).slice(0, 64).map((track) => ({
              index: track.index,
              name: track.name,
              subType: track.subType,
              enabled: track.enabled,
              locked: track.locked,
              voiceIsolation: track.voiceIsolation ? { ...track.voiceIsolation } : null,
              sourceMappingVerifiedItemCount: track.sourceMappingVerifiedItemCount,
              sourceMappingUnverifiedItemCount: track.sourceMappingUnverifiedItemCount
            }))
          }
        };
      } else if (evidence.workflowId === 'fairlight.mapping_inspect.v1') {
        this.fairlightMappingInspector = { evidenceId: evidence.id, value: null };
      }
      if (result.clipProcessing) {
        const projectedItems: NonNullable<AgentFairlightInspectorDetail['processing']>['items'] = [];
        for (const item of result.clipProcessing.items) {
          const entity = this.bindEntity({
            kind: 'timeline_item',
            exactId: item.timelineItemId,
            label: item.timelineItemName,
            parentHandle: timeline.handle,
            locator: `A${item.trackIndex}`
          });
          if (projectedItems.length >= 2000) continue;
          projectedItems.push({
            trackIndex: item.trackIndex,
            semanticHandle: entity.handle,
            name: item.timelineItemName,
            volumeEnabled: item.volumeEnabled,
            volumeDb: item.volumeDb,
            panEnabled: item.panEnabled,
            pan: item.pan,
            pitchEnabled: item.pitchEnabled,
            pitchSemitones: item.pitchSemitones,
            pitchCents: item.pitchCents,
            voiceIsolationEnabled: item.voiceIsolationEnabled,
            voiceIsolationAmount: item.voiceIsolationAmount,
            dialogueLevelerEnabled: item.dialogueLevelerEnabled,
            dialogueLevelerMode: item.dialogueLevelerMode,
            dialogueReduceLoud: item.dialogueReduceLoud,
            dialogueLiftSoft: item.dialogueLiftSoft,
            dialogueBackgroundReduction: item.dialogueBackgroundReduction,
            dialogueOutputGainDb: item.dialogueOutputGainDb,
            voiceConsistency: item.voiceConsistency
          });
        }
        this.fairlightProcessingInspector = {
          evidenceId: evidence.id,
          value: {
            timelineLabel: result.clipProcessing.timeline.name,
            audioTrackCount: result.clipProcessing.audioTrackCount,
            tracksScanned: result.clipProcessing.tracksScanned,
            audioItemsObserved: result.clipProcessing.audioItemsObserved,
            itemsScanned: result.clipProcessing.itemsScanned,
            tracksTruncated: result.clipProcessing.tracksTruncated === true,
            itemsTruncated: result.clipProcessing.itemsTruncated === true,
            complete: result.clipProcessing.complete === true,
            methodEvidence: {
              checkedMethodCount: result.clipProcessing.methodEvidence.checkedMethods.length,
              fullyObservedMethodCount: result.clipProcessing.methodEvidence.fullyObservedMethods.length,
              missingMethodCount: result.clipProcessing.methodEvidence.missingMethods.length,
              failedMethodCount: result.clipProcessing.methodEvidence.failedMethods.length
            },
            unverified: (Array.isArray(result.clipProcessing.unverified) ? result.clipProcessing.unverified : []).slice(0, 16),
            items: projectedItems
          }
        };
      } else if (evidence.workflowId === 'fairlight.clip_processing_inspect.v1') {
        this.fairlightProcessingInspector = { evidenceId: evidence.id, value: null };
      }
    } else if (result.target === 'deliver') {
      const capabilities = result.capabilities;
      const settings = result.settings;
      const videoFormats = capabilities?.videoFormats ?? [];
      const audioFormats = capabilities?.audioFormats ?? [];
      this.deliverCapabilitiesInspector = {
        evidenceId: evidence.id,
        value: capabilities ? {
          videoFormatCount: capabilities.videoFormatCount,
          videoCodecCountObserved: capabilities.videoCodecCountObserved,
          audioFormatCount: capabilities.audioFormatCount,
          audioCodecCountObserved: capabilities.audioCodecCountObserved,
          generalResolutions: capabilities.generalResolutions.slice(0, 64).map((resolution) => ({ ...resolution })),
          currentSelection: capabilities.currentSelection ? {
            format: deliverFormatRow(videoFormats, capabilities.currentSelection.format)?.name
              ?? deliverFormatRow(audioFormats, capabilities.currentSelection.format)?.name
              ?? null,
            codec: deliverCodecDisplayName(videoFormats, capabilities.currentSelection.format, capabilities.currentSelection.codec)
              ?? deliverCodecDisplayName(audioFormats, capabilities.currentSelection.format, capabilities.currentSelection.codec),
            resolutionCount: capabilities.currentSelection.resolutionCount
          } : null,
          renderPresetCount: capabilities.renderPresetCount,
          renderPresets: capabilities.renderPresets.slice(0, 64),
          quickExportPresetCount: capabilities.quickExportPresetCount,
          quickExportPresets: capabilities.quickExportPresets.slice(0, 64),
          complete: capabilities.complete === true,
          videoFormats: capabilities.videoFormats.slice(0, 64).map((format) => ({
            name: format.name,
            extension: format.extension,
            codecCount: format.codecCount,
            codecs: format.codecs.slice(0, 64).map((codec) => codec.name)
          }))
        } : null
      };
      if (settings) {
        this.setFact(changed, 'deliver.rendering', settings.renderingInProgress, evidence.id, observedAt, project?.handle ?? null,
          settings.renderingInProgress === null ? 'unknown' : 'observed');
        this.setFact(changed, 'deliver.jobsObserved', settings.renderJobCountObserved, evidence.id, observedAt, project?.handle ?? null);
        const jobs: NonNullable<AgentDeliverInspectorDetail['settings']>['jobs'] = [];
        for (const job of settings.renderJobs) {
          if (!job.id) continue;
          const entity = this.bindEntity({ kind: 'render_job', exactId: job.id, label: job.name ?? 'Render Job', parentHandle: project?.handle ?? null });
          if (jobs.length >= 64) continue;
          const videoFormat = deliverFormatRow(videoFormats, job.videoFormat)?.name ?? null;
          jobs.push({
            semanticHandle: entity.handle,
            name: job.name,
            timelineName: job.timelineName,
            status: job.status,
            outputResolution: job.outputResolution ? { ...job.outputResolution } : null,
            videoFormat,
            videoCodec: deliverCodecDisplayName(videoFormats, job.videoFormat, job.videoCodec),
            audioCodec: deliverCodecDisplayName(audioFormats, null, job.audioCodec)
          });
        }
        this.deliverSettingsInspector = {
          evidenceId: evidence.id,
          value: {
            currentFormat: deliverFormatRow(videoFormats, settings.currentFormat)?.name
              ?? deliverFormatRow(audioFormats, settings.currentFormat)?.name
              ?? null,
            currentCodec: deliverCodecDisplayName(videoFormats, settings.currentFormat, settings.currentCodec)
              ?? deliverCodecDisplayName(audioFormats, settings.currentFormat, settings.currentCodec),
            renderMode: settings.renderMode,
            renderingInProgress: settings.renderingInProgress,
            renderJobCountObserved: settings.renderJobCountObserved,
            jobsTruncated: settings.jobsTruncated === true,
            jobs
          }
        };
      } else {
        this.deliverSettingsInspector = { evidenceId: evidence.id, value: null };
      }
    } else if (result.target === 'preflight') {
      this.setFact(
        changed,
        `project.preflight.${result.preflight.profile}.status`,
        result.preflight.status,
        evidence.id,
        observedAt,
        project?.handle ?? null
      );
      if (result.preflight.profile === 'general') {
        this.projectInspectorPreflight = {
          evidenceId: evidence.id,
          value: {
            status: result.preflight.status,
            projectLabel: result.preflight.project?.name ?? null,
            timelineLabel: result.preflight.timeline?.name ?? null,
            checks: (Array.isArray(result.preflight.checks) ? result.preflight.checks : []).slice(0, 16).map((check) => ({
              id: check.id,
              status: check.status,
              issueCodes: (Array.isArray(check.issueCodes) ? check.issueCodes : []).slice(0, 16)
            })),
            blockers: (Array.isArray(result.preflight.blockers) ? result.preflight.blockers : []).slice(0, 32),
            warnings: (Array.isArray(result.preflight.warnings) ? result.preflight.warnings : []).slice(0, 32),
            capabilityGaps: (Array.isArray(result.preflight.capabilityGaps) ? result.preflight.capabilityGaps : []).slice(0, 32),
            capabilityEvidence: (Array.isArray(result.preflight.capabilityEvidence) ? result.preflight.capabilityEvidence : []).slice(0, 32).map((item) => ({
              capabilityId: item.capabilityId,
              evidenceSource: item.evidenceSource,
              status: item.status,
              limitations: (Array.isArray(item.limitations) ? item.limitations : []).slice(0, 8)
            }))
          }
        };
      }
    }

    this.lastObservedAt = Math.max(this.lastObservedAt, observedAt);
    this.revision += 1;
    const invalidatedFactKeys = this.retireUnsupportedFacts();
    this.deltas.push({
      revision: this.revision,
      generation: this.generation,
      observedAt,
      reason: `Protected ${result.target} observation`,
      changedFactKeys: [...changed],
      invalidatedFactKeys,
      evidenceIds: [evidence.id]
    });
    if (this.deltas.length > MAX_DELTAS) this.deltas.splice(0, this.deltas.length - MAX_DELTAS);
  }

  observe(observation: ToolKernelObservation): void {
    const envelope = protectedEnvelope(observation.result);
    if (!envelope) return;
    if (observation.name === 'status') {
      const status = objectValue(envelope.result);
      if (!status) return;
      const observedAt = Date.now();
      const evidence = this.evidenceRef(envelope.operation, observedAt);
      const changed = new Set<string>();
      const running = status['running'];
      const version = status['version'];
      this.setFact(changed, 'resolve.running', typeof running === 'boolean' ? running : null, evidence.id, observedAt,
        null, typeof running === 'boolean' ? 'observed' : 'unknown');
      this.setFact(changed, 'resolve.version', typeof version === 'string' ? version : null, evidence.id, observedAt,
        null, typeof version === 'string' ? 'observed' : 'unknown');
      this.lastObservedAt = observedAt;
      this.revision += 1;
      const invalidatedFactKeys = this.retireUnsupportedFacts();
      this.deltas.push({
        revision: this.revision,
        generation: this.generation,
        observedAt,
        reason: 'Protected connection status observation',
        changedFactKeys: [...changed],
        invalidatedFactKeys,
        evidenceIds: [evidence.id]
      });
      if (this.deltas.length > MAX_DELTAS) this.deltas.splice(0, this.deltas.length - MAX_DELTAS);
      return;
    }
    if (observation.name === 'inspect') {
      const result = objectValue(envelope.result);
      const target = result?.['target'];
      if (typeof target !== 'string') return;
      this.observeInspect(envelope.result as WorkflowInspectResult, envelope.operation, observation.args);
      const itemId = observation.args['itemId'];
      if (observation.context.caller === 'agent' && target === 'media' && typeof itemId === 'string') {
        const entity = this.findEntity('media_pool_item', itemId);
        if (entity?.generation === this.generation) {
          this.focus = { entity: mention(entity), source: 'agent', setAt: Date.now() };
        }
      }
      return;
    }
    if (observation.name === 'execute') {
      const status = envelope.operation?.['status'];
      if (status === 'success' || status === 'ambiguous' || status === 'failed') {
        const observedAt = Date.now();
        // Execution evidence is durable history, not a replaceable observation slice. Repeated
        // writers therefore do not supersede each other's evidence merely because they share one
        // workflow id.
        const evidence = this.evidenceRef(envelope.operation, observedAt, [], null, undefined, false);
        const nextRevision = this.revision + 1;
        const mutationWorkflow = workflowIdFrom(envelope.operation);
        const markerMutation = mutationWorkflow === 'edit.review_marker_add.v1';
        const invalidatedFacts = markerMutation
          ? [...this.facts.values()].filter((fact) =>
              fact.key === 'timeline.itemCountObserved' || fact.key === 'timeline.markerCount'
            )
          : [...this.facts.values()];
        const invalidated = invalidatedFacts.map((fact) => fact.key);
        const invalidatedFactKeys = new Set(invalidated);
        const invalidatedEvidenceIds = new Set(invalidatedFacts.flatMap((fact) => fact.evidenceIds));
        const explicitlyInvalidatedWorkflows = markerMutation
          ? new Set<ProtectedWorkflowId>(['edit.timeline_summary.v1', 'edit.review_annotations_inspect.v1'])
          : null;
        for (const item of this.evidence) {
          if (item === evidence || item.generation !== this.generation || (item.provenanceRevision ?? 0) >= nextRevision) continue;
          const stillSupportsCurrentFact = [...this.facts.values()].some((fact) =>
            !invalidatedFactKeys.has(fact.key) && fact.evidenceIds.includes(item.id)
          );
          const exactSliceInvalidated = explicitlyInvalidatedWorkflows?.has(item.workflowId as ProtectedWorkflowId) ?? false;
          const factSupportFullyInvalidated = invalidatedEvidenceIds.has(item.id) && !stillSupportsCurrentFact;
          const unknownScope = explicitlyInvalidatedWorkflows === null;
          if (
            exactSliceInvalidated
            || factSupportFullyInvalidated
            || unknownScope
          ) {
            item.invalidatedAtRevision = nextRevision;
          }
        }
        for (const fact of invalidatedFacts) this.facts.delete(fact.key);
        this.lastObservedAt = Math.max(this.lastObservedAt, observedAt);
        this.revision = nextRevision;
        this.deltas.push({
          revision: this.revision,
          generation: this.generation,
          observedAt,
          reason: markerMutation
            ? 'Review-marker mutation invalidated only marker/annotation semantic slices'
            : 'Protected mutation scope is unknown; conservatively invalidated current semantic evidence',
          changedFactKeys: [],
          invalidatedFactKeys: invalidated,
          evidenceIds: [evidence.id]
        });
        if (this.deltas.length > MAX_DELTAS) this.deltas.splice(0, this.deltas.length - MAX_DELTAS);
      }
    }
  }

  resolveEntity(handle: string, generation?: number): AgentEntityRef {
    if (generation !== undefined && generation !== this.generation) throw new Error('Agent entity generation is stale');
    const entity = this.entitiesByHandle.get(handle);
    if (!entity || entity.generation !== this.generation) throw new Error('Agent entity handle is stale or unknown');
    if (entity.parentHandle) {
      const parent = this.entitiesByHandle.get(entity.parentHandle);
      if (!parent || parent.generation !== this.generation) throw new Error('Agent entity parent identity is stale');
    }
    return structuredClone(entity);
  }

  mentionEntityByExactId(exactId: string): AgentEntityMention | null {
    const entity = this.findEntityByExactId(exactId);
    return entity && entity.generation === this.generation ? mention(entity) : null;
  }

  setFocus(request: AgentFocusRequest, source: AgentSharedFocus['source'] = 'user'): AgentSharedFocus {
    const entity = this.findEntity(request.kind, request.exactId);
    if (!entity || entity.generation !== this.generation) throw new Error('Selected entity is not present in the current Resolve World Model');
    this.focus = { entity: mention(entity), source, setAt: Date.now() };
    return structuredClone(this.focus);
  }

  getFocus(): AgentSharedFocus | null {
    return this.focus ? structuredClone(this.focus) : null;
  }

  currentEvidence(): AgentEvidenceRef[] {
    return this.evidence
      .filter((item) => agentEvidenceIsCurrent(item, this.generation))
      .map((item) => structuredClone(item));
  }

  projectInspectorDetail(): AgentProjectInspectorDetail | null {
    const currentEvidenceIds = this.currentEvidenceIds();
    const settings = this.projectInspectorSettings && currentEvidenceIds.has(this.projectInspectorSettings.evidenceId)
      ? structuredClone(this.projectInspectorSettings.value)
      : null;
    const preflight = this.projectInspectorPreflight && currentEvidenceIds.has(this.projectInspectorPreflight.evidenceId)
      ? structuredClone(this.projectInspectorPreflight.value)
      : null;
    return settings || preflight ? { settings, preflight } : null;
  }

  mediaInspectorProjection(): AgentMediaInspectorProjection {
    const currentEvidenceIds = this.currentEvidenceIds();
    const inventoryObserved = Boolean(
      this.mediaInventoryInspector && currentEvidenceIds.has(this.mediaInventoryInspector.evidenceId)
    );
    const inventory = inventoryObserved && this.mediaInventoryInspector
      ? structuredClone(this.mediaInventoryInspector.value)
      : null;
    const poolLink = this.mediaPoolLinkInspector && currentEvidenceIds.has(this.mediaPoolLinkInspector.evidenceId)
      ? structuredClone(this.mediaPoolLinkInspector.value)
      : null;
    const pool: AgentMediaInspectorDetail | null = inventoryObserved || poolLink
      ? { inventory, clip: null, linkStatus: poolLink }
      : null;
    const handles = new Set([...this.mediaClipInspectors.keys(), ...this.mediaLinkInspectors.keys()]);
    const items: AgentMediaInspectorProjection['items'] = [];
    for (const handle of handles) {
      const entity = this.entitiesByHandle.get(handle);
      if (!entity || entity.kind !== 'media_pool_item' || entity.generation !== this.generation) continue;
      const clipEntry = this.mediaClipInspectors.get(handle);
      const linkEntry = this.mediaLinkInspectors.get(handle);
      const clip = clipEntry && currentEvidenceIds.has(clipEntry.evidenceId)
        ? structuredClone(clipEntry.value)
        : null;
      const linkStatus = linkEntry && currentEvidenceIds.has(linkEntry.evidenceId)
        ? structuredClone(linkEntry.value)
        : null;
      if (!clip && !linkStatus) continue;
      items.push({
        semanticHandle: entity.handle,
        generation: entity.generation,
        label: entity.label,
        locator: entity.locator,
        detail: { inventory: null, clip, linkStatus }
      });
    }
    return { pool, items };
  }

  editInspectorProjection(): AgentEditInspectorDetail {
    const currentEvidenceIds = this.currentEvidenceIds();
    const timeline = this.editTimelineInspector && currentEvidenceIds.has(this.editTimelineInspector.evidenceId)
      ? structuredClone(this.editTimelineInspector.value)
      : null;
    const structure = this.editStructureInspector && currentEvidenceIds.has(this.editStructureInspector.evidenceId)
      ? structuredClone(this.editStructureInspector.value)
      : null;
    const gaps = this.editGapsInspector && currentEvidenceIds.has(this.editGapsInspector.evidenceId)
      ? structuredClone(this.editGapsInspector.value)
      : null;
    const sourceRanges = this.editSourceRangesInspector && currentEvidenceIds.has(this.editSourceRangesInspector.evidenceId)
      ? structuredClone(this.editSourceRangesInspector.value)
      : null;
    const transitions = this.editTransitionsInspector && currentEvidenceIds.has(this.editTransitionsInspector.evidenceId)
      ? structuredClone(this.editTransitionsInspector.value)
      : null;
    const annotations = this.editAnnotationsInspector && currentEvidenceIds.has(this.editAnnotationsInspector.evidenceId)
      ? structuredClone(this.editAnnotationsInspector.value)
      : null;
    return { timeline, structure, gaps, sourceRanges, transitions, annotations };
  }

  fusionInspectorProjection(): AgentFusionInspectorDetail {
    const currentEvidenceIds = this.currentEvidenceIds();
    const composition = this.fusionCompositionInspector && currentEvidenceIds.has(this.fusionCompositionInspector.evidenceId)
      ? structuredClone(this.fusionCompositionInspector.value)
      : null;
    const graph = this.fusionGraphInspector && currentEvidenceIds.has(this.fusionGraphInspector.evidenceId)
      ? structuredClone(this.fusionGraphInspector.value)
      : null;
    return { composition, graph };
  }

  colorInspectorProjection(): AgentColorInspectorDetail {
    const currentEvidenceIds = this.currentEvidenceIds();
    const pipeline = this.colorPipelineInspector && currentEvidenceIds.has(this.colorPipelineInspector.evidenceId)
      ? structuredClone(this.colorPipelineInspector.value)
      : null;
    const graph = this.colorGraphInspector && currentEvidenceIds.has(this.colorGraphInspector.evidenceId)
      ? structuredClone(this.colorGraphInspector.value)
      : null;
    const versions = this.colorVersionsInspector && currentEvidenceIds.has(this.colorVersionsInspector.evidenceId)
      ? structuredClone(this.colorVersionsInspector.value)
      : null;
    return { pipeline, graph, versions };
  }

  fairlightInspectorProjection(): AgentFairlightInspectorDetail {
    const currentEvidenceIds = this.currentEvidenceIds();
    const mapping = this.fairlightMappingInspector && currentEvidenceIds.has(this.fairlightMappingInspector.evidenceId)
      ? structuredClone(this.fairlightMappingInspector.value)
      : null;
    const processing = this.fairlightProcessingInspector && currentEvidenceIds.has(this.fairlightProcessingInspector.evidenceId)
      ? structuredClone(this.fairlightProcessingInspector.value)
      : null;
    return { mapping, processing };
  }

  deliverInspectorProjection(): AgentDeliverInspectorDetail {
    const currentEvidenceIds = this.currentEvidenceIds();
    const capabilities = this.deliverCapabilitiesInspector && currentEvidenceIds.has(this.deliverCapabilitiesInspector.evidenceId)
      ? structuredClone(this.deliverCapabilitiesInspector.value)
      : null;
    const settings = this.deliverSettingsInspector && currentEvidenceIds.has(this.deliverSettingsInspector.evidenceId)
      ? structuredClone(this.deliverSettingsInspector.value)
      : null;
    return { capabilities, settings };
  }

  /**
   * Historical evidence remains owned by the World Model but is never returned by currentEvidence().
   * This read seam exists only for cached/offline projections and preserves original provenance.
   */
  historicalEvidenceForGeneration(generation: number): AgentEvidenceRef[] {
    return this.evidence
      .filter((item) => item.generation === generation && agentEvidenceIsCurrent(item, generation))
      .map((item) => structuredClone(item));
  }

  /**
   * Bounded historical projection captured immediately before an epoch reset. It is presentation
   * history, not semantic authority: callers must never feed it back into currentEvidence(),
   * DecisionFrame, CompletionReport, target resolution, or protected execution.
   */
  historicalSituationForProject(projectExactId: string, generation?: number): AgentSituationFrame | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    if (!snapshot) return null;
    const evidence = this.historicalEvidenceForGeneration(snapshot.generation);
    const evidenceIds = new Set(evidence.map((item) => item.id));
    const facts = snapshot.facts
      .filter((fact) => fact.evidenceIds.some((id) => evidenceIds.has(id)))
      .map((fact) => structuredClone(fact));
    return {
      generation: snapshot.generation,
      revision: snapshot.revision,
      observedAt: snapshot.observedAt,
      project: structuredClone(snapshot.project),
      timeline: snapshot.timeline ? structuredClone(snapshot.timeline) : null,
      resolvePage: snapshot.resolvePage,
      sharedFocus: snapshot.sharedFocus ? structuredClone(snapshot.sharedFocus) : null,
      entities: snapshot.entities.map((entity) => structuredClone(entity)),
      facts,
      evidence,
      recentDeltas: [],
      blockers: ['Cached historical World Model projection.'],
      unknowns: [...snapshot.unknowns]
    };
  }

  historicalProjectInspectorForProject(projectExactId: string, generation?: number): AgentProjectInspectorDetail | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot?.projectInspector ? structuredClone(snapshot.projectInspector) : null;
  }

  historicalMediaInspectorForProject(projectExactId: string, generation?: number): AgentMediaInspectorProjection | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot ? structuredClone(snapshot.mediaInspector) : null;
  }

  historicalEditInspectorForProject(projectExactId: string, generation?: number): AgentEditInspectorDetail | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot ? structuredClone(snapshot.editInspector) : null;
  }

  historicalFusionInspectorForProject(projectExactId: string, generation?: number): AgentFusionInspectorDetail | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot ? structuredClone(snapshot.fusionInspector) : null;
  }

  historicalColorInspectorForProject(projectExactId: string, generation?: number): AgentColorInspectorDetail | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot ? structuredClone(snapshot.colorInspector) : null;
  }

  historicalFairlightInspectorForProject(projectExactId: string, generation?: number): AgentFairlightInspectorDetail | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot ? structuredClone(snapshot.fairlightInspector) : null;
  }

  historicalDeliverInspectorForProject(projectExactId: string, generation?: number): AgentDeliverInspectorDetail | null {
    const snapshot = [...this.historicalProjections].reverse().find((item) =>
      item.projectExactId === projectExactId
      && (generation === undefined || item.generation === generation)
    );
    return snapshot ? structuredClone(snapshot.deliverInspector) : null;
  }

  projectText(text: string): string {
    let projected = text;
    for (const entity of this.entitiesByHandle.values()) {
      if (entity.exactId.length >= 6 && projected.includes(entity.exactId)) {
        projected = projected.split(entity.exactId).join(`${entity.handle} (${entity.label})`);
      }
    }
    return projected.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, '[local identity omitted]');
  }

  projectToolResult(result: CallToolResult): string {
    const envelope = protectedEnvelope(result);
    if (!envelope) return JSON.stringify({ status: 'unparsed_protected_result' });
    const privateKeys = new Set([
      'plan_hash', 'hash_algorithm', 'canonicalization_version', 'input_fingerprint',
      'marker_state_hash', 'custom_data', 'customData', 'version_type', 'versionType'
    ]);
    const protocolIdKeys = new Set([
      'readerId', 'workflow_id', 'workflowId', 'capabilityId', 'plan_id', 'planId',
      'execution_id', 'executionId', 'approval_id', 'approvalId', 'callId'
    ]);
    const looksLikeIdentity = (key: string): boolean => key === 'id'
      || key.endsWith('Id') || key.endsWith('Ids') || key.endsWith('_id') || key.endsWith('_ids')
      || key.endsWith('UniqueId') || key.endsWith('UniqueIds') || key.endsWith('unique_id') || key.endsWith('unique_ids');
    const sanitize = (value: unknown, key = '', depth = 0): unknown => {
      if (depth > 8) return '[detail omitted]';
      if (typeof value === 'string') {
        const entity = this.findEntityByExactId(value);
        if (entity) return { ref: entity.handle, label: entity.label, kind: entity.kind, generation: entity.generation };
        if (protocolIdKeys.has(key)) return value.length > MAX_MODEL_RESULT_STRING ? `${value.slice(0, MAX_MODEL_RESULT_STRING)}…` : value;
        if (looksLikeIdentity(key) && !protocolIdKeys.has(key)) return '[local identity omitted]';
        const projected = this.projectText(value);
        return projected.length > MAX_MODEL_RESULT_STRING ? `${projected.slice(0, MAX_MODEL_RESULT_STRING)}…` : projected;
      }
      if (Array.isArray(value)) {
        const rows = value.slice(0, MAX_MODEL_RESULT_ARRAY).map((item) => sanitize(item, key, depth + 1));
        if (value.length > MAX_MODEL_RESULT_ARRAY) rows.push({ truncated: value.length - MAX_MODEL_RESULT_ARRAY });
        return rows;
      }
      const row = objectValue(value);
      if (!row) return value;
      const entries = Object.entries(row).filter(([childKey]) => !privateKeys.has(childKey));
      const output: Record<string, unknown> = {};
      for (const [childKey, childValue] of entries.slice(0, MAX_MODEL_RESULT_KEYS)) {
        output[childKey] = sanitize(childValue, childKey, depth + 1);
      }
      if (entries.length > MAX_MODEL_RESULT_KEYS) output['_truncatedKeys'] = entries.length - MAX_MODEL_RESULT_KEYS;
      return output;
    };
    const protectedResult = objectValue(envelope.result);
    const target = protectedResult?.['target'];
    const canonicalDomainResult = target === 'fusion'
      ? { target, generation: this.generation, ...this.fusionInspectorProjection() }
      : target === 'color'
        ? { target, generation: this.generation, ...this.colorInspectorProjection() }
        : target === 'fairlight'
          ? { target, generation: this.generation, ...this.fairlightInspectorProjection() }
          : target === 'deliver'
            ? { target, generation: this.generation, ...this.deliverInspectorProjection() }
            : null;
    if (canonicalDomainResult) {
      return JSON.stringify({
        result: canonicalDomainResult,
        operation: sanitize(envelope.operation)
      });
    }
    return JSON.stringify({
      result: sanitize(envelope.result),
      operation: sanitize(envelope.operation)
    });
  }

  situation(sinceRevision = 0): AgentSituationFrame {
    const project = this.currentProjectId ? this.findEntity('project', this.currentProjectId) : null;
    const timeline = this.currentTimelineId ? this.findEntity('timeline', this.currentTimelineId) : null;
    const focusHandle = this.focus?.entity.handle ?? null;
    const currentEvidenceIds = this.currentEvidenceIds();
    const priorityFacts = [...this.facts.values()]
      .filter((fact) =>
        fact.evidenceIds.some((id) => currentEvidenceIds.has(id))
        && (
          fact.subjectHandle === null
          || fact.subjectHandle === focusHandle
          || fact.subjectHandle === project?.handle
          || fact.subjectHandle === timeline?.handle
        )
      )
      .sort((left, right) => right.observedAt - left.observedAt)
      .slice(0, MAX_SITUATION_FACTS)
      .map((fact): AgentModelFact => ({
        key: fact.key,
        subjectHandle: fact.subjectHandle,
        value: structuredClone(fact.value),
        epistemicState: fact.epistemicState,
        evidenceIds: [...fact.evidenceIds]
      }));
    const recentDeltas = this.deltas.filter((delta) => delta.revision > sinceRevision).slice(-8).map((delta) => structuredClone(delta));
    const evidenceIds = new Set([
      ...priorityFacts.flatMap((fact) => fact.evidenceIds),
      ...recentDeltas.flatMap((delta) => delta.evidenceIds)
    ]);
    return {
      generation: this.generation,
      revision: this.revision,
      observedAt: this.lastObservedAt,
      project: project ? mention(project) : null,
      timeline: timeline ? mention(timeline) : null,
      resolvePage: (this.facts.get('resolve.page')?.value as string | null | undefined) ?? null,
      sharedFocus: this.getFocus(),
      entities: [...this.entitiesByHandle.values()]
        .filter((entity) => entity.handle !== project?.handle && entity.handle !== timeline?.handle)
        .slice(-MAX_SITUATION_ENTITIES)
        .map(mention),
      facts: priorityFacts,
      evidence: this.evidence
        .filter((item) => evidenceIds.has(item.id) && agentEvidenceIsCurrent(item, this.generation))
        .slice(-16)
        .map((item) => structuredClone(item)),
      recentDeltas,
      blockers: [],
      unknowns: priorityFacts.filter((fact) => fact.epistemicState === 'unknown' || fact.epistemicState === 'contradicted').map((fact) => fact.key)
    };
  }

  identitySnapshot(): {
    generation: number;
    revision: number;
    observedAt: number;
    project: AgentEntityRef | null;
    timeline: AgentEntityRef | null;
    resolveVersion: string | null;
    resolveRunning: boolean | null;
  } {
    const project = this.currentProjectId ? this.findEntity('project', this.currentProjectId) : null;
    const timeline = this.currentTimelineId ? this.findEntity('timeline', this.currentTimelineId) : null;
    const version = this.facts.get('resolve.version')?.value;
    const running = this.facts.get('resolve.running')?.value;
    return {
      generation: this.generation,
      revision: this.revision,
      observedAt: this.lastObservedAt,
      project: project ? structuredClone(project) : null,
      timeline: timeline ? structuredClone(timeline) : null,
      resolveVersion: typeof version === 'string' ? version : null,
      resolveRunning: typeof running === 'boolean' ? running : null
    };
  }

  snapshotForTests(): { generation: number; revision: number; entities: AgentEntityRef[]; facts: AgentWorldFact[] } {
    return {
      generation: this.generation,
      revision: this.revision,
      entities: [...this.entitiesByHandle.values()].map((entity) => structuredClone(entity)),
      facts: [...this.facts.values()].map((fact) => structuredClone(fact))
    };
  }
}
