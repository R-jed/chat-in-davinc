import { readFileSync } from 'node:fs';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { describe, expect, it } from 'vitest';
import type {
  AgentActionOffer,
  AgentArtifactWorkspaceProjection,
  AgentEntityMention,
  AgentEvidenceRef,
  AgentSituationFrame,
  AgentSystemSpineProjection
} from '../src/shared/agent-system.js';
import type { WorkflowPlanProjection } from '../src/shared/types.js';
import { deriveArtifactWorkspaceProjection } from '../src/main/artifact-workspace.js';
import { AgentWorldModel } from '../src/main/agent-world-model.js';
import {
  ARTIFACT_MANUAL_INSPECTION_HOLD_MS,
  artifactWorkspaceSemanticScope,
  createArtifactWorkspacePresentationState,
  reconcileArtifactWorkspacePresentation,
  selectArtifactForInspection,
  selectArtifactLens,
  setArtifactPin
} from '../src/renderer/artifact-workspace-policy.js';

const project: AgentEntityMention = {
  kind: 'project', handle: 'P1', label: 'Documentary', generation: 3, parentHandle: null, locator: null
};
const timeline: AgentEntityMention = {
  kind: 'timeline', handle: 'T1', label: 'Main Cut', generation: 3, parentHandle: 'P1', locator: null
};
const clip: AgentEntityMention = {
  kind: 'media_pool_item', handle: 'M1', label: 'Interview', generation: 3, parentHandle: 'P1', locator: null
};
const timelineItem: AgentEntityMention = {
  kind: 'timeline_item', handle: 'I1', label: 'Interview on V1', generation: 3, parentHandle: 'T1', locator: null
};

function offer(targetHandle: string | null = 'M1'): AgentActionOffer {
  return {
    capabilityId: 'media.item.inspect',
    targetHandle,
    applicability: 'applicable',
    kind: 'observe',
    whyRelevant: 'Review Media item metadata',
    advancesCriterion: 'Inspect the interview clip.',
    requiredPreconditions: [],
    risk: 'low',
    expectedSemanticEffect: 'Observe exact clip metadata and proxy state.',
    verificationRequirement: 'API_READBACK',
    implementation: {
      implementationId: 'media.clip_inspect.v1',
      implementationVersion: '1',
      source: 'official',
      qualification: 'behaviorally_qualified',
      evidenceBuild: '21.1',
      availability: 'available',
      blockingReason: null,
      remediation: null
    },
    estimatedCost: { context: 'low', resolve: 'low', latency: 'low' },
    blockingReason: null,
    remediation: null
  };
}

function evidence(): AgentEvidenceRef {
  return {
    id: 'E-media',
    source: 'official_api',
    observedAt: 100,
    generation: 3,
    provenanceRevision: 9,
    workflowId: 'media.clip_inspect.v1',
    executionId: null,
    verificationStatus: 'passed',
    verificationLevel: 'API_READBACK',
    projectHandle: 'P1',
    timelineHandle: 'T1',
    targetHandle: 'M1',
    limitations: []
  };
}

function situation(overrides: Partial<AgentSituationFrame> = {}): AgentSituationFrame {
  return {
    generation: 3,
    revision: 9,
    observedAt: 100,
    project,
    timeline,
    resolvePage: 'edit',
    sharedFocus: { entity: clip, source: 'agent', setAt: 100 },
    entities: [project, timeline, clip, timelineItem],
    facts: [{
      key: 'focus.media.proxy',
      subjectHandle: 'M1',
      value: 'online',
      epistemicState: 'observed',
      evidenceIds: ['E-media']
    }],
    evidence: [evidence()],
    recentDeltas: [{
      revision: 9,
      generation: 3,
      observedAt: 100,
      reason: 'media.clip_inspect.v1 observed',
      changedFactKeys: ['focus.media.proxy'],
      invalidatedFactKeys: [],
      evidenceIds: ['E-media']
    }],
    blockers: [],
    unknowns: [],
    ...overrides
  };
}

function protectedInspectResult(result: Record<string, unknown>, workflowId: string): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        result,
        operation: {
          workflow_id: workflowId,
          verification: { status: 'passed', level_reached: 'API_READBACK' }
        }
      })
    }]
  };
}

function projectInspectorWorld(): AgentWorldModel {
  const world = new AgentWorldModel();
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'project' },
    result: protectedInspectResult({
      target: 'project',
      observedAt: 100,
      page: 'edit',
      project: { name: 'Documentary', id: 'project-exact-1', timelineCount: 1 },
      timeline: { name: 'Main Cut', id: 'timeline-exact-1', videoTracks: 2, audioTracks: 2, subtitleTracks: 0 },
      settings: {
        readerId: 'project.settings_summary.v1',
        project: {
          timelineResolution: { width: 3840, height: 2160 },
          timelineFrameRate: 24,
          timelinePlaybackFrameRate: 24,
          outputResolution: { width: 3840, height: 2160 },
          frameRateMismatchBehavior: 'nearest',
          colorScienceMode: 'DaVinci YRGB Color Managed',
          videoMonitorFormat: '2160p24',
          unverified: []
        },
        timeline: null,
        timelineUsesCustomSettings: false
      },
      schemaHash: 'schema-project-inspector'
    }, 'project.settings_summary.v1')
  });
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'preflight', profile: 'general' },
    result: protectedInspectResult({
      target: 'preflight',
      observedAt: 101,
      preflight: {
        readerId: 'project.preflight.v1',
        profile: 'general',
        status: 'warning',
        project: { id: 'project-exact-1', name: 'Documentary' },
        timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
        checks: [{ id: 'project.identity.v1', status: 'pass', issueCodes: [] }],
        blockers: [],
        warnings: ['project_warning'],
        capabilityGaps: [],
        capabilityEvidence: []
      },
      schemaHash: 'schema-project-inspector'
    }, 'project.preflight.v1')
  });
  return world;
}

function mediaInspectorWorld(): AgentWorldModel {
  const world = projectInspectorWorld();
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'media' },
    result: protectedInspectResult({
      target: 'media',
      observedAt: 102,
      inventory: {
        readerId: 'media.inventory_summary.v1',
        rootFolder: { id: 'folder-exact-1', name: 'Master' },
        currentFolder: { id: 'folder-exact-1', name: 'Master' },
        folders: [],
        items: [
          {
            id: 'clip-exact-a',
            name: 'Clip A',
            folderId: 'folder-exact-1',
            folderName: 'Master',
            resolveType: 'Video + Audio',
            isTimeline: false,
            duration: '00:00:10:00',
            fps: 24,
            resolution: { width: 1920, height: 1080 },
            videoCodec: 'ProRes',
            audioCodec: 'PCM',
            online: true,
            hasProxyMedia: false
          },
          {
            id: 'clip-exact-b',
            name: 'Clip B',
            folderId: 'folder-exact-1',
            folderName: 'Master',
            resolveType: 'Video',
            isTimeline: false,
            duration: '00:00:08:00',
            fps: 24,
            resolution: { width: 1920, height: 1080 },
            videoCodec: 'H.264',
            audioCodec: null,
            online: true,
            hasProxyMedia: true
          }
        ],
        folderCountObserved: 1,
        itemsObserved: 2,
        sourceClipCountObserved: 2,
        timelineItemCountObserved: 0,
        onlineCountObserved: 2,
        offlineCountObserved: 0,
        onlineUnverifiedCount: 0,
        proxyLinkedCountObserved: 1,
        proxyAbsentCountObserved: 1,
        proxyUnverifiedCount: 0,
        resolveTypeCounts: [{ type: 'Video', count: 2 }],
        motionFrameRateMismatchCount: 0,
        motionResolutionMismatchCount: 0,
        complete: true
      },
      clip: null,
      linkStatus: null,
      requestedItemId: null,
      schemaHash: 'schema-project-inspector'
    }, 'media.inventory_summary.v1')
  });
  const inspectClip = (id: string, name: string, online: boolean): void => {
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'media', itemId: id },
      result: protectedInspectResult({
        target: 'media',
        observedAt: 103,
        inventory: null,
        clip: {
          readerId: 'media.clip_inspect.v1',
          lookup: 'found',
          search: { foldersObserved: 1, itemsObserved: 2, truncated: false },
          item: {
            id,
            name,
            resolveType: 'Video',
            isTimeline: false,
            duration: '00:00:10:00',
            fps: 24,
            resolution: { width: 1920, height: 1080 },
            videoCodec: 'ProRes',
            audioCodec: 'PCM',
            audioBitDepth: 24,
            audioChannels: 2,
            startTimecode: '01:00:00:00',
            endTimecode: '01:00:10:00',
            online,
            hasProxyMedia: false,
            clipColor: null,
            flags: [],
            audioMapping: null
          },
          metadata: [{ key: 'Scene', value: name }],
          metadataTruncated: false,
          thirdPartyMetadata: [],
          thirdPartyMetadataTruncated: false,
          markers: [],
          markersTruncated: false,
          methodEvidence: { checkedMethods: ['GetMetadata'], observedMethods: ['GetMetadata'], failedMethods: [] }
        },
        linkStatus: null,
        requestedItemId: id,
        schemaHash: 'schema-project-inspector'
      }, 'media.clip_inspect.v1')
    });
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'media', itemId: id, view: 'link_status' },
      result: protectedInspectResult({
        target: 'media',
        observedAt: 104,
        inventory: null,
        clip: null,
        linkStatus: {
          readerId: 'media.link_status.v1',
          itemLookup: 'found',
          methodEvidence: {
            mediaPool: { probed: true },
            mediaPoolItem: { probed: true }
          },
          capabilities: [
            { id: 'relink', surface: 'observed' },
            { id: 'unlink', surface: 'observed' },
            { id: 'linkProxy', surface: 'observed' },
            { id: 'unlinkProxy', surface: 'observed' },
            { id: 'linkFullResolution', surface: 'observed' }
          ]
        },
        requestedItemId: id,
        schemaHash: 'schema-project-inspector'
      }, 'media.link_status.v1')
    });
  };
  inspectClip('clip-exact-a', 'Clip A', true);
  inspectClip('clip-exact-b', 'Clip B', true);
  return world;
}

