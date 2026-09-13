import type {
  AgentActionDescriptor,
  AgentActionOffer,
  AgentEntityKind,
  AgentImplementationBinding,
  AgentSemanticCapabilityId
} from '../shared/agent-system.js';
import type {
  ProjectPreflightProfile,
  ProtectedWorkflowId,
  ResolveCapabilityEvidence,
  ResolveCapabilityQualification
} from '../shared/types.js';
import { workflowDefinitions } from './workflow-registry.js';

interface ActionHint {
  intent: string;
  invoke: string;
  keywords: string[];
}

interface SemanticCapabilityDefinition extends ActionHint {
  capabilityId: AgentSemanticCapabilityId;
  workflowId: ProtectedWorkflowId;
  expectedEffect: string;
  dispatch?: { profile?: ProjectPreflightProfile };
}

const HINTS: Record<ProtectedWorkflowId, ActionHint> = {
  'system.connection_status.v1': { intent: 'Check whether Resolve is reachable and running.', invoke: 'status()', keywords: ['resolve', 'connection', 'connected', 'running', '连接', '状态'] },
  'system.capability_snapshot.v1': { intent: 'Inspect currently qualified protected capabilities and limitations.', invoke: 'inspect({target:"capabilities"})', keywords: ['capability', 'support', 'available', '能力', '支持', '可用'] },
  'project.identity.v1': { intent: 'Identify the current Resolve project and timeline.', invoke: 'inspect({target:"project"})', keywords: ['project', 'timeline', 'current', '项目', '时间线', '当前'] },
  'project.settings_summary.v1': { intent: 'Read effective project/timeline technical settings.', invoke: 'inspect({target:"project"})', keywords: ['project', 'timeline', 'settings', 'resolution', 'frame rate', '项目', '时间线', '设置', '分辨率', '帧率'] },
  'media.inventory_summary.v1': { intent: 'Inspect bounded Media Pool inventory and source readiness.', invoke: 'inspect({target:"media"})', keywords: ['media', 'clip', 'bin', 'pool', '素材', '媒体', '片段', '素材库'] },
  'media.clip_inspect.v1': { intent: 'Inspect one known Media Pool item by semantic handle.', invoke: 'inspect({target:"media",itemRef:"M#",generation:<current>})', keywords: ['clip', 'media', 'metadata', 'proxy', '素材', '片段', '元数据', '代理'] },
  'media.link_status.v1': { intent: 'Inspect relink/proxy/full-resolution link method availability without writing.', invoke: 'inspect({target:"media",view:"link_status",itemRef:"M#",generation:<current>})', keywords: ['relink', 'proxy', 'link', 'offline', '重连', '代理', '链接', '离线'] },
  'edit.timeline_summary.v1': { intent: 'Read current timeline structure summary.', invoke: 'inspect({target:"edit"})', keywords: ['edit', 'timeline', 'track', '剪辑', '时间线', '轨道'] },
  'edit.structure_inspect.v1': { intent: 'Inspect tracks and exact timeline-item structure.', invoke: 'inspect({target:"edit",view:"structure"})', keywords: ['edit', 'structure', 'track', 'item', 'timeline', '剪辑', '结构', '轨道', '片段'] },
  'edit.gaps_overlaps.v1': { intent: 'Find observed gaps and overlaps in the current timeline.', invoke: 'inspect({target:"edit",view:"gaps_overlaps"})', keywords: ['gap', 'overlap', 'space', '剪辑', '空隙', '重叠', '间隙'] },
  'edit.source_range_report.v1': { intent: 'Inspect timeline record/source ranges and media associations.', invoke: 'inspect({target:"edit",view:"source_ranges"})', keywords: ['source range', 'range', 'trim', '源范围', '范围', '修剪'] },
  'edit.transition_inspect.v1': { intent: 'Inspect current fade/transition evidence without changing it.', invoke: 'inspect({target:"edit",view:"transitions"})', keywords: ['transition', 'fade', '转场', '淡入', '淡出'] },
  'edit.review_annotations_inspect.v1': { intent: 'Inspect timeline review markers/annotations.', invoke: 'inspect({target:"edit",view:"annotations"})', keywords: ['marker', 'annotation', 'review', '标记', '批注', '审阅'] },
  'fusion.composition_inspect.v1': { intent: 'Find timeline items with Fusion compositions.', invoke: 'inspect({target:"fusion"})', keywords: ['fusion', 'composition', 'comp', '合成'] },
  'fusion.graph_inspect.v1': { intent: 'Inspect bounded Fusion tools, ports and graph connections.', invoke: 'inspect({target:"fusion",view:"graph"})', keywords: ['fusion', 'graph', 'node', 'tool', '节点', '图'] },
  'color.pipeline_inspect.v1': { intent: 'Inspect current color-management and grade-pipeline summary.', invoke: 'inspect({target:"color"})', keywords: ['color', 'grade', 'lut', '调色', '色彩', 'lut'] },
  'color.graph_inventory.v1': { intent: 'Inspect bounded Color node-stack/group graph structure.', invoke: 'inspect({target:"color",view:"graph"})', keywords: ['color', 'node', 'graph', 'group', '调色', '节点', '组'] },
  'color.grade_version_inspect.v1': { intent: 'Inspect current/local/remote grade-version evidence.', invoke: 'inspect({target:"color",view:"versions"})', keywords: ['color', 'grade', 'version', '调色', '版本'] },
  'color.grade_version_create.v1': { intent: 'Plan one new LOCAL grade version on the exact focused TimelineItem.', invoke: 'plan({workflowId:"color.grade_version_create.v1",target:"timeline_item",itemRef,generation,name}) then execute({planId}) only after local approval', keywords: ['create grade version', 'new grade version', 'add grade version', '新建调色版本', '创建调色版本', '新增调色版本'] },
  'fairlight.mapping_inspect.v1': { intent: 'Inspect Fairlight tracks and source channel mappings.', invoke: 'inspect({target:"fairlight"})', keywords: ['fairlight', 'audio', 'track', 'channel', '音频', '轨道', '声道'] },
  'fairlight.clip_processing_inspect.v1': { intent: 'Inspect bounded clip audio processing values and Voice Isolation state.', invoke: 'inspect({target:"fairlight",view:"audio_processing"})', keywords: ['fairlight', 'audio', 'voice', 'volume', 'dialogue', '音频', '人声', '音量', '对白'] },
  'deliver.capability_matrix.v1': { intent: 'Inspect render formats/codecs/resolutions/preset-name capabilities.', invoke: 'inspect({target:"deliver"})', keywords: ['deliver', 'render', 'codec', 'format', 'export', '交付', '渲染', '编码', '格式', '导出'] },
  'deliver.settings_inspect.v1': { intent: 'Inspect current render mode, current format/codec and render jobs.', invoke: 'inspect({target:"deliver"})', keywords: ['deliver', 'render', 'job', 'queue', '交付', '渲染', '任务', '队列'] },
  'project.preflight.v1': { intent: 'Run a bounded cross-domain project readiness preflight.', invoke: 'inspect({target:"preflight",profile:"general"})', keywords: ['preflight', 'check project', 'ready', '检查项目', '预检', '就绪'] },
  'activity.audit_recent.v1': { intent: 'Read recent protected tool-call summaries.', invoke: 'audit({limit:10})', keywords: ['audit', 'activity', 'history', '审计', '活动', '历史'] },
  'edit.track_add.v1': { intent: 'Plan one appended empty VIDEO track; execution still requires local approval and Class C backup.', invoke: 'plan({workflowId:"edit.track_add.v1",target:"current_timeline",trackType:"video",placement:"append"}) then execute({planId}) only after local approval', keywords: ['add track', 'video track', 'new track', '轨道', '视频轨', '新增轨道'] },
  'edit.timeline_structural_guard.v1': { intent: 'Internal structural timeline Plan guard. Not publicly executable.', invoke: 'internal only', keywords: ['structural', 'timeline', 'guard'] },
  'edit.review_marker_add.v1': { intent: 'Plan one exact review marker addition; execution still requires local approval.', invoke: 'plan({workflowId:"edit.review_marker_add.v1",...}) then execute({planId}) only after local approval', keywords: ['add marker', 'marker', 'review point', '加标记', '添加标记', '审阅点'] }
};

