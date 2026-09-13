import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import { AgentWorldModel } from '../src/main/agent-world-model.js';
import { AgentContextCompiler, renderAgentContextPack } from '../src/main/context-compiler.js';
import type { ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { ToolKernel } from '../src/main/tool-kernel.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [],
  schemaHash: 'schema-a'
};

function protectedResult(result: unknown, workflowId: string): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        result,
        operation: {
          status: 'success',
          workflow_id: workflowId,
          verification: { status: 'passed', level_reached: 'API_READBACK', checks: ['test evidence'] }
        }
      })
    }]
  };
}

function observeProject(world: AgentWorldModel, projectId: string, timelineId: string): void {
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'project' },
    result: protectedResult({
      target: 'project',
      observedAt: 100,
      page: 'edit',
      project: { id: projectId, name: 'Documentary', timelineCount: 2 },
      timeline: { id: timelineId, name: 'Main Cut', videoTracks: 2, audioTracks: 3, subtitleTracks: 1 },
      settings: { readerId: 'project.settings_summary.v1', project: null, timeline: null, timelineUsesCustomSettings: null },
      schemaHash: 'schema-a'
    }, 'project.settings_summary.v1')
  });
}

describe('Agent System Spine', () => {
  it('binds exact Resolve identity behind a readable handle and compiles only safe semantic context', () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-exact-111', 'timeline-exact-222');
    const mediaResult = protectedResult({
      target: 'media',
      observedAt: 110,
      inventory: {
        rootFolder: { id: 'folder-exact-333', name: 'Master' },
        folders: [],
        items: [{ id: 'clip-exact-444', name: 'Interview 04', folderId: 'folder-exact-333', folderName: 'Master' }],
        itemsObserved: 1,
        offlineCountObserved: 0
      },
      clip: null,
      linkStatus: null,
      requestedItemId: null,
      schemaHash: 'schema-a'
    }, 'media.inventory_summary.v1');
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'media' },
      result: mediaResult
    });

    const media = world.snapshotForTests().entities.find((entity) => entity.kind === 'media_pool_item');
    expect(media).toMatchObject({ handle: 'M1', exactId: 'clip-exact-444', label: 'Interview 04' });
    expect(world.resolveEntity('M1', media!.generation).exactId).toBe('clip-exact-444');
    expect(world.setFocus({ kind: 'media_pool_item', exactId: 'clip-exact-444' }).entity).toMatchObject({ handle: 'M1', label: 'Interview 04' });
    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-focus' },
      name: 'inspect',
      args: { target: 'media', itemId: 'clip-exact-444' },
      result: mediaResult
    });
    expect(world.getFocus()).toMatchObject({ source: 'agent', entity: { handle: 'M1', label: 'Interview 04' } });

    const compiler = new AgentContextCompiler(world);
    const pack = compiler.compile({
      sessionId: 'session-test',
      turnId: 'turn-test',
      input: 'Inspect this clip metadata and proxy state',
      narrativeMessages: 1,
      goal: {
        schemaVersion: 1,
        originalRequest: null,
        userDirectives: [],
        sourceUserMessages: 0,
        omittedUserDirectives: 0,
        desiredOutcome: null,
        hardConstraints: [],
        userPreferences: [],
        explicitNonGoals: [],
        completionCriteria: [],
        requiredEvidence: [],
        assumptions: [],
        decisions: [],
        corrections: [],
        openObligations: []
      }
    });
    expect(pack.situation.sharedFocus?.entity.handle).toBe('M1');
    expect(pack.situation.entities.some((entity) => entity.handle === 'M1')).toBe(true);
    expect(pack.relevantActions.some((action) => action.actionId === 'media.clip_inspect.v1')).toBe(true);
    const visible = renderAgentContextPack(pack);
    expect(visible).toContain('M1');
    expect(visible).not.toContain('clip-exact-444');
    expect(visible).not.toContain('project-exact-111');
    expect(visible).not.toContain('timeline-exact-222');
    const projectedToolResult = compiler.projectToolResult(mediaResult);
    expect(projectedToolResult).toContain('M1');
    expect(projectedToolResult).not.toContain('clip-exact-444');
    expect(projectedToolResult).not.toContain('folder-exact-333');
    const planId = 'plan_123e4567-e89b-42d3-a456-426614174000';
    const projectedPlan = compiler.projectToolResult(protectedResult({
      plan: {
        plan_id: planId,
        target_ids: ['clip-exact-444']
      },
      state: 'ready',
      approval: null,
      reason: null,
      execution: null
    }, 'edit.review_marker_add.v1'));
    expect(projectedPlan).toContain(planId);
    expect(projectedPlan).toContain('M1');
    expect(projectedPlan).not.toContain('clip-exact-444');
    const projectedColorPlan = compiler.projectToolResult(protectedResult({
      plan: {
        plan_id: 'plan_color_public',
        requested_parameters: { target: 'timeline_item', name: 'Agent Version', version_type: 0 },
        proposed_changes: [{ kind: 'create_grade_version', name: 'Agent Version', version_type: 0 }]
      },
      operationPreview: { versionType: 0 }
    }, 'color.grade_version_create.v1'));
    expect(projectedColorPlan).toContain('Agent Version');
    expect(projectedColorPlan).not.toContain('version_type');
    expect(projectedColorPlan).not.toContain('versionType');

    const kernel = new ToolKernel({
      async callTool(): Promise<unknown> { throw new Error('Unexpected Resolve call'); },
      async getResolveStatus(): Promise<Record<string, unknown>> { throw new Error('Unexpected Resolve status call'); }
    }, snapshot, world);
    const inspect = kernel.tools({ caller: 'agent', sessionId: 'session-test', turnId: 'turn-test' })
      .find((tool) => tool.name === 'inspect');
    const properties = inspect?.inputSchema['properties'] as Record<string, unknown> | undefined;
    expect(properties).toHaveProperty('itemRef');
    expect(properties).toHaveProperty('generation');
    expect(properties).not.toHaveProperty('itemId');
  });

  it('keeps prior-generation evidence available only through the historical projection after epoch invalidation', () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-history-001', 'timeline-history-001');
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'media' },
      result: protectedResult({
        target: 'media',
        observedAt: 120,
        inventory: {
          rootFolder: { id: 'folder-history-001', name: 'Master' },
          folders: [],
          items: [{ id: 'clip-history-001', name: 'Cached Interview', folderId: 'folder-history-001', folderName: 'Master' }],
          itemsObserved: 1,
          offlineCountObserved: 0
        },
        clip: null,
        linkStatus: null,
        requestedItemId: null,
        schemaHash: 'schema-a'
      }, 'media.inventory_summary.v1')
    });
    const priorGeneration = world.identitySnapshot().generation;
    expect(world.currentEvidence().some((item) => item.workflowId === 'media.inventory_summary.v1')).toBe(true);

    world.invalidate('Resolve authority disconnected');

    expect(world.identitySnapshot().generation).toBe(priorGeneration + 1);
    expect(world.currentEvidence()).toHaveLength(0);
    const historical = world.historicalSituationForProject('project-history-001', priorGeneration);
    expect(historical).toMatchObject({
      generation: priorGeneration,
      project: { handle: 'P1', label: 'Documentary' },
      timeline: { handle: 'T1', label: 'Main Cut' }
    });
    expect(historical?.entities).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'media_pool_item', handle: 'M1', label: 'Cached Interview', generation: priorGeneration })
    ]));
    expect(historical?.evidence.some((item) => item.workflowId === 'media.inventory_summary.v1')).toBe(true);
    expect(historical?.evidence.every((item) => item.generation === priorGeneration)).toBe(true);
  });

  it('refuses a stale semantic handle before any Resolve call can target it', async () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-one', 'timeline-one');
    const oldProject = world.snapshotForTests().entities.find((entity) => entity.kind === 'project')!;

    observeProject(world, 'project-two', 'timeline-two');

    expect(world.snapshotForTests().generation).toBeGreaterThan(oldProject.generation);
    expect(() => world.resolveEntity(oldProject.handle, oldProject.generation)).toThrow('generation is stale');

    let resolveCalled = false;
    const kernel = new ToolKernel({
      async callTool(): Promise<unknown> { resolveCalled = true; throw new Error('Unexpected Resolve call'); },
      async getResolveStatus(): Promise<Record<string, unknown>> { resolveCalled = true; throw new Error('Unexpected Resolve status call'); }
    }, snapshot, world);
    await expect(kernel.call(
      { caller: 'agent', sessionId: 'session-test', turnId: 'turn-test', callId: 'call-stale' },
      'inspect',
      { target: 'media', itemRef: oldProject.handle, generation: oldProject.generation }
    )).rejects.toThrow('generation is stale');
    expect(resolveCalled).toBe(false);
  });

  it('revalidates project identity before attributing Deliver evidence', async () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-a', 'timeline-a');
    const priorGeneration = world.identitySnapshot().generation;
    const scripts: string[] = [];
    const deliverSnapshot: ResolveBrokerSnapshot = {
      ...snapshot,
      tools: [{ name: 'run_script', description: 'qualified script surface', inputSchema: { type: 'object', properties: {} } }]
    };
    const broker = {
      async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        expect(name).toBe('run_script');
        const script = String(args['script'] ?? '');
        scripts.push(script);
        const payload = scripts.length === 1
          ? {
              project: { id: 'project-b', name: 'Project B', timelineCount: 1 },
              timeline: { id: 'timeline-b', name: 'Timeline B', videoTracks: 1, audioTracks: 1, subtitleTracks: 0 },
              page: 'deliver',
              projectSettings: {},
              timelineSettings: null
            }
          : {
              capabilities: null,
              settings: null
            };
        return { content: [{ type: 'text', text: JSON.stringify({ result: payload }) }] };
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    };
    const kernel = new ToolKernel(broker, deliverSnapshot, world);

    await kernel.call({ caller: 'local_ui' }, 'inspect', { target: 'deliver' });

    expect(scripts).toHaveLength(2);
    expect(world.identitySnapshot()).toMatchObject({
      generation: priorGeneration + 1,
      project: { exactId: 'project-b' },
      timeline: { exactId: 'timeline-b' }
    });
    const deliverEvidence = world.currentEvidence().find((item) => item.workflowId === 'deliver.settings_inspect.v1');
    expect(deliverEvidence?.projectHandle).toBe('P1');
    expect(world.resolveEntity('P1', priorGeneration + 1).exactId).toBe('project-b');
  });

  it('fails identity-free project-scoped inspection closed when identity revalidation fails', async () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-a', 'timeline-a');
    let resolveCalls = 0;
    const deliverSnapshot: ResolveBrokerSnapshot = {
      ...snapshot,
      tools: [{ name: 'run_script', description: 'qualified script surface', inputSchema: { type: 'object', properties: {} } }]
    };
    const kernel = new ToolKernel({
      async callTool(): Promise<unknown> {
        resolveCalls += 1;
        throw new Error('project identity unavailable');
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return { running: true, version: '21.1' }; }
    }, deliverSnapshot, world);

    await expect(kernel.call({ caller: 'local_ui' }, 'inspect', { target: 'color' }))
      .rejects.toThrow('project identity unavailable');
    expect(resolveCalls).toBe(1);
    expect(world.identitySnapshot().project?.exactId).toBe('project-a');
    expect(world.currentEvidence().some((item) => item.workflowId === 'deliver.settings_inspect.v1')).toBe(false);
  });

  it('supersedes only the exact semantic read slice and keeps preflight profiles independent', () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-one', 'timeline-one');
    const observePreflight = (id: string, profile: 'general' | 'delivery'): void => {
      world.observe({
        context: { caller: 'agent', sessionId: 'session-test', turnId: id },
        name: 'inspect',
        args: { target: 'preflight', profile },
        result: protectedResult({
          target: 'preflight',
          observedAt: Date.now(),
          preflight: { readerId: 'project.preflight.v1', profile, status: 'pass' },
          schemaHash: 'schema-a'
        }, 'project.preflight.v1')
      });
    };

    observePreflight('turn-preflight-general-1', 'general');
    const firstGeneral = world.currentEvidence().find((item) =>
      item.workflowId === 'project.preflight.v1' && item.preflightProfile === 'general'
    )!;
    expect(firstGeneral).toBeTruthy();
    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-media-unrelated' },
      name: 'inspect',
      args: { target: 'media' },
      result: protectedResult({
        target: 'media',
        observedAt: Date.now(),
        inventory: {
          rootFolder: { id: 'folder-one', name: 'Master' },
          folders: [],
          items: [],
          itemsObserved: 0,
          offlineCountObserved: 0
        },
        clip: null,
        linkStatus: null,
        requestedItemId: null,
        schemaHash: 'schema-a'
      }, 'media.inventory_summary.v1')
    });
    expect(world.currentEvidence().some((item) => item.id === firstGeneral.id)).toBe(true);

    observePreflight('turn-preflight-delivery-1', 'delivery');
    const delivery = world.currentEvidence().find((item) =>
      item.workflowId === 'project.preflight.v1' && item.preflightProfile === 'delivery'
    )!;
    expect(delivery).toBeTruthy();
    expect(world.currentEvidence().some((item) => item.id === firstGeneral.id)).toBe(true);

    observePreflight('turn-preflight-general-2', 'general');
    const current = world.currentEvidence();
    expect(current.some((item) => item.id === firstGeneral.id)).toBe(false);
    expect(current.some((item) => item.id === delivery.id)).toBe(true);
    expect(current.filter((item) =>
      item.workflowId === 'project.preflight.v1' && item.preflightProfile === 'general'
    )).toHaveLength(1);
    expect(world.snapshotForTests().facts.map((fact) => fact.key)).toEqual(expect.arrayContaining([
      'project.preflight.general.status',
      'project.preflight.delivery.status'
    ]));

    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-fairlight-unrelated' },
      name: 'inspect',
      args: { target: 'fairlight' },
      result: protectedResult({
        target: 'fairlight',
        observedAt: Date.now(),
        summary: {
          readerId: 'fairlight.mapping_inspect.v1',
          timeline: { id: 'timeline-one', name: 'Main Cut' },
          audioTrackCount: 1
        },
        clipProcessing: null,
        schemaHash: 'schema-a'
      }, 'fairlight.mapping_inspect.v1')
    });
    expect(world.currentEvidence().some((item) => item.id === firstGeneral.id)).toBe(false);
    expect(world.currentEvidence().some((item) => item.id === delivery.id)).toBe(true);
  });

  it('invalidates only marker-dependent semantic slices while preserving unrelated evidence', () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-one', 'timeline-one');
    const projectEvidence = world.currentEvidence().find((item) => item.workflowId === 'project.settings_summary.v1')!;

    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-media' },
      name: 'inspect',
      args: { target: 'media' },
      result: protectedResult({
        target: 'media',
        observedAt: Date.now(),
        inventory: {
          rootFolder: { id: 'folder-one', name: 'Master' },
          folders: [],
          items: [],
          itemsObserved: 0,
          offlineCountObserved: 0
        },
        clip: null,
        linkStatus: null,
        requestedItemId: null,
        schemaHash: 'schema-a'
      }, 'media.inventory_summary.v1')
    });
    const mediaEvidence = world.currentEvidence().find((item) => item.workflowId === 'media.inventory_summary.v1')!;

    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-edit-summary' },
      name: 'inspect',
      args: { target: 'edit' },
      result: protectedResult({
        target: 'edit',
        observedAt: Date.now(),
        view: 'summary',
        summary: {
          readerId: 'edit.timeline_summary.v1',
          timeline: { id: 'timeline-one', name: 'Main Cut' },
          timelineItemCountObserved: 3,
          markerCount: 1
        },
        structure: null,
        gapsOverlaps: null,
        sourceRanges: null,
        transitions: null,
        annotations: null,
        schemaHash: 'schema-a'
      }, 'edit.timeline_summary.v1')
    });
    const editEvidence = world.currentEvidence().find((item) => item.workflowId === 'edit.timeline_summary.v1')!;

    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-annotations' },
      name: 'inspect',
      args: { target: 'edit', view: 'annotations' },
      result: protectedResult({
        target: 'edit',
        observedAt: Date.now(),
        view: 'annotations',
        summary: null,
        structure: null,
        gapsOverlaps: null,
        sourceRanges: null,
        transitions: null,
        annotations: { timeline: { id: 'timeline-one', name: 'Main Cut' } },
        schemaHash: 'schema-a'
      }, 'edit.review_annotations_inspect.v1')
    });
    const annotationEvidence = world.currentEvidence().find((item) => item.workflowId === 'edit.review_annotations_inspect.v1')!;

    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-write' },
      name: 'execute',
      args: { planId: 'plan-one' },
      result: protectedResult({ state: 'executed' }, 'edit.review_marker_add.v1')
    });

    const current = world.currentEvidence();
    expect(current.some((item) => item.id === projectEvidence.id)).toBe(true);
    expect(current.some((item) => item.id === mediaEvidence.id)).toBe(true);
    expect(current.some((item) => item.id === editEvidence.id)).toBe(false);
    expect(current.some((item) => item.id === annotationEvidence.id)).toBe(false);
    expect(current.some((item) => item.workflowId === 'edit.review_marker_add.v1')).toBe(true);
    expect(world.situation(0).recentDeltas.at(-1)?.invalidatedFactKeys).toEqual([
      'timeline.itemCountObserved',
      'timeline.markerCount'
    ]);
  });

  it('supersedes evidence for one exact target without invalidating an unrelated target', () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-one', 'timeline-one');
    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-inventory' },
      name: 'inspect',
      args: { target: 'media' },
      result: protectedResult({
        target: 'media',
        observedAt: Date.now(),
        inventory: {
          rootFolder: { id: 'folder-one', name: 'Master' },
          folders: [],
          items: [
            { id: 'clip-one', name: 'Clip One', folderId: 'folder-one', folderName: 'Master' },
            { id: 'clip-two', name: 'Clip Two', folderId: 'folder-one', folderName: 'Master' }
          ],
          itemsObserved: 2,
          offlineCountObserved: 0
        },
        clip: null,
        linkStatus: null,
        requestedItemId: null,
        schemaHash: 'schema-a'
      }, 'media.inventory_summary.v1')
    });
    const inspectItem = (turnId: string, itemId: string, name: string): void => {
      world.observe({
        context: { caller: 'agent', sessionId: 'session-test', turnId },
        name: 'inspect',
        args: { target: 'media', itemId },
        result: protectedResult({
          target: 'media',
          observedAt: Date.now(),
          inventory: null,
          clip: {
            lookup: 'found',
            item: { name, online: true, hasProxyMedia: false, fps: 24 }
          },
          linkStatus: null,
          requestedItemId: itemId,
          schemaHash: 'schema-a'
        }, 'media.clip_inspect.v1')
      });
    };

    inspectItem('turn-m1-1', 'clip-one', 'Clip One');
    inspectItem('turn-m2-1', 'clip-two', 'Clip Two');
    const firstM1 = world.currentEvidence().find((item) =>
      item.workflowId === 'media.clip_inspect.v1' && item.targetHandle === 'M1'
    )!;
    const firstM2 = world.currentEvidence().find((item) =>
      item.workflowId === 'media.clip_inspect.v1' && item.targetHandle === 'M2'
    )!;
    expect(firstM1).toBeTruthy();
    expect(firstM2).toBeTruthy();

    inspectItem('turn-m1-2', 'clip-one', 'Clip One');
    const current = world.currentEvidence();
    expect(current.some((item) => item.id === firstM1.id)).toBe(false);
    expect(current.some((item) => item.id === firstM2.id)).toBe(true);
    expect(current.filter((item) =>
      item.workflowId === 'media.clip_inspect.v1' && item.targetHandle === 'M1'
    )).toHaveLength(1);
  });

  it('retires stale facts when an exact target refresh no longer returns the old fields', () => {
    const world = new AgentWorldModel();
    observeProject(world, 'project-one', 'timeline-one');
    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-inventory' },
      name: 'inspect',
      args: { target: 'media' },
      result: protectedResult({
        target: 'media',
        observedAt: Date.now(),
        inventory: {
          rootFolder: { id: 'folder-one', name: 'Master' },
          folders: [],
          items: [{ id: 'clip-one', name: 'Clip One', folderId: 'folder-one', folderName: 'Master' }],
          itemsObserved: 1,
          offlineCountObserved: 0
        },
        clip: null,
        linkStatus: null,
        requestedItemId: null,
        schemaHash: 'schema-a'
      }, 'media.inventory_summary.v1')
    });
    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-found' },
      name: 'inspect',
      args: { target: 'media', itemId: 'clip-one' },
      result: protectedResult({
        target: 'media',
        observedAt: Date.now(),
        inventory: null,
        clip: {
          lookup: 'found',
          item: { name: 'Clip One', online: true, hasProxyMedia: true, fps: 24 }
        },
        linkStatus: null,
        requestedItemId: 'clip-one',
        schemaHash: 'schema-a'
      }, 'media.clip_inspect.v1')
    });
    const foundEvidence = world.currentEvidence().find((item) =>
      item.workflowId === 'media.clip_inspect.v1' && item.targetHandle === 'M1'
    )!;
    expect(foundEvidence).toBeTruthy();
    expect(world.situation(0).facts.map((fact) => fact.key)).toEqual(expect.arrayContaining([
      'focus.media.online',
      'focus.media.proxy',
      'focus.media.fps'
    ]));

    world.observe({
      context: { caller: 'agent', sessionId: 'session-test', turnId: 'turn-not-found' },
      name: 'inspect',
      args: { target: 'media', itemId: 'clip-one' },
      result: protectedResult({
        target: 'media',
        observedAt: Date.now(),
        inventory: null,
        clip: { lookup: 'not_found', item: null },
        linkStatus: null,
        requestedItemId: 'clip-one',
        schemaHash: 'schema-a'
      }, 'media.clip_inspect.v1')
    });

    expect(world.currentEvidence().some((item) => item.id === foundEvidence.id)).toBe(false);
    expect(world.situation(0).facts.map((fact) => fact.key)).not.toEqual(expect.arrayContaining([
      'focus.media.online',
      'focus.media.proxy',
      'focus.media.fps'
    ]));
    expect(world.situation(0).recentDeltas.at(-1)?.invalidatedFactKeys).toEqual(expect.arrayContaining([
      'focus.media.online',
      'focus.media.proxy',
      'focus.media.fps'
    ]));
  });
});
