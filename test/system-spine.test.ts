import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type {
  AgentActionOffer,
  AgentGoalFrame,
  AgentImplementationBinding
} from '../src/shared/agent-system.js';
import type { ResolveCapabilityEvidence } from '../src/shared/types.js';
import { AgentWorldModel } from '../src/main/agent-world-model.js';
import { AgentContextCompiler } from '../src/main/context-compiler.js';
import {
  bindAgentSemanticDispatchArgs,
  deriveAgentActionOffers,
  explicitMutationPlanningRequested,
  explicitMutationPlanningWorkflowIds,
  selectQualifiedImplementation
} from '../src/main/agent-action-catalog.js';
import { deriveAgentCompletionReport, deriveDecisionKindFromCompletion } from '../src/main/completion-report.js';
import {
  bindCosSessionToWorkspace,
  initCidWorkspaceRegistry,
  observeCidWorkspaceProject,
  resetCidWorkspaceRegistryForTests,
  workspaceForSession,
  workspaceMention
} from '../src/main/workspace-identity.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import {
  evaluateSystemSpineCompletion,
  getSystemSpineProjection,
  initSystemSpineRuntime,
  shutdownSystemSpineRuntime,
  systemSpineDecisionRuntime
} from '../src/main/system-spine.js';
import {
  initCosSessionRuntime,
  recordCosBrowserEventsNow,
  rebindCosSessionConversationNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';
import { resetConnectionForTests } from '../src/main/connection.js';

let tempDir: string | null = null;

afterEach(async () => {
  shutdownSystemSpineRuntime();
  resetCosSessionRuntimeForTests();
  resetConnectionForTests();
  resetCidWorkspaceRegistryForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function capability(
  capabilityId: ResolveCapabilityEvidence['capabilityId'],
  status: ResolveCapabilityEvidence['status'] = 'available',
  qualification: ResolveCapabilityEvidence['qualification'] = 'behaviorally_qualified'
): ResolveCapabilityEvidence {
  return {
    capabilityId,
    symbol: capabilityId,
    introducedIn: '21.1',
    evidenceSource: 'measured',
    qualification,
    evidenceBuild: '21.1',
    status,
    requirements: [],
    limitations: [],
    probeStrategy: 'focused test'
  };
}

function goal(text: string): AgentGoalFrame {
  return {
    schemaVersion: 1,
    originalRequest: { turnId: 'turn-1', seq: 1, text, chars: text.length, truncated: false },
    userDirectives: [],
    sourceUserMessages: 1,
    omittedUserDirectives: 0,
    desiredOutcome: text,
    hardConstraints: [],
    userPreferences: [],
    explicitNonGoals: [],
    completionCriteria: [text],
    requiredEvidence: ['qualified CID Resolve evidence'],
    assumptions: [],
    decisions: [],
    corrections: [],
    openObligations: [text]
  };
}

function projectResult(projectId: string, name: string): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        result: {
          target: 'project',
          observedAt: Date.now(),
          page: 'edit',
          project: { id: projectId, name, timelineCount: 1 },
          timeline: { id: 'timeline-stable-001', name: 'Main', videoTracks: 2, audioTracks: 2, subtitleTracks: 0 },
          settings: { readerId: 'project.settings_summary.v1', project: null, timeline: null, timelineUsesCustomSettings: null },
          schemaHash: 'schema-spine'
        },
        operation: {
          status: 'success',
          workflow_id: 'project.identity.v1',
          verification: { status: 'passed', level_reached: 'API_READBACK', checks: ['exact project identity'] }
        }
      })
    }]
  };
}

