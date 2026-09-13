import type { AgentEntityMention } from '../shared/agent-system.js';
import type {
  RendererWorkflowPlanProjection,
  WorkflowPlanProjection
} from '../shared/types.js';

function approvalState(projection: WorkflowPlanProjection): RendererWorkflowPlanProjection['approvalState'] {
  if (projection.approval) return 'approved';
  if (projection.state === 'rejected') return 'rejected';
  if (projection.state === 'ready') return 'awaiting';
  return 'closed';
}

function targetProjection(
  projection: WorkflowPlanProjection,
  mentionExactId: (exactId: string) => AgentEntityMention | null
): RendererWorkflowPlanProjection['target'] {
  if (projection.plan.plan_kind === 'review_marker_add' || projection.plan.plan_kind === 'color_grade_version_create') {
    const mention = mentionExactId(projection.plan.target_ids[0]);
    const safeMention = mention?.kind === 'timeline_item' ? mention : null;
    return {
      kind: 'timeline_item',
      handle: safeMention?.handle ?? null,
      label: safeMention?.label ?? `Video timeline item · V${projection.plan.preconditions.track_index}`,
      generation: safeMention?.generation ?? null
    };
  }

  const mention = mentionExactId(projection.plan.timeline_unique_id);
  const safeMention = mention?.kind === 'timeline' ? mention : null;
  return {
    kind: 'timeline',
    handle: safeMention?.handle ?? null,
    label: safeMention?.label ?? projection.plan.preconditions.timeline_name,
    generation: safeMention?.generation ?? null
  };
}

function proposedChange(projection: WorkflowPlanProjection): RendererWorkflowPlanProjection['proposedChange'] {
  if (projection.plan.plan_kind === 'review_marker_add') {
    const change = projection.plan.proposed_changes[0];
    if (!change) throw new Error('Review-marker Plan has no proposed change to project for renderer display');
    return {
      kind: 'add_review_marker',
      name: change.name,
      note: change.note,
      color: change.color,
      frameOffset: change.frame_offset,
      duration: change.duration
    };
  }
  if (projection.plan.plan_kind === 'edit_track_add') {
    const change = projection.plan.proposed_changes[0];
    return {
      kind: 'add_track',
      trackType: change.track_type,
      placement: change.placement,
      expectedTrackIndex: change.expected_track_index
    };
  }
  if (projection.plan.plan_kind === 'color_grade_version_create') {
    const change = projection.plan.proposed_changes[0];
    return {
      kind: 'create_grade_version',
      name: change.name
    };
  }
  return {
    kind: 'structural_edit',
    summary: projection.plan.proposed_changes[0]?.summary ?? projection.plan.requested_parameters.summary
  };
}

export function projectWorkflowPlanForRenderer(
  projection: WorkflowPlanProjection,
  mentionExactId: (exactId: string) => AgentEntityMention | null
): RendererWorkflowPlanProjection {
  const observation = projection.change_set.actual_observation;
  const actualPresent = observation?.kind === 'review_marker_state' || observation?.kind === 'track_add_state' || observation?.kind === 'grade_version_state'
    ? observation.present
    : null;
  return {
    planId: projection.plan.plan_id,
    workflowId: projection.plan.workflow_id,
    planKind: projection.plan.plan_kind,
    state: projection.state,
    risk: projection.plan.risk_level,
    blastRadius: projection.plan.blast_radius,
    createdAt: projection.plan.created_at,
    expiresAt: projection.plan.expires_at,
    requiredBackup: projection.plan.required_backup,
    backupState: projection.plan.required_backup
      ? projection.backup ? 'created' : 'required'
      : 'not_required',
    verificationLevel: projection.plan.verification_level,
    approvalState: approvalState(projection),
    approval: projection.approval
      ? { approvedAt: projection.approval.approved_at, expiresAt: projection.approval.expires_at }
      : null,
    target: targetProjection(projection, mentionExactId),
    proposedChange: proposedChange(projection),
    execution: projection.execution
      ? {
          state: projection.execution.state,
          verificationStatus: projection.change_set.verification_status,
          verificationLevel: projection.change_set.verification_level,
          recoveryStatus: projection.change_set.recovery_status,
          actualPresent
        }
      : null
  };
}