const SEMANTIC_CAPABILITIES: readonly SemanticCapabilityDefinition[] = [
  { capabilityId: 'system.connection.inspect', workflowId: 'system.connection_status.v1', ...HINTS['system.connection_status.v1'], expectedEffect: 'Refresh Resolve reachability and runtime-version evidence.' },
  { capabilityId: 'project.identity.inspect', workflowId: 'project.identity.v1', ...HINTS['project.identity.v1'], expectedEffect: 'Establish the exact current project and timeline identity.' },
  { capabilityId: 'project.settings.inspect', workflowId: 'project.settings_summary.v1', ...HINTS['project.settings_summary.v1'], expectedEffect: 'Refresh effective project and timeline technical settings.' },
  { capabilityId: 'project.preflight', workflowId: 'project.preflight.v1', ...HINTS['project.preflight.v1'], dispatch: { profile: 'general' }, expectedEffect: 'Collect bounded cross-domain readiness evidence for the current project.' },
  { capabilityId: 'media.inventory.inspect', workflowId: 'media.inventory_summary.v1', ...HINTS['media.inventory_summary.v1'], expectedEffect: 'Refresh bounded Media Pool inventory and offline-source evidence.' },
  { capabilityId: 'media.item.inspect', workflowId: 'media.clip_inspect.v1', ...HINTS['media.clip_inspect.v1'], expectedEffect: 'Refresh metadata and link evidence for one exact Media Pool item.' },
  { capabilityId: 'media.link.capabilities.inspect', workflowId: 'media.link_status.v1', ...HINTS['media.link_status.v1'], expectedEffect: 'Observe relink/proxy/full-resolution link capability evidence without mutation.' },
  { capabilityId: 'edit.timeline.inspect', workflowId: 'edit.timeline_summary.v1', ...HINTS['edit.timeline_summary.v1'], expectedEffect: 'Refresh the current timeline summary.' },
  { capabilityId: 'edit.timeline.structure.inspect', workflowId: 'edit.structure_inspect.v1', ...HINTS['edit.structure_inspect.v1'], expectedEffect: 'Refresh exact bounded track and timeline-item structure.' },
  { capabilityId: 'edit.timeline.gaps_overlaps.inspect', workflowId: 'edit.gaps_overlaps.v1', ...HINTS['edit.gaps_overlaps.v1'], expectedEffect: 'Refresh observed timeline gap and overlap evidence.' },
  { capabilityId: 'edit.clip.source_range.inspect', workflowId: 'edit.source_range_report.v1', ...HINTS['edit.source_range_report.v1'], expectedEffect: 'Refresh record/source-range and media-association evidence.' },
  { capabilityId: 'edit.fade.inspect', workflowId: 'edit.transition_inspect.v1', ...HINTS['edit.transition_inspect.v1'], expectedEffect: 'Refresh qualified fade/transition evidence without mutation.' },
  { capabilityId: 'edit.review_annotations.inspect', workflowId: 'edit.review_annotations_inspect.v1', ...HINTS['edit.review_annotations_inspect.v1'], expectedEffect: 'Refresh review marker and annotation evidence.' },
  { capabilityId: 'edit.marker.add', workflowId: 'edit.review_marker_add.v1', ...HINTS['edit.review_marker_add.v1'], expectedEffect: 'Propose one exact review-marker mutation through an immutable approved Plan.' },
  { capabilityId: 'edit.track.add', workflowId: 'edit.track_add.v1', ...HINTS['edit.track_add.v1'], expectedEffect: 'Propose appending one empty VIDEO track through an immutable Class C protected Plan.' },
  { capabilityId: 'fusion.composition.inspect', workflowId: 'fusion.composition_inspect.v1', ...HINTS['fusion.composition_inspect.v1'], expectedEffect: 'Refresh Fusion-composition inventory for bounded timeline items.' },
  { capabilityId: 'fusion.graph.inspect', workflowId: 'fusion.graph_inspect.v1', ...HINTS['fusion.graph_inspect.v1'], expectedEffect: 'Refresh bounded Fusion tool, port and edge evidence.' },
  { capabilityId: 'color.pipeline.inspect', workflowId: 'color.pipeline_inspect.v1', ...HINTS['color.pipeline_inspect.v1'], expectedEffect: 'Refresh current color-management and grade-pipeline evidence.' },
  { capabilityId: 'color.graph.inspect', workflowId: 'color.graph_inventory.v1', ...HINTS['color.graph_inventory.v1'], expectedEffect: 'Refresh bounded Color node-stack and group graph evidence.' },
  { capabilityId: 'color.grade_version.inspect', workflowId: 'color.grade_version_inspect.v1', ...HINTS['color.grade_version_inspect.v1'], expectedEffect: 'Refresh current/local/remote grade-version evidence.' },
  { capabilityId: 'color.grade_version.create', workflowId: 'color.grade_version_create.v1', ...HINTS['color.grade_version_create.v1'], expectedEffect: 'Propose creating and switching to one new LOCAL grade version on the exact focused TimelineItem.' },
  { capabilityId: 'fairlight.mapping.inspect', workflowId: 'fairlight.mapping_inspect.v1', ...HINTS['fairlight.mapping_inspect.v1'], expectedEffect: 'Refresh Fairlight track and source-channel mapping evidence.' },
  { capabilityId: 'fairlight.clip_processing.inspect', workflowId: 'fairlight.clip_processing_inspect.v1', ...HINTS['fairlight.clip_processing_inspect.v1'], expectedEffect: 'Refresh bounded clip-processing and Voice Isolation evidence.' },
  { capabilityId: 'deliver.capability_matrix.inspect', workflowId: 'deliver.capability_matrix.v1', ...HINTS['deliver.capability_matrix.v1'], expectedEffect: 'Refresh format/codec/resolution and preset capability evidence.' },
  { capabilityId: 'deliver.settings.inspect', workflowId: 'deliver.settings_inspect.v1', ...HINTS['deliver.settings_inspect.v1'], expectedEffect: 'Refresh current render mode, format/codec and render-job evidence.' },
  { capabilityId: 'deliver.preflight', workflowId: 'project.preflight.v1', ...HINTS['project.preflight.v1'], invoke: 'inspect({target:"preflight",profile:"delivery"})', dispatch: { profile: 'delivery' }, keywords: ['deliver', 'render', 'preflight', 'export', '交付', '渲染', '预检', '导出'], expectedEffect: 'Refresh the Deliver-related readiness slice of the bounded project preflight.' }
] as const;

