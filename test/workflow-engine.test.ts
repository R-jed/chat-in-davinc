import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResolveBrokerError, type ResolveBroker, type ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import {
  createColorGradeVersionCreatePlan,
  createEditTrackAddPlan,
  createTimelineDuplicateBackupForPlan,
  createReviewMarkerPlan,
  executeColorGradeVersionCreatePlan,
  executeEditTrackAddPlan,
  executeWorkflowPlan,
  getLatestWorkflowTimelineForProject,
  getWorkflowPlan,
  grantWorkflowPlanApproval,
  initWorkflowEngine,
  invalidateWorkflowAuthority,
  revalidateWorkflowPlan,
  rejectWorkflowPlan,
  resetWorkflowEngineForTests,
  setBeforeMutationDispatchHookForTests,
  workflowEngineError
} from '../src/main/workflow-engine.js';
import { hashCanonicalValue, sealWorkflowPlan } from '../src/main/workflow-plan.js';
import { projectWorkflowPlanForRenderer } from '../src/main/workflow-plan-view.js';
import type { EditStructuralWorkflowPlan, WorkflowApprovalRecord } from '../src/shared/types.js';
import {
  appendWorkflowLedgerEvent,
  closeWorkflowLedger,
  initWorkflowLedger,
  resetWorkflowLedgerForTests,
  workflowLedgerError,
  workflowLedgerEvents
} from '../src/main/workflow-ledger.js';
import { callWorkflowTool, workflowTools } from '../src/main/workflow.js';
import { ToolKernel, type ToolKernelSemanticState } from '../src/main/tool-kernel.js';

let tempDir: string | null = null;

function mcpResult(result: Record<string, unknown>): unknown {
  return { content: [{ type: 'text', text: JSON.stringify({ result }) }] };
}

function evidence(): Record<string, unknown> {
  return {
    projectId: 'project-id',
    timelineId: 'timeline-id',
    itemId: 'item-id',
    trackType: 'video',
    trackIndex: 1,
    trackLocked: false,
    itemStart: 0,
    itemEnd: 100,
    itemDuration: 100,
    markerAtFrame: null
  };
}

function structuralEvidence(): Record<string, unknown> {
  return {
    projectId: 'project-id',
    timelineId: 'timeline-id',
    timelineName: 'Main Cut',
    startFrame: 0,
    endFrame: 100,
    complete: true,
    tracks: [{
      type: 'video',
      index: 1,
      locked: false,
      items: [{
        itemId: 'item-id',
        recordStart: 0,
        recordEnd: 100,
        duration: 100,
        sourceStart: 0,
        sourceEnd: 100,
        leftOffset: 0,
        rightOffset: 0,
        mediaPoolItemId: 'media-item-id'
      }]
    }]
  };
}

function structuralEvidenceWithAddedVideoTrack(): Record<string, unknown> {
  const result = structuredClone(structuralEvidence());
  const tracks = result['tracks'] as Array<Record<string, unknown>>;
  tracks.push({ type: 'video', index: 2, locked: false, items: [] });
  return result;
}

function gradeVersionEvidence(
  localVersions: string[] = ['版本 1'],
  currentName = '版本 1'
): Record<string, unknown> {
  return {
    projectId: 'project-id',
    timelineId: 'timeline-id',
    itemId: 'item-id',
    trackIndex: 1,
    localVersions,
    remoteVersions: ['版本 1'],
    currentVersion: { versionName: currentName, versionType: 0 },
    complete: true
  };
}

function fakeBroker(target: Record<string, unknown>, scripts: string[]) {
  return {
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      expect(name).toBe('run_script');
      const script = String(args['script'] ?? '');
      scripts.push(script);
      expect(script).not.toContain('AddMarker(');
      expect(script).not.toContain('DeleteMarker');
      return mcpResult(target);
    },
    async getResolveStatus(): Promise<Record<string, unknown>> {
      return { running: true, version: '21.1' };
    }
  };
}

function classCPlan(): EditStructuralWorkflowPlan {
  const structure = structuralEvidence();
  const structureFingerprint = hashCanonicalValue({
    projectId: structure.projectId,
    timelineId: structure.timelineId,
    startFrame: structure.startFrame,
    endFrame: structure.endFrame,
    tracks: structure.tracks
  });
  return sealWorkflowPlan({
    plan_id: 'plan-class-c-backup',
    hash_algorithm: 'sha256',
    canonicalization_version: '1',
    plan_kind: 'edit_structural',
    workflow_id: 'edit.timeline_structural_guard.v1',
    workflow_version: '1',
    created_at: '2026-09-12T00:00:00.000Z',
    expires_at: '2099-09-13T00:10:00.000Z',
    resolve_version: '21.1',
    project_unique_id: 'project-id',
    timeline_unique_id: 'timeline-id',
    target_ids: ['timeline-id'],
    input_fingerprint: structureFingerprint,
    requested_parameters: { target: 'current_timeline', intent: 'structural_edit', summary: 'Synthetic protected structural edit' },
    proposed_changes: [{ kind: 'structural_edit', summary: 'Synthetic protected structural edit' }],
    preconditions: {
      timeline_name: 'Main Cut',
      timeline_start_frame: 0,
      timeline_end_frame: 100,
      track_count: 1,
      item_count: 1,
      structure_fingerprint: structureFingerprint
    },
    risk_level: 'medium',
    blast_radius: 'timeline',
    preview_mode: 'derived_plan',
    recovery_class: 'C',
    required_backup: true,
    verification_level: 'STRUCTURAL_READBACK',
    verification_contract: { id: 'edit.timeline_structural_guard.verify.v1', version: '1' },
    capability_evidence_refs: ['edit.timeline_structure.read']
  });
}

function classCApproval(plan: EditStructuralWorkflowPlan, approvalId = 'approval-class-c-backup'): WorkflowApprovalRecord {
  return {
    approval_id: approvalId,
    plan_id: plan.plan_id,
    plan_hash: plan.plan_hash,
    approved_at: new Date(Date.now() - 1_000).toISOString(),
    expires_at: plan.expires_at,
    approved_scope: 'exact_plan',
    provenance: 'local_renderer'
  };
}

async function seedApprovedClassCPlan(broker: Parameters<typeof initWorkflowEngine>[0]): Promise<EditStructuralWorkflowPlan> {
  const plan = classCPlan();
  const approval = classCApproval(plan);
  await appendWorkflowLedgerEvent({
    eventType: 'plan_created', planId: plan.plan_id, workflowId: plan.workflow_id,
    workflowVersion: plan.workflow_version, payload: { plan }, flush: true
  });
  await appendWorkflowLedgerEvent({
    eventType: 'approval_granted', planId: plan.plan_id, approvalId: approval.approval_id,
    workflowId: plan.workflow_id, workflowVersion: plan.workflow_version, payload: { approval }, flush: true
  });
  initWorkflowEngine(broker);
  return plan;
}

