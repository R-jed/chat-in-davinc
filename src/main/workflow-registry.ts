import type {
  ProtectedWorkflowId,
  WorkflowDefinition,
  WorkflowRiskAssessment
} from '../shared/types.js';

const DEFINITIONS: readonly WorkflowDefinition[] = [
  {
    id: 'system.connection_status.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.status.read']
  },
  {
    id: 'system.capability_snapshot.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.status.read']
  },
  {
    id: 'project.identity.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'project.identity.read']
  },
  {
    id: 'project.settings_summary.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'project.identity.read', 'project.settings.read']
  },
  {
    id: 'media.inventory_summary.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'media.inventory.read']
  },
  {
    id: 'media.clip_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'media.clip_detail.read']
  },
  {
    id: 'media.link_status.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'media.link_status.read']
  },
  {
    id: 'edit.timeline_summary.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read']
  },
  {
    id: 'edit.structure_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read']
  },
  {
    id: 'edit.gaps_overlaps.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read']
  },
  {
    id: 'edit.source_range_report.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read']
  },
  {
    id: 'edit.transition_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.transition_fade.read']
  },
  {
    id: 'edit.review_annotations_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'edit.review_marker.read', 'media.clip_detail.read']
  },
  {
    id: 'fusion.composition_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'fusion.composition.read']
  },
  {
    id: 'fusion.graph_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'fusion.composition.read', 'fusion.graph.read']
  },
  {
    id: 'color.pipeline_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'color.pipeline.read']
  },
  {
    id: 'color.graph_inventory.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'color.graph.read']
  },
  {
    id: 'color.grade_version_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'color.grade_version.read']
  },
  {
    id: 'fairlight.mapping_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'fairlight.mapping.read']
  },
  {
    id: 'fairlight.clip_processing_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'fairlight.clip_processing.read']
  },
  {
    id: 'deliver.capability_matrix.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'deliver.capability_matrix.read']
  },
  {
    id: 'deliver.settings_inspect.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'deliver.capability_matrix.read', 'deliver.settings.partial_read']
  },
  {
    id: 'project.preflight.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'project',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: [
      'project.identity.read', 'project.settings.read', 'media.inventory.read', 'edit.timeline_structure.read',
      'fusion.composition.read', 'fusion.graph.read', 'color.pipeline.read', 'color.graph.read', 'color.grade_version.read',
      'fairlight.mapping.read', 'fairlight.clip_processing.read', 'deliver.capability_matrix.read', 'deliver.settings.partial_read'
    ]
  },
  {
    id: 'activity.audit_recent.v1', version: '1', readOnly: true, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'none', recoveryClass: 'A', previewMode: 'native', verificationLevel: 'API_READBACK',
    requiredCapabilities: []
  },
  {
    id: 'edit.review_marker_add.v1', version: '1', readOnly: false, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'local_required', recoveryClass: 'B', previewMode: 'derived_plan', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.review_marker.read', 'edit.review_marker.write']
  },
  {
    id: 'edit.track_add.v1', version: '1', readOnly: false, risk: 'low', blastRadius: 'timeline',
    approvalPolicy: 'local_required', recoveryClass: 'C', previewMode: 'derived_plan', verificationLevel: 'STRUCTURAL_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'edit.track.write']
  },
  {
    id: 'color.grade_version_create.v1', version: '1', readOnly: false, risk: 'low', blastRadius: 'item',
    approvalPolicy: 'local_required', recoveryClass: 'B', previewMode: 'derived_plan', verificationLevel: 'API_READBACK',
    requiredCapabilities: ['resolve.sandboxed_script.read', 'color.grade_version.read', 'color.grade_version.write']
  }
] as const;

const BY_ID = new Map<string, WorkflowDefinition>(DEFINITIONS.map((definition) => [definition.id, definition]));

export function workflowDefinitions(): WorkflowDefinition[] {
  return structuredClone([...DEFINITIONS]);
}

export function getWorkflowDefinition(id: string): WorkflowDefinition | null {
  const definition = BY_ID.get(id);
  return definition ? structuredClone(definition) : null;
}

export function assessRegisteredWorkflow(id: string): WorkflowRiskAssessment {
  const definition = BY_ID.get(id);
  if (!definition) {
    return {
      tool: id,
      workflowId: null,
      workflowVersion: null,
      riskLevel: 'medium',
      riskEstablished: false,
      executable: false,
      readOnly: null,
      destructive: null,
      blastRadius: 'unknown',
      confirmationRequired: true,
      approvalPolicy: null,
      recoveryClass: null,
      previewMode: null,
      verificationLevel: null,
      reasons: ['Workflow ID is not registered in the protected runtime registry.']
    };
  }
  return {
    tool: id,
    workflowId: definition.id,
    workflowVersion: definition.version,
    riskLevel: definition.risk,
    riskEstablished: true,
    executable: true,
    readOnly: definition.readOnly,
    destructive: !definition.readOnly,
    blastRadius: definition.blastRadius,
    confirmationRequired: definition.approvalPolicy !== 'none',
    approvalPolicy: definition.approvalPolicy,
    recoveryClass: definition.recoveryClass,
    previewMode: definition.previewMode,
    verificationLevel: definition.verificationLevel,
    reasons: definition.readOnly
      ? ['Metadata is sourced from the versioned protected workflow registry.']
      : ['Metadata is sourced from the versioned protected workflow registry. The writer is callable only through an approved immutable plan and the serialized Workflow engine.']
  };
}

export function isRegisteredWorkflowId(id: string): id is ProtectedWorkflowId {
  return BY_ID.has(id);
}