const QUALIFICATION_RANK: Record<AgentImplementationBinding['qualification'], number> = {
  unknown: 0,
  runtime_observed: 1,
  behaviorally_qualified: 2
};

const SOURCE_RANK: Record<AgentImplementationBinding['source'], number> = {
  ui_automation: 0,
  trusted_plugin: 1,
  official: 2
};

function normalizedQualification(value: ResolveCapabilityQualification | null): AgentImplementationBinding['qualification'] {
  if (value === 'behaviorally_qualified' || value === 'runtime_observed') return value;
  return 'unknown';
}

export function selectQualifiedImplementation(
  candidates: readonly AgentImplementationBinding[]
): AgentImplementationBinding | null {
  const usable = candidates.filter((candidate) =>
    candidate.availability === 'available' || candidate.availability === 'conditional'
  );
  return [...usable].sort((left, right) =>
    QUALIFICATION_RANK[right.qualification] - QUALIFICATION_RANK[left.qualification]
    || SOURCE_RANK[right.source] - SOURCE_RANK[left.source]
    || left.implementationId.localeCompare(right.implementationId)
  )[0] ?? null;
}

function implementationBinding(
  definition: SemanticCapabilityDefinition,
  capabilityEvidence: readonly ResolveCapabilityEvidence[]
): AgentImplementationBinding {
  const workflow = workflowDefinitions().find((row) => row.id === definition.workflowId)!;
  const byId = new Map(capabilityEvidence.map((row) => [row.capabilityId, row]));
  const required = workflow.requiredCapabilities.map((id) => byId.get(id) ?? null);
  const missing = workflow.requiredCapabilities.filter((_, index) => required[index] === null);
  const unavailable = required.filter((row) => row?.status === 'unavailable');
  const unknown = required.filter((row) => row === null || row.status === 'unknown');
  const conditional = required.filter((row) => row?.status === 'conditional' || row?.status === 'unreliable');
  const rank: Record<ResolveCapabilityQualification, number> = {
    declared: 0,
    runtime_observed: 1,
    behaviorally_qualified: 2
  };
  const lowest = required.reduce<ResolveCapabilityQualification | null>((current, row) => {
    if (!row) return null;
    if (current === null) return row.qualification;
    return rank[row.qualification] < rank[current] ? row.qualification : current;
  }, null);
  const qualification = required.length === 0 ? 'runtime_observed' : normalizedQualification(lowest);
  const builds = [...new Set(required.map((row) => row?.evidenceBuild ?? null).filter((value): value is string => Boolean(value)))];
  const availability: AgentImplementationBinding['availability'] =
    unavailable.length > 0 ? 'unavailable'
      : unknown.length > 0 ? 'unknown'
        : conditional.length > 0 ? 'conditional'
          : 'available';
  const unknownIds = [
    ...missing,
    ...unknown.flatMap((row) => row ? [row.capabilityId] : [])
  ];
  const reason = availability === 'unavailable'
    ? 'Required Resolve capability unavailable: ' + unavailable.map((row) => row!.capabilityId).join(', ') + '.'
    : availability === 'unknown'
      ? 'Qualification is incomplete for: ' + (unknownIds.join(', ') || 'required capability evidence') + '.'
      : availability === 'conditional'
        ? 'Implementation is qualified with limitations: ' + conditional.map((row) => row!.capabilityId).join(', ') + '.'
        : null;
  return {
    implementationId: definition.workflowId,
    implementationVersion: '1',
    source: 'official',
    qualification,
    evidenceBuild: builds.length === 1 ? builds[0]! : null,
    availability,
    blockingReason: reason,
    remediation: availability === 'unknown'
      ? 'Refresh the exact Resolve build/capability evidence before dispatch.'
      : availability === 'unavailable'
        ? 'Use a qualified implementation for the required Resolve capability; no fallback is selected automatically.'
        : null
  };
}