describe('read-only System Spine', () => {
  it('derives a bounded DecisionFrame/ActionOffer and completes only from qualified evidence', () => {
    const world = new AgentWorldModel();
    const compiler = new AgentContextCompiler(world);
    const criterion = 'Identify the current Resolve project.';
    const capabilities = [
      capability('resolve.sandboxed_script.read'),
      capability('project.identity.read')
    ];

    const before = compiler.compile({
      sessionId: 'session-spine-001',
      turnId: 'turn-1',
      input: criterion,
      narrativeMessages: 1,
      goal: goal(criterion),
      capabilityEvidence: capabilities
    });
    expect(before.actionOffers.length).toBeLessThanOrEqual(6);
    expect(before.actionOffers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: 'project.identity.inspect',
        applicability: 'applicable',
        advancesCriterion: criterion,
        implementation: expect.objectContaining({
          implementationId: 'project.identity.v1',
          source: 'official',
          qualification: 'behaviorally_qualified'
        })
      })
    ]));
    expect(before.actionOffers.some((offer) => offer.capabilityId === 'color.graph.inspect')).toBe(false);
    expect(deriveAgentCompletionReport({
      sessionId: before.sessionId,
      generation: before.situation.generation,
      goal: before.goal,
      actionOffers: before.actionOffers,
      evidence: compiler.completionEvidence()
    }).complete).toBe(false);

    world.observe({
      context: { caller: 'agent', sessionId: before.sessionId, turnId: before.turnId },
      name: 'inspect',
      args: { target: 'project' },
      result: projectResult('project-stable-001', 'Original Name')
    });
    world.observe({
      context: { caller: 'agent', sessionId: before.sessionId, turnId: before.turnId },
      name: 'inspect',
      args: { target: 'media' },
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            result: {
              target: 'media',
              observedAt: Date.now(),
              inventory: {
                rootFolder: { id: 'folder-stable-001', name: 'Master' },
                folders: [],
                items: [{ id: 'clip-stable-001', name: 'Interview', folderId: 'folder-stable-001', folderName: 'Master' }],
                itemsObserved: 1,
                offlineCountObserved: 0
              },
              clip: null,
              linkStatus: null,
              requestedItemId: null,
              schemaHash: 'schema-spine'
            },
            operation: {
              status: 'success',
              workflow_id: 'media.inventory_summary.v1',
              verification: { status: 'passed', level_reached: 'STRUCTURAL_READBACK', checks: ['inventory'] }
            }
          })
        }]
      }
    });
    world.setFocus({ kind: 'media_pool_item', exactId: 'clip-stable-001' });
    const after = compiler.compile({
      sessionId: before.sessionId,
      turnId: 'turn-2',
      input: criterion,
      narrativeMessages: 1,
      goal: goal(criterion),
      capabilityEvidence: capabilities
    });
    const report = deriveAgentCompletionReport({
      sessionId: after.sessionId,
      generation: after.situation.generation,
      goal: after.goal,
      actionOffers: after.actionOffers,
      evidence: compiler.completionEvidence()
    });
    expect(after.decision.decisionKind).toBe('observe');
    expect(after.decision.sharedFocus?.entity.handle).toBe('M1');
    expect(report.complete).toBe(true);
    expect(deriveDecisionKindFromCompletion({
      completion: report,
      actionOffers: after.actionOffers,
      materialUncertainty: after.decision.materialUncertainty
    })).toBe('finish_check');
    expect(report.criteria).toEqual([
      expect.objectContaining({
        criterion,
        status: 'satisfied',
        strongestVerification: 'API_READBACK'
      })
    ]);
    expect(report.evidenceIds.length).toBeGreaterThan(0);

    world.invalidate('external project drift');
    const stale = compiler.compile({
      sessionId: before.sessionId,
      turnId: 'turn-3',
      input: criterion,
      narrativeMessages: 1,
      goal: goal(criterion),
      capabilityEvidence: capabilities
    });
    expect(deriveAgentCompletionReport({
      sessionId: stale.sessionId,
      generation: stale.situation.generation,
      goal: stale.goal,
      actionOffers: stale.actionOffers,
      evidence: compiler.completionEvidence()
    }).complete).toBe(false);
  });

  it('keeps unknown distinct from unavailable, blocks read-slice mutation, and uses official on a qualification tie', () => {
    const criterion = 'Add one review marker.';
    const unknown = deriveAgentActionOffers({
      input: criterion,
      focusedKind: 'timeline_item',
      focusedHandle: 'T1',
      goalCriterion: criterion,
      capabilityEvidence: []
    });
    const marker = unknown.find((offer) => offer.capabilityId === 'edit.marker.add');
    expect(marker).toMatchObject({
      applicability: 'blocked',
      blockingReason: expect.stringContaining('read-only System Spine slice')
    });

    const projectUnknown = deriveAgentActionOffers({
      input: 'Inspect project identity',
      focusedKind: null,
      focusedHandle: null,
      goalCriterion: 'Inspect project identity',
      capabilityEvidence: [capability('resolve.sandboxed_script.read')]
    }).find((offer) => offer.capabilityId === 'project.identity.inspect');
    expect(projectUnknown).toMatchObject({
      applicability: 'unknown',
      implementation: expect.objectContaining({ availability: 'unknown' })
    });
    const projectUnavailable = deriveAgentActionOffers({
      input: 'Inspect project identity',
      focusedKind: null,
      focusedHandle: null,
      goalCriterion: 'Inspect project identity',
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('project.identity.read', 'unavailable')
      ]
    }).find((offer) => offer.capabilityId === 'project.identity.inspect');
    expect(projectUnavailable).toMatchObject({
      applicability: 'unavailable',
      implementation: expect.objectContaining({ availability: 'unavailable' })
    });

    const base: AgentImplementationBinding = {
      implementationId: 'project.identity.v1',
      implementationVersion: '1',
      source: 'trusted_plugin',
      qualification: 'behaviorally_qualified',
      evidenceBuild: '21.1',
      availability: 'available',
      blockingReason: null,
      remediation: null
    };
    expect(selectQualifiedImplementation([
      base,
      { ...base, source: 'official' }
    ])?.source).toBe('official');

    const trackAdd = deriveAgentActionOffers({
      input: 'Add one empty video track to the current timeline',
      focusedKind: null,
      focusedHandle: null,
      goalCriterion: 'Add one empty video track to the current timeline',
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('edit.timeline_structure.read'),
        capability('edit.track.write')
      ],
      readOnlySlice: false
    }).find((offer) => offer.capabilityId === 'edit.track.add');
    expect(trackAdd).toMatchObject({
      applicability: 'applicable',
      kind: 'mutate',
      risk: 'low',
      verificationRequirement: 'STRUCTURAL_READBACK',
      implementation: {
        implementationId: 'edit.track_add.v1',
        qualification: 'behaviorally_qualified',
        availability: 'available'
      }
    });

    expect(explicitMutationPlanningRequested('Add one empty video track to the current timeline')).toBe(true);
    expect(explicitMutationPlanningRequested('新增一条视频轨道')).toBe(true);
    expect(explicitMutationPlanningRequested('Inspect the current video tracks')).toBe(false);
    expect(explicitMutationPlanningRequested('Show me the track structure')).toBe(false);
    expect(explicitMutationPlanningRequested('Do not add a video track')).toBe(false);
    expect(explicitMutationPlanningRequested('Explain how to add a video track')).toBe(false);
    expect(explicitMutationPlanningRequested('不要新增视频轨道')).toBe(false);
    expect(explicitMutationPlanningRequested('告诉我怎么新增一条视频轨道')).toBe(false);
    expect(explicitMutationPlanningRequested('Create a new track')).toBe(false);
    expect(explicitMutationPlanningRequested('Make a new video track')).toBe(false);
    expect(explicitMutationPlanningRequested('New video track')).toBe(false);
    expect(explicitMutationPlanningRequested('新增轨道')).toBe(false);
    expect(explicitMutationPlanningWorkflowIds('Add one review marker to the current video track')).toEqual(['edit.review_marker_add.v1']);
    expect(explicitMutationPlanningWorkflowIds('Add one empty video track to the current timeline')).toEqual(['edit.track_add.v1']);
    expect(explicitMutationPlanningWorkflowIds('Create a new local grade version')).toEqual(['color.grade_version_create.v1']);
    expect(explicitMutationPlanningWorkflowIds('新建一个本地调色版本')).toEqual(['color.grade_version_create.v1']);
    expect(explicitMutationPlanningWorkflowIds('Inspect the grade versions')).toEqual([]);

    expect(bindAgentSemanticDispatchArgs(trackAdd ? [trackAdd] : [], 'plan', {
      workflowId: 'edit.track_add.v1', target: 'current_timeline', trackType: 'video', placement: 'append'
    })).toEqual({
      workflowId: 'edit.track_add.v1', target: 'current_timeline', trackType: 'video', placement: 'append'
    });
    expect(() => bindAgentSemanticDispatchArgs(trackAdd ? [trackAdd] : [], 'plan', {
      workflowId: 'edit.track_add.v1', target: 'current_timeline', trackType: 'audio', placement: 'append'
    })).toThrow('do not match');
    expect(() => bindAgentSemanticDispatchArgs([], 'plan', {
      workflowId: 'edit.track_add.v1', target: 'current_timeline', trackType: 'video', placement: 'append'
    })).toThrow('not authorized');

    const gradeVersion = deriveAgentActionOffers({
      input: 'Create a new local grade version',
      focusedKind: 'timeline_item',
      focusedHandle: 'I1',
      goalCriterion: 'Create a new local grade version',
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('color.grade_version.read'),
        capability('color.grade_version.write')
      ],
      readOnlySlice: false,
      allowedMutationWorkflowIds: ['color.grade_version_create.v1']
    }).find((offer) => offer.capabilityId === 'color.grade_version.create');
    expect(gradeVersion).toMatchObject({ applicability: 'applicable', targetHandle: 'I1', kind: 'mutate' });
    expect(bindAgentSemanticDispatchArgs(gradeVersion ? [gradeVersion] : [], 'plan', {
      workflowId: 'color.grade_version_create.v1', target: 'timeline_item', itemRef: 'I1', generation: 3, name: 'Agent Version'
    })).toMatchObject({
      workflowId: 'color.grade_version_create.v1', target: 'timeline_item', itemRef: 'I1', generation: 3, name: 'Agent Version'
    });
    const wrongKindGradeVersion = deriveAgentActionOffers({
      input: 'Create a new local grade version',
      focusedKind: 'media_pool_item',
      focusedHandle: 'M1',
      goalCriterion: 'Create a new local grade version',
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('color.grade_version.read'),
        capability('color.grade_version.write')
      ],
      readOnlySlice: false,
      allowedMutationWorkflowIds: ['color.grade_version_create.v1']
    }).find((offer) => offer.capabilityId === 'color.grade_version.create');
    expect(wrongKindGradeVersion).toMatchObject({ applicability: 'unknown', targetHandle: null });

    const markerStillBlocked = deriveAgentActionOffers({
      input: 'Add one review marker',
      focusedKind: 'timeline_item',
      focusedHandle: 'T1',
      goalCriterion: 'Add one review marker',
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('edit.review_marker.read'),
        capability('edit.review_marker.write')
      ],
      readOnlySlice: false,
      allowedMutationWorkflowIds: ['edit.track_add.v1']
    }).find((offer) => offer.capabilityId === 'edit.marker.add');
    expect(markerStillBlocked).toMatchObject({
      applicability: 'blocked',
      blockingReason: expect.stringContaining('does not authorize planning this mutation workflow')
    });

    const markerAllowed = deriveAgentActionOffers({
      input: 'Add one review marker',
      focusedKind: 'timeline_item',
      focusedHandle: 'T1',
      goalCriterion: 'Add one review marker',
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('edit.review_marker.read'),
        capability('edit.review_marker.write')
      ],
      readOnlySlice: false,
      allowedMutationWorkflowIds: ['edit.review_marker_add.v1']
    }).find((offer) => offer.capabilityId === 'edit.marker.add');
    expect(markerAllowed).toMatchObject({ applicability: 'applicable', targetHandle: 'T1', kind: 'mutate' });
    expect(bindAgentSemanticDispatchArgs(markerAllowed ? [markerAllowed] : [], 'plan', {
      workflowId: 'edit.review_marker_add.v1', target: 'timeline_item', itemRef: 'T1', generation: 1,
      frameOffset: 2, color: 'Yellow', name: 'Review'
    })).toMatchObject({
      workflowId: 'edit.review_marker_add.v1', target: 'timeline_item', itemRef: 'T1', generation: 1
    });
    expect(() => bindAgentSemanticDispatchArgs(markerAllowed ? [markerAllowed] : [], 'plan', {
      workflowId: 'edit.review_marker_add.v1', target: 'timeline_item', itemRef: 'T2', generation: 1,
      frameOffset: 2, color: 'Yellow', name: 'Wrong target'
    })).toThrow('does not match the exact current ActionOffer target');

    const fakeOffer: AgentActionOffer = {
      capabilityId: 'edit.marker.add',
      targetHandle: 'T1',
      applicability: 'applicable',
      whyRelevant: 'test',
      advancesCriterion: criterion,
      requiredPreconditions: [],
      risk: 'low',
      expectedSemanticEffect: 'marker exists',
      verificationRequirement: 'API_READBACK',
      implementation: {
        implementationId: 'edit.review_marker_add.v1',
        implementationVersion: '1',
        source: 'official',
        qualification: 'behaviorally_qualified',
        evidenceBuild: '21.1',
        availability: 'available',
        blockingReason: null,
        remediation: null
      },
      estimatedCost: { context: 'low', resolve: 'medium', latency: 'low' },
      blockingReason: null,
      remediation: null
    };
    expect(deriveAgentCompletionReport({
      sessionId: 'session-spine-002',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [fakeOffer],
      evidence: [{
        id: 'E-unverified',
        source: 'official_api',
        observedAt: Date.now(),
        generation: 1,
        workflowId: 'edit.review_marker_add.v1',
        executionId: 'exec-1',
        verificationStatus: 'unverified',
        verificationLevel: null,
        projectHandle: 'P1',
        timelineHandle: 'T1',
        targetHandle: 'T1',
        limitations: []
      }]
    }).complete).toBe(false);

    const verifiedEvidence = {
      id: 'E-verified',
      source: 'official_api' as const,
      observedAt: Date.now(),
      generation: 1,
      workflowId: 'edit.review_marker_add.v1' as const,
      executionId: 'exec-2',
      verificationStatus: 'passed' as const,
      verificationLevel: 'API_READBACK' as const,
      projectHandle: 'P1',
      timelineHandle: 'T1',
      targetHandle: 'T1',
      limitations: []
    };
    expect(deriveAgentCompletionReport({
      sessionId: 'session-spine-002',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [fakeOffer],
      evidence: [{ ...verifiedEvidence, id: 'E-wrong-target', targetHandle: 'T2' }]
    }).complete).toBe(false);
    expect(deriveAgentCompletionReport({
      sessionId: 'session-spine-002',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [fakeOffer],
      evidence: [{ ...verifiedEvidence, id: 'E-wrong-level', verificationLevel: 'STRUCTURAL_READBACK' }]
    }).complete).toBe(false);
    expect(deriveAgentCompletionReport({
      sessionId: 'session-spine-002',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [fakeOffer],
      evidence: [verifiedEvidence]
    }).complete).toBe(true);
  });

  it('requires fresh criterion-bound evidence and never upgrades unrelated evidence to finish_check', () => {
    const criterion = 'Inspect project identity';
    const offers = deriveAgentActionOffers({
      input: criterion,
      focusedKind: null,
      focusedHandle: null,
      goalCriterion: criterion,
      capabilityEvidence: [
        capability('resolve.sandboxed_script.read'),
        capability('project.identity.read')
      ]
    });
    const projectOffer = offers.find((offer) => offer.capabilityId === 'project.identity.inspect')!;
    const oldEvidence = {
      id: 'E-old-project',
      source: 'official_api' as const,
      observedAt: 100,
      generation: 1,
      provenanceRevision: 3,
      workflowId: projectOffer.implementation!.implementationId,
      executionId: 'exec-old',
      verificationStatus: 'passed' as const,
      verificationLevel: projectOffer.verificationRequirement,
      projectHandle: 'P1',
      timelineHandle: 'T1',
      targetHandle: projectOffer.targetHandle,
      limitations: []
    };
    const fresh = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [projectOffer],
      evidence: [oldEvidence]
    });
    expect(fresh.complete).toBe(true);
    expect(deriveDecisionKindFromCompletion({
      completion: fresh,
      actionOffers: [projectOffer],
      materialUncertainty: null
    })).toBe('finish_check');

    const stale = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [projectOffer],
      evidence: [{ ...oldEvidence, invalidatedAtRevision: 4 }]
    });
    expect(stale.complete).toBe(false);
    expect(stale.criteria[0]?.blockingReason).toContain('invalidated for this semantic slice');
    expect(deriveDecisionKindFromCompletion({
      completion: stale,
      actionOffers: [projectOffer],
      materialUncertainty: null
    })).toBe('observe');

    const refreshed = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [projectOffer],
      evidence: [
        { ...oldEvidence, invalidatedAtRevision: 4 },
        { ...oldEvidence, id: 'E-new-project', provenanceRevision: 4, observedAt: 200 }
      ]
    });
    expect(refreshed.complete).toBe(true);

    const unrelated = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [projectOffer],
      evidence: [{
        ...oldEvidence,
        id: 'E-media',
        provenanceRevision: 5,
        workflowId: 'media.inventory_summary.v1'
      }]
    });
    expect(unrelated.complete).toBe(false);
    expect(deriveDecisionKindFromCompletion({
      completion: unrelated,
      actionOffers: [projectOffer],
      materialUncertainty: null
    })).toBe('observe');

    const wrongGeneration = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 2,
      goal: goal(criterion),
      actionOffers: [projectOffer],
      evidence: [{ ...oldEvidence, id: 'E-wrong-generation', provenanceRevision: 9 }]
    });
    expect(wrongGeneration.complete).toBe(false);

    const wrongTarget = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [{ ...projectOffer, targetHandle: 'P2' }],
      evidence: [{ ...oldEvidence, id: 'E-wrong-target', provenanceRevision: 9, targetHandle: 'P1' }]
    });
    expect(wrongTarget.complete).toBe(false);

    const wrongVerification = deriveAgentCompletionReport({
      sessionId: 'session-freshness',
      generation: 1,
      goal: goal(criterion),
      actionOffers: [{ ...projectOffer, verificationRequirement: 'STRUCTURAL_READBACK' }],
      evidence: [{ ...oldEvidence, id: 'E-wrong-verification', provenanceRevision: 9, verificationLevel: 'API_READBACK' }]
    });
    expect(wrongVerification.complete).toBe(false);
  });

  it('keeps System Spine completion stale across unrelated reads until the exact semantic slice refreshes', () => {
    const world = new AgentWorldModel();
    const compiler = new AgentContextCompiler(world);
    const criterion = 'Inspect project identity';
    const capabilities = [
      capability('resolve.sandboxed_script.read'),
      capability('project.identity.read')
    ];
    const evaluate = (turnId: string) => {
      const pack = compiler.compile({
        sessionId: 'session-semantic-freshness',
        turnId,
        input: criterion,
        narrativeMessages: 1,
        goal: goal(criterion),
        capabilityEvidence: capabilities
      });
      return {
        pack,
        completion: evaluateSystemSpineCompletion({
          pack,
          evidence: compiler.completionEvidence()
        })
      };
    };

    world.observe({
      context: { caller: 'agent', sessionId: 'session-semantic-freshness', turnId: 'turn-project-1' },
      name: 'inspect',
      args: { target: 'project' },
      result: projectResult('project-semantic-001', 'Semantic Project')
    });
    const firstProjectEvidence = world.currentEvidence().find((item) => item.workflowId === 'project.identity.v1')!;
    const initial = evaluate('turn-evaluate-1');
    expect(initial.completion.complete).toBe(true);
    expect(initial.pack.decision.decisionKind).toBe('finish_check');

    world.observe({
      context: { caller: 'agent', sessionId: 'session-semantic-freshness', turnId: 'turn-external-change' },
      name: 'execute',
      args: { planId: 'unknown-scope' },
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            result: { state: 'changed' },
            operation: {
              status: 'success',
              workflow_id: 'unknown.writer.v1',
              verification: { status: 'passed', level_reached: 'API_READBACK', checks: ['unknown mutation scope'] }
            }
          })
        }]
      }
    });
    expect(world.currentEvidence().some((item) => item.id === firstProjectEvidence.id)).toBe(false);

    world.observe({
      context: { caller: 'agent', sessionId: 'session-semantic-freshness', turnId: 'turn-media' },
      name: 'inspect',
      args: { target: 'media' },
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            result: {
              target: 'media',
              observedAt: Date.now(),
              inventory: {
                rootFolder: { id: 'folder-semantic', name: 'Master' },
                folders: [],
                items: [],
                itemsObserved: 0,
                offlineCountObserved: 0
              },
              clip: null,
              linkStatus: null,
              requestedItemId: null,
              schemaHash: 'schema-spine'
            },
            operation: {
              status: 'success',
              workflow_id: 'media.inventory_summary.v1',
              verification: { status: 'passed', level_reached: 'STRUCTURAL_READBACK', checks: ['media inventory'] }
            }
          })
        }]
      }
    });
    expect(evaluate('turn-evaluate-media').completion.complete).toBe(false);

    world.observe({
      context: { caller: 'agent', sessionId: 'session-semantic-freshness', turnId: 'turn-fairlight' },
      name: 'inspect',
      args: { target: 'fairlight' },
      result: {
        content: [{
          type: 'text',
          text: JSON.stringify({
            result: {
              target: 'fairlight',
              observedAt: Date.now(),
              summary: {
                readerId: 'fairlight.mapping_inspect.v1',
                timeline: { id: 'timeline-stable-001', name: 'Main' },
                audioTrackCount: 2
              },
              clipProcessing: null,
              schemaHash: 'schema-spine'
            },
            operation: {
              status: 'success',
              workflow_id: 'fairlight.mapping_inspect.v1',
              verification: { status: 'passed', level_reached: 'STRUCTURAL_READBACK', checks: ['fairlight mapping'] }
            }
          })
        }]
      }
    });
    expect(evaluate('turn-evaluate-fairlight').completion.complete).toBe(false);

    world.observe({
      context: { caller: 'agent', sessionId: 'session-semantic-freshness', turnId: 'turn-project-2' },
      name: 'inspect',
      args: { target: 'project' },
      result: projectResult('project-semantic-001', 'Semantic Project')
    });
    const refreshed = evaluate('turn-evaluate-2');
    expect(refreshed.completion.complete).toBe(true);
    expect(refreshed.pack.decision.decisionKind).toBe('finish_check');
    expect(refreshed.completion.evidenceIds).not.toContain(firstProjectEvidence.id);
  });

  it('binds the shared preflight workflow to the semantic profile that requested it', () => {
    const preflightCapabilities: ResolveCapabilityEvidence['capabilityId'][] = [
      'project.identity.read',
      'project.settings.read',
      'media.inventory.read',
      'edit.timeline_structure.read',
      'fusion.composition.read',
      'fusion.graph.read',
      'color.pipeline.read',
      'color.graph.read',
      'color.grade_version.read',
      'fairlight.mapping.read',
      'fairlight.clip_processing.read',
      'deliver.capability_matrix.read',
      'deliver.settings.partial_read'
    ];
    const offers = deriveAgentActionOffers({
      input: 'Check project preflight and deliver render preflight readiness.',
      focusedKind: null,
      focusedHandle: null,
      goalCriterion: 'Check readiness',
      capabilityEvidence: preflightCapabilities.map((id) => capability(id)),
      limit: 24
    });
    expect(offers.find((offer) => offer.capabilityId === 'project.preflight')?.dispatch).toEqual({
      profile: 'general'
    });
    expect(offers.find((offer) => offer.capabilityId === 'deliver.preflight')?.dispatch).toEqual({
      profile: 'delivery'
    });
    expect(offers.find((offer) => offer.capabilityId === 'project.preflight')?.implementation?.implementationId)
      .toBe('project.preflight.v1');
    expect(offers.find((offer) => offer.capabilityId === 'deliver.preflight')?.implementation?.implementationId)
      .toBe('project.preflight.v1');
    expect(offers.find((offer) => offer.capabilityId === 'project.preflight')?.advancesCriterion).toBeNull();
    expect(offers.find((offer) => offer.capabilityId === 'deliver.preflight')?.advancesCriterion).toBe('Check readiness');
    expect(bindAgentSemanticDispatchArgs(offers, 'inspect', { target: 'preflight' })).toEqual({
      target: 'preflight',
      profile: 'delivery'
    });
    expect(() => bindAgentSemanticDispatchArgs(offers, 'inspect', {
      target: 'preflight',
      profile: 'general'
    })).toThrow('does not match');

    const preflightGoal = goal('Check readiness');
    const evidenceBase = {
      source: 'official_api' as const,
      observedAt: 100,
      generation: 1,
      provenanceRevision: 1,
      workflowId: 'project.preflight.v1' as const,
      executionId: null,
      verificationStatus: 'passed' as const,
      verificationLevel: 'STRUCTURAL_READBACK' as const,
      projectHandle: null,
      timelineHandle: null,
      targetHandle: null,
      limitations: []
    };
    expect(deriveAgentCompletionReport({
      sessionId: 'session-preflight',
      generation: 1,
      goal: preflightGoal,
      actionOffers: offers,
      evidence: [{ id: 'E-general', ...evidenceBase, preflightProfile: 'general' }]
    }).complete).toBe(false);
    expect(deriveAgentCompletionReport({
      sessionId: 'session-preflight',
      generation: 1,
      goal: preflightGoal,
      actionOffers: offers,
      evidence: [{ id: 'E-delivery', ...evidenceBase, preflightProfile: 'delivery' }]
    }).complete).toBe(true);
  });

  it('keeps the cockpit projection scoped to the exact active Session and turn', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-spine-projection-'));
    initDurableStore(tempDir);
    await initCosSessionRuntime();
    await initSystemSpineRuntime();
    const convA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const convB = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const convC = 'cccccccc-3333-4333-8333-cccccccccccc';
    const sessionA = await recordCosBrowserEventsNow(convA, [
      { kind: 'turn_start', turnId: 'turn-a', time: 100 },
      { kind: 'user_message', turnId: 'turn-a', messageId: 'msg-a', text: 'Inspect the project.', time: 101 }
    ]);
    const sessionB = await recordCosBrowserEventsNow(convB, [
      { kind: 'turn_start', turnId: 'turn-b', time: 110 },
      { kind: 'user_message', turnId: 'turn-b', messageId: 'msg-b', text: 'Historical session.', time: 111 }
    ]);
    await systemSpineDecisionRuntime.projectSession(sessionA, { publish: true });
    expect(getSystemSpineProjection()).toMatchObject({ sessionId: sessionA.sessionId, turnId: 'turn-a' });

    await systemSpineDecisionRuntime.projectSession(sessionB);
    expect(getSystemSpineProjection()).toMatchObject({ sessionId: sessionA.sessionId, turnId: 'turn-a' });

    const settledA = await recordCosBrowserEventsNow(convA, [
      { kind: 'turn_end', turnId: 'turn-a', outcome: 'completed', time: 120 }
    ]);
    await systemSpineDecisionRuntime.projectSession(settledA, { publish: true });
    expect(getSystemSpineProjection()).toBeNull();

    const moved = await rebindCosSessionConversationNow(sessionA.sessionId, convA, convC);
    expect(moved.sessionId).toBe(sessionA.sessionId);
    expect(getSystemSpineProjection()).toBeNull();
    const successor = await recordCosBrowserEventsNow(convC, [
      { kind: 'turn_start', turnId: 'turn-c', time: 130 },
      { kind: 'user_message', turnId: 'turn-c', messageId: 'msg-c', text: 'Continue with the successor.', time: 131 }
    ]);
    await systemSpineDecisionRuntime.projectSession(successor, { publish: true });
    expect(getSystemSpineProjection()).toMatchObject({ sessionId: sessionA.sessionId, turnId: 'turn-c' });
  });

  it('preserves Workspace identity across rename and refuses silent Session cross-project rebinding', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-workspace-spine-'));
    initDurableStore(tempDir);
    await initCidWorkspaceRegistry();
    const projectA = {
      kind: 'project' as const,
      exactId: 'project-stable-001',
      handle: 'P1',
      label: 'Original Name',
      generation: 1,
      parentHandle: null,
      locator: null
    };
    const first = await observeCidWorkspaceProject({ project: projectA, observedAt: Date.now(), semanticHistoryRevision: 1 });
    const renamed = await observeCidWorkspaceProject({
      project: { ...projectA, label: 'Renamed Project' },
      observedAt: Date.now(),
      semanticHistoryRevision: 2
    });
    expect(renamed.workspaceId).toBe(first.workspaceId);
    expect(renamed.projectLabel).toBe('Renamed Project');
    expect(await bindCosSessionToWorkspace('session-workspace-001', first.workspaceId)).toBe('bound');

    const second = await observeCidWorkspaceProject({
      project: { ...projectA, exactId: 'project-stable-002', handle: 'P2', label: 'Other Project', generation: 2 },
      observedAt: Date.now(),
      semanticHistoryRevision: 3
    });
    expect(second.workspaceId).not.toBe(first.workspaceId);
    expect(await bindCosSessionToWorkspace('session-workspace-001', second.workspaceId)).toBe('mismatch');
    expect(workspaceForSession('session-workspace-001')?.workspaceId).toBe(first.workspaceId);
    expect(workspaceMention({
      workspace: first,
      project: null,
      online: false,
      observedAt: 0,
      bindingStatus: 'bound'
    })).toMatchObject({ online: false, freshness: 'offline', bindingStatus: 'bound' });
  });
});
