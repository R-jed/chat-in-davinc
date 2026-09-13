export interface AppConfig {
  /** Canonical product Tunnel ID. The normal COS -> CID product path owns exactly one Tunnel. */
  tunnelId: string;
  /**
   * Legacy compatibility alias from the pre-2026-09-11 dual-tunnel build.
   * During migration it is persisted equal to tunnelId so the old renderer can keep working
   * until the COS shell replaces it. It is not a second runtime authority.
   */
  workflowTunnelId: string;
  projectLocations: ProjectLocation[];
  chatgptVerified: boolean;
  /** Legacy UI alias for chatgptVerified; it does not describe a second connector anymore. */
  workflowChatgptVerified: boolean;
  language: UiLanguagePreference;
  navigationLayout: NavigationLayoutPreference;
  sidebarCollapsed: boolean;
  autoConnectOnLaunch: boolean;
  keepRunningOnWindowClose: boolean;
  showMenuBarIcon: boolean;
  launchAtLogin: boolean;
  developerMode: boolean;
}

export type UiLanguagePreference = 'system' | 'en' | 'zh-CN';
export type NavigationLayoutPreference = 'topbar' | 'sidebar';

export interface ProjectLocation {
  name: string;
  path: string;
}

export interface ResolveProbe {
  installed: boolean;
  mcpPath: string;
  serverName: string | null;
  serverVersion: string | null;
  protocolVersion: string | null;
  tools: string[];
  running: boolean | null;
  reachable: boolean;
  detail: string;
}

export type TunnelState = 'disconnected' | 'starting' | 'connected' | 'offline' | 'error';

export interface TunnelStatus {
  state: TunnelState;
  binaryPath: string | null;
  clientVersion: string | null;
  healthBase: string | null;
  health: boolean | null;
  ready: boolean | null;
  probe: string | null;
  lastPollSuccessMs: number | null;
  toolCallCount: number;
  lastToolCallMs: number | null;
  lastToolName: string | null;
  pid: number | null;
  detail: string;
}

export interface ResolveGatewayStatus {
  active: boolean;
  rawRequestAt: number | null;
  workflowRequestAt: number | null;
  lastToolCallAt: number | null;
  lastToolName: string | null;
  schemaHash: string | null;
}

export type WorkflowRiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type WorkflowBlastRadius = 'item' | 'track' | 'timeline' | 'project' | 'system' | 'unknown';
export type WorkflowApprovalPolicy = 'none' | 'local_required';
export type WorkflowRecoveryClass = 'A' | 'B' | 'C' | 'D';
export type WorkflowPreviewMode = 'native' | 'derived_plan' | 'unavailable';

export type ResolveCapabilityStatus = 'available' | 'unavailable' | 'conditional' | 'unreliable' | 'unknown';
export type ResolveCapabilityEvidenceSource = 'measured' | 'reported' | 'vendor' | 'code_floor';
export type ResolveCapabilityQualification = 'declared' | 'runtime_observed' | 'behaviorally_qualified';
export type ResolveCapabilityId =
  | 'resolve.status.read'
  | 'resolve.sandboxed_script.read'
  | 'project.identity.read'
  | 'project.settings.read'
  | 'media.inventory.read'
  | 'media.clip_detail.read'
  | 'media.link_status.read'
  | 'edit.timeline_structure.read'
  | 'edit.transition_fade.read'
  | 'edit.review_marker.read'
  | 'edit.review_marker.write'
  | 'edit.track.write'
  | 'fusion.composition.read'
  | 'fusion.graph.read'
  | 'color.pipeline.read'
  | 'color.graph.read'
  | 'color.grade_version.read'
  | 'color.grade_version.write'
  | 'fairlight.mapping.read'
  | 'fairlight.clip_processing.read'
  | 'deliver.capability_matrix.read'
  | 'deliver.settings.partial_read';

export interface ResolveCapabilityEvidence {
  capabilityId: ResolveCapabilityId;
  symbol: string;
  introducedIn: string | null;
  evidenceSource: ResolveCapabilityEvidenceSource;
  qualification: ResolveCapabilityQualification;
  evidenceBuild: string | null;
  status: ResolveCapabilityStatus;
  requirements: string[];
  limitations: string[];
  probeStrategy: string;
}

export interface WorkflowRiskAssessment {
  tool: string;
  workflowId: string | null;
  workflowVersion: string | null;
  riskLevel: WorkflowRiskLevel;
  riskEstablished: boolean;
  executable: boolean;
  readOnly: boolean | null;
  destructive: boolean | null;
  blastRadius: WorkflowBlastRadius;
  confirmationRequired: boolean;
  approvalPolicy: WorkflowApprovalPolicy | null;
  recoveryClass: WorkflowRecoveryClass | null;
  previewMode: WorkflowPreviewMode | null;
  verificationLevel: ProtectedVerificationLevel | null;
  reasons: string[];
}

export interface WorkflowAuditEntry {
  id: string;
  tool: string;
  startedAt: number;
  durationMs: number;
  outcome: 'success' | 'failure';
}

export type ProtectedWorkflowId =
  | 'system.connection_status.v1'
  | 'system.capability_snapshot.v1'
  | 'project.identity.v1'
  | 'project.settings_summary.v1'
  | 'media.inventory_summary.v1'
  | 'media.clip_inspect.v1'
  | 'media.link_status.v1'
  | 'edit.timeline_summary.v1'
  | 'edit.structure_inspect.v1'
  | 'edit.gaps_overlaps.v1'
  | 'edit.source_range_report.v1'
  | 'edit.transition_inspect.v1'
  | 'edit.review_annotations_inspect.v1'
  | 'fusion.composition_inspect.v1'
  | 'fusion.graph_inspect.v1'
  | 'color.pipeline_inspect.v1'
  | 'color.graph_inventory.v1'
  | 'color.grade_version_inspect.v1'
  | 'color.grade_version_create.v1'
  | 'fairlight.mapping_inspect.v1'
  | 'fairlight.clip_processing_inspect.v1'
  | 'deliver.capability_matrix.v1'
  | 'deliver.settings_inspect.v1'
  | 'project.preflight.v1'
  | 'activity.audit_recent.v1'
  | 'edit.track_add.v1'
  | 'edit.timeline_structural_guard.v1'
  | 'edit.review_marker_add.v1';

