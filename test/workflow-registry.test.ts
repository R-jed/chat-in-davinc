import { describe, expect, it } from 'vitest';
import {
  assessRegisteredWorkflow,
  getWorkflowDefinition,
  workflowDefinitions
} from '../src/main/workflow-registry.js';

describe('protected workflow registry', () => {
  it('contains the current read-only set plus the three bounded writer definitions', () => {
    const definitions = workflowDefinitions();
    expect(definitions).toHaveLength(27);
    expect(definitions.filter((definition) => definition.readOnly)).toHaveLength(24);
    expect(definitions.filter((definition) => !definition.readOnly).map((definition) => definition.id)).toEqual([
      'edit.review_marker_add.v1',
      'edit.track_add.v1',
      'color.grade_version_create.v1'
    ]);
    expect(definitions.map((definition) => definition.id)).toContain('activity.audit_recent.v1');
    expect(definitions.map((definition) => definition.id)).toContain('media.clip_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('media.link_status.v1');
    expect(definitions.map((definition) => definition.id)).toContain('edit.structure_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('edit.gaps_overlaps.v1');
    expect(definitions.map((definition) => definition.id)).toContain('edit.source_range_report.v1');
    expect(definitions.map((definition) => definition.id)).toContain('edit.transition_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('edit.review_annotations_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('fusion.composition_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('fusion.graph_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('color.graph_inventory.v1');
    expect(definitions.map((definition) => definition.id)).toContain('color.grade_version_inspect.v1');
    expect(definitions.map((definition) => definition.id)).toContain('fairlight.clip_processing_inspect.v1');
    expect(getWorkflowDefinition('fusion.composition_inspect.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'edit.timeline_structure.read',
      'fusion.composition.read'
    ]);
    expect(getWorkflowDefinition('fusion.composition_inspect.v1')?.blastRadius).toBe('timeline');
    expect(getWorkflowDefinition('fusion.graph_inspect.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'edit.timeline_structure.read',
      'fusion.composition.read',
      'fusion.graph.read'
    ]);
    expect(getWorkflowDefinition('fusion.graph_inspect.v1')?.blastRadius).toBe('timeline');
    expect(getWorkflowDefinition('color.graph_inventory.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'edit.timeline_structure.read',
      'color.graph.read'
    ]);
    expect(getWorkflowDefinition('color.graph_inventory.v1')?.blastRadius).toBe('timeline');
    expect(getWorkflowDefinition('color.grade_version_inspect.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'edit.timeline_structure.read',
      'color.grade_version.read'
    ]);
    expect(getWorkflowDefinition('color.grade_version_inspect.v1')?.blastRadius).toBe('timeline');
    expect(getWorkflowDefinition('fairlight.clip_processing_inspect.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'edit.timeline_structure.read',
      'fairlight.clip_processing.read'
    ]);
    expect(getWorkflowDefinition('fairlight.clip_processing_inspect.v1')?.blastRadius).toBe('timeline');
    expect(getWorkflowDefinition('deliver.settings_inspect.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'deliver.capability_matrix.read',
      'deliver.settings.partial_read'
    ]);
    expect(getWorkflowDefinition('project.preflight.v1')?.requiredCapabilities).toContain('deliver.capability_matrix.read');
    expect(getWorkflowDefinition('edit.review_annotations_inspect.v1')?.requiredCapabilities).toEqual([
      'resolve.sandboxed_script.read',
      'edit.timeline_structure.read',
      'edit.review_marker.read',
      'media.clip_detail.read'
    ]);
    expect(definitions.map((definition) => definition.id)).not.toContain('activity.execution_detail.v1');
  });

  it('returns registry metadata for a known workflow without inventing execution policy', () => {
    const definition = getWorkflowDefinition('project.preflight.v1');
    expect(definition).toMatchObject({
      id: 'project.preflight.v1',
      version: '1',
      readOnly: true,
      risk: 'low',
      blastRadius: 'project',
      approvalPolicy: 'none',
      recoveryClass: 'A',
      previewMode: 'native',
      verificationLevel: 'STRUCTURAL_READBACK'
    });

    const assessment = assessRegisteredWorkflow('project.preflight.v1');
    expect(assessment).toMatchObject({
      workflowId: 'project.preflight.v1',
      workflowVersion: '1',
      riskEstablished: true,
      executable: true,
      readOnly: true,
      destructive: false,
      blastRadius: 'project',
      confirmationRequired: false
    });
  });

  it('keeps unknown workflow ids unestablished and non-executable', () => {
    expect(assessRegisteredWorkflow('unknown.writer.v1')).toMatchObject({
      workflowId: null,
      workflowVersion: null,
      riskEstablished: false,
      executable: false,
      readOnly: null,
      destructive: null,
      blastRadius: 'unknown',
      confirmationRequired: true,
      approvalPolicy: null,
      recoveryClass: null,
      previewMode: null,
      verificationLevel: null
    });
  });

  it('registers the bounded writers only through their protected policies', () => {
    expect(assessRegisteredWorkflow('edit.review_marker_add.v1')).toMatchObject({
      workflowId: 'edit.review_marker_add.v1',
      riskEstablished: true,
      executable: true,
      readOnly: false,
      destructive: true,
      blastRadius: 'item',
      confirmationRequired: true,
      approvalPolicy: 'local_required',
      recoveryClass: 'B',
      previewMode: 'derived_plan',
      verificationLevel: 'API_READBACK'
    });
    expect(assessRegisteredWorkflow('edit.track_add.v1')).toMatchObject({
      workflowId: 'edit.track_add.v1',
      riskEstablished: true,
      executable: true,
      readOnly: false,
      destructive: true,
      blastRadius: 'timeline',
      confirmationRequired: true,
      approvalPolicy: 'local_required',
      recoveryClass: 'C',
      previewMode: 'derived_plan',
      verificationLevel: 'STRUCTURAL_READBACK'
    });
    expect(assessRegisteredWorkflow('color.grade_version_create.v1')).toMatchObject({
      workflowId: 'color.grade_version_create.v1',
      riskEstablished: true,
      executable: true,
      readOnly: false,
      destructive: true,
      blastRadius: 'item',
      confirmationRequired: true,
      approvalPolicy: 'local_required',
      recoveryClass: 'B',
      previewMode: 'derived_plan',
      verificationLevel: 'API_READBACK'
    });
  });
});
