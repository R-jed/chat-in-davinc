import type {
  ProtectedVerificationLevel,
  ProtectedVerificationStatus,
  ProtectedWorkflowId,
  ProjectPreflightCheck,
  ProjectPreflightProfile,
  ProjectPreflightStatus,
  ProjectSettingsFacts,
  ResolveCapabilityEvidence,
  ResolveCapabilityId,
  WorkflowApprovalPolicy,
  WorkflowBlastRadius,
  WorkflowChangeSetState,
  WorkflowExecutionState,
  WorkflowPlanState,
  WorkflowRecoveryClass,
  WorkflowRiskLevel
} from './types.js';

export type AgentEntityKind =
  | 'project'
  | 'timeline'
  | 'media_pool_folder'
  | 'media_pool_item'
  | 'timeline_item'
  | 'fusion_composition'
  | 'fusion_tool'
  | 'color_node'
  | 'grade_version'
  | 'fairlight_track'
  | 'render_job'
  | 'deliverable';

/** Main-owned semantic identity. `exactId` is never required in model-visible context. */
export interface AgentEntityRef {
  kind: AgentEntityKind;
  exactId: string;
  handle: string;
  label: string;
  generation: number;
  parentHandle: string | null;
  locator: string | null;
}

/** Safe projection used by the model and renderer. */
export interface AgentEntityMention {
  kind: AgentEntityKind;
  handle: string;
  label: string;
  generation: number;
  parentHandle: string | null;
  locator: string | null;
}

export type AgentEvidenceSource = 'official_api' | 'render' | 'file_qc' | 'analysis' | 'user' | 'memory';
export type AgentEpistemicState = 'observed' | 'derived' | 'assumed' | 'unknown' | 'contradicted';

export interface AgentEvidenceRef {
  id: string;
  source: AgentEvidenceSource;
  observedAt: number;
  generation: number;
  /** World Model revision created by this observation. Used by semantic freshness fences. */
  provenanceRevision?: number;
  /** Revision that explicitly invalidated facts backed by this evidence. */
  invalidatedAtRevision?: number;
  workflowId: ProtectedWorkflowId | null;
  executionId: string | null;
  verificationStatus: ProtectedVerificationStatus | null;
  verificationLevel: ProtectedVerificationLevel | null;
  projectHandle: string | null;
  timelineHandle: string | null;
  targetHandle: string | null;
  /** Semantic parameter that distinguishes shared preflight workflow observations. */
  preflightProfile?: ProjectPreflightProfile;
  limitations: string[];
}

export interface AgentWorldFact {
  key: string;
  subjectHandle: string | null;
  value: unknown;
  epistemicState: AgentEpistemicState;
  evidenceIds: string[];
  observedAt: number;
  generation: number;
}

export interface AgentModelFact {
  key: string;
  subjectHandle: string | null;
  value: unknown;
  epistemicState: AgentEpistemicState;
  evidenceIds: string[];
}

export interface AgentSemanticDelta {
  revision: number;
  generation: number;
  observedAt: number;
  reason: string;
  changedFactKeys: string[];
  invalidatedFactKeys: string[];
  evidenceIds: string[];
}

export type AgentFocusSource = 'user' | 'agent' | 'resolve' | 'plan';

export interface AgentSharedFocus {
  entity: AgentEntityMention;
  source: AgentFocusSource;
  setAt: number;
}

export type AgentSemanticCapabilityId =
  | 'system.connection.inspect'
  | 'project.identity.inspect'
  | 'project.settings.inspect'
  | 'project.preflight'
  | 'media.inventory.inspect'
  | 'media.item.inspect'
  | 'media.link.capabilities.inspect'
  | 'edit.timeline.inspect'
  | 'edit.timeline.structure.inspect'
  | 'edit.timeline.gaps_overlaps.inspect'
  | 'edit.clip.source_range.inspect'
  | 'edit.fade.inspect'
  | 'edit.review_annotations.inspect'
  | 'edit.marker.add'
  | 'edit.track.add'
  | 'fusion.composition.inspect'
  | 'fusion.graph.inspect'
  | 'color.pipeline.inspect'
  | 'color.graph.inspect'
  | 'color.grade_version.inspect'
  | 'color.grade_version.create'
  | 'fairlight.mapping.inspect'
  | 'fairlight.clip_processing.inspect'
  | 'deliver.capability_matrix.inspect'
  | 'deliver.settings.inspect'
  | 'deliver.preflight';