export type ProtectedOperationStatus = 'success' | 'partial' | 'blocked' | 'failed' | 'ambiguous';
export type ProtectedVerificationStatus = 'passed' | 'partial' | 'failed' | 'contradiction' | 'unverified';
export type ProtectedVerificationLevel =
  | 'API_READBACK'
  | 'STRUCTURAL_READBACK'
  | 'RENDER_VERIFIED'
  | 'AUDIO_VERIFIED'
  | 'DELIVERABLE_VERIFIED';

export interface ProtectedVerification {
  status: ProtectedVerificationStatus;
  level_reached?: ProtectedVerificationLevel;
  checks: string[];
}

export interface ProtectedOperation {
  status: ProtectedOperationStatus;
  workflow_id: ProtectedWorkflowId;
  workflow_version: '1';
  changeset_id?: string;
  execution_id?: string;
  risk: WorkflowRiskLevel;
  blast_radius: WorkflowBlastRadius;
  changes?: Array<{
    kind: 'review_marker_added';
    target_item_id: string;
    frame_offset: number;
    custom_data: string;
  } | {
    kind: 'track_added';
    track_type: 'video';
    track_index: number;
  } | {
    kind: 'grade_version_created';
    name: string;
  }>;
  warnings?: string[];
  verification: ProtectedVerification;
  recovery?: {
    status: 'not_needed' | 'recovered' | 'failed' | 'unavailable';
    checks: string[];
  };
}

export interface ProtectedWorkflowResult<T> {
  result: T;
  operation: ProtectedOperation;
}

export interface WorkflowDefinition {
  id: ProtectedWorkflowId;
  version: '1';
  readOnly: boolean;
  risk: WorkflowRiskLevel;
  blastRadius: WorkflowBlastRadius;
  approvalPolicy: WorkflowApprovalPolicy;
  recoveryClass: WorkflowRecoveryClass;
  previewMode: WorkflowPreviewMode;
  verificationLevel: ProtectedVerificationLevel;
  requiredCapabilities: ResolveCapabilityId[];
}

export type ReviewMarkerColor =
  | 'Blue' | 'Cyan' | 'Green' | 'Yellow' | 'Red' | 'Pink' | 'Purple' | 'Fuchsia'
  | 'Rose' | 'Lavender' | 'Sky' | 'Mint' | 'Lemon' | 'Sand' | 'Cocoa' | 'Cream';

export interface ReviewMarkerAddRequestedParameters {
  target: 'timeline_item';
  frameOffset: number;
  color: ReviewMarkerColor;
  name: string;
  note: string;
  duration: number;
}

export interface LegacyReviewMarkerAddRequestedParameters {
  target: 'current_video_item';
  frameOffset: number;
  color: ReviewMarkerColor;
  name: string;
  note: string;
  duration: number;
}

interface WorkflowPlanBase {
  plan_id: string;
  plan_hash: string;
  hash_algorithm: 'sha256';
  canonicalization_version: '1';
  plan_kind: 'review_marker_add' | 'edit_structural' | 'edit_track_add' | 'color_grade_version_create';
  workflow_id: ProtectedWorkflowId;
  workflow_version: '1';
  created_at: string;
  expires_at: string;
  resolve_version: string;
  project_unique_id: string;
  timeline_unique_id: string;
  target_ids: [string];
  input_fingerprint: string;
  risk_level: WorkflowRiskLevel;
  blast_radius: WorkflowBlastRadius;
  preview_mode: WorkflowPreviewMode;
  recovery_class: WorkflowRecoveryClass;
  required_backup: boolean;
  verification_level: ProtectedVerificationLevel;
  capability_evidence_refs: ResolveCapabilityId[];
}

export interface ReviewMarkerWorkflowPlan extends WorkflowPlanBase {
  plan_kind: 'review_marker_add';
  workflow_id: 'edit.review_marker_add.v1';
  requested_parameters: ReviewMarkerAddRequestedParameters | LegacyReviewMarkerAddRequestedParameters;
  proposed_changes: Array<{
    kind: 'add_review_marker';
    target_item_id: string;
    frame_offset: number;
    color: ReviewMarkerColor;
    name: string;
    note: string;
    duration: number;
    custom_data: string;
  }>;
  preconditions: {
    target_item_id: string;
    track_type: string;
    track_index: number;
    track_locked: false;
    item_start: number;
    item_end: number;
    item_duration: number;
    marker_frame_empty: true;
    marker_state_hash: string;
  };
  recovery_class: 'B';
  required_backup: false;
  verification_level: 'API_READBACK';
  verification_contract: {
    id: 'edit.review_marker_add.verify.v1';
    version: '1';
  };
}

export interface EditStructuralWorkflowPlan extends WorkflowPlanBase {
  plan_kind: 'edit_structural';
  workflow_id: 'edit.timeline_structural_guard.v1';
  requested_parameters: {
    target: 'current_timeline';
    intent: 'structural_edit';
    summary: string;
  };
  proposed_changes: Array<{
    kind: 'structural_edit';
    summary: string;
  }>;
  preconditions: {
    timeline_name: string;
    timeline_start_frame: number | null;
    timeline_end_frame: number | null;
    track_count: number;
    item_count: number;
    structure_fingerprint: string;
  };
  recovery_class: 'C';
  required_backup: true;
  verification_level: 'STRUCTURAL_READBACK';
  verification_contract: {
    id: 'edit.timeline_structural_guard.verify.v1';
    version: '1';
  };
}

export interface EditTrackAddWorkflowPlan extends WorkflowPlanBase {
  plan_kind: 'edit_track_add';
  workflow_id: 'edit.track_add.v1';
  requested_parameters: {
    target: 'current_timeline';
    track_type: 'video';
    placement: 'append';
  };
  proposed_changes: [{
    kind: 'add_track';
    track_type: 'video';
    placement: 'append';
    expected_track_index: number;
  }];
  preconditions: {
    timeline_name: string;
    timeline_start_frame: number | null;
    timeline_end_frame: number | null;
    total_track_count_before: number;
    item_count_before: number;
    video_track_count_before: number;
    expected_new_track_index: number;
    structure_fingerprint: string;
  };
  risk_level: 'low';
  blast_radius: 'timeline';
  preview_mode: 'derived_plan';
  recovery_class: 'C';
  required_backup: true;
  verification_level: 'STRUCTURAL_READBACK';
  verification_contract: {
    id: 'edit.track_add.verify.v1';
    version: '1';
  };
}

