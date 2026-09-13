import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'annotations-test'
};

function annotationDetail(): Record<string, unknown> {
  return {
    readerId: 'edit.review_annotations_inspect.v1',
    timeline: { id: 'timeline-1', name: 'Timeline 1' },
    tracksObserved: 1,
    itemsObserved: 1,
    mediaPoolItemsObserved: 1,
    timelineMarkerCountObserved: 1,
    timelineItemMarkerCountObserved: 1,
    mediaPoolMarkerCountObserved: 1,
    flaggedMediaPoolItemCountObserved: 1,
    coloredMediaPoolItemCountObserved: 1,
    tracksTruncated: false,
    itemsTruncated: false,
    markerRowsTruncated: false,
    methodEvidence: {
      strategy: 'dir',
      timeline: {
        checkedMethods: ['GetMarkers'],
        observedMethods: ['GetMarkers'],
        missingMethods: [],
        failedMethods: []
      },
      timelineItem: {
        checkedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetMediaPoolItem'],
        fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetMediaPoolItem'],
        missingMethods: [],
        failedMethods: [],
        itemsProbed: 1
      },
      mediaPoolItem: {
        checkedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor'],
        fullyObservedMethods: ['GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor'],
        missingMethods: [],
        failedMethods: [],
        itemsProbed: 1
      }
    },
    markers: [
      { scope: 'timeline', targetId: 'timeline-1', targetName: 'Timeline 1', trackType: null, trackIndex: null, frame: 2, color: 'Yellow', duration: 1, name: 'Timeline note', note: '', customData: '' },
      { scope: 'timeline_item', targetId: 'item-1', targetName: 'Item 1', trackType: 'video', trackIndex: 1, frame: 3, color: 'Blue', duration: 1, name: 'Item note', note: 'Review', customData: 'item-marker' },
      { scope: 'media_pool_item', targetId: 'media-1', targetName: 'Media 1', trackType: null, trackIndex: null, frame: 4, color: 'Red', duration: 1, name: 'Clip note', note: '', customData: 'media-marker' }
    ],
    mediaPoolAnnotations: [{
      mediaPoolItemId: 'media-1', name: 'Media 1', flags: ['Blue'], flagsTruncated: false, clipColor: 'Orange', markerCountObserved: 1
    }]
  };
}

function brokerFor(detail: Record<string, unknown>, scripts: string[]): ResolveBroker {
  return {
    async callTool(_name: string, args: Record<string, unknown>): Promise<unknown> {
      scripts.push(String(args['script'] ?? ''));
      return { content: [{ type: 'text', text: JSON.stringify({ result: detail }) }] };
    }
  } as unknown as ResolveBroker;
}

