import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import {
  initCosSessionRuntime,
  recordCosBrowserEventsNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';
import {
  getSystemSpineProjection,
  initSystemSpineRuntime,
  shutdownSystemSpineRuntime,
  systemSpineDecisionRuntime
} from '../src/main/system-spine.js';
import {
  getAgentSituationFrame,
  invalidateAgentWorldForTests,
  observeAgentWorldForTests,
  resetConnectionForTests
} from '../src/main/connection.js';
import { getArtifactWorkspaceProjection } from '../src/main/artifact-workspace.js';
import {
  bindCosSessionToWorkspace,
  resetCidWorkspaceRegistryForTests,
  workspaceForSession
} from '../src/main/workspace-identity.js';
import {
  createReviewMarkerPlan,
  establishWorkflowAuthority,
  executeWorkflowPlan,
  getWorkflowPlan,
  grantWorkflowPlanApproval,
  initWorkflowEngine,
  resetWorkflowEngineForTests,
  revokeWorkflowApprovalsForAuthorityLoss
} from '../src/main/workflow-engine.js';
import {
  closeWorkflowLedger,
  initWorkflowLedger,
  resetWorkflowLedgerForTests,
  workflowLedgerEvents
} from '../src/main/workflow-ledger.js';

const CONVERSATION = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa';
let tempDir: string | null = null;

function protectedResult(result: Record<string, unknown>, workflowId: string): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        result,
        operation: {
          status: 'success',
          workflow_id: workflowId,
          verification: { status: 'passed', level_reached: 'API_READBACK', checks: ['integration'] }
        }
      })
    }]
  };
}

function observeProject(projectId: string, projectName: string, timelineId: string, timelineName: string): void {
  observeAgentWorldForTests({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'project' },
    result: protectedResult({
      target: 'project',
      observedAt: Date.now(),
      page: 'edit',
      project: { id: projectId, name: projectName, timelineCount: 1 },
      timeline: { id: timelineId, name: timelineName, videoTracks: 2, audioTracks: 2, subtitleTracks: 0 },
      settings: { readerId: 'project.settings_summary.v1', project: null, timeline: null, timelineUsesCustomSettings: null },
      schemaHash: 'schema-offline-integration'
    }, 'project.identity.v1')
  });
}

function observeMedia(): void {
  observeAgentWorldForTests({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'media' },
    result: protectedResult({
      target: 'media',
      observedAt: Date.now(),
      inventory: {
        rootFolder: { id: 'folder-offline-001', name: 'Master' },
        folders: [],
        items: [{ id: 'clip-offline-001', name: 'Cached Interview', folderId: 'folder-offline-001', folderName: 'Master' }],
        itemsObserved: 1,
        offlineCountObserved: 0
      },
      clip: null,
      linkStatus: null,
      requestedItemId: null,
      schemaHash: 'schema-offline-integration'
    }, 'media.inventory_summary.v1')
  });
}

function fakeBroker(target: Record<string, unknown>, scripts: string[]) {
  return {
    async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
      expect(name).toBe('run_script');
      scripts.push(String(args['script'] ?? ''));
      return { content: [{ type: 'text', text: JSON.stringify({ result: target }) }] };
    },
    async getResolveStatus(): Promise<Record<string, unknown>> {
      return { running: true, version: '21.1' };
    }
  };
}