export interface ColorGradeVersionCreateWorkflowPlan extends WorkflowPlanBase {
  plan_kind: 'color_grade_version_create';
  workflow_id: 'color.grade_version_create.v1';
  requested_parameters: {
    target: 'timeline_item';
    name: string;
    version_type: 0;
  };
  proposed_changes: [{
    kind: 'create_grade_version';
    target_item_id: string;
    name: string;
    version_type: 0;
  }];
  preconditions: {
    target_item_id: string;
    track_index: number;
    current_version: { name: string; type: 0 };
    local_versions: string[];
    remote_versions: string[];
    version_state_hash: string;
  };
  risk_level: 'low';
  blast_radius: 'item';
  preview_mode: 'derived_plan';
  recovery_class: 'B';
  required_backup: false;
  verification_level: 'API_READBACK';
  verification_contract: {
    id: 'color.grade_version_create.verify.v1';
    version: '1';
  };
}

export type WorkflowPlan =
  | ReviewMarkerWorkflowPlan
  | EditStructuralWorkflowPlan
  | EditTrackAddWorkflowPlan
  | ColorGradeVersionCreateWorkflowPlan;

export type WorkflowPlanState = 'ready' | 'approved' | 'rejected' | 'expired' | 'stale' | 'consumed';

export type WorkflowExecutionState =
  | 'prepared'
  | 'dispatch_started'
  | 'dispatch_returned'
  | 'verifying'
  | 'verified'
  | 'failed'
  | 'contradiction'
  | 'ambiguous'
  | 'recovering'
  | 'recovered'
  | 'recovery_failed';

export type WorkflowChangeSetState =
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'stale'
  | 'prepared'
  | 'dispatched'
  | 'verifying'
  | 'verified'
  | 'failed'
  | 'contradiction'
  | 'ambiguous'
  | 'recovering'
  | 'recovered'
  | 'recovery_failed';

export interface WorkflowChangeSetProjection {
  changeset_id: string;
  plan_id: string;
  workflow_id: ProtectedWorkflowId;
  state: WorkflowChangeSetState;
  project_unique_id: string;
  timeline_unique_id: string;
  target_ids: string[];
  expected_changes: WorkflowPlan['proposed_changes'];
  actual_observation: {
    kind: 'review_marker_state';
    target_item_id: string;
    frame_offset: number;
    present: boolean;
    color: ReviewMarkerColor | null;
    duration: number | null;
    name: string | null;
    note: string | null;
  } | {
    kind: 'track_add_state';
    track_type: 'video';
    track_index: number;
    present: boolean;
    item_count: number | null;
  } | {
    kind: 'grade_version_state';
    name: string;
    version_type: 0;
    present: boolean;
    current: boolean;
  } | null;
  execution_id: string | null;
  verification_status: ProtectedVerificationStatus;
  verification_level: ProtectedVerificationLevel | null;
  recovery_status: WorkflowExecutionProjection['recovery_status'] | null;
  backup: WorkflowBackupProjection | null;
  reason: string | null;
}

export interface WorkflowExecutionProjection {
  execution_id: string;
  plan_id: string;
  state: WorkflowExecutionState;
  writer_returned: boolean | null;
  writer_precondition_ok: boolean | null;
  marker_readback: {
    color: ReviewMarkerColor;
    duration: number;
    note: string;
    name: string;
    customData: string;
  } | null;
  structural_readback: {
    kind: 'track_add_state';
    track_type: 'video';
    track_index: number;
    present: boolean;
    item_count: number | null;
  } | null;
  grade_version_readback: {
    name: string;
    version_type: 0;
    present: boolean;
    current: boolean;
  } | null;
  reason: string | null;
  recovery_status: 'not_needed' | 'recovered' | 'failed' | 'unavailable';
}

export interface WorkflowApprovalRecord {
  approval_id: string;
  plan_id: string;
  plan_hash: string;
  approved_at: string;
  expires_at: string;
  approved_scope: 'exact_plan';
  provenance: 'local_renderer';
}

export interface WorkflowBackupProjection {
  strategy: 'timeline_duplicate';
  source_timeline_id: string;
  backup_timeline_id: string;
  backup_timeline_name: string;
  current_timeline_restored: true;
  created_at: string;
}

export interface WorkflowPlanProjection {
  plan: WorkflowPlan;
  state: WorkflowPlanState;
  approval: WorkflowApprovalRecord | null;
  reason: string | null;
  execution: WorkflowExecutionProjection | null;
  backup: WorkflowBackupProjection | null;
  change_set: WorkflowChangeSetProjection;
}