export interface AgentWorkspaceMention {
  workspaceId: string;
  projectHandle: string | null;
  projectLabel: string | null;
  online: boolean;
  freshness: 'fresh' | 'stale' | 'offline';
  bindingStatus: 'bound' | 'mismatch' | 'unbound';
}

export interface AgentImplementationBinding {
  implementationId: ProtectedWorkflowId;
  implementationVersion: '1';
  source: 'official' | 'trusted_plugin' | 'ui_automation';
  qualification: 'behaviorally_qualified' | 'runtime_observed' | 'unknown';
  evidenceBuild: string | null;
  availability: 'available' | 'conditional' | 'unknown' | 'unavailable';
  blockingReason: string | null;
  remediation: string | null;
}

export interface AgentActionOffer {
  capabilityId: AgentSemanticCapabilityId;
  targetHandle: string | null;
  applicability: 'applicable' | 'blocked' | 'unknown' | 'unavailable';
  /** Present on current semantic offers; optional only for persisted/test compatibility. */
  kind?: 'observe' | 'mutate';
  whyRelevant: string;
  advancesCriterion: string | null;
  requiredPreconditions: string[];
  risk: WorkflowRiskLevel;
  expectedSemanticEffect: string;
  verificationRequirement: ProtectedVerificationLevel;
  implementation: AgentImplementationBinding | null;
  /** Exact protected-tool parameters fixed by this semantic capability. */
  dispatch?: {
    profile?: ProjectPreflightProfile;
  };
  estimatedCost: {
    context: 'low' | 'medium' | 'high';
    resolve: 'none' | 'low' | 'medium' | 'high';
    latency: 'low' | 'medium' | 'high';
  };
  blockingReason: string | null;
  remediation: string | null;
}

export type AgentDecisionKind = 'observe' | 'act' | 'clarify' | 'approval_wait' | 'finish_check';

export interface AgentDecisionFrame {
  schemaVersion: 1;
  sessionId: string;
  turnId: string | null;
  compiledAt: number;
  generation: number;
  provenanceRevision: number;
  decisionKind: AgentDecisionKind;
  goalCriterion: string | null;
  openObligation: string | null;
  completionGap: string | null;
  materialUncertainty: string | null;
  minimumFacts: AgentModelFact[];
  evidenceRefs: AgentEvidenceRef[];
  staleDependencies: string[];
  sharedFocus: AgentSharedFocus | null;
  actionOffers: AgentActionOffer[];
  riskHints: string[];
  costHints: string[];
  workspace: AgentWorkspaceMention | null;
}

export interface AgentCompletionCriterion {
  criterion: string;
  status: 'satisfied' | 'missing_evidence' | 'blocked' | 'unknown';
  evidenceIds: string[];
  strongestVerification: ProtectedVerificationLevel | null;
  blockingReason: string | null;
}

export interface AgentCompletionReport {
  schemaVersion: 1;
  sessionId: string;
  evaluatedAt: number;
  generation: number;
  complete: boolean;
  criteria: AgentCompletionCriterion[];
  blockers: string[];
  materialUnknowns: string[];
  evidenceIds: string[];
  strongestVerification: ProtectedVerificationLevel | null;
}

export interface AgentSystemSpineProjection {
  sessionId: string;
  turnId: string;
  workspace: AgentWorkspaceMention | null;
  decision: AgentDecisionFrame;
  actionOffers: AgentActionOffer[];
  completion: AgentCompletionReport;
}

export type AgentArtifactKind =
  | 'project'
  | 'media_pool'
  | 'media_item'
  | 'timeline'
  | 'timeline_item'
  | 'fusion_composition'
  | 'color_graph'
  | 'grade_version'
  | 'fairlight'
  | 'deliver';

export type AgentArtifactLensId =
  | 'summary'
  | 'project'
  | 'media'
  | 'edit'
  | 'fusion'
  | 'color'
  | 'fairlight'
  | 'deliver';

export interface AgentArtifactLens {
  id: AgentArtifactLensId;
  availability: 'available' | 'unavailable';
  reason: string | null;
}