export function semanticCapabilityDefinitions(): Array<{
  capabilityId: AgentSemanticCapabilityId;
  workflowId: ProtectedWorkflowId;
}> {
  return SEMANTIC_CAPABILITIES.map(({ capabilityId, workflowId }) => ({ capabilityId, workflowId }));
}

function relevantSemanticDefinitions(
  input: string,
  focusedKind: AgentEntityKind | null,
  limit: number
): SemanticCapabilityDefinition[] {
  const text = input.toLocaleLowerCase();
  const focusedDomain = domainForAgentEntityKind(focusedKind);
  const explicitlyRequestedMutations = new Set(explicitMutationPlanningWorkflowIds(input));
  const rows = SEMANTIC_CAPABILITIES.map((definition) => {
    let score = 0;
    if (explicitlyRequestedMutations.has(definition.workflowId)) score += 100;
    for (const keyword of definition.keywords) {
      if (text.includes(keyword.toLocaleLowerCase())) score += keyword.length > 4 ? 3 : 2;
    }
    const domain = definition.capabilityId.split('.')[0] ?? '';
    if (focusedDomain && domain === focusedDomain) score += 2;
    return { definition, score };
  });
  const ranked = rows
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.definition.capabilityId.localeCompare(right.definition.capabilityId))
    .slice(0, Math.max(1, limit))
    .map((row) => row.definition);
  if (ranked.length > 0) return ranked;
  return SEMANTIC_CAPABILITIES.filter((definition) =>
    definition.capabilityId === 'system.connection.inspect'
    || definition.capabilityId === 'project.identity.inspect'
    || definition.capabilityId === 'project.settings.inspect'
  );
}

