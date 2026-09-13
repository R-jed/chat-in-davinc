import { createHash, randomUUID } from 'node:crypto';
import type { ColorGradeVersionCreateWorkflowPlan, EditStructuralWorkflowPlan, EditTrackAddWorkflowPlan, ReviewMarkerWorkflowPlan, WorkflowPlan } from '../shared/types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Plan contains a non-finite number');
  if (value === undefined) throw new Error('Plan contains undefined');
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashCanonicalValue(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function createPlanId(): string { return `plan_${randomUUID()}`; }

export function sealWorkflowPlan(draft: Omit<ReviewMarkerWorkflowPlan, 'plan_hash'>): ReviewMarkerWorkflowPlan;
export function sealWorkflowPlan(draft: Omit<EditStructuralWorkflowPlan, 'plan_hash'>): EditStructuralWorkflowPlan;
export function sealWorkflowPlan(draft: Omit<EditTrackAddWorkflowPlan, 'plan_hash'>): EditTrackAddWorkflowPlan;
export function sealWorkflowPlan(draft: Omit<ColorGradeVersionCreateWorkflowPlan, 'plan_hash'>): ColorGradeVersionCreateWorkflowPlan;
export function sealWorkflowPlan(
  draft:
    | Omit<ReviewMarkerWorkflowPlan, 'plan_hash'>
    | Omit<EditStructuralWorkflowPlan, 'plan_hash'>
    | Omit<EditTrackAddWorkflowPlan, 'plan_hash'>
    | Omit<ColorGradeVersionCreateWorkflowPlan, 'plan_hash'>
): WorkflowPlan {
  const plan = { ...structuredClone(draft), plan_hash: '' } as WorkflowPlan;
  const { plan_hash: _ignored, ...hashable } = plan;
  plan.plan_hash = hashCanonicalValue(hashable);
  return plan;
}

export function verifyWorkflowPlanHash(plan: WorkflowPlan): boolean {
  const { plan_hash, ...hashable } = plan;
  if (plan_hash === hashCanonicalValue(hashable)) return true;
  if (plan.plan_kind !== 'review_marker_add') return false;
  if (plan.requested_parameters.target !== 'current_video_item') return false;
  const { plan_kind: _legacyMissingDiscriminator, ...legacyHashable } = hashable;
  return plan_hash === hashCanonicalValue(legacyHashable);
}