export interface AgentProjectInspectorDetail {
  settings: (Pick<ProjectSettingsFacts,
    | 'timelineResolution'
    | 'timelineFrameRate'
    | 'timelinePlaybackFrameRate'
    | 'outputResolution'
    | 'frameRateMismatchBehavior'
    | 'colorScienceMode'
    | 'videoMonitorFormat'> & {
    timelineUsesCustomSettings: boolean | null;
  }) | null;
  preflight: {
    status: ProjectPreflightStatus;
    projectLabel: string | null;
    timelineLabel: string | null;
    checks: ProjectPreflightCheck[];
    blockers: string[];
    warnings: string[];
    capabilityGaps: string[];
    capabilityEvidence: Array<Pick<ResolveCapabilityEvidence,
      'capabilityId' | 'evidenceSource' | 'status' | 'limitations'>>;
  } | null;
}

export interface AgentMediaInventoryItemDetail {
  semanticHandle: string;
  generation: number;
  name: string;
  folderLabel: string;
  resolveType: string | null;
  isTimeline: boolean;
  duration: string | null;
  fps: number | null;
  resolution: { width: number; height: number } | null;
  videoCodec: string | null;
  audioCodec: string | null;
  online: boolean | null;
  hasProxyMedia: boolean | null;
}

export interface AgentMediaInventoryInspectorDetail {
  rootFolderLabel: string | null;
  currentFolderLabel: string | null;
  folderCountObserved: number;
  itemsObserved: number;
  sourceClipCountObserved: number;
  timelineItemCountObserved: number;
  onlineCountObserved: number;
  offlineCountObserved: number;
  onlineUnverifiedCount: number;
  proxyLinkedCountObserved: number;
  proxyAbsentCountObserved: number;
  proxyUnverifiedCount: number;
  resolveTypeCounts: Array<{ type: string; count: number }>;
  motionFrameRateMismatchCount: number | null;
  motionResolutionMismatchCount: number | null;
  complete: boolean;
  items: AgentMediaInventoryItemDetail[];
}

export interface AgentMediaClipInspectorDetail {
  lookup: 'found' | 'not_found' | 'unverified';
  search: {
    foldersObserved: number;
    itemsObserved: number;
    truncated: boolean;
  };
  item: {
    semanticHandle: string;
    generation: number;
    name: string;
    resolveType: string | null;
    isTimeline: boolean | null;
    duration: string | null;
    fps: number | null;
    resolution: { width: number; height: number } | null;
    videoCodec: string | null;
    audioCodec: string | null;
    audioBitDepth: number | null;
    audioChannels: number | null;
    startTimecode: string | null;
    endTimecode: string | null;
    online: boolean | null;
    hasProxyMedia: boolean | null;
    clipColor: string | null;
    flags: string[];
    audioMapping: {
      embeddedAudioChannels: number | null;
      trackCount: number;
      mappedChannelCount: number;
    } | null;
  } | null;
  metadata: Array<{ key: string; value: string }>;
  metadataTruncated: boolean;
  thirdPartyMetadata: Array<{ key: string; value: string }>;
  thirdPartyMetadataTruncated: boolean;
  markers: Array<{
    frame: number;
    color: string | null;
    duration: number | null;
    name: string | null;
    note: string | null;
  }>;
  markersTruncated: boolean;
  methodEvidence: {
    checkedMethods: string[];
    observedMethods: string[];
    failedMethods: string[];
  };
}

export interface AgentMediaLinkInspectorDetail {
  scope: 'pool' | 'item';
  itemHandle: string | null;
  itemLookup: 'not_requested' | 'found' | 'not_found' | 'unverified';
  methodEvidence: {
    mediaPoolProbed: boolean;
    mediaPoolItemProbed: boolean;
  };
  capabilities: Array<{
    id: 'relink' | 'unlink' | 'linkProxy' | 'unlinkProxy' | 'linkFullResolution';
    surface: 'observed' | 'missing' | 'unverified';
  }>;
}

export interface AgentMediaInspectorDetail {
  inventory: AgentMediaInventoryInspectorDetail | null;
  clip: AgentMediaClipInspectorDetail | null;
  linkStatus: AgentMediaLinkInspectorDetail | null;
}