function editInspectorWorld(): AgentWorldModel {
  const world = projectInspectorWorld();
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'edit' },
    result: protectedInspectResult({
      target: 'edit',
      observedAt: 102,
      summary: {
        readerId: 'edit.timeline_summary.v1',
        timeline: {
          id: 'timeline-exact-1',
          name: 'Main Cut',
          startFrame: 0,
          endFrame: 239,
          durationFrames: 240,
          startTimecode: '01:00:00:00',
          frameRate: 24
        },
        trackCounts: { video: 1, audio: 1, subtitle: 0 },
        timelineItemCountObserved: 2,
        itemsScannedForSourceState: 2,
        markerCount: 0,
        subtitleItemCount: 0,
        offlineSourceItemCountObserved: 0,
        onlineStateUnverifiedItemCountObserved: 0,
        itemsWithoutMediaPoolReferenceCountObserved: 2,
        tracks: [
          {
            type: 'video', index: 1, name: 'V1', enabled: true, locked: false, itemCount: 2,
            offlineSourceItemCountObserved: 0, onlineStateUnverifiedItemCountObserved: 0,
            itemsWithoutMediaPoolReferenceCountObserved: 2
          }
        ],
        complete: true,
        tracksTruncated: false,
        sourceStateScanTruncated: false,
        unverified: []
      },
      schemaHash: 'schema-project-inspector'
    }, 'edit.timeline_summary.v1')
  });
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'edit', view: 'structure' },
    result: protectedInspectResult({
      target: 'edit',
      observedAt: 103,
      structure: {
        readerId: 'edit.structure_inspect.v1',
        timeline: { id: 'timeline-exact-1', name: 'Main Cut', startFrame: 0, endFrame: 239 },
        tracksObserved: 1,
        itemsObserved: 2,
        tracksTruncated: false,
        itemsTruncated: false,
        methodEvidence: {
          strategy: 'dir',
          checkedMethods: ['GetUniqueId', 'GetName', 'GetStart'],
          fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetStart'],
          missingMethods: [],
          failedMethods: [],
          itemsProbed: 2
        },
        tracks: [{
          type: 'video', index: 1, name: 'V1', enabled: true, locked: false,
          items: [
            {
              id: 'timeline-item-exact-a', name: 'Edit A', recordStart: 0, recordEnd: 99, duration: 100,
              sourceStart: 10, sourceEnd: 109, leftOffset: null, rightOffset: null,
              mediaPoolItemId: null, recordRangeConsistent: true
            },
            {
              id: 'timeline-item-exact-b', name: 'Edit B', recordStart: 100, recordEnd: 239, duration: 140,
              sourceStart: 20, sourceEnd: 159, leftOffset: null, rightOffset: null,
              mediaPoolItemId: null, recordRangeConsistent: true
            }
          ]
        }],
        unverified: []
      },
      schemaHash: 'schema-project-inspector'
    }, 'edit.structure_inspect.v1')
  });
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'edit', view: 'gaps_overlaps' },
    result: protectedInspectResult({
      target: 'edit',
      observedAt: 104,
      gapsOverlaps: {
        readerId: 'edit.gaps_overlaps.v1',
        timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
        tracksObserved: 1,
        itemsObserved: 2,
        adjacentPairsObserved: 1,
        comparablePairsObserved: 1,
        unverifiedTrackCount: 0,
        gapCountObserved: 1,
        overlapCountObserved: 0,
        boundaryAmbiguousCountObserved: 0,
        complete: true,
        methodEvidence: {
          sourceReaderId: 'edit.structure_inspect.v1',
          requiredMethods: ['GetUniqueId', 'GetName', 'GetStart', 'GetEnd'],
          fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetStart', 'GetEnd'],
          missingMethods: [], failedMethods: []
        },
        relationships: [{
          kind: 'gap', trackType: 'video', trackIndex: 1, trackName: 'V1',
          leftItem: { id: 'timeline-item-exact-a', name: 'Edit A', recordStart: 0, recordEnd: 99 },
          rightItem: { id: 'timeline-item-exact-b', name: 'Edit B', recordStart: 110, recordEnd: 239 },
          boundaryDelta: 11
        }],
        unverified: []
      },
      schemaHash: 'schema-project-inspector'
    }, 'edit.gaps_overlaps.v1')
  });
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'edit', view: 'source_ranges' },
    result: protectedInspectResult({
      target: 'edit',
      observedAt: 105,
      sourceRanges: {
        readerId: 'edit.source_range_report.v1',
        timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
        tracksObserved: 1,
        itemsObserved: 2,
        itemsReported: 2,
        itemsWithMediaPoolReference: 1,
        itemsWithoutMediaPoolReference: 1,
        itemsWithCompleteRecordGetterValues: 2,
        itemsWithCompleteSourceGetterValues: 2,
        complete: true,
        methodEvidence: {
          sourceReaderId: 'edit.structure_inspect.v1',
          requiredMethods: ['GetUniqueId', 'GetName', 'GetStart', 'GetEnd', 'GetDuration', 'GetSourceStartFrame', 'GetSourceEndFrame', 'GetMediaPoolItem'],
          fullyObservedMethods: ['GetUniqueId', 'GetName'], missingMethods: [], failedMethods: []
        },
        items: [
          {
            trackType: 'video', trackIndex: 1, trackName: 'V1', timelineItemId: 'timeline-item-exact-a', name: 'Edit A',
            mediaPoolItemId: 'media-item-exact-a', recordStartGetterValue: 0, recordEndGetterValue: 99,
            durationGetterValue: 100, sourceStartFrameGetterValue: 10, sourceEndFrameGetterValue: 109,
            recordRangeArithmeticConsistent: true
          },
          {
            trackType: 'video', trackIndex: 1, trackName: 'V1', timelineItemId: 'timeline-item-exact-b', name: 'Edit B',
            mediaPoolItemId: null, recordStartGetterValue: 110, recordEndGetterValue: 239,
            durationGetterValue: 130, sourceStartFrameGetterValue: 20, sourceEndFrameGetterValue: 149,
            recordRangeArithmeticConsistent: true
          }
        ],
        unverified: []
      },
      schemaHash: 'schema-project-inspector'
    }, 'edit.source_range_report.v1')
  });
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'edit', view: 'transitions' },
    result: protectedInspectResult({
      target: 'edit',
      observedAt: 106,
      transitions: {
        readerId: 'edit.transition_inspect.v1',
        timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
        tracksObserved: 1,
        itemsObserved: 2,
        itemsReported: 2,
        tracksTruncated: false,
        itemsTruncated: false,
        getFadesReadbackObservedCount: 2,
        getFadesReadbackFailureCount: 0,
        getFadesUnavailableCount: 0,
        complete: true,
        methodEvidence: {
          strategy: 'dir', checkedMethods: ['AddTransition', 'GetFades', 'SetFades'],
          fullyObservedMethods: ['AddTransition', 'GetFades', 'SetFades'], missingMethods: [], failedReadMethods: [], itemsProbed: 2
        },
        items: [
          { trackType: 'video', trackIndex: 1, trackName: 'V1', timelineItemId: 'timeline-item-exact-a', name: 'Edit A', fadeInGetterValue: 0, fadeOutGetterValue: 12, getFadesReadback: 'observed' },
          { trackType: 'video', trackIndex: 1, trackName: 'V1', timelineItemId: 'timeline-item-exact-b', name: 'Edit B', fadeInGetterValue: 12, fadeOutGetterValue: 0, getFadesReadback: 'observed' }
        ],
        unverified: []
      },
      schemaHash: 'schema-project-inspector'
    }, 'edit.transition_inspect.v1')
  });
  world.observe({
    context: { caller: 'local_ui' },
    name: 'inspect',
    args: { target: 'edit', view: 'annotations' },
    result: protectedInspectResult({
      target: 'edit',
      observedAt: 107,
      annotations: {
        readerId: 'edit.review_annotations_inspect.v1',
        timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
        tracksObserved: 1,
        itemsObserved: 2,
        mediaPoolItemsObserved: 1,
        timelineMarkerCountObserved: 1,
        timelineItemMarkerCountObserved: 1,
        mediaPoolMarkerCountObserved: 1,
        flaggedMediaPoolItemCountObserved: 1,
        coloredMediaPoolItemCountObserved: 1,
        tracksTruncated: false,
        itemsTruncated: false,
        markerRowsTruncated: false,
        complete: true,
        methodEvidence: {
          strategy: 'dir',
          timeline: { checkedMethods: ['GetMarkers'], observedMethods: ['GetMarkers'], missingMethods: [], failedMethods: [] },
          timelineItem: { checkedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetMediaPoolItem'], fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetMediaPoolItem'], missingMethods: [], failedMethods: [], itemsProbed: 2 },
          mediaPoolItem: { checkedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor'], fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor'], missingMethods: [], failedMethods: [], itemsProbed: 1 }
        },
        markers: [
          { scope: 'timeline', targetId: 'timeline-exact-1', targetName: 'Main Cut', trackType: null, trackIndex: null, frame: 12, color: 'Blue', duration: 1, name: 'Timeline note', note: null, customData: null },
          { scope: 'timeline_item', targetId: 'timeline-item-exact-a', targetName: 'Edit A', trackType: 'video', trackIndex: 1, frame: 24, color: 'Yellow', duration: 1, name: 'Item note', note: 'Check', customData: null },
          { scope: 'media_pool_item', targetId: 'media-item-exact-a', targetName: 'Source A', trackType: null, trackIndex: null, frame: 36, color: 'Green', duration: 1, name: 'Source note', note: null, customData: null }
        ],
        mediaPoolAnnotations: [{ mediaPoolItemId: 'media-item-exact-a', name: 'Source A', flags: ['Good Take'], flagsTruncated: false, clipColor: 'Blue', markerCountObserved: 1 }],
        unverified: []
      },
      view: 'annotations',
      schemaHash: 'schema-project-inspector'
    }, 'edit.review_annotations_inspect.v1')
  });
  return world;
}