export function deriveAgentActionOffers(options: {
  input: string;
  focusedKind: AgentEntityKind | null;
  focusedHandle: string | null;
  goalCriterion: string | null;
  capabilityEvidence: readonly ResolveCapabilityEvidence[];
  readOnlySlice?: boolean;
  allowedMutationWorkflowIds?: readonly ProtectedWorkflowId[];
  limit?: number;
}): AgentActionOffer[] {
  const itemScoped = new Set<AgentSemanticCapabilityId>([
    'media.item.inspect',
    'media.link.capabilities.inspect',
    'edit.marker.add',
    'color.grade_version.create'
  ]);
  const expectedFocusedKind = (capabilityId: AgentSemanticCapabilityId): AgentEntityKind | null =>
    capabilityId === 'media.item.inspect' || capabilityId === 'media.link.capabilities.inspect'
      ? 'media_pool_item'
      : capabilityId === 'edit.marker.add' || capabilityId === 'color.grade_version.create'
        ? 'timeline_item'
        : null;
  const criterionText = (options.input + '\n' + (options.goalCriterion ?? '')).toLocaleLowerCase();
  const preferredPreflightProfile: ProjectPreflightProfile =
    ['deliver', 'delivery', 'render', 'export', '交付', '渲染', '导出'].some((term) => criterionText.includes(term))
      ? 'delivery'
      : 'general';
  const allowedMutationWorkflowIds = options.allowedMutationWorkflowIds === undefined
    ? null
    : new Set(options.allowedMutationWorkflowIds);
  return relevantSemanticDefinitions(options.input, options.focusedKind, options.limit ?? 6).map((definition) => {
    const workflow = workflowDefinitions().find((row) => row.id === definition.workflowId)!;
    const candidate = implementationBinding(definition, options.capabilityEvidence);
    const selected = selectQualifiedImplementation([candidate]);
    const requiredKind = expectedFocusedKind(definition.capabilityId);
    const targetHandle = itemScoped.has(definition.capabilityId) && requiredKind === options.focusedKind ? options.focusedHandle : null;
    const targetMissing = itemScoped.has(definition.capabilityId) && targetHandle === null;
    const mutationBlockedByReadOnly = !workflow.readOnly && (options.readOnlySlice ?? true);
    const mutationBlockedByAllowlist = !workflow.readOnly
      && !mutationBlockedByReadOnly
      && allowedMutationWorkflowIds !== null
      && !allowedMutationWorkflowIds.has(workflow.id);
    const mutationBlocked = mutationBlockedByReadOnly || mutationBlockedByAllowlist;
    const applicability: AgentActionOffer['applicability'] = mutationBlocked
      ? 'blocked'
      : targetMissing
        ? 'unknown'
      : candidate.availability === 'unavailable'
        ? 'unavailable'
        : candidate.availability === 'unknown'
          ? 'unknown'
          : 'applicable';
    const blockingReason = mutationBlockedByReadOnly
      ? 'Mutation is outside the current read-only System Spine slice.'
      : mutationBlockedByAllowlist
        ? 'The current user turn does not authorize planning this mutation workflow.'
      : targetMissing
        ? 'This capability requires one exact current semantic item target.'
      : candidate.blockingReason;
    const remediation = mutationBlockedByReadOnly
      ? 'Create a new immutable mutation Plan under CID approval authority; do not dispatch from this read-only decision.'
      : mutationBlockedByAllowlist
        ? 'Require an explicit current-turn request for this exact registered mutation before creating a Plan.'
      : targetMissing
        ? 'Select one observed item in SharedFocus, then derive a fresh ActionOffer from the current generation.'
      : candidate.remediation;
    const advancesCriterion =
      definition.workflowId === 'project.preflight.v1'
      && definition.dispatch?.profile
      && definition.dispatch.profile !== preferredPreflightProfile
        ? null
        : options.goalCriterion;
    return {
      capabilityId: definition.capabilityId,
      targetHandle,
      applicability,
      kind: workflow.readOnly ? 'observe' : 'mutate',
      whyRelevant: definition.intent,
      advancesCriterion,
      requiredPreconditions: workflow.requiredCapabilities.map((capability) => 'Resolve capability ' + capability),
      risk: workflow.risk,
      expectedSemanticEffect: definition.expectedEffect,
      verificationRequirement: workflow.verificationLevel,
      implementation: selected ?? candidate,
      ...(definition.dispatch ? { dispatch: structuredClone(definition.dispatch) } : {}),
      estimatedCost: {
        context: 'low',
        resolve: workflow.readOnly ? 'low' : 'medium',
        latency: workflow.id === 'project.preflight.v1' ? 'medium' : 'low'
      },
      blockingReason,
      remediation
    };
  });
}