export interface AgentMediaInspectorProjection {
  pool: AgentMediaInspectorDetail | null;
  items: Array<{
    semanticHandle: string;
    generation: number;
    label: string;
    locator: string | null;
    detail: AgentMediaInspectorDetail;
  }>;
}

export interface AgentEditTimelineInspectorDetail {
  timeline: {
    semanticHandle: string;
    generation: number;
    name: string;
    startFrame: number | null;
    endFrame: number | null;
    durationFrames: number | null;
    startTimecode: string | null;
    frameRate: number | null;
  };
  trackCounts: {
    video: number;
    audio: number;
    subtitle: number;
  };
  timelineItemCountObserved: number;
  itemsScannedForSourceState: number;
  markerCount: number;
  subtitleItemCount: number;
  offlineSourceItemCountObserved: number;
  onlineStateUnverifiedItemCountObserved: number;
  itemsWithoutMediaPoolReferenceCountObserved: number;
  tracks: Array<{
    type: 'video' | 'audio' | 'subtitle';
    index: number;
    name: string | null;
    enabled: boolean | null;
    locked: boolean | null;
    itemCount: number;
    offlineSourceItemCountObserved: number;
    onlineStateUnverifiedItemCountObserved: number;
    itemsWithoutMediaPoolReferenceCountObserved: number;
  }>;
  complete: boolean;
}

export interface AgentEditStructureInspectorDetail {
  timelineHandle: string;
  generation: number;
  tracksObserved: number;
  itemsObserved: number;
  methodEvidence: {
    checkedMethodCount: number;
    fullyObservedMethodCount: number;
    failedMethodCount: number;
  };
  tracks: Array<{
    type: 'video' | 'audio' | 'subtitle';
    index: number;
    items: Array<{
      semanticHandle: string;
      generation: number;
      name: string;
      recordStart: number | null;
      recordEnd: number | null;
      duration: number | null;
      sourceStart: number | null;
      sourceEnd: number | null;
      mediaPoolHandle: string | null;
    }>;
  }>;
}

export interface AgentEditGapsInspectorDetail {
  adjacentPairsObserved: number;
  comparablePairsObserved: number;
  unverifiedTrackCount: number;
  gapCountObserved: number;
  overlapCountObserved: number;
  boundaryAmbiguousCountObserved: number;
  relationships: Array<{
    kind: 'gap' | 'overlap' | 'boundary_ambiguous';
    trackType: 'video' | 'audio' | 'subtitle';
    trackIndex: number;
    leftItem: { semanticHandle: string | null; name: string };
    rightItem: { semanticHandle: string | null; name: string };
    boundaryDelta: number;
  }>;
}

export interface AgentEditSourceRangesInspectorDetail {
  itemsObserved: number;
  itemsReported: number;
  itemsWithMediaPoolReference: number;
  itemsWithCompleteRecordGetterValues: number;
  itemsWithCompleteSourceGetterValues: number;
  items: Array<{
    trackType: 'video' | 'audio' | 'subtitle';
    trackIndex: number;
    semanticHandle: string | null;
    name: string;
    mediaPoolHandle: string | null;
    recordStartGetterValue: number | null;
    recordEndGetterValue: number | null;
    durationGetterValue: number | null;
    sourceStartFrameGetterValue: number | null;
    sourceEndFrameGetterValue: number | null;
  }>;
}

export interface AgentEditTransitionsInspectorDetail {
  itemsObserved: number;
  itemsReported: number;
  getFadesReadbackObservedCount: number;
  addTransitionSurfaceObserved: boolean;
  setFadesSurfaceObserved: boolean;
  items: Array<{
    trackType: 'video' | 'audio';
    trackIndex: number;
    semanticHandle: string | null;
    name: string;
    fadeInGetterValue: number | null;
    fadeOutGetterValue: number | null;
    getFadesReadback: 'observed' | 'failed' | 'unavailable';
  }>;
}

