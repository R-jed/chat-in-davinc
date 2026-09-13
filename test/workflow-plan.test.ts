import { describe, expect, it } from 'vitest';
import type { ReviewMarkerWorkflowPlan } from '../src/shared/types.js';
import { canonicalJson, hashCanonicalValue, sealWorkflowPlan, verifyWorkflowPlanHash } from '../src/main/workflow-plan.js';

function draft(): Omit<ReviewMarkerWorkflowPlan, 'plan_hash'> {
  return {
    plan_id: 'plan_test',
    hash_algorithm: 'sha256',
    canonicalization_version: '1',
    plan_kind: 'review_marker_add',
    workflow_id: 'edit.review_marker_add.v1',
    workflow_version: '1',
    created_at: '2026-09-10T00:00:00.000Z',
    expires_at: '2026-09-10T00:10:00.000Z',
    resolve_version: '21.1',
    project_unique_id: 'project-id',
    timeline_unique_id: 'timeline-id',
    target_ids: ['item-id'],
    input_fingerprint: 'fingerprint',
    requested_parameters: {
      target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Review', note: 'Check this', duration: 1
    },
    proposed_changes: [{
      kind: 'add_review_marker', target_item_id: 'item-id', frame_offset: 12, color: 'Yellow',
      name: 'Review', note: 'Check this', duration: 1, custom_data: 'cid:plan_test'
    }],
    preconditions: {
      target_item_id: 'item-id', track_type: 'video', track_index: 1, track_locked: false,
      item_start: 0, item_end: 100, item_duration: 100, marker_frame_empty: true, marker_state_hash: 'marker-hash'
    },
    risk_level: 'low',
    blast_radius: 'item',
    preview_mode: 'derived_plan',
    recovery_class: 'B',
    required_backup: false,
    verification_level: 'API_READBACK',
    verification_contract: { id: 'edit.review_marker_add.verify.v1', version: '1' },
    capability_evidence_refs: ['resolve.sandboxed_script.read', 'edit.review_marker.read', 'edit.review_marker.write']
  };
}

describe('workflow plan canonical hashing', () => {
  it('canonicalizes object key order deterministically', () => {
    expect(canonicalJson({ b: 2, a: { z: 3, y: 1 } })).toBe(canonicalJson({ a: { y: 1, z: 3 }, b: 2 }));
  });

  it('seals and verifies execution-relevant plan fields', () => {
    const plan = sealWorkflowPlan(draft());
    expect(plan.plan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyWorkflowPlanHash(plan)).toBe(true);

    const { plan_kind: _legacyMissingDiscriminator, ...legacyDraft } = draft();
    const legacy = {
      ...legacyDraft,
      plan_hash: hashCanonicalValue(legacyDraft),
      plan_kind: 'review_marker_add' as const
    };
    expect(verifyWorkflowPlanHash(legacy)).toBe(true);

    const tampered: ReviewMarkerWorkflowPlan = structuredClone(plan);
    tampered.requested_parameters.note = 'different';
    expect(verifyWorkflowPlanHash(tampered)).toBe(false);
  });
});
