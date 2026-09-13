import { describe, expect, it } from 'vitest';
import type { WorkflowPlanProjection } from '../src/shared/types.js';
import { projectWorkflowPlanForRenderer } from '../src/main/workflow-plan-view.js';

function markerProjection(): WorkflowPlanProjection {
  return {
    plan: {
      plan_id: 'plan_marker_safe',
      plan_hash: 'secret-plan-hash',
      hash_algorithm: 'sha256',
      canonicalization_version: '1',
      plan_kind: 'review_marker_add',
      workflow_id: 'edit.review_marker_add.v1',
      workflow_version: '1',
      created_at: '2026-09-13T00:00:00.000Z',
      expires_at: '2026-09-13T00:10:00.000Z',
      resolve_version: '21.1',
      project_unique_id: 'project-exact-secret',
      timeline_unique_id: 'timeline-exact-secret',
      target_ids: ['item-exact-secret'],
      input_fingerprint: 'input-fingerprint-secret',
      requested_parameters: { target: 'timeline_item', frameOffset: 12, color: 'Yellow', name: 'Review', note: 'Check this', duration: 1 },
      proposed_changes: [{
        kind: 'add_review_marker', target_item_id: 'item-exact-secret', frame_offset: 12, color: 'Yellow',
        name: 'Review', note: 'Check this', duration: 1, custom_data: 'custom-data-secret'
      }],
      preconditions: {
        target_item_id: 'item-exact-secret', track_type: 'video', track_index: 1, track_locked: false,
        item_start: 0, item_end: 100, item_duration: 100, marker_frame_empty: true, marker_state_hash: 'marker-hash-secret'
      },
      risk_level: 'low',
      blast_radius: 'item',
      preview_mode: 'derived_plan',
      recovery_class: 'B',
      required_backup: false,
      verification_level: 'API_READBACK',
      verification_contract: { id: 'edit.review_marker_add.verify.v1', version: '1' },
      capability_evidence_refs: ['resolve.sandboxed_script.read', 'edit.review_marker.read', 'edit.review_marker.write']
    },
    state: 'ready',
    approval: null,
    reason: null,
    execution: null,
    backup: null,
    change_set: {
      changeset_id: 'changeset-marker-safe',
      plan_id: 'plan_marker_safe',
      workflow_id: 'edit.review_marker_add.v1',
      state: 'proposed',
      project_unique_id: 'project-exact-secret',
      timeline_unique_id: 'timeline-exact-secret',
      target_ids: ['item-exact-secret'],
      expected_changes: [{
        kind: 'add_review_marker', target_item_id: 'item-exact-secret', frame_offset: 12, color: 'Yellow',
        name: 'Review', note: 'Check this', duration: 1, custom_data: 'custom-data-secret'
      }],
      actual_observation: null,
      execution_id: null,
      verification_status: 'unverified',
      verification_level: null,
      recovery_status: null,
      backup: null,
      reason: null
    }
  };
}