function parsedTextResult(value: Awaited<ReturnType<typeof callWorkflowTool>>): Record<string, unknown> {
  const text = value.content[0]?.type === 'text' ? value.content[0].text : '';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('edit review annotations protected reader', () => {
  it('routes the public annotations view through the bounded getter-only reader and returns its own operation envelope', async () => {
    const scripts: string[] = [];
    const output = parsedTextResult(await callWorkflowTool(brokerFor(annotationDetail(), scripts), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    const result = output['result'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(result).toMatchObject({ target: 'edit', view: 'annotations' });
    expect((result['annotations'] as Record<string, unknown>)['complete']).toBe(true);
    expect(operation).toMatchObject({
      workflow_id: 'edit.review_annotations_inspect.v1',
      status: 'success',
      verification: { status: 'passed', level_reached: 'API_READBACK' }
    });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('MAX_TRACKS = 64');
    expect(scripts[0]).toContain('MAX_ITEMS = 2000');
    expect(scripts[0]).toContain('MAX_MARKER_ROWS = 2000');
    expect(scripts[0]).toContain('MAX_FLAGS = 64');
    expect(scripts[0]).toContain('if not isinstance(timeline_raw, dict):');
    expect(scripts[0]).toContain('if not isinstance(item_raw, dict):');
    expect(scripts[0]).toContain('if not isinstance(raw_media_markers, dict):');
    expect(scripts[0]).toContain('if isinstance(raw_flags, list):');
    expect(scripts[0]).toContain('media_failed.add("GetFlagList")');
    expect(scripts[0]).toContain('item_id = raw_item_id.strip() if isinstance(raw_item_id, str) and raw_item_id.strip() else None');
    expect(scripts[0]).toContain('item_name = raw_item_name.strip() if isinstance(raw_item_name, str) and raw_item_name.strip() else None');
    expect(scripts[0]).toContain('media_id = raw_media_id.strip() if isinstance(raw_media_id, str) and raw_media_id.strip() else None');
    expect(scripts[0]).toContain('media_name = raw_media_name.strip() if isinstance(raw_media_name, str) and raw_media_name.strip() else None');
    expect(scripts[0]).toContain('if any(not isinstance(flag, str) for flag in raw_flags):');
    expect(scripts[0]).toContain('if raw_clip_color is None or isinstance(raw_clip_color, str):');
    expect(scripts[0]).not.toMatch(/AddMarker\(|DeleteMarker|SetClipColor|AddFlag|GetClipProperty|GetMetadata|GetThirdPartyMetadata|Proxy Media Path|File Path/);
  });

  it('reports truncated or identity-incomplete annotation evidence as partial instead of falsely complete', async () => {
    const detail = annotationDetail();
    detail['markerRowsTruncated'] = true;
    detail['timelineItemMarkerCountObserved'] = 5;
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['timelineItem']!['fullyObservedMethods'] = ['GetName', 'GetMarkers', 'GetMediaPoolItem'];
    evidence['timelineItem']!['missingMethods'] = ['GetUniqueId'];
    const markers = detail['markers'] as Array<Record<string, unknown>>;
    markers[1]!['targetId'] = null;
    const mediaRows = detail['mediaPoolAnnotations'] as Array<Record<string, unknown>>;
    mediaRows[0]!['flags'] = Array.from({ length: 64 }, (_, index) => `Flag ${index + 1}`);
    mediaRows[0]!['flagsTruncated'] = true;

    const output = parsedTextResult(await callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    const annotations = (output['result'] as Record<string, unknown>)['annotations'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(annotations['complete']).toBe(false);
    expect(annotations['unverified']).toEqual(expect.arrayContaining(['timelineItemIdentity', 'markerRows']));
    expect(operation['status']).toBe('partial');
    expect(operation['warnings']).toEqual(expect.arrayContaining([
      'reader_bounded_or_incomplete',
      'timeline_item_surface_missing:GetUniqueId'
    ]));
  });

  it('rejects structured annotation results that exceed the fixed traversal bounds', async () => {
    const detail = annotationDetail();
    detail['itemsObserved'] = 2001;
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['timelineItem']!['itemsProbed'] = 2001;
    await expect(callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    })).rejects.toThrow('exceeded its fixed traversal bounds');
  });

  it('rejects an expanded checked-method surface outside the fixed getter allowlist', async () => {
    const detail = annotationDetail();
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['mediaPoolItem']!['checkedMethods'] = [
      'GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor', 'SetClipColor'
    ];
    await expect(callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    })).rejects.toThrow('invalid MediaPoolItem allowlist evidence');
  });

  it('rejects unknown method evidence instead of silently dropping it', async () => {
    const detail = annotationDetail();
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['timelineItem']!['failedMethods'] = ['SetClipColor'];
    await expect(callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    })).rejects.toThrow('invalid timeline item failed method evidence');
  });

  it('projects only annotation fields and does not surface injected source or media path fields', async () => {
    const detail = annotationDetail();
    (detail['markers'] as Array<Record<string, unknown>>)[0]!['filePath'] = '/Volumes/private/source.mov';
    (detail['mediaPoolAnnotations'] as Array<Record<string, unknown>>)[0]!['proxyMediaPath'] = '/Volumes/private/proxy.mov';
    const output = parsedTextResult(await callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    expect(JSON.stringify(output)).not.toContain('/Volumes/private/');
  });

  it('keeps unexpected marker return shapes explicit as failed and unverified', async () => {
    const detail = annotationDetail();
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['timeline']!['failedMethods'] = ['GetMarkers'];
    const output = parsedTextResult(await callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    const annotations = (output['result'] as Record<string, unknown>)['annotations'] as Record<string, unknown>;
    expect(annotations['complete']).toBe(false);
    expect(annotations['unverified']).toContain('timelineMarkers');
  });

  it('keeps unexpected flag-list return shapes explicit as failed and unverified', async () => {
    const detail = annotationDetail();
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['mediaPoolItem']!['failedMethods'] = ['GetFlagList'];
    const output = parsedTextResult(await callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    const annotations = (output['result'] as Record<string, unknown>)['annotations'] as Record<string, unknown>;
    expect(annotations['complete']).toBe(false);
    expect(annotations['unverified']).toContain('flags');
  });

  it('keeps an empty MediaPoolItem unique id explicit as failed identity evidence', async () => {
    const detail = annotationDetail();
    detail['mediaPoolItemsObserved'] = 0;
    detail['mediaPoolMarkerCountObserved'] = 0;
    detail['flaggedMediaPoolItemCountObserved'] = 0;
    detail['coloredMediaPoolItemCountObserved'] = 0;
    detail['markers'] = (detail['markers'] as Array<Record<string, unknown>>).filter((row) => row['scope'] !== 'media_pool_item');
    detail['mediaPoolAnnotations'] = [];
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['mediaPoolItem']!['failedMethods'] = ['GetUniqueId'];
    const output = parsedTextResult(await callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    const annotations = (output['result'] as Record<string, unknown>)['annotations'] as Record<string, unknown>;
    expect(annotations['complete']).toBe(false);
    expect(annotations['unverified']).toContain('mediaPoolIdentity');
  });

  it('keeps empty item/media names and unexpected flag/color values explicit through failed evidence', async () => {
    const detail = annotationDetail();
    const evidence = detail['methodEvidence'] as Record<string, Record<string, unknown>>;
    evidence['timelineItem']!['failedMethods'] = ['GetName'];
    evidence['mediaPoolItem']!['failedMethods'] = ['GetName', 'GetFlagList', 'GetClipColor'];
    const output = parsedTextResult(await callWorkflowTool(brokerFor(detail, []), snapshot, 'inspect', {
      target: 'edit', view: 'annotations'
    }));
    const annotations = (output['result'] as Record<string, unknown>)['annotations'] as Record<string, unknown>;
    expect(annotations['complete']).toBe(false);
    expect(annotations['unverified']).toEqual(expect.arrayContaining([
      'timelineItemIdentity', 'mediaPoolIdentity', 'flags', 'clipColor'
    ]));
  });
});