afterEach(async () => {
  shutdownSystemSpineRuntime();
  resetCosSessionRuntimeForTests();
  resetConnectionForTests();
  resetCidWorkspaceRegistryForTests();
  resetWorkflowEngineForTests();
  await closeWorkflowLedger().catch(() => undefined);
  resetWorkflowLedgerForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('Artifact Workspace real offline projection', () => {
  it('keeps cached Artifact/Evidence/Plan browseable while completion and write authority remain closed across reconnects', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-artifact-offline-'));
    initDurableStore(tempDir);
    await initCosSessionRuntime();
    await initSystemSpineRuntime();
    await initWorkflowLedger(tempDir);

    const scripts: string[] = [];
    const target = {
      projectId: 'project-offline-001',
      timelineId: 'timeline-offline-001',
      itemId: 'item-offline-001',
      trackType: 'video',
      trackIndex: 1,
      trackLocked: false,
      itemStart: 0,
      itemEnd: 100,
      itemDuration: 100,
      markerAtFrame: null
    };
    initWorkflowEngine(fakeBroker(target, scripts));

    observeProject('project-offline-001', 'Documentary A', 'timeline-offline-001', 'Main A');
    observeMedia();
    const session = await recordCosBrowserEventsNow(CONVERSATION, [
      { kind: 'turn_start', turnId: 'turn-offline', time: 100 },
      { kind: 'user_message', turnId: 'turn-offline', messageId: 'msg-offline', text: 'Review the current edit.', time: 101 }
    ]);
    await systemSpineDecisionRuntime.projectSession(session, { publish: true });
    const boundWorkspace = workspaceForSession(session.sessionId);
    expect(boundWorkspace).toMatchObject({
      projectIdentity: 'project-offline-001',
      lastKnownTimelineIdentity: 'timeline-offline-001',
      lastKnownWorldGeneration: 1
    });
    expect(await bindCosSessionToWorkspace(session.sessionId, boundWorkspace!.workspaceId)).toBe('already_bound');

    const planned = await createReviewMarkerPlan({
      target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Review', note: 'Check cut', duration: 1
    });
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    const online = await getArtifactWorkspaceProjection();
    expect(online).toMatchObject({
      workspace: { online: true, bindingStatus: 'bound' },
      protectedResolveActionsBlocked: false
    });
    expect(online?.plans[0]).toMatchObject({ authority: 'current', approvalState: 'approved' });

    expect(await revokeWorkflowApprovalsForAuthorityLoss()).toBe(1);
    invalidateAgentWorldForTests('Resolve authority disconnected');

    const offline = await getArtifactWorkspaceProjection();
    expect(offline).toMatchObject({
      workspace: { online: false, freshness: 'offline', bindingStatus: 'bound' },
      protectedResolveActionsBlocked: true
    });
    expect(offline?.generation).toBeGreaterThan(1);
    expect(offline?.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'project', label: 'Documentary A', source: 'cached_projection', generation: 1 }),
      expect.objectContaining({ kind: 'timeline', label: 'Main A', source: 'cached_projection', generation: 1 }),
      expect.objectContaining({ kind: 'media_item', label: 'Cached Interview', source: 'cached_projection', generation: 1 })
    ]));
    const cachedMedia = offline?.artifacts.find((artifact) => artifact.kind === 'media_item' && artifact.label === 'Cached Interview');
    expect(cachedMedia?.evidenceRefs.some((item) => item.workflowId === 'media.inventory_summary.v1' && item.generation === 1)).toBe(true);
    expect(getAgentSituationFrame().evidence).toHaveLength(0);
    expect(offline?.plans).toHaveLength(1);
    expect(offline?.plans[0]).toMatchObject({
      planId: planned.plan.plan_id,
      authority: 'cached_read_only',
      approvalState: 'awaiting',
      targetHandle: null
    });
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({ state: 'ready', approval: null });
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(expect.arrayContaining([
      'plan_created', 'approval_granted', 'approval_revoked'
    ]));
    expect(getSystemSpineProjection()?.completion.complete).toBe(false);
    expect(getSystemSpineProjection()?.completion.blockers.join(' ')).toContain('offline');
    await expect(executeWorkflowPlan(planned.plan.plan_id)).rejects.toThrow('cannot execute because it is ready');

    observeProject('project-other-001', 'Documentary B', 'timeline-other-001', 'Main B');
    await systemSpineDecisionRuntime.projectSession(session, { publish: true });
    const mismatch = await getArtifactWorkspaceProjection();
    expect(mismatch).toMatchObject({
      workspace: { bindingStatus: 'mismatch' },
      protectedResolveActionsBlocked: true,
      context: {
        project: { label: 'Documentary A', generation: 1 },
        timeline: { label: 'Main A', generation: 1 }
      }
    });
    expect(mismatch?.artifacts.some((artifact) => artifact.label === 'Documentary B' && artifact.source === 'world_entity')).toBe(false);
    expect(mismatch?.artifacts.some((artifact) => artifact.label === 'Documentary A' && artifact.source === 'cached_projection')).toBe(true);
    expect(mismatch?.context.timeline?.label).not.toBe('Main B');
    expect(mismatch?.context.sharedFocus?.entity.generation ?? 1).toBe(1);
    expect(mismatch?.recentDeltas).toHaveLength(0);
    expect(mismatch?.actionOffers).toHaveLength(0);
    expect(mismatch?.plans[0]).toMatchObject({ authority: 'cached_read_only', planId: planned.plan.plan_id });
    expect(getSystemSpineProjection()?.completion.complete).toBe(false);

    observeProject('project-offline-001', 'Documentary A', 'timeline-offline-001', 'Main A');
    await systemSpineDecisionRuntime.projectSession(session, { publish: true });
    const reconnected = await getArtifactWorkspaceProjection();
    expect(reconnected).toMatchObject({
      workspace: { online: true, bindingStatus: 'bound' },
      protectedResolveActionsBlocked: false
    });
    expect(reconnected?.generation).toBeGreaterThan(offline!.generation);
    expect(reconnected?.artifacts.some((artifact) => artifact.source === 'cached_projection')).toBe(false);
    expect(reconnected?.artifacts.some((artifact) => artifact.label === 'Cached Interview')).toBe(false);
    expect(reconnected?.plans[0]).toMatchObject({ authority: 'current', approvalState: 'awaiting' });
    expect(reconnected?.plans[0]?.executionState).toBeNull();

    const scriptsBeforeReapproval = scripts.length;
    await expect(grantWorkflowPlanApproval(planned.plan.plan_id)).rejects.toThrow('Resolve authority is unavailable');
    establishWorkflowAuthority();
    await grantWorkflowPlanApproval(planned.plan.plan_id);
    expect(scripts.length).toBeGreaterThan(scriptsBeforeReapproval);
    expect(getWorkflowPlan(planned.plan.plan_id)).toMatchObject({ state: 'approved' });
  });
});