export interface AgentEditAnnotationsInspectorDetail {
  timelineLabel: string;
  timelineMarkerCountObserved: number;
  timelineItemMarkerCountObserved: number;
  mediaPoolMarkerCountObserved: number;
  flaggedMediaPoolItemCountObserved: number;
  coloredMediaPoolItemCountObserved: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  markerRowsTruncated: boolean;
  complete: boolean;
  unverified: string[];
  methodEvidence: {
    timeline: { observed: number; checked: number; missing: number; failed: number };
    timelineItem: { observed: number; checked: number; missing: number; failed: number };
    mediaPoolItem: { observed: number; checked: number; missing: number; failed: number };
  };
  markers: Array<{
    scope: 'timeline' | 'timeline_item' | 'media_pool_item';
    targetHandle: string | null;
    targetName: string;
    trackType: 'video' | 'audio' | 'subtitle' | null;
    trackIndex: number | null;
    frame: number;
    color: string | null;
    duration: number | null;
    name: string | null;
    note: string | null;
  }>;
  mediaPoolAnnotations: Array<{
    semanticHandle: string;
    name: string;
    flags: string[];
    flagsTruncated: boolean;
    clipColor: string | null;
    markerCountObserved: number;
  }>;
}

export interface AgentEditInspectorDetail {
  timeline: AgentEditTimelineInspectorDetail | null;
  structure: AgentEditStructureInspectorDetail | null;
  gaps: AgentEditGapsInspectorDetail | null;
  sourceRanges: AgentEditSourceRangesInspectorDetail | null;
  transitions: AgentEditTransitionsInspectorDetail | null;
  annotations: AgentEditAnnotationsInspectorDetail | null;
}

export interface AgentFusionCompositionInspectorDetail {
  timeline: {
    semanticHandle: string;
    generation: number;
    name: string;
  };
  videoTrackCount: number;
  tracksScanned: number;
  videoItemsObserved: number;
  itemsReported: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  namesTruncated: boolean;
  complete: boolean;
  methodEvidence: {
    checkedMethodCount: number;
    fullyObservedMethodCount: number;
    missingMethodCount: number;
    failedMethodCount: number;
  };
  unverified: string[];
  items: Array<{
    trackIndex: number;
    semanticHandle: string | null;
    generation: number | null;
    name: string | null;
    compositionCountObserved: number | null;
    compositionNames: string[];
  }>;
}

export interface AgentFusionGraphInspectorDetail {
  timeline: {
    semanticHandle: string;
    generation: number;
    name: string;
  };
  compositionsObserved: number;
  compositionsReported: number;
  toolsObserved: number;
  toolsReported: number;
  edgesObserved: number;
  edgesReported: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  compositionsTruncated: boolean;
  toolsTruncated: boolean;
  portsTruncated: boolean;
  edgesTruncated: boolean;
  complete: boolean;
  methodEvidence: {
    checkedMethodCount: number;
    failedMethodCount: number;
  };
  unverified: string[];
  compositions: Array<{
    compositionName: string;
    tools: Array<{
      name: string;
      inputCountObserved: number;
      outputCountObserved: number;
      connections: Array<{
        targetToolName: string;
        bidirectionalReadback: boolean;
      }>;
    }>;
  }>;
}

export interface AgentFusionInspectorDetail {
  composition: AgentFusionCompositionInspectorDetail | null;
  graph: AgentFusionGraphInspectorDetail | null;
}

export interface AgentColorGraphScopeDetail {
  scope: 'timeline' | 'item' | 'group_pre' | 'group_post';
  trackIndex: number | null;
  layerIndex: number | null;
  timelineItemHandle: string | null;
  timelineItemName: string | null;
  colorGroupName: string | null;
  graphAccess: 'observed' | 'null' | 'missing' | 'failed';
  nodeCountObserved: number | null;
  nodes: Array<{
    ordinal: number;
    label: string;
    lutReferencePresent: boolean | null;
    cacheMode: number | null;
    cacheModeShape: 'integer' | 'null' | 'unavailable';
    toolNames: string[];
    toolListShape: 'list' | 'null';
  }>;
}