function spine(online = true): AgentSystemSpineProjection {
  const action = offer();
  return {
    sessionId: 'session-current',
    turnId: 'turn-current',
    workspace: {
      workspaceId: 'workspace-current',
      projectHandle: online ? 'P1' : null,
      projectLabel: 'Documentary',
      online,
      freshness: online ? 'fresh' : 'offline',
      bindingStatus: 'bound'
    },
    decision: {
      schemaVersion: 1,
      sessionId: 'session-current',
      turnId: 'turn-current',
      compiledAt: 100,
      generation: 3,
      provenanceRevision: 9,
      decisionKind: 'observe',
      goalCriterion: 'Inspect the interview clip.',
      openObligation: 'Inspect the interview clip.',
      completionGap: 'Qualified clip evidence is required.',
      materialUncertainty: null,
      minimumFacts: [],
      evidenceRefs: [evidence()],
      staleDependencies: [],
      sharedFocus: { entity: clip, source: 'agent', setAt: 100 },
      actionOffers: [action],
      riskHints: [],
      costHints: [],
      workspace: null
    },
    actionOffers: [action],
    completion: {
      schemaVersion: 1,
      sessionId: 'session-current',
      evaluatedAt: 100,
      generation: 3,
      complete: false,
      criteria: [],
      blockers: online ? [] : ['Resolve is offline.'],
      materialUnknowns: [],
      evidenceIds: ['E-media'],
      strongestVerification: 'API_READBACK'
    }
  };
}

