import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReviewMarkerPlan,
  executeWorkflowPlan,
  getWorkflowPlan,
  grantWorkflowPlanApproval,
  initWorkflowEngine,
  rejectWorkflowPlan,
  resetWorkflowEngineForTests
} from '../src/main/workflow-engine.js';
import {
  closeWorkflowLedger,
  initWorkflowLedger,
  resetWorkflowLedgerForTests,
  workflowLedgerEvents
} from '../src/main/workflow-ledger.js';

let tempDir: string | null = null;

function result(payload: Record<string, unknown>): unknown {
  return { content: [{ type: 'text', text: JSON.stringify({ result: payload }) }] };
}

function target(): Record<string, unknown> {
  return {
    projectId: 'project-id', timelineId: 'timeline-id', itemId: 'item-id', trackType: 'video', trackIndex: 1,
    trackLocked: false, itemStart: 0, itemEnd: 100, itemDuration: 100, markerAtFrame: null
  };
}

function delayedBroker(evidence: Record<string, unknown>) {
  return {
    async callTool(): Promise<unknown> {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return result(evidence);
    },
    async getResolveStatus(): Promise<Record<string, unknown>> {
      return { running: true, version: '21.1' };
    }
  };
}

function frameFromScript(script: string): number {
  const match = /^frame = (\d+)$/m.exec(script);
  return match ? Number(match[1]) : -1;
}

function markerFromPlan(plan: Awaited<ReturnType<typeof createReviewMarkerPlan>>): Record<string, unknown> {
  const change = plan.plan.proposed_changes[0]!;
  return {
    color: change.color,
    duration: change.duration,
    note: change.note,
    name: change.name,
    customData: change.custom_data
  };
}

function mutationBroker(
  markers: Map<number, Record<string, unknown>>,
  onWriter?: (frame: number) => Promise<void>
) {
  const writerFrames: number[] = [];
  return {
    writerFrames,
    broker: {
      async callTool(_name: string, args: Record<string, unknown>): Promise<unknown> {
        const script = String(args['script'] ?? '');
        const frame = frameFromScript(script);
        if (script.includes('AddMarker(')) {
          writerFrames.push(frame);
          if (onWriter) await onWriter(frame);
          return result({ preconditionOk: true, addOk: true });
        }
        if (script.includes('markerByCustomData')) {
          const marker = markers.get(frame) ?? null;
          return result({ markerAtFrame: marker, markerByCustomData: marker });
        }
        return result(target());
      },
      async getResolveStatus(): Promise<Record<string, unknown>> {
        return { running: true, version: '21.1' };
      }
    }
  };
}

async function setupPlan() {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-policy-concurrency-'));
  await initWorkflowLedger(tempDir);
  initWorkflowEngine(delayedBroker(target()));
  return await createReviewMarkerPlan({
    target: 'current_video_item', frameOffset: 2, color: 'Yellow', name: 'Concurrent plan', note: '', duration: 1
  });
}

afterEach(async () => {
  resetWorkflowEngineForTests();
  await closeWorkflowLedger().catch(() => undefined);
  resetWorkflowLedgerForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('protected workflow mutation concurrency gate', () => {
  it('coalesces concurrent approval into one durable approval transition', async () => {
    const plan = await setupPlan();
    const [first, second] = await Promise.all([
      grantWorkflowPlanApproval(plan.plan.plan_id),
      grantWorkflowPlanApproval(plan.plan.plan_id)
    ]);
    expect(first.state).toBe('approved');
    expect(second.state).toBe('approved');
    expect(second.approval?.approval_id).toBe(first.approval?.approval_id);
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'approval_granted']);
  });

  it('serializes approve then reject so the final durable state is rejected', async () => {
    const plan = await setupPlan();
    const approval = grantWorkflowPlanApproval(plan.plan.plan_id);
    const rejection = rejectWorkflowPlan(plan.plan.plan_id);
    await expect(approval).resolves.toMatchObject({ state: 'approved' });
    await expect(rejection).resolves.toMatchObject({ state: 'rejected' });
    expect(getWorkflowPlan(plan.plan.plan_id)?.state).toBe('rejected');
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual([
      'plan_created', 'approval_granted', 'plan_rejected'
    ]);
  });

  it('lets reject win while execute is queued behind another protected writer', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-policy-concurrency-'));
    await initWorkflowLedger(tempDir);
    const markers = new Map<number, Record<string, unknown>>();
    let releaseWriter!: () => void;
    let writerStarted!: () => void;
    const writerWait = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const started = new Promise<void>((resolve) => { writerStarted = resolve; });
    const runtime = mutationBroker(markers, async (frame) => {
      if (frame !== 2) return;
      writerStarted();
      await writerWait;
    });
    initWorkflowEngine(runtime.broker);

    const blocker = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 2, color: 'Yellow', name: 'Blocker', note: '', duration: 1
    });
    const queued = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 4, color: 'Cyan', name: 'Reject queued', note: '', duration: 1
    });
    markers.set(2, markerFromPlan(blocker));
    markers.set(4, markerFromPlan(queued));
    await grantWorkflowPlanApproval(blocker.plan.plan_id);
    await grantWorkflowPlanApproval(queued.plan.plan_id);

    const blockerExecution = executeWorkflowPlan(blocker.plan.plan_id);
    await started;
    await expect(rejectWorkflowPlan(blocker.plan.plan_id)).rejects.toThrow('it is consumed');
    const queuedExecution = executeWorkflowPlan(queued.plan.plan_id);
    await expect(rejectWorkflowPlan(queued.plan.plan_id)).resolves.toMatchObject({ state: 'rejected' });
    expect(getWorkflowPlan(queued.plan.plan_id)?.execution).toBeNull();

    releaseWriter();
    await expect(blockerExecution).resolves.toMatchObject({ execution: { state: 'verified' } });
    await expect(queuedExecution).rejects.toThrow('it is rejected');
    expect(runtime.writerFrames).toEqual([2]);
    expect(workflowLedgerEvents().filter((event) => event.plan_id === queued.plan.plan_id && event.event_type === 'dispatch_started')).toHaveLength(0);
  });

  it('dispatches only once when execute is requested twice for one approved plan', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-policy-concurrency-'));
    await initWorkflowLedger(tempDir);
    const markers = new Map<number, Record<string, unknown>>();
    const runtime = mutationBroker(markers);
    initWorkflowEngine(runtime.broker);
    const plan = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 6, color: 'Blue', name: 'Execute once', note: '', duration: 1
    });
    markers.set(6, markerFromPlan(plan));
    await grantWorkflowPlanApproval(plan.plan.plan_id);

    const first = executeWorkflowPlan(plan.plan.plan_id);
    const second = executeWorkflowPlan(plan.plan.plan_id);
    await expect(first).resolves.toMatchObject({ execution: { state: 'verified' } });
    await expect(second).rejects.toThrow('it is consumed');
    expect(runtime.writerFrames).toEqual([6]);
    expect(workflowLedgerEvents().filter((event) => event.plan_id === plan.plan.plan_id && event.event_type === 'dispatch_started')).toHaveLength(1);
  });
});