export interface AgentColorInspectorDetail {
  pipeline: {
    settings: {
      colorScienceMode: string | null;
      inputColorSpace: string | null;
      inputGamma: string | null;
      timelineColorSpace: string | null;
      timelineGamma: string | null;
      outputColorSpace: string | null;
      outputGamma: string | null;
      outputToneMapping: string | null;
      outputGamutMapping: string | null;
    } | null;
    colorGroupCount: number;
    videoItemCountObserved: number;
    videoItemsScanned: number;
    nodeCountObserved: number;
    lutReferenceCountObserved: number;
    complete: boolean;
    items: Array<{
      name: string;
      groupName: string | null;
      currentVersionName: string | null;
      nodeCount: number | null;
      lutReferenceCount: number;
      localVersionCount: number;
      remoteVersionCount: number;
    }>;
  } | null;
  graph: {
    timelineLabel: string;
    nodeStackLayersReadback: 'observed' | 'failed';
    nodeStackLayersConfigured: number | null;
    nodeStackLayersScanned: number;
    layersTruncated: boolean;
    videoTrackCount: number;
    tracksScanned: number;
    videoItemsObserved: number;
    itemsScanned: number;
    colorGroupsReadback: 'observed' | 'failed';
    colorGroupCountObserved: number | null;
    colorGroupsScanned: number;
    colorGroupsTruncated: boolean;
    graphsObserved: number;
    nodesObserved: number;
    nodesReported: number;
    tracksTruncated: boolean;
    itemsTruncated: boolean;
    nodesTruncated: boolean;
    toolsTruncated: boolean;
    complete: boolean;
    methodEvidence: {
      checkedMethodCount: number;
      fullyObservedMethodCount: number;
      missingMethodCount: number;
      failedMethodCount: number;
    };
    unverified: Array<'nodeTopology' | 'nodeValues' | 'pixelOutput' | 'graphWrites'>;
    timelineGraph: AgentColorGraphScopeDetail;
    itemGraphs: AgentColorGraphScopeDetail[];
    colorGroupGraphs: AgentColorGraphScopeDetail[];
  } | null;
  versions: {
    timelineLabel: string;
    videoTrackCount: number;
    tracksScanned: number;
    videoItemsObserved: number;
    itemsScanned: number;
    tracksTruncated: boolean;
    itemsTruncated: boolean;
    versionNamesTruncated: boolean;
    complete: boolean;
    methodEvidence: {
      checkedMethodCount: number;
      fullyObservedMethodCount: number;
      missingMethodCount: number;
      failedMethodCount: number;
    };
    unverified: Array<
      | 'versionOrdering'
      | 'versionNameUniqueness'
      | 'crossTypeNameIdentity'
      | 'colorGroupVersions'
      | 'pixelOutput'
      | 'versionWrites'
    >;
    items: Array<{
      trackIndex: number;
      timelineItemHandle: string;
      timelineItemName: string;
      currentReadback: 'observed' | 'missing' | 'failed';
      currentVersion: { name: string; type: 0 | 1 } | null;
      localReadback: 'observed' | 'missing' | 'failed';
      localVersions: string[];
      remoteReadback: 'observed' | 'missing' | 'failed';
      remoteVersions: string[];
    }>;
  } | null;
}

export interface AgentFairlightInspectorDetail {
  mapping: {
    timelineLabel: string;
    audioTrackCount: number;
    audioItemCountObserved: number;
    itemsScanned: number;
    sourceMappingVerifiedItemCount: number;
    sourceMappingUnverifiedItemCount: number;
    complete: boolean;
    tracksTruncated: boolean;
    itemsTruncated: boolean;
    unverified: Array<'syncEvidence' | 'transcriptionState'>;
    tracks: Array<{
      index: number;
      name: string | null;
      subType: string | null;
      enabled: boolean | null;
      locked: boolean | null;
      voiceIsolation: { isEnabled: boolean; amount: number | null } | null;
      sourceMappingVerifiedItemCount: number;
      sourceMappingUnverifiedItemCount: number;
    }>;
  } | null;
  processing: {
    timelineLabel: string;
    audioTrackCount: number;
    tracksScanned: number;
    audioItemsObserved: number;
    itemsScanned: number;
    tracksTruncated: boolean;
    itemsTruncated: boolean;
    complete: boolean;
    methodEvidence: {
      checkedMethodCount: number;
      fullyObservedMethodCount: number;
      missingMethodCount: number;
      failedMethodCount: number;
    };
    unverified: Array<'automationState' | 'clipEffects' | 'renderedAudio' | 'processingWrites'>;
    items: Array<{
      trackIndex: number;
      semanticHandle: string;
      name: string;
      volumeEnabled: boolean | null;
      volumeDb: number | null;
      panEnabled: boolean | null;
      pan: number | null;
      pitchEnabled: boolean | null;
      pitchSemitones: number | null;
      pitchCents: number | null;
      voiceIsolationEnabled: boolean | null;
      voiceIsolationAmount: number | null;
      dialogueLevelerEnabled: boolean | null;
      dialogueLevelerMode: 0 | 1 | 2 | 3 | null;
      dialogueReduceLoud: boolean | null;
      dialogueLiftSoft: boolean | null;
      dialogueBackgroundReduction: boolean | null;
      dialogueOutputGainDb: number | null;
      voiceConsistency: 'matched' | 'contradiction' | 'unavailable';
    }>;
  } | null;
}