export function explicitMutationPlanningRequested(input: string): boolean {
  return explicitMutationPlanningWorkflowIds(input).length > 0;
}

export function explicitMutationPlanningWorkflowIds(input: string): ProtectedWorkflowId[] {
  const text = input.trim().toLocaleLowerCase();
  if (!text) return [];
  const negativeOrInstructional =
    /\b(?:do\s+not|don't|dont|never|should\s+not|shouldn't|avoid)\b/.test(text)
    || /\b(?:how\s+(?:do|can|would|should)\s+i|how\s+to|explain|describe|tell\s+me\s+how|show\s+me\s+how|tutorial|guide|steps?\s+to)\b/.test(text)
    || /(?:不要|别|禁止|避免|无需|不需要|如何|怎么|怎样|教程|教我|告诉我怎么|解释.*如何|说明.*如何)/.test(text);
  if (negativeOrInstructional) return [];
  const englishMarker = /\b(?:add|create|place)\s+(?:(?:a|an|one)\s+)?(?:review\s+)?marker\b/.test(text);
  const chineseMarker = /(?:添加|新增|创建|新建|加)(?:一个|个|一条|条)?(?:审阅)?标记/.test(text);
  const englishTrack = /\b(?:add|create|append)\s+(?:(?:a|an|one)\s+)?(?:(?:new|empty)\s+)?video\s+track\b/.test(text);
  const chineseTrack = /(?:添加|新增|创建|新建|加)(?:一个|条|个|一条|一个)?(?:空的?|新)?视频(?:轨道|轨)/.test(text);
  const englishGradeVersion = /\b(?:add|create|make)\s+(?:(?:a|an|one)\s+)?(?:new\s+)?(?:local\s+)?grade\s+version\b/.test(text);
  const chineseGradeVersion = /(?:添加|新增|创建|新建)(?:一个|个)?(?:本地)?调色版本/.test(text);
  const workflows: ProtectedWorkflowId[] = [];
  if (englishMarker || chineseMarker) workflows.push('edit.review_marker_add.v1');
  if (englishTrack || chineseTrack) workflows.push('edit.track_add.v1');
  if (englishGradeVersion || chineseGradeVersion) workflows.push('color.grade_version_create.v1');
  return workflows;
}

