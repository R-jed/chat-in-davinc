import { describe, expect, it } from 'vitest';
import { ResolveBroker } from '../src/main/resolve-broker.js';
import { ResolveScheduler } from '../src/main/resolve-scheduler.js';
import { startResolveGateway } from '../src/main/resolve-gateway.js';

async function rpc(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    },
    body: JSON.stringify(body)
  });
  expect(response.ok).toBe(true);
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('application/json')) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  const data = text.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  if (!data) throw new Error(`MCP response contained no JSON payload: ${text.slice(0, 120)}`);
  return JSON.parse(data) as Record<string, unknown>;
}

function protectedText(response: Record<string, unknown>): {
  result: Record<string, unknown>;
  operation: Record<string, unknown>;
} {
  const callResult = response['result'] as Record<string, unknown> | undefined;
  if (!callResult) throw new Error(`Protected RPC failed: ${JSON.stringify(response['error'] ?? response)}`);
  const content = callResult['content'] as Array<Record<string, unknown>>;
  const envelope = JSON.parse(String(content[0]?.['text'] ?? '{}')) as Record<string, unknown>;
  return {
    result: (envelope['result'] ?? {}) as Record<string, unknown>,
    operation: (envelope['operation'] ?? {}) as Record<string, unknown>
  };
}