export interface AgentDeliverInspectorDetail {
  capabilities: {
    videoFormatCount: number;
    videoCodecCountObserved: number;
    audioFormatCount: number;
    audioCodecCountObserved: number;
    generalResolutions: Array<{ width: number; height: number }>;
    currentSelection: {
      format: string | null;
      codec: string | null;
      resolutionCount: number;
    } | null;
    renderPresetCount: number;
    renderPresets: string[];
    quickExportPresetCount: number;
    quickExportPresets: string[];
    complete: boolean;
    videoFormats: Array<{
      name: string;
      extension: string;
      codecCount: number;
      codecs: string[];
    }>;
  } | null;
  settings: {
    currentFormat: string | null;
    currentCodec: string | null;
    renderMode: 'individualClips' | 'singleClip' | null;
    renderingInProgress: boolean | null;
    renderJobCountObserved: number;
    jobsTruncated: boolean;
    jobs: Array<{
      semanticHandle: string;
      name: string | null;
      timelineName: string | null;
      status: string | null;
      outputResolution: { width: number; height: number } | null;
      videoFormat: string | null;
      videoCodec: string | null;
      audioCodec: string | null;
    }>;
  } | null;
}

/**
 * Bounded presentation projection of an object already owned by the World Model/System Spine.
 * `artifactId` is navigation identity only; it never authorizes Resolve work.
 */
export interface AgentArtifactSummary {
  artifactId: string;
  semanticHandle: string | null;
  kind: AgentArtifactKind;
  label: string;
  workspaceId: string;
  generation: number;
  source: 'world_entity' | 'semantic_projection' | 'cached_projection';
  focusRelationship: 'shared_focus' | 'workspace' | 'related' | 'none';
  lenses: AgentArtifactLens[];
  summaryFacts: AgentModelFact[];
  evidenceRefs: AgentEvidenceRef[];
  actionOffers: AgentActionOffer[];
  projectInspector?: AgentProjectInspectorDetail | null;
  mediaInspector?: AgentMediaInspectorDetail | null;
  editInspector?: AgentEditInspectorDetail | null;
  fusionInspector?: AgentFusionInspectorDetail | null;
  colorInspector?: AgentColorInspectorDetail | null;
  fairlightInspector?: AgentFairlightInspectorDetail | null;
  deliverInspector?: AgentDeliverInspectorDetail | null;
}

export interface AgentArtifactPlanSummary {
  planId: string;
  workflowId: ProtectedWorkflowId;
  state: WorkflowPlanState;
  authority: 'current' | 'cached_read_only';
  risk: WorkflowRiskLevel;
  approvalState: 'awaiting' | 'approved' | 'rejected' | 'closed';
  targetHandle: string | null;
  targetLabel: string | null;
  proposedChanges: Array<
    {
      kind: 'add_review_marker';
      name: string;
      frameOffset: number;
      color: string;
      duration: number;
    }
    | {
      kind: 'structural_edit';
      summary: string;
    }
    | {
      kind: 'add_track';
      trackType: 'video';
      placement: 'append';
      expectedTrackIndex: number;
    }
    | {
      kind: 'create_grade_version';
      name: string;
    }
  >;
  executionState: WorkflowExecutionState | null;
  changeSet: {
    id: string;
    state: WorkflowChangeSetState;
    verificationStatus: ProtectedVerificationStatus;
    verificationLevel: ProtectedVerificationLevel | null;
    recoveryStatus: 'not_needed' | 'recovered' | 'failed' | 'unavailable' | null;
    actualMarkerPresent: boolean | null;
    actualTrackPresent: boolean | null;
    backupAvailable: boolean;
  };
  verificationRequirement: ProtectedVerificationLevel;
  recoveryType: WorkflowRecoveryClass;
  blockingReason: string | null;
}