export function bindAgentSemanticDispatchArgs(
  offers: readonly AgentActionOffer[],
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (toolName === 'plan') {
    const workflowId = args['workflowId'];
    if (typeof workflowId !== 'string' || workflowId.length === 0) {
      throw new Error('Mutation planning requires an exact workflowId from the current ActionOffer');
    }
    const matchingOffer = offers.find((offer) =>
      offer.applicability === 'applicable'
      && offer.kind === 'mutate'
      && offer.implementation?.implementationId === workflowId
    );
    if (!matchingOffer) {
      throw new Error('Mutation planning is not authorized by the current applicable ActionOffer');
    }
    if (workflowId === 'edit.track_add.v1') {
      if (args['target'] !== 'current_timeline' || args['trackType'] !== 'video' || args['placement'] !== 'append') {
        throw new Error('Track-add planning arguments do not match the current protected ActionOffer contract');
      }
    }
    if (workflowId === 'edit.review_marker_add.v1') {
      if (args['target'] !== 'timeline_item') {
        throw new Error('Review-marker planning target does not match the current protected ActionOffer contract');
      }
      if (typeof args['itemRef'] !== 'string' || args['itemRef'] !== matchingOffer.targetHandle) {
        throw new Error('Review-marker itemRef does not match the exact current ActionOffer target');
      }
      if (!Number.isInteger(args['generation']) || (args['generation'] as number) < 1) {
        throw new Error('Review-marker planning requires the current semantic target generation');
      }
    }
    if (workflowId === 'color.grade_version_create.v1') {
      if (args['target'] !== 'timeline_item') {
        throw new Error('Grade-version planning target does not match the current protected ActionOffer contract');
      }
      if (typeof args['itemRef'] !== 'string' || args['itemRef'] !== matchingOffer.targetHandle) {
        throw new Error('Grade-version itemRef does not match the exact current ActionOffer target');
      }
      if (!Number.isInteger(args['generation']) || (args['generation'] as number) < 1) {
        throw new Error('Grade-version planning requires the current semantic target generation');
      }
    }
    return args;
  }
  if (toolName !== 'inspect' || args['target'] !== 'preflight') return args;
  const profiles = [...new Set(
    offers
      .filter((offer) =>
        offer.applicability === 'applicable'
        && offer.advancesCriterion !== null
        && offer.implementation?.implementationId === 'project.preflight.v1'
        && offer.dispatch?.profile
      )
      .map((offer) => offer.dispatch!.profile!)
  )];
  if (profiles.length === 0) return args;
  const requested = args['profile'];
  if (requested === undefined) {
    if (profiles.length !== 1) {
      throw new Error('Current semantic preflight offers require an explicit matching profile');
    }
    return { ...args, profile: profiles[0] };
  }
  if (typeof requested !== 'string' || !profiles.includes(requested as (typeof profiles)[number])) {
    throw new Error('Preflight profile does not match the current semantic ActionOffer');
  }
  return args;
}