describe.skipIf(process.env['CID_LIVE_RESOLVE_GATEWAY'] !== '1')('Resolve MCP gateway', () => {
  it('publishes localhost Raw plus the bounded COS+CID product surface through one broker', async () => {
    const broker = new ResolveBroker();
    const gateway = await startResolveGateway(broker, new ResolveScheduler(broker));
    try {
      const init = await rpc(gateway.urls.raw, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'gateway-live-test', version: '0' } }
      });
      const initResult = (init['result'] ?? {}) as Record<string, unknown>;
      const info = (initResult['serverInfo'] ?? {}) as Record<string, unknown>;
      expect(info['name']).toBe('davinci_resolve');

      const rawList = await rpc(gateway.urls.raw, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
      const rawTools = ((rawList['result'] as Record<string, unknown>)['tools'] ?? []) as Array<Record<string, unknown>>;
      expect(rawTools).toHaveLength(14);
      expect(rawTools.some((tool) => tool['name'] === 'run_script_unsafe')).toBe(true);

      const workflowList = await rpc(gateway.productUrl, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} });
      const workflowTools = ((workflowList['result'] as Record<string, unknown>)['tools'] ?? []) as Array<Record<string, unknown>>;
      expect(workflowTools.map((tool) => tool['name'])).toEqual([
        'session', 'agents', 'session_finish',
        'status', 'inspect', 'inspect_operation', 'audit', 'plan', 'execute'
      ]);

      const called = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'status', arguments: {} }
      });
      const statusEnvelope = protectedText(called);
      const status = statusEnvelope.result;
      expect(typeof status['running']).toBe('boolean');
      expect(statusEnvelope.operation['workflow_id']).toBe('system.connection_status.v1');
      expect(statusEnvelope.operation['status']).toBe('success');
      expect(Object.hasOwn(statusEnvelope.operation, 'changes')).toBe(false);
      expect(gateway.status().lastToolName).toBe('status');

      const inspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'capabilities' } }
      });
      const capabilitiesEnvelope = protectedText(inspected);
      const capabilities = capabilitiesEnvelope.result;
      expect(capabilities['officialToolCount']).toBe(14);
      expect(capabilities['protectedTools']).toEqual(['status', 'inspect', 'inspect_operation', 'audit', 'plan', 'execute']);
      expect(capabilities['resolveVersion']).toBe('21.1');
      const capabilityEvidence = capabilities['capabilities'] as Array<Record<string, unknown>>;
      expect(capabilityEvidence).toHaveLength(20);
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'resolve.sandboxed_script.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'deliver.settings.partial_read')?.['status']).toBe('conditional');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'media.clip_detail.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'media.clip_detail.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'media.link_status.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'media.link_status.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'edit.transition_fade.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'edit.transition_fade.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'edit.review_marker.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'edit.review_marker.write')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'fusion.composition.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'fusion.composition.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'fusion.graph.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'fusion.graph.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'color.graph.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'fairlight.clip_processing.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'fairlight.clip_processing.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'color.graph.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'color.grade_version.read')?.['status']).toBe('available');
      expect(capabilityEvidence.find((item) => item['capabilityId'] === 'color.grade_version.read')?.['qualification']).toBe('behaviorally_qualified');
      expect(capabilityEvidence.every((item) => typeof item['evidenceSource'] === 'string')).toBe(true);
      expect(capabilityEvidence.every((item) => typeof item['qualification'] === 'string')).toBe(true);
      expect(capabilitiesEnvelope.operation['workflow_id']).toBe('system.capability_snapshot.v1');

      const projectInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'project' } }
      });
      const projectEnvelope = protectedText(projectInspected);
      const projectSnapshot = projectEnvelope.result;
      expect(projectSnapshot['target']).toBe('project');
      expect(projectEnvelope.operation['workflow_id']).toBe('project.settings_summary.v1');
      expect(typeof projectSnapshot['schemaHash']).toBe('string');
      const currentProject = projectSnapshot['project'];
      if (currentProject && typeof currentProject === 'object' && !Array.isArray(currentProject)) {
        expect(typeof (currentProject as Record<string, unknown>)['name']).toBe('string');
        expect(typeof (currentProject as Record<string, unknown>)['id']).toBe('string');
      }
      const projectSettings = projectSnapshot['settings'];
      expect(projectSettings && typeof projectSettings === 'object' && !Array.isArray(projectSettings)).toBe(true);
      expect((projectSettings as Record<string, unknown>)['readerId']).toBe('project.settings_summary.v1');
      const effectiveSettings = (projectSettings as Record<string, unknown>)['timeline']
        ?? (projectSettings as Record<string, unknown>)['project'];
      if (effectiveSettings && typeof effectiveSettings === 'object' && !Array.isArray(effectiveSettings)) {
        expect(Array.isArray((effectiveSettings as Record<string, unknown>)['unverified'])).toBe(true);
      }

      const mediaInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 61, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'media' } }
      });
      const mediaEnvelope = protectedText(mediaInspected);
      const mediaSnapshot = mediaEnvelope.result;
      expect(mediaSnapshot['target']).toBe('media');
      expect(mediaEnvelope.operation['workflow_id']).toBe('media.inventory_summary.v1');
      expect(typeof mediaSnapshot['schemaHash']).toBe('string');
      const inventory = mediaSnapshot['inventory'];
      if (inventory && typeof inventory === 'object' && !Array.isArray(inventory)) {
        const mediaInventory = inventory as Record<string, unknown>;
        expect(mediaInventory['readerId']).toBe('media.inventory_summary.v1');
        expect(typeof mediaInventory['sourceClipCountObserved']).toBe('number');
        expect(typeof mediaInventory['complete']).toBe('boolean');
        const items = Array.isArray(mediaInventory['items']) ? mediaInventory['items'] as Array<Record<string, unknown>> : [];
        expect(items.every((item) => !Object.hasOwn(item, 'filePath') && !Object.hasOwn(item, 'proxyMediaPath'))).toBe(true);
        const sourceItem = items.find((item) => item['isTimeline'] === false && typeof item['id'] === 'string');
        if (sourceItem) {
          const clipInspected = await rpc(gateway.productUrl, {
            jsonrpc: '2.0', id: 611, method: 'tools/call', params: {
              name: 'inspect', arguments: { target: 'media', itemId: sourceItem['id'] }
            }
          });
          const clipEnvelope = protectedText(clipInspected);
          const clipSnapshot = clipEnvelope.result;
          expect(clipEnvelope.operation['workflow_id']).toBe('media.clip_inspect.v1');
          expect(clipSnapshot['requestedItemId']).toBe(sourceItem['id']);
          const clipDetail = clipSnapshot['clip'] as Record<string, unknown>;
          expect(clipDetail['readerId']).toBe('media.clip_inspect.v1');
          expect(clipDetail['lookup']).toBe('found');
          const exactItem = clipDetail['item'] as Record<string, unknown>;
          expect(exactItem['id']).toBe(sourceItem['id']);
          expect(Object.hasOwn(exactItem, 'filePath')).toBe(false);
          expect(Object.hasOwn(exactItem, 'proxyMediaPath')).toBe(false);
          expect((clipDetail['unverified'] as string[])).toContain('fullResolutionLinkState');
          const methodEvidence = clipDetail['methodEvidence'] as Record<string, unknown>;
          expect(methodEvidence['strategy']).toBe('dir');
          expect(methodEvidence['checkedMethods']).toEqual([
            'GetClipProperty', 'GetMetadata', 'GetThirdPartyMetadata', 'GetMarkers',
            'GetFlagList', 'GetClipColor', 'GetAudioMapping', 'GetTimeline'
          ]);
          expect(methodEvidence['missingMethods']).toEqual([]);
          expect(methodEvidence['failedMethods']).toEqual([]);
          for (const entry of [
            ...((clipDetail['metadata'] ?? []) as Array<Record<string, unknown>>),
            ...((clipDetail['thirdPartyMetadata'] ?? []) as Array<Record<string, unknown>>)
          ]) {
            expect(String(entry['key'] ?? '').toLowerCase()).not.toMatch(/path|directory|folder|location/);
          }

          const linkInspected = await rpc(gateway.productUrl, {
            jsonrpc: '2.0', id: 612, method: 'tools/call', params: {
              name: 'inspect', arguments: { target: 'media', view: 'link_status', itemId: sourceItem['id'] }
            }
          });
          const linkEnvelope = protectedText(linkInspected);
          expect(linkEnvelope.operation['workflow_id']).toBe('media.link_status.v1');
          const linkSnapshot = linkEnvelope.result;
          expect(linkSnapshot['requestedItemId']).toBe(sourceItem['id']);
          expect(linkSnapshot['inventory']).toBeNull();
          expect(linkSnapshot['clip']).toBeNull();
          const linkStatus = linkSnapshot['linkStatus'] as Record<string, unknown>;
          expect(linkStatus['readerId']).toBe('media.link_status.v1');
          expect(linkStatus['itemLookup']).toBe('found');
          const linkMethodEvidence = linkStatus['methodEvidence'] as Record<string, unknown>;
          const poolEvidence = linkMethodEvidence['mediaPool'] as Record<string, unknown>;
          const itemEvidence = linkMethodEvidence['mediaPoolItem'] as Record<string, unknown>;
          expect(poolEvidence['probed']).toBe(true);
          expect(poolEvidence['checkedMethods']).toEqual(['RelinkClips', 'UnlinkClips']);
          expect(poolEvidence['missingMethods']).toEqual([]);
          expect(itemEvidence['probed']).toBe(true);
          expect(itemEvidence['checkedMethods']).toEqual(['LinkProxyMedia', 'UnlinkProxyMedia', 'LinkFullResolutionMedia']);
          expect(itemEvidence['missingMethods']).toEqual([]);
          const linkCapabilities = linkStatus['capabilities'] as Array<Record<string, unknown>>;
          expect(linkCapabilities).toHaveLength(5);
          expect(linkCapabilities.every((entry) => entry['surface'] === 'observed')).toBe(true);
          expect(linkCapabilities.every((entry) => entry['qualification'] === 'runtime_observed')).toBe(true);
          expect(linkCapabilities.every((entry) => entry['protectedWrite'] === 'not_registered')).toBe(true);
          expect((linkStatus['unverified'] as string[])).toContain('behavioralWriteQualification');
          expect((linkStatus['unverified'] as string[])).toContain('fullResolutionLinkState');
          expect(JSON.stringify(linkStatus)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
        }
      }

      const editInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 62, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'edit' } }
      });
      const editEnvelope = protectedText(editInspected);
      const editSnapshot = editEnvelope.result;
      expect(editSnapshot['target']).toBe('edit');
      expect(editEnvelope.operation['workflow_id']).toBe('edit.timeline_summary.v1');
      expect(typeof editSnapshot['schemaHash']).toBe('string');
      const editSummary = editSnapshot['summary'];
      if (editSummary && typeof editSummary === 'object' && !Array.isArray(editSummary)) {
        const timelineSummary = editSummary as Record<string, unknown>;
        expect(timelineSummary['readerId']).toBe('edit.timeline_summary.v1');
        expect(typeof timelineSummary['timelineItemCountObserved']).toBe('number');
        expect(typeof timelineSummary['markerCount']).toBe('number');
        expect(Array.isArray(timelineSummary['tracks'])).toBe(true);
        expect(Array.isArray(timelineSummary['unverified'])).toBe(true);
      }

      const editStructureInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 621, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'edit', view: 'structure' }
        }
      });
      const editStructureEnvelope = protectedText(editStructureInspected);
      expect(editStructureEnvelope.operation['workflow_id']).toBe('edit.structure_inspect.v1');
      const editStructureSnapshot = editStructureEnvelope.result;
      expect(editStructureSnapshot['view']).toBe('structure');
      expect(editStructureSnapshot['summary']).toBeNull();
      const structure = editStructureSnapshot['structure'] as Record<string, unknown> | null;
      if (structure) {
        expect(structure['readerId']).toBe('edit.structure_inspect.v1');
        expect(typeof structure['itemsObserved']).toBe('number');
        const evidence = structure['methodEvidence'] as Record<string, unknown>;
        expect(evidence['checkedMethods']).toEqual([
          'GetUniqueId', 'GetName', 'GetStart', 'GetEnd', 'GetDuration', 'GetLeftOffset', 'GetRightOffset',
          'GetSourceStartFrame', 'GetSourceEndFrame', 'GetMediaPoolItem'
        ]);
        expect(evidence['missingMethods']).toEqual([]);
        expect(evidence['failedMethods']).toEqual([]);
        expect(evidence['fullyObservedMethods']).toHaveLength(10);
        const tracks = structure['tracks'] as Array<Record<string, unknown>>;
        const items = tracks.flatMap((track) => Array.isArray(track['items']) ? track['items'] as Array<Record<string, unknown>> : []);
        expect(items.length).toBe(structure['itemsObserved']);
        expect(items.every((item) => typeof item['id'] === 'string')).toBe(true);
        expect(items.every((item) => item['recordRangeConsistent'] === true)).toBe(true);
        expect(JSON.stringify(structure)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const editGapsInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 622, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'edit', view: 'gaps_overlaps' }
        }
      });
      const editGapsEnvelope = protectedText(editGapsInspected);
      expect(editGapsEnvelope.operation['workflow_id']).toBe('edit.gaps_overlaps.v1');
      const editGapsSnapshot = editGapsEnvelope.result;
      expect(editGapsSnapshot['view']).toBe('gaps_overlaps');
      expect(editGapsSnapshot['summary']).toBeNull();
      expect(editGapsSnapshot['structure']).toBeNull();
      const gapsOverlaps = editGapsSnapshot['gapsOverlaps'] as Record<string, unknown> | null;
      if (gapsOverlaps) {
        expect(gapsOverlaps['readerId']).toBe('edit.gaps_overlaps.v1');
        expect(typeof gapsOverlaps['adjacentPairsObserved']).toBe('number');
        expect(typeof gapsOverlaps['comparablePairsObserved']).toBe('number');
        expect((gapsOverlaps['unverified'] as string[])).toContain('recordRangeBoundarySemantics');
        const gapEvidence = gapsOverlaps['methodEvidence'] as Record<string, unknown>;
        expect(gapEvidence['sourceReaderId']).toBe('edit.structure_inspect.v1');
        expect(gapEvidence['requiredMethods']).toEqual(['GetUniqueId', 'GetName', 'GetStart', 'GetEnd']);
        expect(gapEvidence['missingMethods']).toEqual([]);
        expect(gapEvidence['failedMethods']).toEqual([]);
        const relationships = gapsOverlaps['relationships'] as Array<Record<string, unknown>>;
        expect(relationships.every((relationship) => ['gap', 'overlap', 'boundary_ambiguous'].includes(String(relationship['kind'])))).toBe(true);
        expect(relationships.every((relationship) => typeof relationship['boundaryDelta'] === 'number')).toBe(true);
        expect(JSON.stringify(gapsOverlaps)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const editSourceRangesInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 623, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'edit', view: 'source_ranges' }
        }
      });
      const editSourceRangesEnvelope = protectedText(editSourceRangesInspected);
      expect(editSourceRangesEnvelope.operation['workflow_id']).toBe('edit.source_range_report.v1');
      const editSourceRangesSnapshot = editSourceRangesEnvelope.result;
      expect(editSourceRangesSnapshot['view']).toBe('source_ranges');
      expect(editSourceRangesSnapshot['summary']).toBeNull();
      expect(editSourceRangesSnapshot['structure']).toBeNull();
      expect(editSourceRangesSnapshot['gapsOverlaps']).toBeNull();
      const sourceRanges = editSourceRangesSnapshot['sourceRanges'] as Record<string, unknown> | null;
      if (sourceRanges) {
        expect(sourceRanges['readerId']).toBe('edit.source_range_report.v1');
        expect((sourceRanges['unverified'] as string[])).toEqual(expect.arrayContaining([
          'recordRangeBoundarySemantics',
          'sourceRangeBoundarySemantics',
          'sourceCoordinateSemantics',
          'sourceRangeArithmetic',
          'conformMatch'
        ]));
        const sourceEvidence = sourceRanges['methodEvidence'] as Record<string, unknown>;
        expect(sourceEvidence['sourceReaderId']).toBe('edit.structure_inspect.v1');
        expect(sourceEvidence['requiredMethods']).toEqual([
          'GetUniqueId', 'GetName', 'GetStart', 'GetEnd', 'GetDuration',
          'GetSourceStartFrame', 'GetSourceEndFrame', 'GetMediaPoolItem'
        ]);
        expect(sourceEvidence['missingMethods']).toEqual([]);
        expect(sourceEvidence['failedMethods']).toEqual([]);
        const sourceRows = sourceRanges['items'] as Array<Record<string, unknown>>;
        expect(sourceRows.every((item) => typeof item['timelineItemId'] === 'string')).toBe(true);
        expect(sourceRows.every((item) => !Object.hasOwn(item, 'sourceDuration'))).toBe(true);
        expect(JSON.stringify(sourceRanges)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const editTransitionsInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 624, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'edit', view: 'transitions' }
        }
      });
      const editTransitionsEnvelope = protectedText(editTransitionsInspected);
      expect(editTransitionsEnvelope.operation['workflow_id']).toBe('edit.transition_inspect.v1');
      const editTransitionsSnapshot = editTransitionsEnvelope.result;
      expect(editTransitionsSnapshot['view']).toBe('transitions');
      expect(editTransitionsSnapshot['summary']).toBeNull();
      expect(editTransitionsSnapshot['structure']).toBeNull();
      expect(editTransitionsSnapshot['gapsOverlaps']).toBeNull();
      expect(editTransitionsSnapshot['sourceRanges']).toBeNull();
      const transitions = editTransitionsSnapshot['transitions'] as Record<string, unknown> | null;
      if (transitions) {
        expect(transitions['readerId']).toBe('edit.transition_inspect.v1');
        expect((transitions['unverified'] as string[])).toEqual(expect.arrayContaining([
          'editTransitionState',
          'transitionReadback',
          'fadeValueSemantics',
          'transitionWriterQualification',
          'fadeWriterQualification'
        ]));
        const transitionEvidence = transitions['methodEvidence'] as Record<string, unknown>;
        expect(transitionEvidence['checkedMethods']).toEqual(['AddTransition', 'GetFades', 'SetFades']);
        expect(transitionEvidence['missingMethods']).toEqual([]);
        expect(transitionEvidence['failedReadMethods']).toEqual([]);
        expect(transitionEvidence['fullyObservedMethods']).toEqual(['AddTransition', 'GetFades', 'SetFades']);
        const transitionRows = transitions['items'] as Array<Record<string, unknown>>;
        expect(transitionRows.every((item) => typeof item['timelineItemId'] === 'string')).toBe(true);
        expect(transitionRows.every((item) => item['getFadesReadback'] === 'observed')).toBe(true);
        expect(JSON.stringify(transitions)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const editAnnotationsInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 625, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'edit', view: 'annotations' }
        }
      });
      const editAnnotationsEnvelope = protectedText(editAnnotationsInspected);
      expect(editAnnotationsEnvelope.operation['workflow_id']).toBe('edit.review_annotations_inspect.v1');
      const editAnnotationsSnapshot = editAnnotationsEnvelope.result;
      expect(editAnnotationsSnapshot['view']).toBe('annotations');
      expect(editAnnotationsSnapshot['summary']).toBeNull();
      expect(editAnnotationsSnapshot['structure']).toBeNull();
      expect(editAnnotationsSnapshot['gapsOverlaps']).toBeNull();
      expect(editAnnotationsSnapshot['sourceRanges']).toBeNull();
      expect(editAnnotationsSnapshot['transitions']).toBeNull();
      const annotations = editAnnotationsSnapshot['annotations'] as Record<string, unknown> | null;
      if (annotations) {
        expect(annotations['readerId']).toBe('edit.review_annotations_inspect.v1');
        expect(typeof (annotations['timeline'] as Record<string, unknown>)['id']).toBe('string');
        expect(Array.isArray(annotations['markers'])).toBe(true);
        expect(Array.isArray(annotations['mediaPoolAnnotations'])).toBe(true);
        const annotationEvidence = annotations['methodEvidence'] as Record<string, unknown>;
        const timelineEvidence = annotationEvidence['timeline'] as Record<string, unknown>;
        const itemEvidence = annotationEvidence['timelineItem'] as Record<string, unknown>;
        const mediaEvidence = annotationEvidence['mediaPoolItem'] as Record<string, unknown>;
        expect(timelineEvidence['checkedMethods']).toEqual(['GetMarkers']);
        expect(timelineEvidence['missingMethods']).toEqual([]);
        expect(timelineEvidence['failedMethods']).toEqual([]);
        expect(itemEvidence['checkedMethods']).toEqual(['GetUniqueId', 'GetName', 'GetMarkers', 'GetMediaPoolItem']);
        expect(itemEvidence['missingMethods']).toEqual([]);
        expect(itemEvidence['failedMethods']).toEqual([]);
        expect(mediaEvidence['checkedMethods']).toEqual(['GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor']);
        expect(mediaEvidence['missingMethods']).toEqual([]);
        expect(mediaEvidence['failedMethods']).toEqual([]);
        expect(JSON.stringify(annotations)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const fusionInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 626, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'fusion' }
        }
      });
      const fusionEnvelope = protectedText(fusionInspected);
      expect(fusionEnvelope.operation['workflow_id']).toBe('fusion.composition_inspect.v1');
      expect(fusionEnvelope.operation['status']).toBe('partial');
      const fusionSnapshot = fusionEnvelope.result;
      expect(fusionSnapshot['target']).toBe('fusion');
      expect(fusionSnapshot['view']).toBe('composition');
      expect(fusionSnapshot['graph']).toBeNull();
      const fusionSummary = fusionSnapshot['summary'] as Record<string, unknown> | null;
      if (fusionSummary) {
        expect(fusionSummary['readerId']).toBe('fusion.composition_inspect.v1');
        expect(fusionSummary['videoTrackCount']).toBe(1);
        expect(fusionSummary['tracksScanned']).toBe(1);
        expect(fusionSummary['videoItemsObserved']).toBe(1);
        expect(fusionSummary['itemsReported']).toBe(1);
        expect(fusionSummary['tracksTruncated']).toBe(false);
        expect(fusionSummary['itemsTruncated']).toBe(false);
        expect(fusionSummary['namesTruncated']).toBe(false);
        expect(Array.isArray(fusionSummary['items'])).toBe(true);
        const fusionItems = fusionSummary['items'] as Array<Record<string, unknown>>;
        expect(fusionItems).toHaveLength(1);
        expect(fusionItems[0]).toMatchObject({
          trackIndex: 1,
          itemIndex: 1,
          id: '3ae6bdfb-6b71-41df-a18c-3e75f73a3b52',
          compositionCountObserved: 0,
          compositionNames: [],
          namesTruncated: false,
          nameListShape: 'empty_dict_zero_count'
        });
        expect(typeof fusionItems[0]?.['name']).toBe('string');
        expect(fusionSummary['complete']).toBe(true);
        expect(fusionSummary['unverified']).toEqual(['compositionGraph', 'pixelOutput']);
        const fusionEvidence = fusionSummary['methodEvidence'] as Record<string, unknown>;
        expect(fusionEvidence['checkedMethods']).toEqual([
          'GetUniqueId', 'GetName', 'GetFusionCompCount', 'GetFusionCompNameList',
          'GetFusionCompByIndex', 'GetFusionCompByName'
        ]);
        expect(fusionEvidence['fullyObservedMethods']).toEqual([
          'GetFusionCompByIndex', 'GetFusionCompByName', 'GetFusionCompCount',
          'GetFusionCompNameList', 'GetName', 'GetUniqueId'
        ]);
        expect(fusionEvidence['missingMethods']).toEqual([]);
        expect(fusionEvidence['failedMethods']).toEqual([]);
        expect(fusionEvidence['itemsProbed']).toBe(1);
        expect(JSON.stringify(fusionSummary)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const fusionGraphInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 627, method: 'tools/call', params: {
          name: 'inspect', arguments: { target: 'fusion', view: 'graph' }
        }
      });
      const fusionGraphEnvelope = protectedText(fusionGraphInspected);
      expect(fusionGraphEnvelope.operation['workflow_id']).toBe('fusion.graph_inspect.v1');
      expect(fusionGraphEnvelope.operation['status']).toBe('partial');
      const fusionGraphSnapshot = fusionGraphEnvelope.result;
      expect(fusionGraphSnapshot).toMatchObject({ target: 'fusion', view: 'graph', summary: null });
      const fusionGraph = fusionGraphSnapshot['graph'] as Record<string, unknown> | null;
      if (fusionGraph) {
        expect(fusionGraph).toMatchObject({
          readerId: 'fusion.graph_inspect.v1',
          videoTrackCount: 1,
          tracksScanned: 1,
          videoItemsObserved: 1,
          itemsScanned: 1,
          compositionsObserved: 0,
          compositionsReported: 0,
          toolsObserved: 0,
          toolsReported: 0,
          edgesObserved: 0,
          edgesReported: 0,
          complete: true,
          unverified: ['controlValues', 'pixelOutput', 'graphWrites']
        });
        expect(fusionGraph['compositions']).toEqual([]);
        const graphEvidence = fusionGraph['methodEvidence'] as Record<string, unknown>;
        expect(graphEvidence['checkedMethods']).toEqual([
          'GetFusionCompByName', 'GetToolList', 'GetInputList',
          'GetOutputList', 'GetConnectedInputs', 'GetConnectedOutput'
        ]);
        expect(graphEvidence['failedMethods']).toEqual([]);
        expect(JSON.stringify(fusionGraph)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const colorInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 63, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'color' } }
      });
      const colorEnvelope = protectedText(colorInspected);
      const colorSnapshot = colorEnvelope.result;
      expect(colorSnapshot['target']).toBe('color');
      expect(colorEnvelope.operation['workflow_id']).toBe('color.pipeline_inspect.v1');
      const colorSummary = colorSnapshot['summary'];
      if (colorSummary && typeof colorSummary === 'object' && !Array.isArray(colorSummary)) {
        expect((colorSummary as Record<string, unknown>)['readerId']).toBe('color.pipeline_inspect.v1');
        expect(typeof (colorSummary as Record<string, unknown>)['nodeCountObserved']).toBe('number');
      }

      const colorGraphInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 631, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'color', view: 'graph' } }
      });
      const colorGraphEnvelope = protectedText(colorGraphInspected);
      const colorGraphSnapshot = colorGraphEnvelope.result;
      expect(colorGraphSnapshot['target']).toBe('color');
      expect(colorGraphSnapshot['view']).toBe('graph');
      expect(colorGraphEnvelope.operation['workflow_id']).toBe('color.graph_inventory.v1');
      const colorGraph = colorGraphSnapshot['graph'] as Record<string, unknown> | null;
      if (colorGraph) {
        expect(colorGraph['readerId']).toBe('color.graph_inventory.v1');
        expect(colorGraph['nodeStackLayersReadback']).toBe('observed');
        expect(colorGraph['nodeStackLayersConfigured']).toBe(1);
        expect(colorGraph['nodeStackLayersScanned']).toBe(1);
        expect(colorGraph['layersTruncated']).toBe(false);
        expect(colorGraph['colorGroupsReadback']).toBe('observed');
        expect(colorGraph['colorGroupCountObserved']).toBe(0);
        expect(colorGraph['colorGroupsScanned']).toBe(0);
        expect(colorGraph['colorGroupsTruncated']).toBe(false);
        expect(colorGraph['graphsObserved']).toBe(2);
        expect(colorGraph['nodesObserved']).toBe(1);
        expect(colorGraph['nodesReported']).toBe(1);
        expect(colorGraph['complete']).toBe(true);
        const timelineGraph = colorGraph['timelineGraph'] as Record<string, unknown>;
        expect(timelineGraph['graphAccess']).toBe('observed');
        expect(timelineGraph['nodeCountObserved']).toBe(0);
        const itemGraphs = colorGraph['itemGraphs'] as Array<Record<string, unknown>>;
        expect(itemGraphs).toHaveLength(1);
        expect(itemGraphs[0]?.['layerIndex']).toBe(1);
        expect(itemGraphs[0]?.['graphAccess']).toBe('observed');
        expect(itemGraphs[0]?.['nodeCountObserved']).toBe(1);
        const nodes = itemGraphs[0]?.['nodes'] as Array<Record<string, unknown>>;
        expect(nodes).toEqual([expect.objectContaining({
          index: 1,
          label: '',
          lutReferencePresent: false,
          cacheMode: -1,
          cacheModeShape: 'integer',
          toolNames: [],
          toolListShape: 'null'
        })]);
        expect(colorGraph['colorGroupGraphs']).toEqual([]);
        const graphEvidence = colorGraph['methodEvidence'] as Record<string, unknown>;
        expect(graphEvidence['checkedMethods']).toEqual([
          'Timeline.GetNodeGraph', 'TimelineItem.GetNodeGraph', 'ColorGroup.GetPreClipNodeGraph', 'ColorGroup.GetPostClipNodeGraph',
          'Graph.GetNumNodes', 'Graph.GetNodeLabel',
          'Graph.GetLUT', 'Graph.GetNodeCacheMode', 'Graph.GetToolsInNode'
        ]);
        expect(graphEvidence['fullyObservedMethods']).toHaveLength(7);
        expect(graphEvidence['missingMethods']).toEqual([]);
        expect(graphEvidence['failedMethods']).toEqual([]);
        expect(JSON.stringify(colorGraph)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const colorVersionsInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 632, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'color', view: 'versions' } }
      });
      const colorVersionsEnvelope = protectedText(colorVersionsInspected);
      const colorVersionsSnapshot = colorVersionsEnvelope.result;
      expect(colorVersionsSnapshot['target']).toBe('color');
      expect(colorVersionsSnapshot['view']).toBe('versions');
      expect(colorVersionsEnvelope.operation['workflow_id']).toBe('color.grade_version_inspect.v1');
      const colorVersions = colorVersionsSnapshot['versions'] as Record<string, unknown> | null;
      if (colorVersions) {
        expect(colorVersions['readerId']).toBe('color.grade_version_inspect.v1');
        expect(colorVersions['itemsScanned']).toBe(1);
        expect(colorVersions['complete']).toBe(true);
        const versionItems = colorVersions['items'] as Array<Record<string, unknown>>;
        expect(versionItems).toHaveLength(1);
        const versionItem = versionItems[0] as Record<string, unknown>;
        expect(versionItem['localReadback']).toBe('observed');
        expect(versionItem['remoteReadback']).toBe('observed');
        expect(versionItem['currentReadback']).toBe('observed');
        expect(versionItem['localVersionCountObserved']).toBe(1);
        expect(versionItem['remoteVersionCountObserved']).toBe(1);
        expect((versionItem['localVersions'] as unknown[])).toHaveLength(1);
        expect((versionItem['remoteVersions'] as unknown[])).toHaveLength(1);
        expect((versionItem['currentVersion'] as Record<string, unknown>)['type']).toBe(0);
        const versionEvidence = colorVersions['methodEvidence'] as Record<string, unknown>;
        expect(versionEvidence['checkedMethods']).toEqual(['GetVersionNameList', 'GetCurrentVersion']);
        expect(versionEvidence['fullyObservedMethods']).toEqual(['GetVersionNameList', 'GetCurrentVersion']);
        expect(versionEvidence['missingMethods']).toEqual([]);
        expect(versionEvidence['failedMethods']).toEqual([]);
        expect(JSON.stringify(colorVersions)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const fairlightInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 64, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'fairlight' } }
      });
      const fairlightEnvelope = protectedText(fairlightInspected);
      const fairlightSnapshot = fairlightEnvelope.result;
      expect(fairlightSnapshot['target']).toBe('fairlight');
      expect(fairlightEnvelope.operation['workflow_id']).toBe('fairlight.mapping_inspect.v1');
      const fairlightSummary = fairlightSnapshot['summary'];
      if (fairlightSummary && typeof fairlightSummary === 'object' && !Array.isArray(fairlightSummary)) {
        expect((fairlightSummary as Record<string, unknown>)['readerId']).toBe('fairlight.mapping_inspect.v1');
        expect(Array.isArray((fairlightSummary as Record<string, unknown>)['tracks'])).toBe(true);
      }

      const fairlightProcessingInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 641, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'fairlight', view: 'audio_processing' } }
      });
      const fairlightProcessingEnvelope = protectedText(fairlightProcessingInspected);
      const fairlightProcessingSnapshot = fairlightProcessingEnvelope.result;
      expect(fairlightProcessingSnapshot['target']).toBe('fairlight');
      expect(fairlightProcessingSnapshot['view']).toBe('clip_processing');
      expect(fairlightProcessingEnvelope.operation['workflow_id']).toBe('fairlight.clip_processing_inspect.v1');
      const fairlightProcessing = fairlightProcessingSnapshot['clipProcessing'] as Record<string, unknown> | null;
      if (fairlightProcessing) {
        expect(fairlightProcessing['readerId']).toBe('fairlight.clip_processing_inspect.v1');
        expect(fairlightProcessing['audioTrackCount']).toBe(1);
        expect(fairlightProcessing['tracksScanned']).toBe(1);
        expect(fairlightProcessing['audioItemsObserved']).toBe(1);
        expect(fairlightProcessing['itemsScanned']).toBe(1);
        expect(fairlightProcessing['complete']).toBe(true);
        const processingItems = fairlightProcessing['items'] as Array<Record<string, unknown>>;
        expect(processingItems).toHaveLength(1);
        expect(processingItems[0]).toMatchObject({
          trackIndex: 1,
          itemIndex: 1,
          timelineItemId: 'aa0bb325-0a56-407a-a110-32b510af99fa',
          volumeEnabled: true,
          volumeDb: 0,
          panEnabled: true,
          pan: 0,
          pitchEnabled: true,
          pitchSemitones: 0,
          pitchCents: 0,
          voiceIsolationEnabled: false,
          voiceIsolationAmount: 0,
          dialogueLevelerEnabled: false,
          dialogueLevelerMode: 0,
          dialogueOutputGainDb: 0,
          voiceReadback: 'observed',
          voiceState: { isEnabled: false, amount: 0 },
          voiceConsistency: 'matched'
        });
        const processingEvidence = fairlightProcessing['methodEvidence'] as Record<string, unknown>;
        expect(processingEvidence['checkedMethods']).toEqual(['GetUniqueId', 'GetName', 'GetProperties', 'GetVoiceIsolationState']);
        expect(processingEvidence['fullyObservedMethods']).toEqual(['GetUniqueId', 'GetName', 'GetProperties', 'GetVoiceIsolationState']);
        expect(processingEvidence['missingMethods']).toEqual([]);
        expect(processingEvidence['failedMethods']).toEqual([]);
        expect(JSON.stringify(fairlightProcessing)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
      }

      const deliverInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 65, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'deliver' } }
      });
      const deliverEnvelope = protectedText(deliverInspected);
      const deliverSnapshot = deliverEnvelope.result;
      expect(deliverSnapshot['target']).toBe('deliver');
      expect(deliverEnvelope.operation['workflow_id']).toBe('deliver.settings_inspect.v1');
      const capabilityMatrix = deliverSnapshot['capabilities'] as Record<string, unknown> | null;
      const deliverSettings = deliverSnapshot['settings'] as Record<string, unknown> | null;
      if (capabilityMatrix) {
        expect(capabilityMatrix['readerId']).toBe('deliver.capability_matrix.v1');
        const currentSelection = capabilityMatrix['currentSelection'] as Record<string, unknown> | null;
        expect(currentSelection).not.toBeNull();
        if (currentSelection) {
          expect(currentSelection['format']).toBe('mov');
          expect(currentSelection['codec']).toBe('H264');
          expect(typeof currentSelection['resolutionCount']).toBe('number');
          expect((currentSelection['resolutionCount'] as number)).toBeGreaterThan(0);
          expect(Array.isArray(currentSelection['resolutions'])).toBe(true);
        }
        const renderPresets = capabilityMatrix['renderPresets'];
        const quickExportPresets = capabilityMatrix['quickExportPresets'];
        expect(Array.isArray(renderPresets)).toBe(true);
        expect(Array.isArray(quickExportPresets)).toBe(true);
        if (Array.isArray(renderPresets)) {
          expect(renderPresets.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 256)).toBe(true);
          expect(renderPresets.length).toBe(Math.min(capabilityMatrix['renderPresetCount'] as number, 64));
        }
        if (Array.isArray(quickExportPresets)) {
          expect(quickExportPresets.every((name) => typeof name === 'string' && name.length > 0 && name.length <= 256)).toBe(true);
          expect(quickExportPresets.length).toBe(Math.min(capabilityMatrix['quickExportPresetCount'] as number, 64));
        }
      }
      if (deliverSettings) {
        expect(deliverSettings['readerId']).toBe('deliver.settings_inspect.v1');
        const jobs = Array.isArray(deliverSettings['renderJobs']) ? deliverSettings['renderJobs'] as Array<Record<string, unknown>> : [];
        expect(jobs.every((job) => !Object.hasOwn(job, 'targetDirectory') && !Object.hasOwn(job, 'outputFilename'))).toBe(true);
      }

      const preflightInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 66, method: 'tools/call', params: { name: 'inspect', arguments: { target: 'preflight', profile: 'fusion' } }
      });
      const preflightEnvelope = protectedText(preflightInspected);
      const preflightSnapshot = preflightEnvelope.result;
      expect(preflightSnapshot['target']).toBe('preflight');
      expect(preflightEnvelope.operation['workflow_id']).toBe('project.preflight.v1');
      const preflight = preflightSnapshot['preflight'] as Record<string, unknown>;
      expect(preflight['readerId']).toBe('project.preflight.v1');
      expect(preflight['profile']).toBe('fusion');
      expect(['warning', 'unverified']).toContain(preflight['status']);
      expect(Array.isArray(preflight['checks'])).toBe(true);
      const preflightCapabilities = preflight['capabilityEvidence'] as Array<Record<string, unknown>>;
      expect(preflightCapabilities).toHaveLength(15);
      expect(preflightCapabilities.some((item) => item['capabilityId'] === 'fusion.composition.read')).toBe(true);
      expect(preflightCapabilities.some((item) => item['capabilityId'] === 'fusion.graph.read')).toBe(true);
      expect(preflightCapabilities.some((item) => item['capabilityId'] === 'color.graph.read')).toBe(true);
      expect(preflightCapabilities.some((item) => item['capabilityId'] === 'color.grade_version.read')).toBe(true);
      expect(preflightCapabilities.some((item) => item['capabilityId'] === 'fairlight.clip_processing.read')).toBe(true);
      const fusionChecks = preflight['checks'] as Array<Record<string, unknown>>;
      expect(fusionChecks.find((check) => check['id'] === 'fusion.composition_inspect.v1')?.['status']).toBe('pass');
      expect(fusionChecks.find((check) => check['id'] === 'fusion.graph_inspect.v1')?.['status']).toBe('pass');
      expect(fusionChecks.find((check) => check['id'] === 'color.graph_inventory.v1')?.['status']).toBe('pass');
      expect(fusionChecks.find((check) => check['id'] === 'color.grade_version_inspect.v1')?.['status']).toBe('pass');
      expect(fusionChecks.find((check) => check['id'] === 'fairlight.clip_processing_inspect.v1')?.['status']).toBe('pass');
      expect(preflight['capabilityGaps']).not.toContain('fusion_graph_readback_unqualified');
      expect(preflight['capabilityGaps']).not.toContain('fusion_graph_unavailable');
      expect(preflight['capabilityGaps']).not.toContain('fusion_reader_not_implemented');

      const riskInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'inspect_operation', arguments: { workflowId: 'project.preflight.v1' } }
      });
      const riskEnvelope = protectedText(riskInspected);
      const risk = riskEnvelope.result;
      expect(risk['riskLevel']).toBe('low');
      expect(risk['riskEstablished']).toBe(true);
      expect(risk['workflowId']).toBe('project.preflight.v1');
      expect(risk['workflowVersion']).toBe('1');
      expect(risk['readOnly']).toBe(true);
      expect(risk['approvalPolicy']).toBe('none');
      expect(risk['recoveryClass']).toBe('A');
      expect(risk['previewMode']).toBe('native');
      expect(risk['verificationLevel']).toBe('STRUCTURAL_READBACK');
      expect(risk['executable']).toBe(true);
      expect(risk['destructive']).toBe(false);
      expect(riskEnvelope.operation['workflow_id']).toBe('system.capability_snapshot.v1');

      const unknownRiskInspected = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'inspect_operation', arguments: { workflowId: 'unknown.writer.v1' } }
      });
      const unknownRisk = protectedText(unknownRiskInspected).result;
      expect(unknownRisk['riskEstablished']).toBe(false);
      expect(unknownRisk['executable']).toBe(false);
      expect(unknownRisk['blastRadius']).toBe('unknown');

      const audited = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'audit', arguments: { limit: 5 } }
      });
      const auditEnvelope = protectedText(audited);
      const audit = auditEnvelope.result;
      expect(auditEnvelope.operation['workflow_id']).toBe('activity.audit_recent.v1');
      const entries = (audit['entries'] ?? []) as Array<Record<string, unknown>>;
      expect(entries.map((entry) => entry['tool'])).toEqual(['inspect_operation', 'inspect_operation', 'inspect', 'inspect', 'inspect']);
      expect(entries.every((entry) => !Object.hasOwn(entry, 'arguments') && !Object.hasOwn(entry, 'result'))).toBe(true);

      const workflowCannotCallRaw = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'get_resolve_status', arguments: {} }
      });
      expect(String((workflowCannotCallRaw['error'] as Record<string, unknown>)?.['message'] ?? '')).toContain('not available');

      const rawCannotCallWorkflow = await rpc(gateway.urls.raw, {
        jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'status', arguments: {} }
      });
      expect(String((rawCannotCallWorkflow['error'] as Record<string, unknown>)?.['message'] ?? '')).toContain('not available');
    } finally {
      await gateway.stop({ forceAfterMs: 5_000 });
    }
  });
});