function trackProjection(): WorkflowPlanProjection {
  return {
    plan: {
      plan_id: 'plan_track_safe',
      plan_hash: 'track-plan-hash-secret',
      hash_algorithm: 'sha256',
      canonicalization_version: '1',
      plan_kind: 'edit_track_add',
      workflow_id: 'edit.track_add.v1',
      workflow_version: '1',
      created_at: '2026-09-13T00:00:00.000Z',
      expires_at: '2026-09-13T00:10:00.000Z',
      resolve_version: '21.1',
      project_unique_id: 'project-track-secret',
      timeline_unique_id: 'timeline-track-secret',
      target_ids: ['timeline-track-secret'],
      input_fingerprint: 'structure-fingerprint-secret',
      requested_parameters: { target: 'current_timeline', track_type: 'video', placement: 'append' },
      proposed_changes: [{ kind: 'add_track', track_type: 'video', placement: 'append', expected_track_index: 2 }],
      preconditions: {
        timeline_name: 'Main Cut', timeline_start_frame: 0, timeline_end_frame: 100,
        total_track_count_before: 2, item_count_before: 3, video_track_count_before: 1,
        expected_new_track_index: 2, structure_fingerprint: 'structure-fingerprint-secret'
      },
      risk_level: 'low',
      blast_radius: 'timeline',
      preview_mode: 'derived_plan',
      recovery_class: 'C',
      required_backup: true,
      verification_level: 'STRUCTURAL_READBACK',
      verification_contract: { id: 'edit.track_add.verify.v1', version: '1' },
      capability_evidence_refs: ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'edit.track.write']
    },
    state: 'consumed',
    approval: {
      approval_id: 'approval-secret', plan_id: 'plan_track_safe', plan_hash: 'track-plan-hash-secret',
      approved_at: '2026-09-13T00:01:00.000Z', expires_at: '2026-09-13T00:10:00.000Z',
      approved_scope: 'exact_plan', provenance: 'local_renderer'
    },
    reason: null,
    execution: {
      execution_id: 'execution-secret', plan_id: 'plan_track_safe', state: 'verified',
      writer_returned: true, writer_precondition_ok: true, marker_readback: null,
      structural_readback: { kind: 'track_add_state', track_type: 'video', track_index: 2, present: true, item_count: 0 },
      grade_version_readback: null,
      reason: null, recovery_status: 'not_needed'
    },
    backup: {
      strategy: 'timeline_duplicate', source_timeline_id: 'timeline-track-secret', backup_timeline_id: 'backup-timeline-secret',
      backup_timeline_name: 'Main Cut [CID backup safe]', current_timeline_restored: true, created_at: '2026-09-13T00:02:00.000Z'
    },
    change_set: {
      changeset_id: 'changeset-track-safe', plan_id: 'plan_track_safe', workflow_id: 'edit.track_add.v1', state: 'verified',
      project_unique_id: 'project-track-secret', timeline_unique_id: 'timeline-track-secret', target_ids: ['timeline-track-secret'],
      expected_changes: [{ kind: 'add_track', track_type: 'video', placement: 'append', expected_track_index: 2 }],
      actual_observation: { kind: 'track_add_state', track_type: 'video', track_index: 2, present: true, item_count: 0 },
      execution_id: 'execution-secret', verification_status: 'passed', verification_level: 'STRUCTURAL_READBACK',
      recovery_status: 'not_needed', backup: null, reason: null
    }
  };
}

function colorVersionProjection(): WorkflowPlanProjection {
  return {
    plan: {
      plan_id: 'plan_color_safe', plan_hash: 'color-plan-hash-secret', hash_algorithm: 'sha256',
      canonicalization_version: '1', plan_kind: 'color_grade_version_create', workflow_id: 'color.grade_version_create.v1',
      workflow_version: '1', created_at: '2026-09-13T00:00:00.000Z', expires_at: '2026-09-13T00:10:00.000Z',
      resolve_version: '21.1', project_unique_id: 'project-color-secret', timeline_unique_id: 'timeline-color-secret',
      target_ids: ['item-color-secret'], input_fingerprint: 'color-fingerprint-secret',
      requested_parameters: { target: 'timeline_item', name: 'Agent Version', version_type: 0 },
      proposed_changes: [{ kind: 'create_grade_version', target_item_id: 'item-color-secret', name: 'Agent Version', version_type: 0 }],
      preconditions: {
        target_item_id: 'item-color-secret', track_index: 1,
        current_version: { name: '版本 1', type: 0 }, local_versions: ['版本 1'], remote_versions: ['版本 1'],
        version_state_hash: 'color-fingerprint-secret'
      },
      risk_level: 'low', blast_radius: 'item', preview_mode: 'derived_plan', recovery_class: 'B', required_backup: false,
      verification_level: 'API_READBACK', verification_contract: { id: 'color.grade_version_create.verify.v1', version: '1' },
      capability_evidence_refs: ['resolve.sandboxed_script.read', 'color.grade_version.read', 'color.grade_version.write']
    },
    state: 'ready', approval: null, reason: null, execution: null, backup: null,
    change_set: {
      changeset_id: 'changeset-color-safe', plan_id: 'plan_color_safe', workflow_id: 'color.grade_version_create.v1',
      state: 'proposed', project_unique_id: 'project-color-secret', timeline_unique_id: 'timeline-color-secret',
      target_ids: ['item-color-secret'],
      expected_changes: [{ kind: 'create_grade_version', target_item_id: 'item-color-secret', name: 'Agent Version', version_type: 0 }],
      actual_observation: null, execution_id: null, verification_status: 'unverified', verification_level: null,
      recovery_status: null, backup: null, reason: null
    }
  };
}

const forbidden = [
  'project_unique_id', 'timeline_unique_id', 'target_ids', 'input_fingerprint', 'structure_fingerprint',
  'custom_data', 'customData', 'preconditions', 'plan_hash', 'marker_state_hash',
  'project-exact-secret', 'timeline-exact-secret', 'item-exact-secret', 'project-track-secret',
  'timeline-track-secret', 'backup-timeline-secret', 'structure-fingerprint-secret', 'track-plan-hash-secret',
  'project-color-secret', 'timeline-color-secret', 'item-color-secret', 'color-fingerprint-secret', 'color-plan-hash-secret'
];