function domainOf(id: ProtectedWorkflowId): string {
  return id.split('.')[0] ?? 'system';
}

function verbOf(id: ProtectedWorkflowId, readOnly: boolean): AgentActionDescriptor['publicVerb'] {
  if (id === 'system.connection_status.v1') return 'status';
  if (id === 'activity.audit_recent.v1') return 'audit';
  if (!readOnly) return 'plan';
  return 'inspect';
}

export function agentActionDescriptors(): AgentActionDescriptor[] {
  return workflowDefinitions().map((definition) => {
    const hint = HINTS[definition.id];
    return {
      actionId: definition.id,
      version: definition.version,
      domain: domainOf(definition.id),
      intent: hint.intent,
      invoke: hint.invoke,
      publicVerb: verbOf(definition.id, definition.readOnly),
      readOnly: definition.readOnly,
      risk: definition.risk,
      blastRadius: definition.blastRadius,
      approvalPolicy: definition.approvalPolicy,
      recoveryClass: definition.recoveryClass,
      verificationLevel: definition.verificationLevel,
      requiredCapabilities: [...definition.requiredCapabilities]
    };
  });
}

export function domainForAgentEntityKind(kind: AgentEntityKind | null): string | null {
  if (kind === 'media_pool_item' || kind === 'media_pool_folder') return 'media';
  if (kind === 'timeline' || kind === 'timeline_item') return 'edit';
  if (kind === 'fusion_composition' || kind === 'fusion_tool') return 'fusion';
  if (kind === 'color_node' || kind === 'grade_version') return 'color';
  if (kind === 'fairlight_track') return 'fairlight';
  if (kind === 'render_job' || kind === 'deliverable') return 'deliver';
  if (kind === 'project') return 'project';
  return null;
}

export function relevantAgentActionDescriptors(
  input: string,
  focusedKind: AgentEntityKind | null,
  limit = 6
): AgentActionDescriptor[] {
  const text = input.toLocaleLowerCase();
  const focusedDomain = domainForAgentEntityKind(focusedKind);
  const rows = agentActionDescriptors().map((descriptor) => {
    const hint = HINTS[descriptor.actionId];
    let score = 0;
    for (const keyword of hint.keywords) if (text.includes(keyword.toLocaleLowerCase())) score += keyword.length > 4 ? 3 : 2;
    if (focusedDomain && descriptor.domain === focusedDomain) score += 2;
    if (descriptor.actionId === 'system.connection_status.v1' && /\b(resolve|connected|connection|running)\b|连接|运行/.test(text)) score += 4;
    if (descriptor.actionId === 'project.identity.v1' && /\b(project|timeline|current)\b|项目|时间线|当前/.test(text)) score += 3;
    return { descriptor, score };
  });
  const ranked = rows
    .filter((row) => row.score > 0)
    .sort((left, right) => right.score - left.score || left.descriptor.actionId.localeCompare(right.descriptor.actionId))
    .slice(0, Math.max(1, limit))
    .map((row) => row.descriptor);
  if (ranked.length > 0) return ranked;
  return agentActionDescriptors().filter((descriptor) =>
    descriptor.actionId === 'system.connection_status.v1'
    || descriptor.actionId === 'project.identity.v1'
    || descriptor.actionId === 'project.settings_summary.v1'
  );
}