export interface RendererWorkflowPlanProjection {
  planId: string;
  workflowId: ProtectedWorkflowId;
  planKind: WorkflowPlan['plan_kind'];
  state: WorkflowPlanState;
  risk: WorkflowRiskLevel;
  blastRadius: WorkflowBlastRadius;
  createdAt: string;
  expiresAt: string;
  requiredBackup: boolean;
  backupState: 'not_required' | 'required' | 'created';
  verificationLevel: ProtectedVerificationLevel;
  approvalState: 'awaiting' | 'approved' | 'rejected' | 'closed';
  approval: {
    approvedAt: string;
    expiresAt: string;
  } | null;
  target: {
    kind: 'timeline' | 'timeline_item';
    handle: string | null;
    label: string;
    generation: number | null;
  };
  proposedChange:
    | {
        kind: 'add_review_marker';
        name: string;
        note: string;
        color: ReviewMarkerColor;
        frameOffset: number;
        duration: number;
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
    | {
        kind: 'structural_edit';
        summary: string;
      };
  execution: {
    state: WorkflowExecutionState;
    verificationStatus: ProtectedVerificationStatus;
    verificationLevel: ProtectedVerificationLevel | null;
    recoveryStatus: WorkflowExecutionProjection['recovery_status'] | null;
    actualPresent: boolean | null;
  } | null;
}

export type WorkflowLedgerEventType =
  | 'plan_created'
  | 'plan_rejected'
  | 'plan_stale'
  | 'approval_granted'
  | 'approval_revoked'
  | 'backup_started'
  | 'backup_cancelled'
  | 'backup_created'
  | 'execution_prepared'
  | 'dispatch_started'
  | 'dispatch_returned'
  | 'execution_cancelled'
  | 'verification_started'
  | 'verification_completed'
  | 'execution_ambiguous'
  | 'recovery_started'
  | 'recovery_completed';

export interface WorkflowLedgerEvent {
  ledger_schema_version: 1;
  event_id: string;
  event_type: WorkflowLedgerEventType;
  recorded_at: string;
  plan_id?: string;
  approval_id?: string;
  execution_id?: string;
  workflow_id?: ProtectedWorkflowId;
  workflow_version?: '1';
  payload: Record<string, unknown>;
}

export type WorkflowInspectTarget =
  | 'connection'
  | 'capabilities'
  | 'project'
  | 'media'
  | 'edit'
  | 'fusion'
  | 'color'
  | 'fairlight'
  | 'deliver'
  | 'preflight';

export interface RendererWorkflowObservationReceipt {
  target: 'fusion' | 'color' | 'fairlight' | 'deliver';
  schemaHash: string;
}

export type ProjectPreflightProfile = 'general' | 'media' | 'edit' | 'fusion' | 'color' | 'fairlight' | 'delivery';

export type ProjectSettingsFactKey =
  | 'timelineResolution'
  | 'timelineFrameRate'
  | 'timelinePlaybackFrameRate'
  | 'outputResolution'
  | 'frameRateMismatchBehavior'
  | 'colorScienceMode'
  | 'videoMonitorFormat';

export interface ProjectSettingsFacts {
  timelineResolution: { width: number; height: number } | null;
  timelineFrameRate: number | null;
  timelinePlaybackFrameRate: number | null;
  outputResolution: { width: number; height: number } | null;
  frameRateMismatchBehavior: string | null;
  colorScienceMode: string | null;
  videoMonitorFormat: string | null;
  unverified: ProjectSettingsFactKey[];
}

export interface ProjectSettingsSummary {
  readerId: 'project.settings_summary.v1';
  project: ProjectSettingsFacts | null;
  timeline: ProjectSettingsFacts | null;
  timelineUsesCustomSettings: boolean | null;
}

export interface MediaInventoryFolderRow {
  id: string;
  name: string;
  parentId: string | null;
  directItemCount: number | null;
}

export interface MediaInventoryItemRow {
  id: string;
  name: string;
  folderId: string;
  folderName: string;
  resolveType: string | null;
  isTimeline: boolean;
  duration: string | null;
  frames: number | null;
  fps: number | null;
  resolution: { width: number; height: number } | null;
  videoCodec: string | null;
  audioCodec: string | null;
  online: boolean | null;
  hasProxyMedia: boolean | null;
}

export interface MediaInventorySummary {
  readerId: 'media.inventory_summary.v1';
  mediaPoolId: string | null;
  rootFolder: { id: string; name: string } | null;
  currentFolder: { id: string; name: string } | null;
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
  observedMotionFrameRates: number[];
  observedMotionResolutions: Array<{ width: number; height: number; count: number }>;
  referenceTimeline: {
    frameRate: number | null;
    resolution: { width: number; height: number } | null;
  } | null;
  motionFrameRateMismatchCount: number | null;
  motionResolutionMismatchCount: number | null;
  folders: MediaInventoryFolderRow[];
  items: MediaInventoryItemRow[];
  complete: boolean;
  foldersTruncated: boolean;
  itemsTruncated: boolean;
  unverified: Array<'optimizedMediaState' | 'fullResolutionLinkState'>;
}

export type EditTimelineTrackType = 'video' | 'audio' | 'subtitle';

export interface MediaLinkStatus {
  readerId: 'media.link_status.v1';
  requestedItemId: string | null;
  itemLookup: 'not_requested' | 'found' | 'not_found' | 'unverified';
  search: {
    foldersObserved: number;
    itemsObserved: number;
    truncated: boolean;
  };
  methodEvidence: {
    strategy: 'dir';
    mediaPool: {
      probed: boolean;
      checkedMethods: Array<'RelinkClips' | 'UnlinkClips'>;
      observedMethods: string[];
      missingMethods: string[];
    };
    mediaPoolItem: {
      probed: boolean;
      checkedMethods: Array<'LinkProxyMedia' | 'UnlinkProxyMedia' | 'LinkFullResolutionMedia'>;
      observedMethods: string[];
      missingMethods: string[];
    };
  };
  capabilities: Array<{
    id: 'relink' | 'unlink' | 'linkProxy' | 'unlinkProxy' | 'linkFullResolution';
    symbol: string;
    owner: 'MediaPool' | 'MediaPoolItem';
    surface: 'observed' | 'missing' | 'unverified';
    qualification: 'runtime_observed' | 'unknown';
    protectedWrite: 'not_registered';
    limitations: string[];
  }>;
  unverified: Array<
    | 'behavioralWriteQualification'
    | 'fullResolutionLinkState'
    | 'proxyGeneration'
    | 'optimizedMediaGeneration'
    | 'itemSurface'
  >;
}

export interface MediaClipInspect {
  readerId: 'media.clip_inspect.v1';
  requestedItemId: string;
  lookup: 'found' | 'not_found' | 'unverified';
  search: {
    foldersObserved: number;
    itemsObserved: number;
    truncated: boolean;
  };
  item: {
    id: string;
    name: string;
    resolveType: string | null;
    isTimeline: boolean | null;
    duration: string | null;
    frames: number | null;
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
    customData: string | null;
  }>;
  markersTruncated: boolean;
  methodEvidence: {
    strategy: 'dir';
    checkedMethods: string[];
    observedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
  };
  unverified: Array<
    | 'fullResolutionLinkState'
    | 'onlineState'
    | 'proxyState'
    | 'clipProperties'
    | 'metadata'
    | 'thirdPartyMetadata'
    | 'markers'
    | 'flags'
    | 'clipColor'
    | 'audioMapping'
    | 'timelineIdentity'
  >;
}

export interface EditTimelineTrackRow {
  type: EditTimelineTrackType;
  index: number;
  name: string | null;
  enabled: boolean | null;
  locked: boolean | null;
  itemCount: number;
  offlineSourceItemCountObserved: number;
  onlineStateUnverifiedItemCountObserved: number;
  itemsWithoutMediaPoolReferenceCountObserved: number;
}

export interface EditStructureInspect {
  readerId: 'edit.structure_inspect.v1';
  timeline: {
    id: string;
    name: string;
    startFrame: number | null;
    endFrame: number | null;
  };
  tracksObserved: number;
  itemsObserved: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  methodEvidence: {
    strategy: 'dir';
    checkedMethods: string[];
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
    itemsProbed: number;
  };
  tracks: Array<{
    type: EditTimelineTrackType;
    index: number;
    name: string | null;
    enabled: boolean | null;
    locked: boolean | null;
    items: Array<{
      id: string;
      name: string;
      recordStart: number | null;
      recordEnd: number | null;
      duration: number | null;
      sourceStart: number | null;
      sourceEnd: number | null;
      leftOffset: number | null;
      rightOffset: number | null;
      mediaPoolItemId: string | null;
      recordRangeConsistent: boolean | null;
    }>;
  }>;
  unverified: Array<'recordRangeBoundarySemantics' | 'sourceRangeBoundarySemantics' | 'transitionState' | 'linkedAudioRelationships'>;
}

export type EditRangeRelationshipKind = 'gap' | 'overlap' | 'boundary_ambiguous';

export interface EditGapsOverlapsInspect {
  readerId: 'edit.gaps_overlaps.v1';
  timeline: {
    id: string;
    name: string;
  };
  tracksObserved: number;
  itemsObserved: number;
  adjacentPairsObserved: number;
  comparablePairsObserved: number;
  unverifiedTrackCount: number;
  gapCountObserved: number;
  overlapCountObserved: number;
  boundaryAmbiguousCountObserved: number;
  complete: boolean;
  methodEvidence: {
    sourceReaderId: 'edit.structure_inspect.v1';
    requiredMethods: Array<'GetUniqueId' | 'GetName' | 'GetStart' | 'GetEnd'>;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
  };
  relationships: Array<{
    kind: EditRangeRelationshipKind;
    trackType: EditTimelineTrackType;
    trackIndex: number;
    trackName: string | null;
    leftItem: {
      id: string;
      name: string;
      recordStart: number;
      recordEnd: number;
    };
    rightItem: {
      id: string;
      name: string;
      recordStart: number;
      recordEnd: number;
    };
    boundaryDelta: number;
  }>;
  unverified: Array<'recordRangeBoundarySemantics' | 'ambiguousBoundaryClassification' | 'incompleteRecordRanges'>;
}

export interface EditSourceRangeReport {
  readerId: 'edit.source_range_report.v1';
  timeline: {
    id: string;
    name: string;
  };
  tracksObserved: number;
  itemsObserved: number;
  itemsReported: number;
  itemsWithMediaPoolReference: number;
  itemsWithoutMediaPoolReference: number;
  itemsWithCompleteRecordGetterValues: number;
  itemsWithCompleteSourceGetterValues: number;
  complete: boolean;
  methodEvidence: {
    sourceReaderId: 'edit.structure_inspect.v1';
    requiredMethods: Array<'GetUniqueId' | 'GetName' | 'GetStart' | 'GetEnd' | 'GetDuration' | 'GetSourceStartFrame' | 'GetSourceEndFrame' | 'GetMediaPoolItem'>;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
  };
  items: Array<{
    trackType: EditTimelineTrackType;
    trackIndex: number;
    trackName: string | null;
    timelineItemId: string;
    name: string;
    mediaPoolItemId: string | null;
    recordStartGetterValue: number | null;
    recordEndGetterValue: number | null;
    durationGetterValue: number | null;
    sourceStartFrameGetterValue: number | null;
    sourceEndFrameGetterValue: number | null;
    recordRangeArithmeticConsistent: boolean | null;
  }>;
  unverified: Array<'recordRangeBoundarySemantics' | 'sourceRangeBoundarySemantics' | 'sourceCoordinateSemantics' | 'sourceRangeArithmetic' | 'conformMatch'>;
}

export interface EditTransitionInspect {
  readerId: 'edit.transition_inspect.v1';
  timeline: {
    id: string;
    name: string;
  };
  tracksObserved: number;
  itemsObserved: number;
  itemsReported: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  getFadesReadbackObservedCount: number;
  getFadesReadbackFailureCount: number;
  getFadesUnavailableCount: number;
  complete: boolean;
  methodEvidence: {
    strategy: 'dir';
    checkedMethods: Array<'AddTransition' | 'GetFades' | 'SetFades'>;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedReadMethods: string[];
    itemsProbed: number;
  };
  items: Array<{
    trackType: 'video' | 'audio';
    trackIndex: number;
    trackName: string | null;
    timelineItemId: string;
    name: string;
    fadeInGetterValue: number | null;
    fadeOutGetterValue: number | null;
    getFadesReadback: 'observed' | 'failed' | 'unavailable';
  }>;
  unverified: Array<'editTransitionState' | 'transitionReadback' | 'fadeValueSemantics' | 'transitionWriterQualification' | 'fadeWriterQualification' | 'itemMethodSurface'>;
}

export interface EditReviewAnnotationsInspect {
  readerId: 'edit.review_annotations_inspect.v1';
  timeline: {
    id: string;
    name: string;
  };
  tracksObserved: number;
  itemsObserved: number;
  mediaPoolItemsObserved: number;
  timelineMarkerCountObserved: number;
  timelineItemMarkerCountObserved: number;
  mediaPoolMarkerCountObserved: number;
  flaggedMediaPoolItemCountObserved: number;
  coloredMediaPoolItemCountObserved: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  markerRowsTruncated: boolean;
  complete: boolean;
  methodEvidence: {
    strategy: 'dir';
    timeline: {
      checkedMethods: Array<'GetMarkers'>;
      observedMethods: string[];
      missingMethods: string[];
      failedMethods: string[];
    };
    timelineItem: {
      checkedMethods: Array<'GetUniqueId' | 'GetName' | 'GetMarkers' | 'GetMediaPoolItem'>;
      fullyObservedMethods: string[];
      missingMethods: string[];
      failedMethods: string[];
      itemsProbed: number;
    };
    mediaPoolItem: {
      checkedMethods: Array<'GetUniqueId' | 'GetName' | 'GetMarkers' | 'GetFlagList' | 'GetClipColor'>;
      fullyObservedMethods: string[];
      missingMethods: string[];
      failedMethods: string[];
      itemsProbed: number;
    };
  };
  markers: Array<{
    scope: 'timeline' | 'timeline_item' | 'media_pool_item';
    targetId: string;
    targetName: string;
    trackType: EditTimelineTrackType | null;
    trackIndex: number | null;
    frame: number;
    color: string | null;
    duration: number | null;
    name: string | null;
    note: string | null;
    customData: string | null;
  }>;
  mediaPoolAnnotations: Array<{
    mediaPoolItemId: string;
    name: string;
    flags: string[];
    flagsTruncated: boolean;
    clipColor: string | null;
    markerCountObserved: number;
  }>;
  unverified: Array<
    | 'timelineMarkers'
    | 'timelineItemMarkers'
    | 'mediaPoolMarkers'
    | 'flags'
    | 'clipColor'
    | 'timelineItemIdentity'
    | 'mediaPoolAssociation'
    | 'mediaPoolIdentity'
    | 'markerRows'
  >;
}

export interface EditTimelineSummary {
  readerId: 'edit.timeline_summary.v1';
  timeline: {
    id: string;
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
  tracks: EditTimelineTrackRow[];
  complete: boolean;
  tracksTruncated: boolean;
  sourceStateScanTruncated: boolean;
  unverified: Array<'gapOverlapIndicators' | 'sourceRangeConflicts'>;
}

export interface FusionCompositionInspect {
  readerId: 'fusion.composition_inspect.v1';
  timeline: { id: string; name: string };
  videoTrackCount: number;
  tracksScanned: number;
  videoItemsObserved: number;
  itemsReported: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  namesTruncated: boolean;
  items: Array<{
    trackIndex: number;
    itemIndex: number;
    id: string | null;
    name: string | null;
    compositionCountObserved: number | null;
    compositionNames: string[];
    namesTruncated: boolean;
    nameListShape: 'list' | 'empty_dict_zero_count' | 'unexpected' | null;
    missingMethods: string[];
    failedMethods: string[];
  }>;
  complete: boolean;
  methodEvidence: {
    strategy: 'dir';
    checkedMethods: Array<
      | 'GetUniqueId'
      | 'GetName'
      | 'GetFusionCompCount'
      | 'GetFusionCompNameList'
      | 'GetFusionCompByIndex'
      | 'GetFusionCompByName'
    >;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
    itemsProbed: number;
  };
  unverified: Array<
    | 'itemIdentity'
    | 'compositionCount'
    | 'compositionNames'
    | 'compositionAccessSurface'
    | 'timelineItemList'
    | 'compositionGraph'
    | 'pixelOutput'
  >;
}

export interface FusionGraphInspect {
  readerId: 'fusion.graph_inspect.v1';
  timeline: { id: string; name: string };
  videoTrackCount: number;
  tracksScanned: number;
  videoItemsObserved: number;
  itemsScanned: number;
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
  compositions: Array<{
    trackIndex: number;
    itemIndex: number;
    timelineItemId: string;
    timelineItemName: string;
    compositionName: string;
    toolCountObserved: number;
    tools: Array<{
      name: string;
      id: string;
      inputCountObserved: number;
      outputCountObserved: number;
    }>;
    edges: Array<{
      sourceToolName: string;
      sourceToolId: string;
      sourceOutputId: string;
      targetToolName: string;
      targetToolId: string;
      targetInputId: string;
      bidirectionalReadback: boolean;
    }>;
  }>;
  complete: boolean;
  methodEvidence: {
    checkedMethods: Array<
      | 'GetFusionCompByName'
      | 'GetToolList'
      | 'GetInputList'
      | 'GetOutputList'
      | 'GetConnectedInputs'
      | 'GetConnectedOutput'
    >;
    failedMethods: string[];
    compositionObjectsProbed: number;
    toolsProbed: number;
    outputsProbed: number;
    edgesReadbackProbed: number;
  };
  unverified: Array<
    | 'compositionObjectAccess'
    | 'toolInventory'
    | 'portInventory'
    | 'edgeReadback'
    | 'controlValues'
    | 'pixelOutput'
    | 'graphWrites'
  >;
}

export interface ColorPipelineItemRow {
  id: string;
  name: string;
  nodeCount: number | null;
  groupName: string | null;
  currentVersionName: string | null;
  currentVersionType: number | null;
  localVersionCount: number;
  remoteVersionCount: number;
  lutReferenceCount: number;
}

export interface ColorPipelineSummary {
  readerId: 'color.pipeline_inspect.v1';
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
    colorSpaceAwareGradingTools: boolean | null;
  } | null;
  colorGroupCount: number;
  colorGroups: Array<{ name: string; currentTimelineItemCount: number }>;
  videoItemCountObserved: number;
  videoItemsScanned: number;
  groupedItemCountObserved: number;
  nodeCountObserved: number;
  lutReferenceCountObserved: number;
  items: ColorPipelineItemRow[];
  complete: boolean;
  itemsTruncated: boolean;
  nodesTruncated: boolean;
  unverified: Array<'dctlReferences' | 'additionalNodeStackLayers'>;
}

export interface ColorGraphNodeRow {
  index: number;
  label: string;
  lutReferencePresent: boolean | null;
  cacheMode: number | null;
  cacheModeShape: 'integer' | 'null' | 'unavailable';
  toolNames: string[];
  toolListShape: 'list' | 'null';
  toolsTruncated: boolean;
}

export interface ColorGraphScopeRow {
  scope: 'timeline' | 'item' | 'group_pre' | 'group_post';
  trackIndex: number | null;
  itemIndex: number | null;
  layerIndex: number | null;
  timelineItemId: string | null;
  timelineItemName: string | null;
  colorGroupIndex: number | null;
  colorGroupName: string | null;
  graphAccess: 'observed' | 'null' | 'missing' | 'failed';
  nodeCountObserved: number | null;
  nodesReported: number;
  nodesTruncated: boolean;
  nodes: ColorGraphNodeRow[];
  missingMethods: string[];
  failedMethods: string[];
}

export interface ColorGraphInventory {
  readerId: 'color.graph_inventory.v1';
  timeline: { id: string; name: string };
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
  timelineGraph: ColorGraphScopeRow;
  itemGraphs: ColorGraphScopeRow[];
  colorGroupGraphs: ColorGraphScopeRow[];
  complete: boolean;
  methodEvidence: {
    checkedMethods: Array<
      | 'Timeline.GetNodeGraph'
      | 'TimelineItem.GetNodeGraph'
      | 'ColorGroup.GetPreClipNodeGraph'
      | 'ColorGroup.GetPostClipNodeGraph'
      | 'Graph.GetNumNodes'
      | 'Graph.GetNodeLabel'
      | 'Graph.GetLUT'
      | 'Graph.GetNodeCacheMode'
      | 'Graph.GetToolsInNode'
    >;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
    graphObjectsProbed: number;
    nodesProbed: number;
  };
  unverified: Array<
    | 'nodeTopology'
    | 'nodeValues'
    | 'pixelOutput'
    | 'graphWrites'
  >;
}

export interface ColorGradeVersionItemRow {
  trackIndex: number;
  itemIndex: number;
  timelineItemId: string;
  timelineItemName: string;
  currentReadback: 'observed' | 'missing' | 'failed';
  currentVersion: { name: string; type: 0 | 1 } | null;
  localReadback: 'observed' | 'missing' | 'failed';
  localVersionCountObserved: number | null;
  localVersions: string[];
  localVersionsTruncated: boolean;
  remoteReadback: 'observed' | 'missing' | 'failed';
  remoteVersionCountObserved: number | null;
  remoteVersions: string[];
  remoteVersionsTruncated: boolean;
  missingMethods: string[];
  failedMethods: string[];
}

export interface ColorGradeVersionInspect {
  readerId: 'color.grade_version_inspect.v1';
  timeline: { id: string; name: string };
  videoTrackCount: number;
  tracksScanned: number;
  videoItemsObserved: number;
  itemsScanned: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  versionNamesTruncated: boolean;
  items: ColorGradeVersionItemRow[];
  complete: boolean;
  methodEvidence: {
    checkedMethods: Array<'GetVersionNameList' | 'GetCurrentVersion'>;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
    itemsProbed: number;
  };
  unverified: Array<
    | 'versionOrdering'
    | 'versionNameUniqueness'
    | 'crossTypeNameIdentity'
    | 'colorGroupVersions'
    | 'pixelOutput'
    | 'versionWrites'
  >;
}

export interface FairlightTrackRow {
  index: number;
  name: string | null;
  subType: string | null;
  enabled: boolean | null;
  locked: boolean | null;
  itemCount: number;
  voiceIsolation: { isEnabled: boolean; amount: number | null } | null;
  sourceMappingVerifiedItemCount: number;
  sourceMappingUnverifiedItemCount: number;
  embeddedAudioChannelCounts: Array<{ channels: number; count: number }>;
}

export interface FairlightMappingSummary {
  readerId: 'fairlight.mapping_inspect.v1';
  timeline: { id: string; name: string };
  audioTrackCount: number;
  audioItemCountObserved: number;
  itemsScanned: number;
  sourceMappingVerifiedItemCount: number;
  sourceMappingUnverifiedItemCount: number;
  tracks: FairlightTrackRow[];
  complete: boolean;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  unverified: Array<'syncEvidence' | 'transcriptionState'>;
}

export interface FairlightClipProcessingItemRow {
  trackIndex: number;
  itemIndex: number;
  timelineItemId: string;
  timelineItemName: string;
  propertiesReadback: 'observed' | 'missing' | 'failed' | 'incomplete';
  missingPropertyKeys: string[];
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
  voiceReadback: 'observed' | 'missing' | 'failed';
  voiceState: { isEnabled: boolean; amount: number } | null;
  voiceConsistency: 'matched' | 'contradiction' | 'unavailable';
  missingMethods: string[];
  failedMethods: string[];
}

export interface FairlightClipProcessingInspect {
  readerId: 'fairlight.clip_processing_inspect.v1';
  timeline: { id: string; name: string };
  audioTrackCount: number;
  tracksScanned: number;
  audioItemsObserved: number;
  itemsScanned: number;
  tracksTruncated: boolean;
  itemsTruncated: boolean;
  items: FairlightClipProcessingItemRow[];
  complete: boolean;
  methodEvidence: {
    checkedMethods: Array<'GetUniqueId' | 'GetName' | 'GetProperties' | 'GetVoiceIsolationState'>;
    fullyObservedMethods: string[];
    missingMethods: string[];
    failedMethods: string[];
    itemsProbed: number;
  };
  unverified: Array<'automationState' | 'clipEffects' | 'renderedAudio' | 'processingWrites'>;
}

export interface DeliverCapabilityFormatRow {
  name: string;
  extension: string;
  codecCount: number;
  codecs: Array<{ name: string; id: string }>;
  codecSampleTruncated: boolean;
}

export interface DeliverCapabilityMatrix {
  readerId: 'deliver.capability_matrix.v1';
  videoFormatCount: number;
  videoCodecCountObserved: number;
  videoFormats: DeliverCapabilityFormatRow[];
  audioFormatCount: number;
  audioCodecCountObserved: number;
  audioFormats: DeliverCapabilityFormatRow[];
  generalResolutions: Array<{ width: number; height: number }>;
  currentSelection: {
    format: string;
    codec: string;
    resolutionCount: number;
    resolutions: Array<{ width: number; height: number }>;
    resolutionsTruncated: boolean;
  } | null;
  renderPresetCount: number;
  renderPresets: string[];
  renderPresetsTruncated: boolean;
  quickExportPresetCount: number;
  quickExportPresets: string[];
  quickExportPresetsTruncated: boolean;
  complete: boolean;
  formatsTruncated: boolean;
  codecSamplesTruncated: boolean;
  resolutionsTruncated: boolean;
}

export interface DeliverRenderJobRow {
  id: string;
  name: string | null;
  timelineName: string | null;
  status: string | null;
  completionPercentage: number | null;
  outputResolution: { width: number; height: number } | null;
  frameRate: number | null;
  exportVideo: boolean | null;
  exportAudio: boolean | null;
  videoFormat: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  renderMode: string | null;
  targetDirectoryConfigured: boolean | null;
  outputFilenameConfigured: boolean | null;
}

export interface DeliverSettingsInspect {
  readerId: 'deliver.settings_inspect.v1';
  currentFormat: string | null;
  currentCodec: string | null;
  renderMode: 'individualClips' | 'singleClip' | null;
  renderingInProgress: boolean | null;
  renderJobCountObserved: number;
  renderJobs: DeliverRenderJobRow[];
  jobsTruncated: boolean;
  unverified: Array<
    | 'currentTargetDirectory'
    | 'currentOutputFilename'
    | 'currentExportVideo'
    | 'currentExportAudio'
    | 'currentMarkInOut'
    | 'currentSubtitleExport'
  >;
}

export type ProjectPreflightStatus = 'pass' | 'warning' | 'blocked' | 'unverified';

export interface ProjectPreflightCheck {
  id:
    | 'project.identity.v1'
    | 'project.settings_summary.v1'
    | 'media.inventory_summary.v1'
    | 'edit.timeline_summary.v1'
    | 'fusion.composition_inspect.v1'
    | 'fusion.graph_inspect.v1'
    | 'color.pipeline_inspect.v1'
    | 'color.graph_inventory.v1'
    | 'color.grade_version_inspect.v1'
    | 'fairlight.mapping_inspect.v1'
    | 'fairlight.clip_processing_inspect.v1'
    | 'deliver.settings_inspect.v1';
  status: ProjectPreflightStatus;
  issueCodes: string[];
}

export interface ProjectPreflightSummary {
  readerId: 'project.preflight.v1';
  profile: ProjectPreflightProfile;
  status: ProjectPreflightStatus;
  project: { id: string; name: string } | null;
  timeline: { id: string; name: string } | null;
  checks: ProjectPreflightCheck[];
  blockers: string[];
  warnings: string[];
  capabilityGaps: string[];
  capabilityEvidence: ResolveCapabilityEvidence[];
}

export type WorkflowInspectResult =
  | {
      target: 'connection';
      observedAt: number;
      running: boolean | null;
      resolveVersion: string | null;
      serverName: string | null;
      serverVersion: string | null;
      protocolVersion: string | null;
      schemaHash: string;
    }
  | {
      target: 'capabilities';
      observedAt: number;
      resolveVersion: string | null;
      officialToolCount: number;
      officialTools: string[];
      protectedTools: string[];
      capabilities: ResolveCapabilityEvidence[];
      schemaHash: string;
    }
  | {
      target: 'project';
      observedAt: number;
      page: string | null;
      project: {
        name: string;
        id: string;
        timelineCount: number | null;
      } | null;
      timeline: {
        name: string;
        id: string;
        videoTracks: number | null;
        audioTracks: number | null;
        subtitleTracks: number | null;
      } | null;
      settings: ProjectSettingsSummary;
      schemaHash: string;
    }
  | {
      target: 'media';
      observedAt: number;
      inventory: MediaInventorySummary | null;
      clip: MediaClipInspect | null;
      linkStatus: MediaLinkStatus | null;
      requestedItemId: string | null;
      schemaHash: string;
    }
  | {
      target: 'edit';
      observedAt: number;
      view: 'default' | 'structure' | 'gaps_overlaps' | 'source_ranges' | 'transitions' | 'annotations';
      summary: EditTimelineSummary | null;
      structure: EditStructureInspect | null;
      gapsOverlaps: EditGapsOverlapsInspect | null;
      sourceRanges: EditSourceRangeReport | null;
      transitions: EditTransitionInspect | null;
      annotations: EditReviewAnnotationsInspect | null;
      schemaHash: string;
    }
  | {
      target: 'fusion';
      observedAt: number;
      view: 'composition' | 'graph';
      summary: FusionCompositionInspect | null;
      graph: FusionGraphInspect | null;
      schemaHash: string;
    }
  | {
      target: 'color';
      observedAt: number;
      view: 'pipeline' | 'graph' | 'versions';
      summary: ColorPipelineSummary | null;
      graph: ColorGraphInventory | null;
      versions: ColorGradeVersionInspect | null;
      schemaHash: string;
    }
  | {
      target: 'fairlight';
      observedAt: number;
      view: 'mapping' | 'clip_processing';
      summary: FairlightMappingSummary | null;
      clipProcessing: FairlightClipProcessingInspect | null;
      schemaHash: string;
    }
  | {
      target: 'deliver';
      observedAt: number;
      capabilities: DeliverCapabilityMatrix | null;
      settings: DeliverSettingsInspect | null;
      schemaHash: string;
    }
  | {
      target: 'preflight';
      observedAt: number;
      preflight: ProjectPreflightSummary;
      schemaHash: string;
    };

export type DiagnosticStatus = 'pass' | 'not-run' | 'fail';
export type DiagnosticCheckId =
  | 'resolve'
  | 'resolveMcp'
  | 'broker'
  | 'tunnel'
  | 'openai'
  | 'chatgptRequest'
  | 'toolCall';

export interface DiagnosticCheck {
  id: DiagnosticCheckId;
  status: DiagnosticStatus;
  observedAt: number | null;
}

export interface DiagnosticsState {
  checks: DiagnosticCheck[];
}

export interface AppState {
  config: AppConfig;
  hasApiKey: boolean;
  apiKeySuffix: string | null;
  apiKeyStorageState: 'missing' | 'available' | 'unavailable';
  secureStorageAvailable: boolean;
  resolvedTunnelClient: string | null;
  resolvedTunnelClientVersion: string | null;
  preferredSystemLanguages: string[];
  resolve: ResolveProbe;
  tunnel: TunnelStatus;
  /**
   * Legacy renderer alias of tunnel. The target product has one CID Tunnel; remove this field
   * when the COS shell replaces the migration renderer.
   */
  workflowTunnel: TunnelStatus;
  gateway: ResolveGatewayStatus;
  diagnostics: DiagnosticsState;
}

export interface LogEntry {
  time: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