describe('renderer workflow plan projection', () => {
  it('projects a marker Plan to semantic display fields without execution authority data', () => {
    const view = projectWorkflowPlanForRenderer(markerProjection(), (exactId) => exactId === 'item-exact-secret'
      ? { kind: 'timeline_item', exactId, handle: 'I7', label: 'Interview 04', generation: 9, parentHandle: 'T1', locator: 'V1 · item 3' }
      : null);
    expect(view).toMatchObject({
      planId: 'plan_marker_safe', workflowId: 'edit.review_marker_add.v1', planKind: 'review_marker_add',
      state: 'ready', approvalState: 'awaiting', backupState: 'not_required',
      target: { kind: 'timeline_item', handle: 'I7', label: 'Interview 04', generation: 9 },
      proposedChange: { kind: 'add_review_marker', name: 'Review', note: 'Check this', color: 'Yellow', frameOffset: 12, duration: 1 }
    });
    const serialized = JSON.stringify(view);
    for (const value of forbidden) expect(serialized).not.toContain(value);
  });

  it('rebuilds a consumed track-add display safely without a current semantic handle', () => {
    const view = projectWorkflowPlanForRenderer(trackProjection(), () => null);
    expect(view).toMatchObject({
      planId: 'plan_track_safe', workflowId: 'edit.track_add.v1', planKind: 'edit_track_add', state: 'consumed',
      approvalState: 'approved', requiredBackup: true, backupState: 'created', verificationLevel: 'STRUCTURAL_READBACK',
      target: { kind: 'timeline', handle: null, label: 'Main Cut', generation: null },
      proposedChange: { kind: 'add_track', trackType: 'video', placement: 'append', expectedTrackIndex: 2 },
      execution: { state: 'verified', verificationStatus: 'passed', verificationLevel: 'STRUCTURAL_READBACK', actualPresent: true }
    });
    const serialized = JSON.stringify(view);
    for (const value of forbidden) expect(serialized).not.toContain(value);
  });

  it('projects a grade-version Plan through semantic item identity without private Color state', () => {
    const view = projectWorkflowPlanForRenderer(colorVersionProjection(), (exactId) => exactId === 'item-color-secret'
      ? { kind: 'timeline_item', exactId, handle: 'I9', label: 'BMX clip', generation: 12, parentHandle: 'T1', locator: 'V1' }
      : null);
    expect(view).toMatchObject({
      planId: 'plan_color_safe', workflowId: 'color.grade_version_create.v1', planKind: 'color_grade_version_create',
      state: 'ready', approvalState: 'awaiting', requiredBackup: false, backupState: 'not_required',
      verificationLevel: 'API_READBACK',
      target: { kind: 'timeline_item', handle: 'I9', label: 'BMX clip', generation: 12 },
      proposedChange: { kind: 'create_grade_version', name: 'Agent Version' }
    });
    const serialized = JSON.stringify(view);
    for (const value of forbidden) expect(serialized).not.toContain(value);
    expect(serialized).not.toContain('local_versions');
    expect(serialized).not.toContain('remote_versions');
    expect(serialized).not.toContain('version_state_hash');
    expect(serialized).not.toContain('versionType');
    expect(serialized).not.toContain('version_type');
  });

  it('preserves closed Plan states and ambiguous execution without exposing canonical detail', () => {
    for (const state of ['rejected', 'expired', 'stale'] as const) {
      const projection = markerProjection();
      projection.state = state;
      const view = projectWorkflowPlanForRenderer(projection, () => null);
      expect(view.state).toBe(state);
      expect(view.approvalState).toBe(state === 'rejected' ? 'rejected' : 'closed');
    }

    const ambiguous = trackProjection();
    ambiguous.execution!.state = 'ambiguous';
    ambiguous.execution!.writer_returned = null;
    ambiguous.execution!.writer_precondition_ok = null;
    ambiguous.execution!.structural_readback = null;
    ambiguous.change_set.state = 'ambiguous';
    ambiguous.change_set.actual_observation = null;
    ambiguous.change_set.verification_status = 'unverified';
    ambiguous.change_set.verification_level = null;
    const view = projectWorkflowPlanForRenderer(ambiguous, () => null);
    expect(view.execution).toMatchObject({
      state: 'ambiguous', verificationStatus: 'unverified', verificationLevel: null, actualPresent: null
    });
    const serialized = JSON.stringify(view);
    for (const value of forbidden) expect(serialized).not.toContain(value);
  });
});