function plan(projectId: string, timelineId: string): WorkflowPlanProjection {
  return {
    plan: {
      plan_id: `plan-${projectId}-${timelineId}`,
      plan_hash: 'a'.repeat(64),
      hash_algorithm: 'sha256',
      canonicalization_version: '1',
      plan_kind: 'review_marker_add',
      workflow_id: 'edit.review_marker_add.v1',
      workflow_version: '1',
      created_at: '2026-09-12T00:00:00.000Z',
      expires_at: '2026-09-13T00:00:00.000Z',
      resolve_version: '21.1',
      project_unique_id: projectId,
      timeline_unique_id: timelineId,
      target_ids: ['item-exact-1'],
      input_fingerprint: 'fingerprint',
      requested_parameters: { target: 'current_video_item', frameOffset: 12, color: 'Yellow', name: 'Review', note: 'Check', duration: 1 },
      proposed_changes: [{
        kind: 'add_review_marker', target_item_id: 'item-exact-1', frame_offset: 12, color: 'Yellow', name: 'Review', note: 'Check', duration: 1, custom_data: 'cid:test'
      }],
      preconditions: {
        target_item_id: 'item-exact-1', track_type: 'video', track_index: 1, track_locked: false,
        item_start: 0, item_end: 100, item_duration: 100, marker_frame_empty: true, marker_state_hash: 'hash'
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
      changeset_id: `changeset-${projectId}-${timelineId}`,
      plan_id: `plan-${projectId}-${timelineId}`,
      workflow_id: 'edit.review_marker_add.v1',
      state: 'proposed',
      project_unique_id: projectId,
      timeline_unique_id: timelineId,
      target_ids: ['item-exact-1'],
      expected_changes: [{
        kind: 'add_review_marker', target_item_id: 'item-exact-1', frame_offset: 12, color: 'Yellow', name: 'Review', note: 'Check', duration: 1, custom_data: 'cid:test'
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

function policyProjection(suggestedArtifactId: string): AgentArtifactWorkspaceProjection {
  return deriveArtifactWorkspaceProjection({
    spine: spine(),
    situation: situation({ sharedFocus: suggestedArtifactId === 'M1'
      ? { entity: clip, source: 'agent', setAt: 100 }
      : { entity: timelineItem, source: 'agent', setAt: 100 } }),
    workspaceProjectIdentity: 'project-exact-1',
    workspaceTimelineIdentity: 'timeline-exact-1'
  });
}

describe('Artifact Workspace foundation', () => {
  it('keeps Active Artifact, Pin and lens selection presentation-only while soft-follow yields to user inspection', () => {
    const first = policyProjection('M1');
    let state = reconcileArtifactWorkspacePresentation(createArtifactWorkspacePresentationState(), first, 1_000);
    expect(state.activeArtifactId).toBe('M1');

    state = selectArtifactForInspection(state, first, 'T1', 1_000);
    expect(state.activeArtifactId).toBe('T1');
    state = reconcileArtifactWorkspacePresentation(state, first, 1_001);
    expect(state.activeArtifactId).toBe('T1');
    state = reconcileArtifactWorkspacePresentation(state, first, 1_000 + ARTIFACT_MANUAL_INSPECTION_HOLD_MS + 1);
    expect(state.activeArtifactId).toBe('T1');

    const changedTarget = policyProjection('I1');
    state = reconcileArtifactWorkspacePresentation(state, changedTarget, 1_000 + ARTIFACT_MANUAL_INSPECTION_HOLD_MS + 2);
    expect(state.activeArtifactId).toBe('I1');

    const noSuggestedTarget = structuredClone(first);
    noSuggestedTarget.suggestedArtifactId = null;
    state = selectArtifactForInspection(state, noSuggestedTarget, 'T1', 10_000);
    expect(state).toMatchObject({ activeArtifactId: 'T1', manualInspectionActive: true, manualBaselineSuggestedArtifactId: null });
    state = reconcileArtifactWorkspacePresentation(state, first, 10_001);
    expect(state.activeArtifactId).toBe('T1');
    state = reconcileArtifactWorkspacePresentation(state, first, 10_000 + ARTIFACT_MANUAL_INSPECTION_HOLD_MS + 1);
    expect(state.activeArtifactId).toBe('M1');

    state = selectArtifactForInspection(state, changedTarget, 'T1', 20_000);
    state = setArtifactPin(state, true);
    state = reconcileArtifactWorkspacePresentation(state, first, 20_000 + ARTIFACT_MANUAL_INSPECTION_HOLD_MS + 1);
    expect(state).toMatchObject({ activeArtifactId: 'T1', pinned: true });
    expect(selectArtifactLens(state, first, 'media').selectedLens).not.toBe('media');
    expect(selectArtifactLens(state, first, 'edit').selectedLens).toBe('edit');

    const sameHandlesNextGeneration = structuredClone(first);
    sameHandlesNextGeneration.generation += 1;
    if (sameHandlesNextGeneration.context.project) sameHandlesNextGeneration.context.project.generation += 1;
    if (sameHandlesNextGeneration.context.timeline) sameHandlesNextGeneration.context.timeline.generation += 1;
    expect(artifactWorkspaceSemanticScope(sameHandlesNextGeneration)).not.toBe(artifactWorkspaceSemanticScope(first));
    expect(artifactWorkspaceSemanticScope(structuredClone(first))).toBe(artifactWorkspaceSemanticScope(first));

    expect(first.context.sharedFocus?.entity.handle).toBe('M1');
    expect(first.context.decisionKind).toBe('observe');
    const policySource = readFileSync(new URL('../src/renderer/artifact-workspace-policy.ts', import.meta.url), 'utf8');
    expect(policySource).not.toMatch(/ToolKernel|ResolveBroker|setAgentFocus|ipcRenderer|execute\(/);
    expect(policySource).toContain('String(projection.generation)');
    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const selectBlock = renderer.split("$<HTMLSelectElement>('artifactSelect').addEventListener")[1]?.split("$<HTMLButtonElement>('artifactPin')")[0] ?? '';
    expect(selectBlock).toContain('selectArtifactForInspection');
    expect(selectBlock).not.toMatch(/setWorkspaceFocus|setAgentFocus|executeWorkflowPlan|probeResolve|selectDavinciDomain|refreshActiveLensIfNeeded|inspectWorkflow|inspectMedia|inspectEdit|inspectFusion|inspectColor|inspectFairlight/);
    const lensBlock = renderer.split('function selectArtifactLens(')[1]?.split("window.addEventListener('resize'")[0] ?? '';
    expect(lensBlock).not.toMatch(/refreshActiveLensIfNeeded|inspectWorkflow|inspectMedia|inspectEdit|inspectFusion|inspectColor|inspectFairlight/);
    expect(renderer).not.toContain('refreshActiveLensIfNeeded');
    const appViewBlock = renderer.split('function selectAppView(view: AppView)')[1]?.split('function selectArtifactLens(')[0] ?? '';
    expect(appViewBlock).not.toMatch(/refreshWorkflowPanel|inspectWorkflow|inspectMedia|inspectEdit|inspectFusion|inspectColor|inspectFairlight/);
    expect((renderer.match(/refreshWorkflowPanel\(\)/g) ?? [])).toHaveLength(2);
    expect(renderer).not.toContain("$<HTMLButtonElement>('artifactReveal').addEventListener");
    expect((renderer.match(/setWorkspaceFocus\(/g) ?? [])).toHaveLength(2);
    expect(renderer).not.toContain('bindSharedFocusRow');
    expect(renderer).toContain("artifact.source === 'cached_projection'");
    expect(renderer).toContain('approve.disabled = !state?.gateway.active;');
  });

  it('derives a bounded current projection, filters Plans by exact Workspace/Timeline and fails protected actions closed offline', () => {
    const plans = [
      plan('project-exact-1', 'timeline-exact-1'),
      plan('project-other', 'timeline-exact-1'),
      plan('project-exact-1', 'timeline-other')
    ];
    const current = deriveArtifactWorkspaceProjection({
      spine: spine(),
      situation: situation(),
      plans,
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1',
      resolvePlanTarget: (exactId) => exactId === 'item-exact-1' ? timelineItem : null
    });
    expect(current).toMatchObject({
      sessionId: 'session-current', turnId: 'turn-current', suggestedArtifactId: 'M1', protectedResolveActionsBlocked: false
    });
    expect(current.plans).toHaveLength(1);
    expect(current.plans[0]).toMatchObject({
      targetHandle: 'I1', approvalState: 'awaiting', authority: 'current',
      proposedChanges: [{ kind: 'add_review_marker', name: 'Review', frameOffset: 12 }],
      changeSet: { state: 'proposed', verificationStatus: 'unverified', actualMarkerPresent: null, backupAvailable: false }
    });
    expect(JSON.stringify(current.plans[0]?.changeSet)).not.toContain('item-exact-1');
    const media = current.artifacts.find((artifact) => artifact.artifactId === 'M1');
    expect(media).toMatchObject({ kind: 'media_item', focusRelationship: 'shared_focus' });
    expect(media?.evidenceRefs.map((item) => item.id)).toEqual(['E-media']);
    expect(media?.summaryFacts.map((item) => item.key)).toEqual(['focus.media.proxy']);
    expect(media?.actionOffers.map((item) => item.capabilityId)).toEqual(['media.item.inspect']);
    expect(media?.lenses.find((lens) => lens.id === 'media')?.availability).toBe('available');
    expect(media?.lenses.find((lens) => lens.id === 'color')?.availability).toBe('unavailable');

    expect(() => deriveArtifactWorkspaceProjection({
      spine: spine(),
      situation: situation({ revision: 10 })
    })).toThrow(/current World Model revision/);

    const offline = deriveArtifactWorkspaceProjection({
      spine: spine(false),
      situation: situation({ project: null }),
      cachedSituation: situation(),
      plans: [plans[0]!, plan('project-exact-1', 'timeline-other')],
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(offline.protectedResolveActionsBlocked).toBe(true);
    expect(offline.workspace?.freshness).toBe('offline');
    expect(offline.artifacts.some((artifact) => artifact.kind === 'project' && artifact.source === 'cached_projection')).toBe(true);
    expect(offline.plans).toHaveLength(1);
    expect(offline.plans[0]).toMatchObject({
      authority: 'cached_read_only', targetHandle: null,
      changeSet: { state: 'proposed', verificationStatus: 'unverified' }
    });
    const cachedWithCollidingCurrentTarget = deriveArtifactWorkspaceProjection({
      spine: spine(false),
      situation: situation({ project: null }),
      cachedSituation: situation(),
      plans: [plans[0]!],
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1',
      resolvePlanTarget: () => ({ ...timelineItem, handle: 'I-CURRENT-COLLISION', generation: 99 })
    });
    expect(cachedWithCollidingCurrentTarget.plans[0]).toMatchObject({ authority: 'cached_read_only', targetHandle: null });
    expect(offline.artifacts.flatMap((artifact) => artifact.evidenceRefs).map((item) => item.id)).toContain('E-media');
    expect(offline.context.blockers).toContain('Resolve is offline.');

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('artifactWorkspaceSemanticScope(previousArtifactWorkspace) !== artifactWorkspaceSemanticScope(nextArtifactWorkspace)');
    expect(renderer).toContain('resetLegacyDomainSnapshots();');
    expect((renderer.match(/reconcileLegacyDomainObservation\(scope\)/g) ?? []).length).toBeGreaterThanOrEqual(7);
    const reconcileBlock = renderer.split('async function reconcileLegacyDomainObservation(scope: string)')[1]?.split('function renderPanelControlIcon')[0] ?? '';
    expect(reconcileBlock).toContain('if (!await refreshAgentSituation()) return false;');
    const situationRefreshBlock = renderer.split('async function refreshAgentSituation(): Promise<boolean>')[1]?.split('async function setWorkspaceFocus')[0] ?? '';
    expect(situationRefreshBlock).toContain('if (!reply.ok) return false;');
    expect(situationRefreshBlock).toContain('canonicalArtifactRefreshed = true;');
    expect(situationRefreshBlock).toContain('return canonicalArtifactRefreshed;');
    const mediaRefresh = renderer.split('async function refreshMediaPanel()')[1]?.split('async function refreshMediaClip')[0] ?? '';
    expect(mediaRefresh.indexOf('await reconcileLegacyDomainObservation(scope)')).toBeGreaterThan(-1);
    expect(mediaRefresh).not.toMatch(/workflowMedia\w*\s*=/);
    const colorRefresh = renderer.split('async function refreshColorPanel()')[1]?.split('async function refreshFusionPanel')[0] ?? '';
    expect(colorRefresh.indexOf('await reconcileLegacyDomainObservation(scope)')).toBeGreaterThan(-1);
    expect(colorRefresh).not.toMatch(/workflowColor\w*\s*=/);

    const source = readFileSync(new URL('../src/main/artifact-workspace.ts', import.meta.url), 'utf8');
    expect(source).toContain('getRecentWorkflowPlansForScope({');
    expect(source).not.toContain('getRecentWorkflowPlans(8)');
  });

  it('projects Project Inspector from World Model observation and leaves protected reader replies out of renderer state', () => {
    const world = projectInspectorWorld();
    const observedSituation = world.situation();
    const inspector = world.projectInspectorDetail();
    expect(observedSituation.facts.some((fact) => fact.key.startsWith('project.inspector.'))).toBe(false);
    expect(inspector).toMatchObject({
      settings: {
        timelineFrameRate: 24,
        colorScienceMode: 'DaVinci YRGB Color Managed',
        timelineUsesCustomSettings: false
      },
      preflight: {
        status: 'warning',
        projectLabel: 'Documentary',
        timelineLabel: 'Main Cut'
      }
    });
    const observedSpine = spine();
    observedSpine.decision.generation = observedSituation.generation;
    observedSpine.decision.provenanceRevision = observedSituation.revision;
    observedSpine.completion.generation = observedSituation.generation;
    const current = deriveArtifactWorkspaceProjection({
      spine: observedSpine,
      situation: observedSituation,
      projectInspector: inspector,
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    const projectArtifact = current.artifacts.find((artifact) => artifact.kind === 'project');
    expect(projectArtifact?.projectInspector).toMatchObject({
      settings: {
        timelineFrameRate: 24,
        colorScienceMode: 'DaVinci YRGB Color Managed',
        timelineUsesCustomSettings: false
      },
      preflight: {
        status: 'warning',
        projectLabel: 'Documentary',
        timelineLabel: 'Main Cut'
      }
    });
    expect(JSON.stringify(projectArtifact?.projectInspector)).not.toContain('project-exact-1');
    expect(JSON.stringify(projectArtifact?.projectInspector)).not.toContain('timeline-exact-1');
    expect(projectArtifact?.summaryFacts.some((fact) => fact.key.startsWith('project.inspector.'))).toBe(false);

    const historicalGeneration = observedSituation.generation;
    world.invalidate('Project inspector offline test');
    const offlineSituation = world.situation();
    const cachedSituation = world.historicalSituationForProject('project-exact-1', historicalGeneration);
    const cachedInspector = world.historicalProjectInspectorForProject('project-exact-1', historicalGeneration);
    expect(world.projectInspectorDetail()).toBeNull();
    expect(cachedInspector).toMatchObject({ preflight: { status: 'warning' } });
    const offlineSpine = spine(false);
    offlineSpine.decision.generation = offlineSituation.generation;
    offlineSpine.decision.provenanceRevision = offlineSituation.revision;
    offlineSpine.completion.generation = offlineSituation.generation;
    const offline = deriveArtifactWorkspaceProjection({
      spine: offlineSpine,
      situation: offlineSituation,
      cachedSituation,
      cachedProjectInspector: cachedInspector,
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(offline.artifacts.find((artifact) => artifact.kind === 'project')).toMatchObject({
      source: 'cached_projection',
      projectInspector: { preflight: { status: 'warning' } }
    });

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/\bworkflowProject\b/);
    expect(renderer).not.toMatch(/\bworkflowPreflight\b/);
    const refreshBlock = renderer.split('async function refreshWorkflowPanel()')[1]?.split('async function refreshMediaPanel()')[0] ?? '';
    expect(refreshBlock).toContain("api.inspectWorkflow('project')");
    expect(refreshBlock).toContain("api.inspectWorkflow('preflight')");
    expect(refreshBlock).toContain('await refreshAgentSituation();');
    expect(refreshBlock).not.toMatch(/workflowProject\s*=|workflowPreflight\s*=/);
    expect(renderer).toContain("projectInspectorDetail()?.settings");
    expect(renderer).toContain("projectInspectorDetail()?.preflight");

    const worldModel = readFileSync(new URL('../src/main/agent-world-model.ts', import.meta.url), 'utf8');
    expect(worldModel).not.toContain("this.setFact(changed, 'project.inspector.");
    expect(worldModel).toContain('projectInspectorSettings =');
    expect(worldModel).toContain('projectInspectorPreflight =');
  });

  it('projects Media aggregate and item inspectors canonically across item switches, same-scope updates and offline history', () => {
    const world = mediaInspectorWorld();
    const observedSituation = world.situation();
    const observedSpine = spine();
    observedSpine.decision.generation = observedSituation.generation;
    observedSpine.decision.provenanceRevision = observedSituation.revision;
    observedSpine.completion.generation = observedSituation.generation;
    const current = deriveArtifactWorkspaceProjection({
      spine: observedSpine,
      situation: observedSituation,
      mediaInspector: world.mediaInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    const pool = current.artifacts.find((artifact) => artifact.kind === 'media_pool');
    const itemA = current.artifacts.find((artifact) => artifact.semanticHandle === 'M1');
    const itemB = current.artifacts.find((artifact) => artifact.semanticHandle === 'M2');
    expect(pool?.mediaInspector?.inventory).toMatchObject({
      itemsObserved: 2,
      offlineCountObserved: 0,
      items: [
        { semanticHandle: 'M1', name: 'Clip A' },
        { semanticHandle: 'M2', name: 'Clip B' }
      ]
    });
    expect(itemA?.mediaInspector?.clip?.item).toMatchObject({ semanticHandle: 'M1', name: 'Clip A', online: true });
    expect(itemB?.mediaInspector?.clip?.item).toMatchObject({ semanticHandle: 'M2', name: 'Clip B', online: true });
    expect(itemA?.mediaInspector?.linkStatus).toMatchObject({ scope: 'item', itemHandle: 'M1' });
    expect(JSON.stringify(current.artifacts)).not.toContain('clip-exact-a');
    expect(JSON.stringify(current.artifacts)).not.toContain('clip-exact-b');
    expect(JSON.stringify(current.artifacts)).not.toContain('folder-exact-1');

    let presentation = reconcileArtifactWorkspacePresentation(createArtifactWorkspacePresentationState(), current, 1_000);
    presentation = selectArtifactForInspection(presentation, current, 'M1', 1_001);
    presentation = selectArtifactLens(presentation, current, 'media', 1_002);
    presentation = selectArtifactLens(presentation, current, 'summary', 1_003);
    presentation = selectArtifactLens(presentation, current, 'media', 1_004);
    expect(presentation.activeArtifactId).toBe('M1');
    presentation = selectArtifactForInspection(presentation, current, 'M2', 1_005);
    presentation = selectArtifactForInspection(presentation, current, 'M1', 1_006);
    expect(presentation.activeArtifactId).toBe('M1');
    expect(current.artifacts.find((artifact) => artifact.artifactId === presentation.activeArtifactId)?.mediaInspector?.clip?.item?.name)
      .toBe('Clip A');

    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'media', itemId: 'clip-exact-a' },
      result: protectedInspectResult({
        target: 'media',
        observedAt: 105,
        inventory: null,
        clip: {
          readerId: 'media.clip_inspect.v1',
          lookup: 'found',
          search: { foldersObserved: 1, itemsObserved: 2, truncated: false },
          item: { id: 'clip-exact-a', name: 'Clip A', online: false, hasProxyMedia: false, fps: 24 },
          metadata: [],
          thirdPartyMetadata: [],
          markers: [],
          methodEvidence: { checkedMethods: [], observedMethods: [], failedMethods: [] }
        },
        linkStatus: null,
        requestedItemId: 'clip-exact-a',
        schemaHash: 'schema-project-inspector'
      }, 'media.clip_inspect.v1')
    });
    const updatedSituation = world.situation();
    const updatedSpine = spine();
    updatedSpine.decision.generation = updatedSituation.generation;
    updatedSpine.decision.provenanceRevision = updatedSituation.revision;
    updatedSpine.completion.generation = updatedSituation.generation;
    const updated = deriveArtifactWorkspaceProjection({
      spine: updatedSpine,
      situation: updatedSituation,
      mediaInspector: world.mediaInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(artifactWorkspaceSemanticScope(updated)).toBe(artifactWorkspaceSemanticScope(current));
    expect(updated.artifacts.find((artifact) => artifact.semanticHandle === 'M1')?.mediaInspector?.clip?.item?.online).toBe(false);
    expect(updated.artifacts.find((artifact) => artifact.semanticHandle === 'M2')?.mediaInspector?.clip?.item?.name).toBe('Clip B');

    const historicalGeneration = updatedSituation.generation;
    world.invalidate('Media inspector offline test');
    expect(world.mediaInspectorProjection()).toEqual({ pool: null, items: [] });
    const offlineSituation = world.situation();
    const cachedSituation = world.historicalSituationForProject('project-exact-1', historicalGeneration);
    const cachedMediaInspector = world.historicalMediaInspectorForProject('project-exact-1', historicalGeneration);
    const offlineSpine = spine(false);
    offlineSpine.decision.generation = offlineSituation.generation;
    offlineSpine.decision.provenanceRevision = offlineSituation.revision;
    offlineSpine.completion.generation = offlineSituation.generation;
    const offline = deriveArtifactWorkspaceProjection({
      spine: offlineSpine,
      situation: offlineSituation,
      cachedSituation,
      cachedMediaInspector,
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(offline.artifacts.find((artifact) => artifact.semanticHandle === 'M1')).toMatchObject({
      source: 'cached_projection',
      mediaInspector: { clip: { item: { semanticHandle: 'M1', online: false } } }
    });

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/\bworkflowMedia\b|\bworkflowMediaClip\b|\bworkflowMediaLink\b/);
    const clipRefresh = renderer.split('async function refreshMediaClip')[1]?.split('async function refreshEditPanel')[0] ?? '';
    expect(clipRefresh).toContain('api.inspectMediaClip(handle, generation)');
    expect(clipRefresh).toContain('api.inspectMediaLinkStatus(handle, generation)');
    expect(clipRefresh).toContain('await reconcileLegacyDomainObservation(scope)');
    expect(clipRefresh).not.toMatch(/workflowMedia\w*\s*=/);
    const lensSelection = renderer.split('function selectArtifactLens(lens: AgentArtifactLensId)')[1]?.split("window.addEventListener('resize'")[0] ?? '';
    expect(lensSelection).not.toContain('refreshMedia');
    expect(renderer).not.toContain("mentionAgentEntity('media_pool_item'");
    expect(renderer).toContain('api.setMediaArtifactFocus(artifact.semanticHandle, artifact.generation)');
    expect(renderer).toContain('if (focus) focusedAgentEntity = focus.entity;');
    const emptyWorkspacePaint = renderer.split('if (!projection) {')[1]?.split('return;')[0] ?? '';
    expect(emptyWorkspacePaint).toContain('paintMediaInventory();');
    expect(emptyWorkspacePaint).toContain('paintMediaClip();');
    expect(emptyWorkspacePaint).toContain('paintMediaLinkStatus();');
  });

  it('projects Edit timeline and structure canonically without renderer exact IDs', () => {
    const world = editInspectorWorld();
    const observedSituation = world.situation();
    const observedSpine = spine();
    observedSpine.decision.generation = observedSituation.generation;
    observedSpine.decision.provenanceRevision = observedSituation.revision;
    observedSpine.completion.generation = observedSituation.generation;
    const current = deriveArtifactWorkspaceProjection({
      spine: observedSpine,
      situation: observedSituation,
      editInspector: world.editInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    const timelineArtifact = current.artifacts.find((artifact) => artifact.kind === 'timeline');
    expect(timelineArtifact?.editInspector?.timeline).toMatchObject({
      timeline: { semanticHandle: 'T1', name: 'Main Cut' },
      timelineItemCountObserved: 2
    });
    expect(timelineArtifact?.editInspector?.structure?.tracks[0]?.items).toMatchObject([
      { semanticHandle: 'I1', name: 'Edit A', recordStart: 0 },
      { semanticHandle: 'I2', name: 'Edit B', recordStart: 100 }
    ]);
    expect(timelineArtifact?.editInspector?.gaps?.relationships[0]).toMatchObject({
      kind: 'gap', leftItem: { semanticHandle: 'I1' }, rightItem: { semanticHandle: 'I2' }
    });
    expect(timelineArtifact?.editInspector?.sourceRanges?.items).toMatchObject([
      { semanticHandle: 'I1', name: 'Edit A' },
      { semanticHandle: 'I2', name: 'Edit B' }
    ]);
    expect(timelineArtifact?.editInspector?.transitions).toMatchObject({
      addTransitionSurfaceObserved: true,
      setFadesSurfaceObserved: true,
      items: [{ semanticHandle: 'I1' }, { semanticHandle: 'I2' }]
    });
    expect(timelineArtifact?.editInspector?.annotations).toMatchObject({
      timelineLabel: 'Main Cut',
      markers: [
        { scope: 'timeline', targetHandle: 'T1' },
        { scope: 'timeline_item', targetHandle: 'I1' },
        { scope: 'media_pool_item', targetHandle: 'M1' }
      ],
      mediaPoolAnnotations: [{ semanticHandle: 'M1', name: 'Source A' }]
    });
    expect(JSON.stringify(timelineArtifact?.editInspector)).not.toContain('timeline-exact-1');
    expect(JSON.stringify(timelineArtifact?.editInspector)).not.toContain('timeline-item-exact-a');
    expect(JSON.stringify(timelineArtifact?.editInspector)).not.toContain('timeline-item-exact-b');
    expect(JSON.stringify(timelineArtifact?.editInspector)).not.toContain('media-item-exact-a');

    let presentation = reconcileArtifactWorkspacePresentation(createArtifactWorkspacePresentationState(), current, 1_000);
    presentation = selectArtifactForInspection(presentation, current, 'I1', 1_001);
    presentation = selectArtifactForInspection(presentation, current, 'I2', 1_002);
    presentation = selectArtifactForInspection(presentation, current, 'I1', 1_003);
    presentation = selectArtifactLens(presentation, current, 'edit', 1_004);
    expect(presentation.activeArtifactId).toBe('I1');

    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'edit', view: 'structure' },
      result: protectedInspectResult({
        target: 'edit',
        observedAt: 104,
        structure: {
          readerId: 'edit.structure_inspect.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut', startFrame: 0, endFrame: 239 },
          tracksObserved: 1,
          itemsObserved: 2,
          tracksTruncated: false,
          itemsTruncated: false,
          methodEvidence: {
            strategy: 'dir', checkedMethods: ['GetUniqueId'], fullyObservedMethods: ['GetUniqueId'],
            missingMethods: [], failedMethods: [], itemsProbed: 2
          },
          tracks: [{
            type: 'video', index: 1, name: 'V1', enabled: true, locked: false,
            items: [
              { id: 'timeline-item-exact-a', name: 'Edit A', recordStart: 12, recordEnd: 111, duration: 100, sourceStart: 10, sourceEnd: 109, leftOffset: null, rightOffset: null, mediaPoolItemId: null, recordRangeConsistent: true },
              { id: 'timeline-item-exact-b', name: 'Edit B', recordStart: 112, recordEnd: 239, duration: 128, sourceStart: 20, sourceEnd: 147, leftOffset: null, rightOffset: null, mediaPoolItemId: null, recordRangeConsistent: true }
            ]
          }],
          unverified: []
        },
        schemaHash: 'schema-project-inspector'
      }, 'edit.structure_inspect.v1')
    });
    const updatedSituation = world.situation();
    const updatedSpine = spine();
    updatedSpine.decision.generation = updatedSituation.generation;
    updatedSpine.decision.provenanceRevision = updatedSituation.revision;
    updatedSpine.completion.generation = updatedSituation.generation;
    const updated = deriveArtifactWorkspaceProjection({
      spine: updatedSpine,
      situation: updatedSituation,
      editInspector: world.editInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(artifactWorkspaceSemanticScope(updated)).toBe(artifactWorkspaceSemanticScope(current));
    expect(updated.artifacts.find((artifact) => artifact.kind === 'timeline')?.editInspector?.structure?.tracks[0]?.items[0]?.recordStart).toBe(12);

    const historicalGeneration = updatedSituation.generation;
    world.invalidate('Edit inspector offline test');
    expect(world.editInspectorProjection()).toEqual({
      timeline: null,
      structure: null,
      gaps: null,
      sourceRanges: null,
      transitions: null,
      annotations: null
    });
    const offlineSituation = world.situation();
    const cachedSituation = world.historicalSituationForProject('project-exact-1', historicalGeneration);
    const cachedEditInspector = world.historicalEditInspectorForProject('project-exact-1', historicalGeneration);
    const offlineSpine = spine(false);
    offlineSpine.decision.generation = offlineSituation.generation;
    offlineSpine.decision.provenanceRevision = offlineSituation.revision;
    offlineSpine.completion.generation = offlineSituation.generation;
    const offline = deriveArtifactWorkspaceProjection({
      spine: offlineSpine,
      situation: offlineSituation,
      cachedSituation,
      cachedEditInspector,
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(offline.artifacts.find((artifact) => artifact.kind === 'timeline')).toMatchObject({
      source: 'cached_projection',
      editInspector: {
        structure: { itemsObserved: 2 },
        gaps: { gapCountObserved: 1 },
        transitions: { addTransitionSurfaceObserved: true },
        annotations: { timelineLabel: 'Main Cut' }
      }
    });

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/\bworkflowEdit(?:Structure|Gaps|SourceRanges|Transitions|Annotations)?\b/);
    expect(renderer).not.toContain('selectArtifactByExactEntity');
    expect(renderer).not.toContain('bindArtifactInspectionRow');
    expect(renderer).toContain("editInspectorDetail()?.timeline");
    expect(renderer).toContain("editInspectorDetail()?.structure");
    expect(renderer).toContain("editInspectorDetail()?.gaps");
    expect(renderer).toContain("editInspectorDetail()?.sourceRanges");
    expect(renderer).toContain("editInspectorDetail()?.transitions");
    expect(renderer).toContain("editInspectorDetail()?.annotations");
    const refreshBlock = renderer.split('async function refreshEditPanel()')[1]?.split('async function refreshColorPanel()')[0] ?? '';
    expect(refreshBlock).toContain("api.inspectWorkflow('edit')");
    expect(refreshBlock).toContain('api.inspectEditStructure()');
    expect(refreshBlock).toContain('await reconcileLegacyDomainObservation(scope)');
    expect(refreshBlock).not.toMatch(/workflowEdit\w*\s*=/);
    const lensSelection = renderer.split('function selectArtifactLens(lens: AgentArtifactLensId)')[1]?.split("window.addEventListener('resize'")[0] ?? '';
    expect(lensSelection).not.toContain('refreshEdit');
  });

  it('projects Fairlight and Deliver through canonical bounded inspectors', () => {
    const world = projectInspectorWorld();
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'fairlight' },
      result: protectedInspectResult({
        target: 'fairlight',
        observedAt: 105,
        summary: {
          readerId: 'fairlight.mapping_inspect.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
          audioTrackCount: 1,
          audioItemCountObserved: 1,
          itemsScanned: 1,
          sourceMappingVerifiedItemCount: 1,
          sourceMappingUnverifiedItemCount: 0,
          tracks: [{
            index: 1, name: 'Dialogue', subType: 'stereo', enabled: true, locked: false, itemCount: 1,
            voiceIsolation: { isEnabled: true, amount: 50 },
            sourceMappingVerifiedItemCount: 1, sourceMappingUnverifiedItemCount: 0,
            embeddedAudioChannelCounts: [{ channels: 2, count: 1 }]
          }],
          complete: true,
          tracksTruncated: false,
          itemsTruncated: false,
          unverified: []
        },
        clipProcessing: null,
        schemaHash: 'schema-project-inspector'
      }, 'fairlight.mapping_inspect.v1')
    });
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'fairlight', view: 'audio_processing' },
      result: protectedInspectResult({
        target: 'fairlight',
        observedAt: 106,
        summary: null,
        clipProcessing: {
          readerId: 'fairlight.clip_processing_inspect.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
          audioTrackCount: 1,
          tracksScanned: 1,
          audioItemsObserved: 1,
          itemsScanned: 1,
          tracksTruncated: false,
          itemsTruncated: false,
          items: [{
            trackIndex: 1,
            itemIndex: 1,
            timelineItemId: 'audio-item-exact-1',
            timelineItemName: '',
            propertiesReadback: 'observed',
            missingPropertyKeys: [],
            volumeEnabled: true,
            volumeDb: -2,
            panEnabled: true,
            pan: 0,
            pitchEnabled: false,
            pitchSemitones: 0,
            pitchCents: 0,
            voiceIsolationEnabled: true,
            voiceIsolationAmount: 50,
            dialogueLevelerEnabled: true,
            dialogueLevelerMode: 1,
            dialogueReduceLoud: true,
            dialogueLiftSoft: true,
            dialogueBackgroundReduction: false,
            dialogueOutputGainDb: 0,
            voiceReadback: 'observed',
            voiceState: { isEnabled: true, amount: 50 },
            voiceConsistency: 'matched',
            missingMethods: [],
            failedMethods: []
          }],
          complete: true,
          methodEvidence: {
            checkedMethods: ['GetUniqueId', 'GetName', 'GetProperties', 'GetVoiceIsolationState'],
            fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetProperties', 'GetVoiceIsolationState'],
            missingMethods: [],
            failedMethods: [],
            itemsProbed: 1
          },
          unverified: []
        },
        schemaHash: 'schema-project-inspector'
      }, 'fairlight.clip_processing_inspect.v1')
    });
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'deliver' },
      result: protectedInspectResult({
        target: 'deliver',
        observedAt: 107,
        capabilities: {
          readerId: 'deliver.capability_matrix.v1',
          videoFormatCount: 1,
          videoCodecCountObserved: 1,
          videoFormats: [{ name: 'QuickTime', extension: 'mov', codecCount: 1, codecs: [{ name: 'H.264', id: 'H264' }], codecSampleTruncated: false }],
          audioFormatCount: 1,
          audioCodecCountObserved: 1,
          audioFormats: [{ name: 'Wave', extension: 'wav', codecCount: 1, codecs: [{ name: 'Linear PCM', id: 'pcm_s16' }], codecSampleTruncated: false }],
          generalResolutions: [{ width: 1920, height: 1080 }],
          currentSelection: { format: 'mov', codec: 'H264', resolutionCount: 1, resolutions: [{ width: 1920, height: 1080 }], resolutionsTruncated: false },
          renderPresetCount: 1,
          renderPresets: ['Master'],
          renderPresetsTruncated: false,
          quickExportPresetCount: 1,
          quickExportPresets: ['H.264'],
          quickExportPresetsTruncated: false,
          complete: true,
          formatsTruncated: false,
          codecSamplesTruncated: false,
          resolutionsTruncated: false
        },
        settings: {
          readerId: 'deliver.settings_inspect.v1',
          currentFormat: 'mov',
          currentCodec: 'H264',
          renderMode: 'singleClip',
          renderingInProgress: false,
          renderJobCountObserved: 1,
          renderJobs: [{
            id: 'render-job-exact-1',
            name: null,
            timelineName: 'Main Cut',
            status: 'Ready',
            completionPercentage: null,
            outputResolution: { width: 1920, height: 1080 },
            frameRate: 24,
            exportVideo: true,
            exportAudio: true,
            videoFormat: 'mov',
            videoCodec: 'H264',
            audioCodec: 'pcm_s16',
            renderMode: 'singleClip',
            targetDirectoryConfigured: true,
            outputFilenameConfigured: true
          }],
          jobsTruncated: false,
          unverified: []
        },
        schemaHash: 'schema-project-inspector'
      }, 'deliver.settings_inspect.v1')
    });

    const observedSituation = world.situation();
    const observedSpine = spine();
    observedSpine.decision.generation = observedSituation.generation;
    observedSpine.decision.provenanceRevision = observedSituation.revision;
    observedSpine.completion.generation = observedSituation.generation;
    const current = deriveArtifactWorkspaceProjection({
      spine: observedSpine,
      situation: observedSituation,
      fairlightInspector: world.fairlightInspectorProjection(),
      deliverInspector: world.deliverInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    const fairlight = current.artifacts.find((artifact) => artifact.kind === 'fairlight')?.fairlightInspector;
    const deliver = current.artifacts.find((artifact) => artifact.kind === 'deliver')?.deliverInspector;
    expect(fairlight?.mapping).toMatchObject({ timelineLabel: 'Main Cut', audioTrackCount: 1 });
    expect(fairlight?.processing?.items[0]).toMatchObject({ semanticHandle: 'I1', name: '' });
    expect(deliver?.settings?.jobs[0]).toMatchObject({ semanticHandle: 'R1', name: null });
    expect(deliver?.capabilities?.videoFormats[0]?.codecs).toEqual(['H.264']);
    expect(deliver?.capabilities?.currentSelection).toMatchObject({ format: 'QuickTime', codec: 'H.264' });
    expect(deliver?.settings).toMatchObject({
      currentFormat: 'QuickTime',
      currentCodec: 'H.264',
      jobs: [{ videoFormat: 'QuickTime', videoCodec: 'H.264', audioCodec: 'Linear PCM' }]
    });
    const canonicalJson = JSON.stringify({ fairlight, deliver });
    expect(canonicalJson).not.toContain('audio-item-exact-1');
    expect(canonicalJson).not.toContain('render-job-exact-1');
    expect(canonicalJson).not.toContain('H264');
    expect(canonicalJson).not.toContain('pcm_s16');
    expect(JSON.stringify(current)).not.toContain('render-job-exact-1');
    expect(JSON.stringify(current)).not.toContain('audio-item-exact-1');
    expect(current.artifacts.find((artifact) => artifact.semanticHandle === 'I1')?.label).toBe('Timeline Item');
    const agentProjectedDeliver = world.projectToolResult(protectedInspectResult({
      target: 'deliver',
      capabilities: { currentSelection: { format: 'mov', codec: 'H264' } },
      settings: { renderJobs: [{ id: 'render-job-exact-1' }] },
      schemaHash: 'schema-project-inspector'
    }, 'deliver.settings_inspect.v1'));
    expect(agentProjectedDeliver).toContain('H.264');
    expect(agentProjectedDeliver).not.toContain('H264');
    expect(agentProjectedDeliver).not.toContain('render-job-exact-1');

    const historicalGeneration = observedSituation.generation;
    world.invalidate('Fairlight/Deliver offline test');
    const offlineSituation = world.situation();
    const offlineSpine = spine(false);
    offlineSpine.decision.generation = offlineSituation.generation;
    offlineSpine.decision.provenanceRevision = offlineSituation.revision;
    offlineSpine.completion.generation = offlineSituation.generation;
    const offline = deriveArtifactWorkspaceProjection({
      spine: offlineSpine,
      situation: offlineSituation,
      cachedSituation: world.historicalSituationForProject('project-exact-1', historicalGeneration),
      cachedFairlightInspector: world.historicalFairlightInspectorForProject('project-exact-1', historicalGeneration),
      cachedDeliverInspector: world.historicalDeliverInspectorForProject('project-exact-1', historicalGeneration),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(offline.artifacts.find((artifact) => artifact.kind === 'fairlight')).toMatchObject({
      source: 'cached_projection',
      fairlightInspector: { processing: { items: [{ semanticHandle: 'I1' }] } }
    });
    expect(offline.artifacts.find((artifact) => artifact.kind === 'deliver')).toMatchObject({
      source: 'cached_projection',
      deliverInspector: { settings: { jobs: [{ semanticHandle: 'R1' }] } }
    });

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../src/preload/index.ts', import.meta.url), 'utf8');
    const ipc = readFileSync(new URL('../src/main/ipc.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/\bworkflowFairlight(?:Processing)?\b|\bworkflowDeliver\b/);
    expect(renderer).not.toContain('api.resolveAgentEntity(');
    expect(renderer).not.toContain('.exactId');
    expect(preload).toContain("call<WorkflowInspectResult | RendererWorkflowObservationReceipt>('workflow:inspect'");
    expect(preload).toContain("call<RendererWorkflowObservationReceipt>('workflow:fusion-graph')");
    expect(preload).toContain("call<RendererWorkflowObservationReceipt>('workflow:color-graph')");
    expect(preload).toContain("call<RendererWorkflowObservationReceipt>('workflow:color-versions')");
    expect(preload).toContain("call<RendererWorkflowObservationReceipt>('workflow:fairlight-processing')");
    expect(preload).not.toContain('AgentEntityRef');
    expect(ipc).toContain("target === 'fusion' || target === 'color' || target === 'fairlight' || target === 'deliver'");
    expect(ipc).toContain('rendererObservationReceipt(await inspectResolveWorkflow');
    expect(ipc).not.toContain("ipcMain.handle('agent:entity:resolve'");
    expect(ipc).not.toContain("ipcMain.handle('agent:focus:set'");
    expect(ipc).toContain("ipcMain.handle('agent:focus:timeline-artifact'");
    const fairlightPaint = renderer.split('function paintFairlightMapping()')[1]?.split('function paintDeliver()')[0] ?? '';
    expect(fairlightPaint).not.toContain('timelineItemId');
    expect(fairlightPaint).toContain('item.semanticHandle');
    const deliverPaint = renderer.split('function paintDeliver()')[1]?.split('function paintWorkflow(')[0] ?? '';
    expect(deliverPaint).not.toContain('job.id');
    expect(deliverPaint).toContain('job.semanticHandle');
  });

  it('projects Color graph and version identities only as semantic handles', () => {
    const world = projectInspectorWorld();
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'color' },
      result: protectedInspectResult({
        target: 'color',
        observedAt: 105,
        view: 'pipeline',
        summary: {
          readerId: 'color.pipeline_inspect.v1',
          settings: null,
          colorGroupCount: 0,
          colorGroups: [],
          videoItemCountObserved: 1,
          videoItemsScanned: 1,
          groupedItemCountObserved: 0,
          nodeCountObserved: 1,
          lutReferenceCountObserved: 0,
          items: [{
            id: 'color-item-exact-1',
            name: 'Color Clip',
            nodeCount: 1,
            groupName: null,
            currentVersionName: 'Version 1',
            currentVersionType: 0,
            localVersionCount: 1,
            remoteVersionCount: 0,
            lutReferenceCount: 0
          }],
          complete: true,
          itemsTruncated: false,
          nodesTruncated: false,
          unverified: []
        },
        graph: null,
        versions: null,
        schemaHash: 'schema-project-inspector'
      }, 'color.pipeline_inspect.v1')
    });
    const node = {
      index: 1,
      label: 'Primary',
      lutReferencePresent: false,
      cacheMode: null,
      cacheModeShape: 'null',
      toolNames: [],
      toolListShape: 'null',
      toolsTruncated: false
    } as const;
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'color', view: 'graph' },
      result: protectedInspectResult({
        target: 'color',
        observedAt: 106,
        view: 'graph',
        summary: null,
        graph: {
          readerId: 'color.graph_inventory.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
          nodeStackLayersReadback: 'observed',
          nodeStackLayersConfigured: 1,
          nodeStackLayersScanned: 1,
          layersTruncated: false,
          videoTrackCount: 1,
          tracksScanned: 1,
          videoItemsObserved: 1,
          itemsScanned: 1,
          colorGroupsReadback: 'observed',
          colorGroupCountObserved: 0,
          colorGroupsScanned: 0,
          colorGroupsTruncated: false,
          graphsObserved: 2,
          nodesObserved: 2,
          nodesReported: 2,
          tracksTruncated: false,
          itemsTruncated: false,
          nodesTruncated: false,
          toolsTruncated: false,
          timelineGraph: {
            scope: 'timeline', trackIndex: null, itemIndex: null, layerIndex: null,
            timelineItemId: null, timelineItemName: null, colorGroupIndex: null, colorGroupName: null,
            graphAccess: 'observed', nodeCountObserved: 1, nodesReported: 1, nodesTruncated: false,
            nodes: [node], missingMethods: [], failedMethods: []
          },
          itemGraphs: [{
            scope: 'item', trackIndex: 1, itemIndex: 1, layerIndex: 1,
            timelineItemId: 'color-item-exact-1', timelineItemName: 'Color Clip', colorGroupIndex: null, colorGroupName: null,
            graphAccess: 'observed', nodeCountObserved: 1, nodesReported: 1, nodesTruncated: false,
            nodes: [node], missingMethods: [], failedMethods: []
          }],
          colorGroupGraphs: [],
          complete: true,
          methodEvidence: {
            checkedMethods: [],
            fullyObservedMethods: [],
            missingMethods: [],
            failedMethods: [],
            graphObjectsProbed: 2,
            nodesProbed: 2
          },
          unverified: []
        },
        versions: null,
        schemaHash: 'schema-project-inspector'
      }, 'color.graph_inventory.v1')
    });
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'color', view: 'versions' },
      result: protectedInspectResult({
        target: 'color',
        observedAt: 107,
        view: 'versions',
        summary: null,
        graph: null,
        versions: {
          readerId: 'color.grade_version_inspect.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
          videoTrackCount: 1,
          tracksScanned: 1,
          videoItemsObserved: 1,
          itemsScanned: 1,
          tracksTruncated: false,
          itemsTruncated: false,
          versionNamesTruncated: false,
          items: [{
            trackIndex: 1,
            itemIndex: 1,
            timelineItemId: 'color-item-exact-1',
            timelineItemName: 'Color Clip',
            currentReadback: 'observed',
            currentVersion: { name: 'Version 1', type: 0 },
            localReadback: 'observed',
            localVersionCountObserved: 1,
            localVersions: ['Version 1'],
            localVersionsTruncated: false,
            remoteReadback: 'observed',
            remoteVersionCountObserved: 0,
            remoteVersions: [],
            remoteVersionsTruncated: false,
            missingMethods: [],
            failedMethods: []
          }],
          complete: true,
          methodEvidence: {
            checkedMethods: ['GetVersionNameList', 'GetCurrentVersion'],
            fullyObservedMethods: ['GetVersionNameList', 'GetCurrentVersion'],
            missingMethods: [],
            failedMethods: [],
            itemsProbed: 1
          },
          unverified: []
        },
        schemaHash: 'schema-project-inspector'
      }, 'color.grade_version_inspect.v1')
    });

    const observedSituation = world.situation();
    const observedSpine = spine();
    observedSpine.decision.generation = observedSituation.generation;
    observedSpine.decision.provenanceRevision = observedSituation.revision;
    observedSpine.completion.generation = observedSituation.generation;
    const current = deriveArtifactWorkspaceProjection({
      spine: observedSpine,
      situation: observedSituation,
      colorInspector: world.colorInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    const color = current.artifacts.find((artifact) => artifact.kind === 'color_graph')?.colorInspector;
    expect(color?.pipeline?.items[0]).toMatchObject({ name: 'Color Clip', nodeCount: 1 });
    expect(color?.graph?.itemGraphs[0]).toMatchObject({ timelineItemHandle: 'I1', timelineItemName: 'Color Clip' });
    expect(color?.versions?.items[0]).toMatchObject({ timelineItemHandle: 'I1', currentVersion: { name: 'Version 1' } });
    expect(JSON.stringify(color)).not.toContain('color-item-exact-1');
    expect(JSON.stringify(color)).not.toContain('timeline-exact-1');

    const historicalGeneration = observedSituation.generation;
    world.invalidate('Color inspector offline test');
    const offlineSituation = world.situation();
    const offlineSpine = spine(false);
    offlineSpine.decision.generation = offlineSituation.generation;
    offlineSpine.decision.provenanceRevision = offlineSituation.revision;
    offlineSpine.completion.generation = offlineSituation.generation;
    const offline = deriveArtifactWorkspaceProjection({
      spine: offlineSpine,
      situation: offlineSituation,
      cachedSituation: world.historicalSituationForProject('project-exact-1', historicalGeneration),
      cachedColorInspector: world.historicalColorInspectorForProject('project-exact-1', historicalGeneration),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    expect(offline.artifacts.find((artifact) => artifact.kind === 'color_graph')).toMatchObject({
      source: 'cached_projection',
      colorInspector: { graph: { itemGraphs: [{ timelineItemHandle: 'I1' }] } }
    });

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/\bworkflowColor(?:Graph|Versions)?\b/);
    const colorPaint = renderer.split('function paintColorPipeline()')[1]?.split('function paintFusionComposition()')[0] ?? '';
    expect(colorPaint).not.toContain('timelineItemId');
    expect(colorPaint).not.toContain('timeline.id');
    expect(colorPaint).toContain('timelineItemHandle');
  });

  it('projects bounded Fusion composition and graph inspectors without renderer exact Resolve identities', () => {
    const world = projectInspectorWorld();
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'fusion' },
      result: protectedInspectResult({
        target: 'fusion',
        observedAt: 102,
        summary: {
          readerId: 'fusion.composition_inspect.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
          videoTrackCount: 1,
          tracksScanned: 1,
          videoItemsObserved: 1,
          itemsReported: 1,
          tracksTruncated: false,
          itemsTruncated: false,
          namesTruncated: false,
          items: [{
            trackIndex: 1,
            itemIndex: 1,
            id: 'fusion-item-exact-1',
            name: 'Fusion Shot',
            compositionCountObserved: 1,
            compositionNames: ['Comp 1'],
            namesTruncated: false,
            nameListShape: 'list',
            missingMethods: [],
            failedMethods: []
          }],
          complete: true,
          methodEvidence: {
            strategy: 'dir',
            checkedMethods: ['GetUniqueId', 'GetName', 'GetFusionCompCount', 'GetFusionCompNameList', 'GetFusionCompByIndex', 'GetFusionCompByName'],
            fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetFusionCompCount', 'GetFusionCompNameList', 'GetFusionCompByIndex', 'GetFusionCompByName'],
            missingMethods: [],
            failedMethods: [],
            itemsProbed: 1
          },
          unverified: ['compositionGraph', 'pixelOutput']
        },
        schemaHash: 'schema-project-inspector'
      }, 'fusion.composition_inspect.v1')
    });
    world.observe({
      context: { caller: 'local_ui' },
      name: 'inspect',
      args: { target: 'fusion', view: 'graph' },
      result: protectedInspectResult({
        target: 'fusion',
        observedAt: 103,
        graph: {
          readerId: 'fusion.graph_inspect.v1',
          timeline: { id: 'timeline-exact-1', name: 'Main Cut' },
          videoTrackCount: 1,
          tracksScanned: 1,
          videoItemsObserved: 1,
          itemsScanned: 1,
          compositionsObserved: 1,
          compositionsReported: 1,
          toolsObserved: 2,
          toolsReported: 2,
          edgesObserved: 1,
          edgesReported: 1,
          tracksTruncated: false,
          itemsTruncated: false,
          compositionsTruncated: false,
          toolsTruncated: false,
          portsTruncated: false,
          edgesTruncated: false,
          compositions: [{
            trackIndex: 1,
            itemIndex: 1,
            timelineItemId: 'fusion-item-exact-1',
            timelineItemName: 'Fusion Shot',
            compositionName: 'Comp 1',
            toolCountObserved: 2,
            tools: [
              { name: 'MediaIn1', id: 'MediaIn-exact-id', inputCountObserved: 0, outputCountObserved: 1 },
              { name: 'MediaOut1', id: 'MediaOut-exact-id', inputCountObserved: 1, outputCountObserved: 0 }
            ],
            edges: [{
              sourceToolName: 'MediaIn1',
              sourceToolId: 'MediaIn-exact-id',
              sourceOutputId: 'Output-exact-id',
              targetToolName: 'MediaOut1',
              targetToolId: 'MediaOut-exact-id',
              targetInputId: 'Input-exact-id',
              bidirectionalReadback: true
            }]
          }],
          complete: true,
          methodEvidence: {
            checkedMethods: ['GetFusionCompByName', 'GetToolList', 'GetInputList', 'GetOutputList', 'GetConnectedInputs', 'GetConnectedOutput'],
            failedMethods: [],
            compositionObjectsProbed: 1,
            toolsProbed: 2,
            outputsProbed: 1,
            edgesReadbackProbed: 1
          },
          unverified: ['controlValues', 'pixelOutput', 'graphWrites']
        },
        schemaHash: 'schema-project-inspector'
      }, 'fusion.graph_inspect.v1')
    });

    const observedSituation = world.situation();
    const observedSpine = spine();
    observedSpine.decision.generation = observedSituation.generation;
    observedSpine.decision.provenanceRevision = observedSituation.revision;
    observedSpine.completion.generation = observedSituation.generation;
    const current = deriveArtifactWorkspaceProjection({
      spine: observedSpine,
      situation: observedSituation,
      fusionInspector: world.fusionInspectorProjection(),
      workspaceProjectIdentity: 'project-exact-1',
      workspaceTimelineIdentity: 'timeline-exact-1'
    });
    const fusion = current.artifacts.find((artifact) => artifact.kind === 'timeline')?.fusionInspector;
    expect(fusion?.composition).toMatchObject({
      timeline: { semanticHandle: 'T1', name: 'Main Cut' },
      items: [{ semanticHandle: 'I1', name: 'Fusion Shot', compositionNames: ['Comp 1'] }]
    });
    expect(fusion?.graph?.compositions[0]).toMatchObject({
      compositionName: 'Comp 1'
    });
    expect(fusion?.graph?.compositions[0]?.tools[0]).toMatchObject({
      name: 'MediaIn1',
      inputCountObserved: 0,
      outputCountObserved: 1,
      connections: [{ targetToolName: 'MediaOut1', bidirectionalReadback: true }]
    });
    const projectedJson = JSON.stringify(fusion);
    expect(projectedJson).not.toContain('timeline-exact-1');
    expect(projectedJson).not.toContain('fusion-item-exact-1');
    expect(projectedJson).not.toContain('MediaIn-exact-id');
    expect(projectedJson).not.toContain('MediaOut-exact-id');
    expect(projectedJson).not.toContain('Output-exact-id');
    expect(projectedJson).not.toContain('Input-exact-id');

    const renderer = readFileSync(new URL('../src/renderer/main.ts', import.meta.url), 'utf8');
    expect(renderer).not.toMatch(/\bworkflowFusion(?:Graph|Error|GraphError)?\b/);
    expect(renderer).toContain('fusionInspectorDetail()?.composition');
    expect(renderer).toContain('fusionInspectorDetail()?.graph');
    const refreshBlock = renderer.split('async function refreshFusionPanel()')[1]?.split('async function refreshFairlightPanel()')[0] ?? '';
    expect(refreshBlock).toContain("api.inspectWorkflow('fusion')");
    expect(refreshBlock).toContain('api.inspectFusionGraph()');
    expect(refreshBlock).toContain('await reconcileLegacyDomainObservation(scope)');
    expect(refreshBlock).not.toMatch(/workflowFusion\w*\s*=/);
  });
});