afterEach(async () => {
  vi.useRealTimers();
  resetWorkflowEngineForTests();
  await closeWorkflowLedger().catch(() => undefined);
  resetWorkflowLedgerForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('workflow plan and local approval engine', () => {
  it('creates one exact LOCAL grade version through approved Plan and API readback', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let state = gradeVersionEvidence();
    let addCalls = 0;
    const scripts: string[] = [];
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        scripts.push(script);
        if (script.includes('item.AddVersion(new_name, 0)')) {
          addCalls += 1;
          state = gradeVersionEvidence(['版本 1', 'Agent Version'], 'Agent Version');
          return mcpResult({ preconditionOk: true, addOk: true });
        }
        if (script.includes('local_versions = item.GetVersionNameList(0)')) return mcpResult(state);
        throw new Error('Unexpected grade-version script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve', serverVersion: '21.1', protocolVersion: '2024-11-05', instructions: null,
      tools: [{ name: 'run_script', description: 'qualified script surface', inputSchema: { type: 'object', properties: {} } }],
      schemaHash: 'grade-version-test'
    };
    const semanticState: ToolKernelSemanticState = {
      observe() {},
      invalidate() {},
      resolveEntity(handle, generation) {
        expect(handle).toBe('I9');
        expect(generation).toBe(7);
        return {
          kind: 'timeline_item', exactId: 'item-id', handle: 'I9', label: 'Grade target', generation: 7,
          parentHandle: 'T1', locator: 'V1'
        };
      }
    };
    const kernel = new ToolKernel(broker, snapshot, semanticState);
    const plannedResult = await kernel.call(
      { caller: 'agent', sessionId: 'session-grade', turnId: 'turn-grade' },
      'plan',
      { workflowId: 'color.grade_version_create.v1', target: 'timeline_item', itemRef: 'I9', generation: 7, name: 'Agent Version' }
    );
    const plannedText = plannedResult.content[0]?.type === 'text' ? plannedResult.content[0].text : '';
    const plannedEnvelope = JSON.parse(plannedText) as Record<string, Record<string, unknown>>;
    const planned = plannedEnvelope['result'] as unknown as ReturnType<typeof getWorkflowPlan> extends infer T ? Exclude<T, null> : never;
    expect(planned).toMatchObject({
      state: 'ready',
      plan: {
        plan_kind: 'color_grade_version_create',
        workflow_id: 'color.grade_version_create.v1',
        target_ids: ['item-id'],
        recovery_class: 'B',
        required_backup: false,
        verification_level: 'API_READBACK',
        requested_parameters: { target: 'timeline_item', name: 'Agent Version', version_type: 0 }
      }
    });
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    const executedResult = await kernel.call(
      { caller: 'agent', sessionId: 'session-grade', turnId: 'turn-grade' },
      'execute',
      { planId: planned.plan.plan_id }
    );
    const executedText = executedResult.content[0]?.type === 'text' ? executedResult.content[0].text : '';
    const executedEnvelope = JSON.parse(executedText) as Record<string, Record<string, unknown>>;
    const executed = executedEnvelope['result'];
    expect(addCalls).toBe(1);
    expect(executed).toMatchObject({
      state: 'consumed',
      execution: {
        state: 'verified',
        writer_returned: true,
        writer_precondition_ok: true,
        grade_version_readback: { name: 'Agent Version', version_type: 0, present: true, current: true }
      },
      change_set: {
        state: 'verified',
        verification_status: 'passed',
        verification_level: 'API_READBACK',
        actual_observation: { kind: 'grade_version_state', name: 'Agent Version', present: true, current: true }
      }
    });
    expect(scripts.filter((script) => script.includes('item.AddVersion(new_name, 0)'))).toHaveLength(1);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'execution_prepared', 'dispatch_started',
      'dispatch_returned', 'verification_started', 'verification_completed'
    ]);
    expect(executedEnvelope['operation']).toMatchObject({
      workflow_id: 'color.grade_version_create.v1',
      status: 'success',
      blast_radius: 'item',
      verification: { status: 'passed', level_reached: 'API_READBACK' }
    });
  });

  it('marks a grade-version Plan stale when exact version state changes before approval', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let state = gradeVersionEvidence();
    let addCalls = 0;
    const broker = {
      async callTool(_name: string, args: Record<string, unknown>): Promise<unknown> {
        const script = String(args['script'] ?? '');
        if (script.includes('item.AddVersion(new_name, 0)')) {
          addCalls += 1;
          return mcpResult({ preconditionOk: true, addOk: true });
        }
        return mcpResult(state);
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createColorGradeVersionCreatePlan('Agent Version', 'item-id');
    state = gradeVersionEvidence(['版本 1', 'Human Version'], 'Human Version');
    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('grade-version state changed after planning');
    expect(getWorkflowPlan(planned.plan.plan_id)?.state).toBe('stale');
    expect(addCalls).toBe(0);
  });

  it('does not dispatch Class B grade-version recovery after Resolve authority is lost', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let state = gradeVersionEvidence();
    let addCalls = 0;
    let recoveryCalls = 0;
    let authorityInvalidated = false;
    const broker = {
      async callTool(_name: string, args: Record<string, unknown>): Promise<unknown> {
        const script = String(args['script'] ?? '');
        if (script.includes('item.AddVersion(new_name, 0)')) {
          addCalls += 1;
          state = gradeVersionEvidence(['版本 1', 'Agent Version'], '版本 1');
          return mcpResult({ preconditionOk: true, addOk: true });
        }
        if (script.includes('LoadVersionByName(original_name, 0)') || script.includes('DeleteVersionByName(new_name, 0)')) {
          recoveryCalls += 1;
          throw new Error('Recovery must not dispatch after authority loss');
        }
        if (Array.isArray(state['localVersions']) && state['localVersions'].includes('Agent Version') && !authorityInvalidated) {
          invalidateWorkflowAuthority();
          authorityInvalidated = true;
        }
        return mcpResult(state);
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createColorGradeVersionCreatePlan('Agent Version', 'item-id');
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    const result = await executeColorGradeVersionCreatePlan(planned.plan.plan_id);
    expect(addCalls).toBe(1);
    expect(recoveryCalls).toBe(0);
    expect(result).toMatchObject({
      state: 'consumed',
      execution: {
        state: 'recovery_failed',
        recovery_status: 'unavailable',
        grade_version_readback: { name: 'Agent Version', version_type: 0, present: true, current: false }
      }
    });
    expect(result.execution?.reason).toContain('authority changed before Class B compensation');
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'execution_prepared', 'dispatch_started',
      'dispatch_returned', 'verification_started', 'verification_completed',
      'recovery_started', 'recovery_completed'
    ]);

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(workflowEngineError()).toBeNull();
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({
      state: 'consumed',
      execution: { state: 'recovery_failed', recovery_status: 'unavailable' }
    });
    expect(recoveryCalls).toBe(0);
  });

  it('runs the internal append-empty-video-track Plan through Class C backup and structural readback', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let trackAdded = false;
    let addTrackCalls = 0;
    const scripts: string[] = [];
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        scripts.push(script);
        if (script.includes('DuplicateTimeline(')) {
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('t.AddTrack("video")')) {
          addTrackCalls += 1;
          trackAdded = true;
          return mcpResult({
            preconditionOk: true,
            addOk: true,
            beforeVideoTrackCount: 1,
            afterVideoTrackCount: 2,
            newTrackIndex: 2,
            newTrackItemCount: 0,
            beforeFingerprint: null
          });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) {
          return mcpResult(trackAdded ? structuralEvidenceWithAddedVideoTrack() : structuralEvidence());
        }
        throw new Error('Unexpected script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);

    const planned = await createEditTrackAddPlan();
    expect(planned).toMatchObject({
      state: 'ready',
      plan: {
        plan_kind: 'edit_track_add',
        workflow_id: 'edit.track_add.v1',
        required_backup: true,
        recovery_class: 'C',
        verification_level: 'STRUCTURAL_READBACK',
        preconditions: { video_track_count_before: 1, expected_new_track_index: 2 }
      }
    });
    expect(workflowTools().map((tool) => tool.name)).toEqual(['status', 'inspect', 'inspect_operation', 'audit', 'plan', 'execute']);
    const approved = await grantWorkflowPlanApproval(planned.plan.plan_id);
    expect(approved.state).toBe('approved');
    await expect(executeEditTrackAddPlan(planned.plan.plan_id)).rejects.toThrow('requires a verified durable timeline backup');
    const protectedPlan = await createTimelineDuplicateBackupForPlan(planned.plan.plan_id);
    expect(protectedPlan.backup?.backup_timeline_id).toBe('timeline-backup-id');
    await expect(executeWorkflowPlan(planned.plan.plan_id)).rejects.toThrow('not registered for this plan kind');

    const executed = await executeEditTrackAddPlan(planned.plan.plan_id);
    expect(executed).toMatchObject({
      state: 'consumed',
      execution: {
        state: 'verified',
        writer_returned: true,
        structural_readback: {
          kind: 'track_add_state', track_type: 'video', track_index: 2, present: true, item_count: 0
        }
      },
      change_set: {
        state: 'verified',
        verification_status: 'passed',
        verification_level: 'STRUCTURAL_READBACK',
        actual_observation: {
          kind: 'track_add_state', track_type: 'video', track_index: 2, present: true, item_count: 0
        },
        backup: { backup_timeline_id: 'timeline-backup-id' }
      }
    });
    expect(addTrackCalls).toBe(1);
    expect(scripts.some((script) => script.includes('DeleteTrack('))).toBe(false);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started', 'backup_created',
      'execution_prepared', 'dispatch_started', 'dispatch_returned', 'verification_started', 'verification_completed'
    ]);
  });

  it('cancels Class C backup before DuplicateTimeline when Resolve authority changes after the durable backup boundary', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let duplicateCalls = 0;
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          duplicateCalls += 1;
          throw new Error('DuplicateTimeline must not dispatch after authority loss');
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        throw new Error('Unexpected backup-cancellation script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    setBeforeMutationDispatchHookForTests(() => invalidateWorkflowAuthority());

    const cancelled = await createTimelineDuplicateBackupForPlan(planned.plan.plan_id);
    expect(cancelled).toMatchObject({ state: 'ready', approval: null, backup: null });
    expect(cancelled.reason).toContain('backup boundary');
    expect(duplicateCalls).toBe(0);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started', 'backup_cancelled'
    ]);

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(workflowEngineError()).toBeNull();
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({ state: 'ready', approval: null, backup: null });
    await expect(createTimelineDuplicateBackupForPlan(planned.plan.plan_id)).rejects.toThrow('cannot create backup because it is ready');
    expect(duplicateCalls).toBe(0);
  });

  it('cancels track writer before AddTrack when Resolve authority changes after dispatch_started', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let addTrackCalls = 0;
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-authority-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-authority-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('t.AddTrack("video")')) {
          addTrackCalls += 1;
          throw new Error('AddTrack must not dispatch after authority loss');
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        throw new Error('Unexpected track authority-cancellation script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    await createTimelineDuplicateBackupForPlan(planned.plan.plan_id);
    setBeforeMutationDispatchHookForTests(() => invalidateWorkflowAuthority());

    const cancelled = await executeEditTrackAddPlan(planned.plan.plan_id);
    expect(cancelled).toMatchObject({
      state: 'consumed', approval: null,
      execution: { state: 'failed', writer_returned: null, writer_precondition_ok: null, recovery_status: 'unavailable' }
    });
    expect(cancelled.execution?.reason).toContain('dispatch boundary');
    expect(addTrackCalls).toBe(0);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started', 'backup_created',
      'execution_prepared', 'dispatch_started', 'execution_cancelled'
    ]);

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(workflowEngineError()).toBeNull();
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({
      state: 'consumed', approval: null, execution: { state: 'failed', recovery_status: 'unavailable' }
    });
    await expect(executeEditTrackAddPlan(planned.plan.plan_id)).rejects.toThrow('cannot execute because it is consumed');
    expect(addTrackCalls).toBe(0);
  });

  it('cancels marker writer before AddMarker when Resolve authority changes after dispatch_started', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let addMarkerCalls = 0;
    const target = evidence();
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('AddMarker(')) {
          addMarkerCalls += 1;
          throw new Error('AddMarker must not dispatch after authority loss');
        }
        return mcpResult(target);
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 8, color: 'Blue', name: 'Authority fence', note: '', duration: 1
    });
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    setBeforeMutationDispatchHookForTests(() => invalidateWorkflowAuthority());

    const cancelled = await executeWorkflowPlan(planned.plan.plan_id);
    expect(cancelled).toMatchObject({
      state: 'consumed', approval: null,
      execution: { state: 'failed', writer_returned: null, writer_precondition_ok: null, recovery_status: 'unavailable' }
    });
    expect(cancelled.execution?.reason).toContain('dispatch boundary');
    expect(addMarkerCalls).toBe(0);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'execution_prepared', 'dispatch_started', 'execution_cancelled'
    ]);

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(workflowEngineError()).toBeNull();
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({
      state: 'consumed', approval: null, execution: { state: 'failed', recovery_status: 'unavailable' }
    });
    await expect(executeWorkflowPlan(planned.plan.plan_id)).rejects.toThrow('cannot execute because it is consumed');
    expect(addMarkerCalls).toBe(0);
  });

  it('marks an internal track-add Plan stale when a human edit changes structure before approval', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const structure = structuralEvidence();
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structure);
        throw new Error('Unexpected script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    const tracks = structure['tracks'] as Array<Record<string, unknown>>;
    const items = tracks[0]!['items'] as Array<Record<string, unknown>>;
    items[0]!['recordEnd'] = 99;
    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('human edits win and require a new Plan');
    expect(getWorkflowPlan(planned.plan.plan_id)?.state).toBe('stale');
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'plan_stale']);
  });

  it('fails closed on replay when a durable track-add approval lacks exact local approval evidence', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        throw new Error('Unexpected script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    const approvalId = 'approval-malformed-track-add';
    await appendWorkflowLedgerEvent({
      eventType: 'approval_granted',
      planId: planned.plan.plan_id,
      approvalId,
      workflowId: planned.plan.workflow_id,
      workflowVersion: planned.plan.workflow_version,
      payload: {
        approval: {
          approval_id: approvalId,
          plan_id: planned.plan.plan_id,
          plan_hash: planned.plan.plan_hash,
          approved_at: new Date(Date.parse(planned.plan.created_at) + 1).toISOString(),
          approved_scope: 'exact_plan',
          provenance: 'local_renderer'
        }
      },
      flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(workflowEngineError()).toContain('Workflow approval ledger event is invalid');
    await expect(createTimelineDuplicateBackupForPlan(planned.plan.plan_id)).rejects.toThrow('Workflow approval ledger event is invalid');
  });

  it('fails closed on replay when verified track-add evidence says the writer precondition was false', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        throw new Error('Unexpected script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    const approved = await grantWorkflowPlanApproval(planned.plan.plan_id);
    await createTimelineDuplicateBackupForPlan(planned.plan.plan_id);
    const approvalId = approved.approval!.approval_id;
    const executionId = 'execution-track-add-replay-precondition-false';
    await appendWorkflowLedgerEvent({
      eventType: 'execution_prepared', planId: planned.plan.plan_id, approvalId, executionId,
      workflowId: planned.plan.workflow_id, workflowVersion: planned.plan.workflow_version,
      payload: { input_fingerprint: planned.plan.input_fingerprint, expected_track_index: 2 }
    });
    await appendWorkflowLedgerEvent({
      eventType: 'dispatch_started', planId: planned.plan.plan_id, approvalId, executionId,
      workflowId: planned.plan.workflow_id, workflowVersion: planned.plan.workflow_version,
      payload: { expected_track_index: 2 }, flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'dispatch_returned', planId: planned.plan.plan_id, approvalId, executionId,
      workflowId: planned.plan.workflow_id, workflowVersion: planned.plan.workflow_version,
      payload: { writer_returned: true, writer_precondition_ok: false }, flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'verification_started', planId: planned.plan.plan_id, approvalId, executionId,
      workflowId: planned.plan.workflow_id, workflowVersion: planned.plan.workflow_version,
      payload: { contract: { id: 'edit.track_add.verify.v1', version: '1' } }, flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'verification_completed', planId: planned.plan.plan_id, approvalId, executionId,
      workflowId: planned.plan.workflow_id, workflowVersion: planned.plan.workflow_version,
      payload: {
        status: 'verified',
        reason: null,
        structural_readback: { kind: 'track_add_state', track_type: 'video', track_index: 2, present: true, item_count: 0 }
      },
      flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(workflowEngineError()).toContain('Workflow structural verification ledger event is invalid');
    await expect(executeEditTrackAddPlan(planned.plan.plan_id)).rejects.toThrow('Workflow structural verification ledger event is invalid');
  });

  it('does not retry an ambiguous internal track-add dispatch across restart', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let addTrackCalls = 0;
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('t.AddTrack("video")')) {
          addTrackCalls += 1;
          throw new ResolveBrokerError('synthetic timeout after AddTrack dispatch', true);
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        throw new Error('Unexpected script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    await createTimelineDuplicateBackupForPlan(planned.plan.plan_id);

    const ambiguous = await executeEditTrackAddPlan(planned.plan.plan_id);
    expect(ambiguous).toMatchObject({
      state: 'consumed',
      execution: { state: 'ambiguous', writer_returned: null, structural_readback: null, recovery_status: 'unavailable' }
    });
    expect(addTrackCalls).toBe(1);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started', 'backup_created',
      'execution_prepared', 'dispatch_started', 'execution_ambiguous'
    ]);
    await expect(executeEditTrackAddPlan(planned.plan.plan_id)).rejects.toThrow('cannot execute because it is consumed');

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    expect(getWorkflowPlan(planned.plan.plan_id)?.execution?.state).toBe('ambiguous');
    await expect(executeEditTrackAddPlan(planned.plan.plan_id)).rejects.toThrow('cannot execute because it is consumed');
    expect(addTrackCalls).toBe(1);
  });

  it('fails without retry when writer-side fingerprint catches a human edit after outer revalidation', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const structure = structuralEvidence();
    let addTrackCalls = 0;
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('t.AddTrack("video")')) {
          addTrackCalls += 1;
          const tracks = structure['tracks'] as Array<Record<string, unknown>>;
          const items = tracks[0]!['items'] as Array<Record<string, unknown>>;
          items[0]!['recordEnd'] = 99;
          return mcpResult({
            preconditionOk: false,
            addOk: false,
            beforeVideoTrackCount: 1,
            afterVideoTrackCount: 1,
            newTrackIndex: 2,
            newTrackItemCount: 0,
            beforeFingerprint: 'different'
          });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structure);
        throw new Error('Unexpected script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const planned = await createEditTrackAddPlan();
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    await createTimelineDuplicateBackupForPlan(planned.plan.plan_id);

    const executed = await executeEditTrackAddPlan(planned.plan.plan_id);
    expect(executed).toMatchObject({
      state: 'consumed',
      execution: {
        state: 'failed',
        writer_returned: false,
        structural_readback: { kind: 'track_add_state', track_index: 2, present: false, item_count: null }
      }
    });
    expect(executed.execution?.reason).toContain('fingerprint precondition rejected');
    expect(addTrackCalls).toBe(1);
    await expect(executeEditTrackAddPlan(planned.plan.plan_id)).rejects.toThrow('cannot execute because it is consumed');
    expect(addTrackCalls).toBe(1);
  });

  it('durably binds approval to the exact canonical plan across restart', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    const scripts: string[] = [];
    initWorkflowEngine(fakeBroker(target, scripts));

    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Review', note: 'Check cut', duration: 1
    });
    if (planned.plan.plan_kind !== 'review_marker_add') throw new Error('Expected review marker Plan');
    expect(planned.state).toBe('ready');
    expect(getLatestWorkflowTimelineForProject('project-id')).toBe('timeline-id');
    expect(getLatestWorkflowTimelineForProject('other-project')).toBeNull();
    expect(planned.plan.target_ids).toEqual(['item-id']);
    expect(planned.plan.preconditions.marker_frame_empty).toBe(true);
    expect(planned.plan.plan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(planned.change_set).toMatchObject({
      plan_id: planned.plan.plan_id,
      workflow_id: 'edit.review_marker_add.v1',
      state: 'proposed',
      verification_status: 'unverified',
      actual_observation: null
    });

    const approved = await grantWorkflowPlanApproval(planned.plan.plan_id);
    expect(approved.state).toBe('approved');
    expect(approved.change_set.state).toBe('approved');
    expect(approved.approval).toMatchObject({
      plan_id: planned.plan.plan_id,
      plan_hash: planned.plan.plan_hash,
      approved_scope: 'exact_plan',
      provenance: 'local_renderer'
    });
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'approval_granted']);

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(target, scripts));
    const restored = getWorkflowPlan(planned.plan.plan_id);
    expect(restored?.state).toBe('approved');
    expect(restored?.approval?.plan_hash).toBe(planned.plan.plan_hash);
    expect(restored?.change_set).toMatchObject({
      changeset_id: planned.change_set.changeset_id,
      state: 'approved',
      verification_status: 'unverified'
    });
    if (!restored) throw new Error('Expected durable Plan replay');
    const rendererProjection = projectWorkflowPlanForRenderer(restored, (exactId) => exactId === 'item-id'
      ? { kind: 'timeline_item', exactId, handle: 'I1', label: 'Replay item', generation: 2, parentHandle: 'T1', locator: 'V1 · item 1' }
      : null);
    expect(rendererProjection).toMatchObject({
      planId: planned.plan.plan_id,
      state: 'approved',
      approvalState: 'approved',
      target: { kind: 'timeline_item', handle: 'I1', label: 'Replay item', generation: 2 }
    });
    expect(JSON.stringify(rendererProjection)).not.toContain(planned.plan.plan_hash);
    expect(JSON.stringify(rendererProjection)).not.toContain('item-id');
    expect(scripts.length).toBe(2);
  });

  it('fails closed on a self-consistent legacy marker hash whose approved request disagrees with the writer change', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    initWorkflowEngine(fakeBroker(target, []));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Legacy mismatch', note: 'Check cut', duration: 1
    });
    if (planned.plan.plan_kind !== 'review_marker_add') throw new Error('Expected review marker Plan');
    const legacy = structuredClone(planned.plan) as unknown as Record<string, unknown>;
    delete legacy['plan_kind'];
    const changes = legacy['proposed_changes'] as Array<Record<string, unknown>>;
    changes[0]!['frame_offset'] = 13;
    delete legacy['plan_hash'];
    legacy['plan_hash'] = hashCanonicalValue(legacy);
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created',
      planId: planned.plan.plan_id,
      workflowId: planned.plan.workflow_id,
      workflowVersion: planned.plan.workflow_version,
      payload: { plan: legacy },
      flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(target, []));
    expect(workflowEngineError()).toContain('Workflow plan ledger event is invalid');
    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('Workflow plan ledger event is invalid');
  });

  it('fails closed when a legacy marker Plan precondition no longer matches its sealed input fingerprint', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    initWorkflowEngine(fakeBroker(target, []));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Legacy fingerprint', note: '', duration: 1
    });
    if (planned.plan.plan_kind !== 'review_marker_add') throw new Error('Expected review marker Plan');
    const legacy = structuredClone(planned.plan) as unknown as Record<string, unknown>;
    delete legacy['plan_kind'];
    const preconditions = legacy['preconditions'] as Record<string, unknown>;
    preconditions['item_duration'] = 1000;
    delete legacy['plan_hash'];
    legacy['plan_hash'] = hashCanonicalValue(legacy);
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created', planId: planned.plan.plan_id, workflowId: planned.plan.workflow_id,
      workflowVersion: planned.plan.workflow_version, payload: { plan: legacy }, flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(target, []));
    expect(workflowEngineError()).toContain('Workflow plan ledger event is invalid');
  });

  it('fails closed when a legacy marker Plan carries a malformed non-expiring lifecycle', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    initWorkflowEngine(fakeBroker(target, []));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Legacy expiry', note: '', duration: 1
    });
    if (planned.plan.plan_kind !== 'review_marker_add') throw new Error('Expected review marker Plan');
    const legacy = structuredClone(planned.plan) as unknown as Record<string, unknown>;
    delete legacy['plan_kind'];
    legacy['expires_at'] = 'not-a-date';
    delete legacy['plan_hash'];
    legacy['plan_hash'] = hashCanonicalValue(legacy);
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created', planId: planned.plan.plan_id, workflowId: planned.plan.workflow_id,
      workflowVersion: planned.plan.workflow_version, payload: { plan: legacy }, flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(target, []));
    expect(workflowEngineError()).toContain('Workflow plan ledger event is invalid');
  });

  it('fails closed and durably marks the plan stale when target state changes', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    const scripts: string[] = [];
    initWorkflowEngine(fakeBroker(target, scripts));

    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 20, color: 'Red', name: 'Needs review', note: '', duration: 1
    });
    target.markerAtFrame = { color: 'Blue', name: 'Someone else', note: '', duration: 1, customData: '' };

    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('marker frame is no longer empty');
    expect(getWorkflowPlan(planned.plan.plan_id)?.state).toBe('stale');
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'plan_stale']);
  });

  it('replays durable timeline backup identity without granting plan authority', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const plan = classCPlan();
    const approval = classCApproval(plan, 'approval-backup-replay');
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created',
      planId: plan.plan_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: { plan },
      flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'approval_granted',
      planId: plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: { approval },
      flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'backup_started',
      planId: plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: {
        backup_operation_id: 'backup-replay-test',
        strategy: 'timeline_duplicate',
        source_timeline_id: plan.timeline_unique_id,
        backup_timeline_name: 'Main Cut — CID backup'
      },
      flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'backup_created',
      planId: plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: {
        backup_operation_id: 'backup-replay-test',
        strategy: 'timeline_duplicate',
        source_timeline_id: plan.timeline_unique_id,
        backup_timeline_id: 'timeline-backup-id',
        backup_timeline_name: 'Main Cut — CID backup',
        current_timeline_restored: true
      },
      flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'approval_revoked',
      planId: plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: { reason: 'Synthetic authority loss after durable backup' },
      flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(evidence(), []));
    const restored = getWorkflowPlan(plan.plan_id);
    expect(restored).toMatchObject({
      state: 'ready',
      approval: null,
      backup: {
        strategy: 'timeline_duplicate',
        source_timeline_id: 'timeline-id',
        backup_timeline_id: 'timeline-backup-id',
        backup_timeline_name: 'Main Cut — CID backup',
        current_timeline_restored: true
      },
      change_set: {
        state: 'proposed',
        backup: { backup_timeline_id: 'timeline-backup-id' }
      }
    });
  });

  it('fails closed when backup_created has no durable matching backup_started event', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const plan = classCPlan();
    const approval = classCApproval(plan, 'approval-orphan-backup');
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created',
      planId: plan.plan_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: { plan },
      flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'approval_granted',
      planId: plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: { approval },
      flush: true
    });
    await appendWorkflowLedgerEvent({
      eventType: 'backup_created',
      planId: plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version,
      payload: {
        backup_operation_id: 'orphan-backup',
        strategy: 'timeline_duplicate',
        source_timeline_id: plan.timeline_unique_id,
        backup_timeline_id: 'timeline-backup-id',
        backup_timeline_name: 'Main Cut — orphan backup',
        current_timeline_restored: true
      },
      flush: true
    });

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(evidence(), []));
    expect(workflowEngineError()).toContain('has no durable backup start');
    await expect(createTimelineDuplicateBackupForPlan(plan.plan_id)).rejects.toThrow('has no durable backup start');
  });

  it('creates and durably records a verified Class C timeline duplicate before writer dispatch', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const scripts: string[] = [];
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        scripts.push(script);
        if (script.includes('DuplicateTimeline(')) {
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({
            projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut',
            timelineNames: ['Main Cut', 'Main Cut [CID backup existing]']
          });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        return mcpResult(evidence());
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    const plan = await seedApprovedClassCPlan(broker);
    await expect(executeWorkflowPlan(plan.plan_id)).rejects.toThrow('writer execution policy is not established');
    const protectedPlan = await createTimelineDuplicateBackupForPlan(plan.plan_id);
    expect(protectedPlan.backup).toMatchObject({
      strategy: 'timeline_duplicate',
      source_timeline_id: 'timeline-id',
      backup_timeline_id: 'timeline-backup-id',
      current_timeline_restored: true
    });
    expect(protectedPlan.backup?.backup_timeline_name).toMatch(/^Main Cut \[CID backup [0-9a-f]{8}\]$/);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started', 'backup_created'
    ]);
    expect(scripts.filter((script) => script.includes('DuplicateTimeline('))).toHaveLength(1);
    expect(scripts.some((script) => script.includes('AddMarker('))).toBe(false);
  });

  it('fails closed after an ambiguous timeline duplicate and does not retry it after restart', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let duplicateCalls = 0;
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          duplicateCalls += 1;
          throw new ResolveBrokerError('synthetic timeout after dispatch', true);
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        return mcpResult(evidence());
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    const plan = await seedApprovedClassCPlan(broker);
    await expect(createTimelineDuplicateBackupForPlan(plan.plan_id)).rejects.toThrow('backup outcome is unresolved');
    expect(duplicateCalls).toBe(1);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started'
    ]);

    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(broker);
    await expect(createTimelineDuplicateBackupForPlan(plan.plan_id)).rejects.toThrow('backup outcome is ambiguous after restart');
    expect(duplicateCalls).toBe(1);
  });

  it('marks a structural Plan stale when exact timeline structure drifts before approval or dispatch', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const structure = structuralEvidence();
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structure);
        return mcpResult(evidence());
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    const plan = classCPlan();
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created', planId: plan.plan_id, workflowId: plan.workflow_id,
      workflowVersion: plan.workflow_version, payload: { plan }, flush: true
    });
    initWorkflowEngine(broker);
    expect((await revalidateWorkflowPlan(plan.plan_id)).state).toBe('ready');

    const tracks = structure['tracks'] as Array<Record<string, unknown>>;
    const items = tracks[0]!['items'] as Array<Record<string, unknown>>;
    items[0]!['recordEnd'] = 99;
    await expect(revalidateWorkflowPlan(plan.plan_id)).rejects.toThrow('human edits win and require a new Plan');
    expect(getWorkflowPlan(plan.plan_id)).toMatchObject({ state: 'stale' });
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'plan_stale']);
  });

  it('does not approve a plan after local rejection', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    initWorkflowEngine(fakeBroker(target, []));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 8, color: 'Cyan', name: 'Reject me', note: '', duration: 1
    });
    const rejected = await rejectWorkflowPlan(planned.plan.plan_id);
    expect(rejected.state).toBe('rejected');
    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('it is rejected');
  });

  it('derives expiry from the immutable plan and refuses late approval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:00:00.000Z'));
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    initWorkflowEngine(fakeBroker(target, []));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 5, color: 'Green', name: 'Short lived', note: '', duration: 1
    });
    vi.setSystemTime(new Date('2026-09-10T00:11:00.000Z'));
    expect(getWorkflowPlan(planned.plan.plan_id)?.state).toBe('expired');
    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('it is expired');
  });

  it('publishes plan and execute as separate protected tools and returns the standard plan envelope', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    const scripts: string[] = [];
    initWorkflowEngine(fakeBroker(target, scripts));
    expect(workflowTools().map((tool) => tool.name)).toEqual(['status', 'inspect', 'inspect_operation', 'audit', 'plan', 'execute']);
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve', serverVersion: '21.1', protocolVersion: '2024-11-05', instructions: null, tools: [], schemaHash: 'test'
    };
    const result = await callWorkflowTool({} as ResolveBroker, snapshot, 'plan', {
      workflowId: 'edit.review_marker_add.v1', target: 'timeline_item', targetItemId: 'item-id', frameOffset: 3,
      color: 'Pink', name: 'Plan only', note: 'No writer call', duration: 1
    });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const envelope = JSON.parse(text) as Record<string, Record<string, unknown>>;
    expect(envelope['result']?.['state']).toBe('ready');
    expect(envelope['operation']).toMatchObject({
      workflow_id: 'edit.review_marker_add.v1',
      changeset_id: (envelope['result']?.['change_set'] as Record<string, unknown> | undefined)?.['changeset_id'],
      status: 'success',
      risk: 'low',
      blast_radius: 'item'
    });
    const planSchema = JSON.stringify(workflowTools().find((tool) => tool.name === 'plan')?.inputSchema);
    expect(planSchema).toContain('timeline_item');
    expect(planSchema).toContain('itemRef');
    expect(planSchema).toContain('generation');
    expect(planSchema).not.toContain('current_video_item');
    expect(planSchema).toContain('color.grade_version_create.v1');
    expect(planSchema).not.toContain('versionType');
    expect(planSchema).not.toContain('version_type');
    expect(planSchema).not.toContain('LoadVersionByName');
    expect(planSchema).not.toContain('DeleteVersionByName');
  });

  it('resolves Agent marker itemRef/generation to one exact TimelineItem without using the playhead current item', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    const scripts: string[] = [];
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        scripts.push(String(args['script'] ?? ''));
        return mcpResult(target);
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve', serverVersion: '21.1', protocolVersion: '2024-11-05', instructions: null,
      tools: [{ name: 'run_script', description: 'qualified script surface', inputSchema: { type: 'object', properties: {} } }],
      schemaHash: 'test'
    };
    const semanticState: ToolKernelSemanticState = {
      observe() {},
      invalidate() {},
      resolveEntity(handle, generation) {
        expect(handle).toBe('I7');
        expect(generation).toBe(5);
        return {
          kind: 'timeline_item', exactId: 'item-id', handle: 'I7', label: 'Exact target', generation: 5,
          parentHandle: 'T1', locator: 'V1'
        };
      }
    };
    const kernel = new ToolKernel(broker, snapshot, semanticState);
    const result = await kernel.call({ caller: 'agent', sessionId: 'session-marker', turnId: 'turn-marker' }, 'plan', {
      workflowId: 'edit.review_marker_add.v1', target: 'timeline_item', itemRef: 'I7', generation: 5,
      frameOffset: 3, color: 'Pink', name: 'Semantic target', note: '', duration: 1
    });
    const text = result.content[0]?.type === 'text' ? result.content[0].text : '';
    const envelope = JSON.parse(text) as Record<string, Record<string, unknown>>;
    expect((envelope['result']?.['plan'] as Record<string, unknown>)?.['requested_parameters']).toMatchObject({ target: 'timeline_item' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('target_id = "item-id"');
    expect(scripts[0]).not.toContain('GetCurrentVideoItem');
    await expect(kernel.call({ caller: 'agent', sessionId: 'session-marker', turnId: 'turn-marker' }, 'plan', {
      workflowId: 'edit.review_marker_add.v1', target: 'timeline_item', targetItemId: 'item-id',
      frameOffset: 3, color: 'Pink', name: 'Raw target', note: '', duration: 1
    })).rejects.toThrow('semantic itemRef');
  });

  it('routes public track-add plan and execute through local approval, Class C backup and structural readback', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let trackAdded = false;
    let addTrackCalls = 0;
    let duplicateCalls = 0;
    const mutationBroker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          duplicateCalls += 1;
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-public-backup-id',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-public-backup-id',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('t.AddTrack("video")')) {
          addTrackCalls += 1;
          trackAdded = true;
          return mcpResult({
            preconditionOk: true,
            addOk: true,
            beforeVideoTrackCount: 1,
            afterVideoTrackCount: 2,
            newTrackIndex: 2,
            newTrackItemCount: 0,
            beforeFingerprint: null
          });
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) {
          return mcpResult(trackAdded ? structuralEvidenceWithAddedVideoTrack() : structuralEvidence());
        }
        throw new Error('Unexpected public track-add script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(mutationBroker);
    const publicPlanTool = workflowTools().find((tool) => tool.name === 'plan');
    expect(JSON.stringify(publicPlanTool?.inputSchema)).toContain('edit.track_add.v1');
    expect(JSON.stringify(publicPlanTool?.inputSchema)).toContain('current_timeline');
    expect(JSON.stringify(publicPlanTool?.inputSchema)).toContain('trackType');
    expect(JSON.stringify(publicPlanTool?.inputSchema)).toContain('append');
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve', serverVersion: '21.1', protocolVersion: '2024-11-05', instructions: null,
      tools: [{ name: 'run_script', description: 'qualified script surface', inputSchema: { type: 'object', properties: {} } }],
      schemaHash: 'test'
    };

    const plannedReply = await callWorkflowTool(mutationBroker, snapshot, 'plan', {
      workflowId: 'edit.track_add.v1', target: 'current_timeline', trackType: 'video', placement: 'append'
    });
    const plannedText = plannedReply.content[0]?.type === 'text' ? plannedReply.content[0].text : '';
    const plannedEnvelope = JSON.parse(plannedText) as Record<string, Record<string, unknown>>;
    const planResult = plannedEnvelope['result']!;
    const plan = planResult['plan'] as Record<string, unknown>;
    const planId = plan['plan_id'] as string;
    expect(planResult['state']).toBe('ready');
    expect(plan).toMatchObject({
      plan_kind: 'edit_track_add', workflow_id: 'edit.track_add.v1', required_backup: true,
      recovery_class: 'C', verification_level: 'STRUCTURAL_READBACK'
    });
    expect(plannedEnvelope['operation']).toMatchObject({
      workflow_id: 'edit.track_add.v1', status: 'success', risk: 'low', blast_radius: 'timeline',
      verification: { status: 'passed', level_reached: 'STRUCTURAL_READBACK' }
    });
    await expect(callWorkflowTool(mutationBroker, snapshot, 'execute', { planId })).rejects.toThrow('cannot create backup because it is ready');
    expect(addTrackCalls).toBe(0);
    expect(duplicateCalls).toBe(0);

    await grantWorkflowPlanApproval(planId);
    const executedReply = await callWorkflowTool(mutationBroker, snapshot, 'execute', { planId });
    const executedText = executedReply.content[0]?.type === 'text' ? executedReply.content[0].text : '';
    const executedEnvelope = JSON.parse(executedText) as Record<string, Record<string, unknown>>;
    expect(executedEnvelope['result']).toMatchObject({
      state: 'consumed',
      backup: { backup_timeline_id: 'timeline-public-backup-id', current_timeline_restored: true },
      execution: {
        state: 'verified', writer_returned: true, writer_precondition_ok: true,
        structural_readback: { kind: 'track_add_state', track_type: 'video', track_index: 2, present: true, item_count: 0 }
      }
    });
    expect(executedEnvelope['operation']).toMatchObject({
      workflow_id: 'edit.track_add.v1', status: 'success', risk: 'low', blast_radius: 'timeline',
      changes: [{ kind: 'track_added', track_type: 'video', track_index: 2 }],
      verification: { status: 'passed', level_reached: 'STRUCTURAL_READBACK' }
    });
    expect(duplicateCalls).toBe(1);
    expect(addTrackCalls).toBe(1);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'backup_started', 'backup_created',
      'execution_prepared', 'dispatch_started', 'dispatch_returned', 'verification_started', 'verification_completed'
    ]);
  });

  it('does not replay public track-add backup or writer after an ambiguous execute', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    let duplicateCalls = 0;
    let addTrackCalls = 0;
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        if (script.includes('DuplicateTimeline(')) {
          duplicateCalls += 1;
          const match = script.match(/backup_name = (.+)\n/);
          const backupName = match ? JSON.parse(match[1]!) as string : '';
          return mcpResult({
            duplicateCreated: true,
            backupTimelineId: 'timeline-public-ambiguous-backup',
            backupTimelineName: backupName,
            currentAfterDuplicateId: 'timeline-public-ambiguous-backup',
            restoreOk: true,
            currentTimelineId: 'timeline-id',
            error: null
          });
        }
        if (script.includes('"timelineNames"')) {
          return mcpResult({ projectId: 'project-id', timelineId: 'timeline-id', timelineName: 'Main Cut', timelineNames: ['Main Cut'] });
        }
        if (script.includes('t.AddTrack("video")')) {
          addTrackCalls += 1;
          throw new ResolveBrokerError('synthetic public track-add timeout after dispatch', true);
        }
        if (script.includes('for track_type in ("video", "audio", "subtitle")')) return mcpResult(structuralEvidence());
        throw new Error('Unexpected public ambiguous track-add script');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    initWorkflowEngine(broker);
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve', serverVersion: '21.1', protocolVersion: '2024-11-05', instructions: null,
      tools: [{ name: 'run_script', description: 'qualified script surface', inputSchema: { type: 'object', properties: {} } }],
      schemaHash: 'test'
    };
    const plannedReply = await callWorkflowTool(broker, snapshot, 'plan', {
      workflowId: 'edit.track_add.v1', target: 'current_timeline', trackType: 'video', placement: 'append'
    });
    const plannedText = plannedReply.content[0]?.type === 'text' ? plannedReply.content[0].text : '';
    const planId = ((JSON.parse(plannedText) as Record<string, Record<string, unknown>>)['result']!['plan'] as Record<string, unknown>)['plan_id'] as string;
    await grantWorkflowPlanApproval(planId);

    const first = await callWorkflowTool(broker, snapshot, 'execute', { planId });
    const firstText = first.content[0]?.type === 'text' ? first.content[0].text : '';
    expect(JSON.parse(firstText)).toMatchObject({
      result: { state: 'consumed', execution: { state: 'ambiguous' } },
      operation: { workflow_id: 'edit.track_add.v1', status: 'ambiguous', verification: { status: 'unverified' } }
    });
    expect(duplicateCalls).toBe(1);
    expect(addTrackCalls).toBe(1);
    await expect(callWorkflowTool(broker, snapshot, 'execute', { planId })).rejects.toThrow('cannot create backup because it is consumed');
    expect(duplicateCalls).toBe(1);
    expect(addTrackCalls).toBe(1);
  });

  it('executes one approved marker plan and verifies the exact marker by API readback', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    const scripts: string[] = [];
    let writerSeen = false;
    let expectedMarker: Record<string, unknown> | null = null;
    const mutationBroker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        scripts.push(script);
        if (script.includes('AddMarker(')) {
          writerSeen = true;
          return mcpResult({ preconditionOk: true, addOk: true });
        }
        if (script.includes('markerByCustomData')) {
          return mcpResult({
            markerAtFrame: writerSeen ? expectedMarker : null,
            markerByCustomData: writerSeen ? expectedMarker : null
          });
        }
        return mcpResult(target);
      },
      async getResolveStatus(): Promise<Record<string, unknown>> {
        return { running: true, version: '21.1' };
      }
    };
    initWorkflowEngine(mutationBroker);
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 6, color: 'Blue', name: 'Verified marker', note: 'Review', duration: 1
    });
    if (planned.plan.plan_kind !== 'review_marker_add') throw new Error('Expected review marker Plan');
    const change = planned.plan.proposed_changes[0]!;
    expectedMarker = {
      color: change.color,
      duration: change.duration,
      note: change.note,
      name: change.name,
      customData: change.custom_data
    };
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    const executed = await executeWorkflowPlan(planned.plan.plan_id);
    expect(executed.state).toBe('consumed');
    expect(executed.execution).toMatchObject({
      state: 'verified',
      writer_returned: true,
      recovery_status: 'not_needed',
      marker_readback: expectedMarker
    });
    expect(executed.change_set).toMatchObject({
      state: 'verified',
      verification_status: 'passed',
      verification_level: 'API_READBACK',
      recovery_status: 'not_needed',
      actual_observation: {
        kind: 'review_marker_state',
        target_item_id: 'item-id',
        frame_offset: 6,
        present: true,
        color: 'Blue'
      }
    });
    expect(scripts.some((script) => script.includes('AddMarker('))).toBe(true);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'execution_prepared', 'dispatch_started',
      'dispatch_returned', 'verification_started', 'verification_completed'
    ]);
  });

  it('projects an in-flight dispatch as ambiguous after restart without replaying the writer', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    const scripts: string[] = [];
    initWorkflowEngine(fakeBroker(target, scripts));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 4, color: 'Yellow', name: 'Crash boundary', note: '', duration: 1
    });
    const approved = await grantWorkflowPlanApproval(planned.plan.plan_id);
    const executionId = 'execution-crash-boundary';
    await appendWorkflowLedgerEvent({
      eventType: 'execution_prepared',
      planId: planned.plan.plan_id,
      approvalId: approved.approval!.approval_id,
      executionId,
      workflowId: planned.plan.workflow_id,
      workflowVersion: '1',
      payload: { previous_marker: null }
    });
    await appendWorkflowLedgerEvent({
      eventType: 'dispatch_started',
      planId: planned.plan.plan_id,
      approvalId: approved.approval!.approval_id,
      executionId,
      workflowId: planned.plan.workflow_id,
      workflowVersion: '1',
      payload: {},
      flush: true
    });
    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    resetWorkflowEngineForTests();
    await initWorkflowLedger(tempDir);
    initWorkflowEngine(fakeBroker(target, scripts));
    const restored = getWorkflowPlan(planned.plan.plan_id);
    expect(restored?.state).toBe('consumed');
    expect(restored?.execution).toMatchObject({
      execution_id: executionId,
      state: 'ambiguous',
      recovery_status: 'not_needed'
    });
    expect(restored?.change_set).toMatchObject({
      changeset_id: planned.change_set.changeset_id,
      state: 'ambiguous',
      verification_status: 'unverified',
      actual_observation: null
    });
    expect(scripts.some((script) => script.includes('AddMarker('))).toBe(false);
  });

  it('does not advance execution projection when durable ledger append is unavailable', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-engine-test-'));
    await initWorkflowLedger(tempDir);
    const target = evidence();
    initWorkflowEngine(fakeBroker(target, []));
    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 10, color: 'Yellow', name: 'Durability guard', note: '', duration: 1
    });
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    await closeWorkflowLedger();

    await expect(executeWorkflowPlan(planned.plan.plan_id)).rejects.toThrow('Workflow ledger append failed');
    expect(workflowLedgerError()).toContain('Workflow ledger append failed');
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({ state: 'approved', execution: null });
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'approval_granted']);
    await expect(rejectWorkflowPlan(planned.plan.plan_id)).rejects.toThrow('Workflow ledger append failed');
  });
});