export interface AgentArtifactWorkspaceProjection {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  generation: number;
  workspace: AgentWorkspaceMention | null;
  context: {
    project: AgentEntityMention | null;
    timeline: AgentEntityMention | null;
    sharedFocus: AgentSharedFocus | null;
    goalCriterion: string | null;
    openObligation: string | null;
    decisionKind: AgentDecisionKind;
    completionGap: string | null;
    blockers: string[];
    materialUncertainty: string | null;
    unknowns: string[];
  };
  artifacts: AgentArtifactSummary[];
  suggestedArtifactId: string | null;
  actionOffers: AgentActionOffer[];
  plans: AgentArtifactPlanSummary[];
  recentDeltas: AgentSemanticDelta[];
  protectedResolveActionsBlocked: boolean;
}

export interface AgentGoalDirective {
  turnId: string;
  seq: number;
  text: string;
  chars: number;
  truncated: boolean;
}

/** Durable intent derived from authoritative user rows in the append-only Session. */
export interface AgentGoalFrame {
  schemaVersion: 1;
  originalRequest: AgentGoalDirective | null;
  userDirectives: AgentGoalDirective[];
  sourceUserMessages: number;
  omittedUserDirectives: number;
  desiredOutcome: string | null;
  hardConstraints: string[];
  userPreferences: string[];
  explicitNonGoals: string[];
  completionCriteria: string[];
  requiredEvidence: string[];
  assumptions: string[];
  decisions: string[];
  corrections: string[];
  openObligations: string[];
}

export interface AgentFocusRequest {
  kind: 'media_pool_item' | 'timeline_item';
  exactId: string;
}

export interface AgentSituationFrame {
  generation: number;
  revision: number;
  observedAt: number;
  project: AgentEntityMention | null;
  timeline: AgentEntityMention | null;
  resolvePage: string | null;
  sharedFocus: AgentSharedFocus | null;
  entities: AgentEntityMention[];
  facts: AgentModelFact[];
  evidence: AgentEvidenceRef[];
  recentDeltas: AgentSemanticDelta[];
  blockers: string[];
  unknowns: string[];
}

export type AgentPublicVerb = 'status' | 'inspect' | 'inspect_operation' | 'audit' | 'plan' | 'execute';

export interface AgentActionDescriptor {
  actionId: ProtectedWorkflowId;
  version: '1';
  domain: string;
  intent: string;
  invoke: string;
  publicVerb: AgentPublicVerb;
  readOnly: boolean;
  risk: WorkflowRiskLevel;
  blastRadius: WorkflowBlastRadius;
  approvalPolicy: WorkflowApprovalPolicy;
  recoveryClass: WorkflowRecoveryClass;
  verificationLevel: ProtectedVerificationLevel;
  requiredCapabilities: ResolveCapabilityId[];
}

export interface AgentContextPack {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  compiledAt: number;
  goal: AgentGoalFrame;
  situation: AgentSituationFrame;
  relevantActions: AgentActionDescriptor[];
  decision: AgentDecisionFrame;
  actionOffers: AgentActionOffer[];
  budget: {
    narrativeMessages: number;
    goalChars: number;
    worldFacts: number;
    evidenceRefs: number;
    semanticDeltas: number;
    actionDescriptors: number;
  };
}

export interface AgentTurnTrace {
  schemaVersion: 1;
  sessionId: string;
  turnId: string;
  startedAt: number;
  endedAt: number;
  outcome: 'completed' | 'failed';
  modelCalls: number;
  providerUsage: {
    complete: boolean;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
  protectedToolCalls: number;
  protectedToolFailures: number;
  invalidToolCalls: number;
  redundantToolCalls: number;
  workflowIds: ProtectedWorkflowId[];
  resolveMetricsAvailable: boolean;
  resolveCalls: number | null;
  resolveDurationMs: number | null;
  staleTargetFailures: number;
  verificationFailures: number;
  maxContextBudget: {
    narrativeMessages: number;
    goalChars: number;
    worldFacts: number;
    evidenceRefs: number;
    semanticDeltas: number;
    actionDescriptors: number;
  };
}
