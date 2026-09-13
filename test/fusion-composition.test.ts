import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'fusion-test'
};

const methods = ['GetUniqueId', 'GetName', 'GetFusionCompCount', 'GetFusionCompNameList', 'GetFusionCompByIndex', 'GetFusionCompByName'];

function item(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    trackIndex: 1,
    itemIndex: 1,
    id: 'item-1',
    name: 'Clip 1',
    compositionCountObserved: 0,
    compositionNames: [],
    namesTruncated: false,
    nameListShape: 'empty_dict_zero_count',
    missingMethods: [],
    failedMethods: [],
    ...overrides
  };
}

function detail(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    readerId: 'fusion.composition_inspect.v1',
    timeline: { id: 'timeline-1', name: 'Timeline 1' },
    videoTrackCount: 1,
    tracksScanned: 1,
    videoItemsObserved: 1,
    itemsReported: 1,
    tracksTruncated: false,
    itemsTruncated: false,
    namesTruncated: false,
    itemListFailed: false,
    items: [item()],
    methodEvidence: {
      strategy: 'dir',
      checkedMethods: methods,
      fullyObservedMethods: methods,
      missingMethods: [],
      failedMethods: [],
      itemsProbed: 1
    },
    ...overrides
  };
}

function brokerFor(value: Record<string, unknown>, scripts: string[] = []): ResolveBroker {
  return {
    async callTool(_name: string, args: Record<string, unknown>): Promise<unknown> {
      scripts.push(String(args['script'] ?? ''));
      return { content: [{ type: 'text', text: JSON.stringify({ result: value }) }] };
    }
  } as unknown as ResolveBroker;
}

function parsed(value: Awaited<ReturnType<typeof callWorkflowTool>>): Record<string, unknown> {
  const text = value.content[0]?.type === 'text' ? value.content[0].text : '';
  return JSON.parse(text) as Record<string, unknown>;
}

describe('Fusion composition protected reader', () => {
  it('scans bounded current-timeline VIDEO items and accepts the qualified per-item zero-count dict quirk', async () => {
    const scripts: string[] = [];
    const output = parsed(await callWorkflowTool(brokerFor(detail(), scripts), snapshot, 'inspect', { target: 'fusion' }));
    const result = output['result'] as Record<string, unknown>;
    const summary = result['summary'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(result['target']).toBe('fusion');
    expect(summary).toMatchObject({
      readerId: 'fusion.composition_inspect.v1',
      videoTrackCount: 1,
      tracksScanned: 1,
      videoItemsObserved: 1,
      itemsReported: 1,
      complete: true
    });
    expect(summary['items']).toEqual([expect.objectContaining({
      id: 'item-1', name: 'Clip 1', compositionCountObserved: 0, compositionNames: []
    })]);
    expect(summary['unverified']).toEqual(['compositionGraph', 'pixelOutput']);
    expect(operation).toMatchObject({ workflow_id: 'fusion.composition_inspect.v1', status: 'partial', blast_radius: 'timeline' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('MAX_VIDEO_TRACKS = 64');
    expect(scripts[0]).toContain('MAX_ITEMS = 2000');
    expect(scripts[0]).toContain('MAX_COMPOSITIONS_PER_ITEM = 64');
    expect(scripts[0]).toContain('t.GetTrackCount("video")');
    expect(scripts[0]).toContain('t.GetItemListInTrack("video", track_index)');
    expect(scripts[0]).toContain('isinstance(raw_names, dict) and len(raw_names) == 0 and comp_count == 0');
    expect(scripts[0]).not.toMatch(/GetCurrentVideoItem|GetToolList|GetInputList|GetOutputList|GetConnected|GetFusionCompByIndex\(|GetFusionCompByName\(|AddTool|DeleteTool|SetAttrs|ConnectTo|SaveSettings/);
  });

  it('treats a nonzero unexpected per-item name-list shape as failed and unverified instead of known empty', async () => {
    const evidence = {
      strategy: 'dir',
      checkedMethods: methods,
      fullyObservedMethods: methods,
      missingMethods: [],
      failedMethods: ['GetFusionCompNameList'],
      itemsProbed: 1
    };
    const output = parsed(await callWorkflowTool(brokerFor(detail({
      items: [item({ compositionCountObserved: 2, nameListShape: 'unexpected', failedMethods: ['GetFusionCompNameList'] })],
      methodEvidence: evidence
    })), snapshot, 'inspect', { target: 'fusion' }));
    const summary = (output['result'] as Record<string, unknown>)['summary'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;
    expect(summary['complete']).toBe(false);
    expect(summary['unverified']).toEqual(expect.arrayContaining(['compositionNames']));
    expect(operation['warnings']).toEqual(expect.arrayContaining([
      'getter_failed:GetFusionCompNameList',
      'unverified:compositionNames'
    ]));
  });

  it('rejects malformed zero-count name-list shape when no missing/failed evidence explains it', async () => {
    await expect(callWorkflowTool(brokerFor(detail({
      items: [item({ nameListShape: 'unexpected' })]
    })), snapshot, 'inspect', { target: 'fusion' })).rejects.toThrow('unexpected item name-list shape without failed evidence');
    await expect(callWorkflowTool(brokerFor(detail({
      items: [item({ nameListShape: null })]
    })), snapshot, 'inspect', { target: 'fusion' })).rejects.toThrow('missing item name-list shape without method evidence');
  });

  it('marks track/item/name bounds and item-list failures partial instead of complete', async () => {
    const output = parsed(await callWorkflowTool(brokerFor(detail({
      videoTrackCount: 65,
      tracksScanned: 64,
      tracksTruncated: true,
      itemListFailed: true
    })), snapshot, 'inspect', { target: 'fusion' }));
    const summary = (output['result'] as Record<string, unknown>)['summary'] as Record<string, unknown>;
    expect(summary['complete']).toBe(false);
    expect(summary['unverified']).toEqual(expect.arrayContaining(['timelineItemList']));
  });

  it('keeps per-item identity/getter drift explicit and never promotes it to exact identity', async () => {
    const evidence = {
      strategy: 'dir',
      checkedMethods: methods,
      fullyObservedMethods: methods.filter((name) => name !== 'GetUniqueId'),
      missingMethods: [],
      failedMethods: ['GetUniqueId'],
      itemsProbed: 1
    };
    const output = parsed(await callWorkflowTool(brokerFor(detail({
      items: [item({ id: null, failedMethods: ['GetUniqueId'] })],
      methodEvidence: evidence
    })), snapshot, 'inspect', { target: 'fusion' }));
    const summary = (output['result'] as Record<string, unknown>)['summary'] as Record<string, unknown>;
    expect(summary['complete']).toBe(false);
    expect(summary['unverified']).toEqual(expect.arrayContaining(['itemIdentity']));
  });

  it('rejects unknown method evidence outside the six-method reader surface', async () => {
    const evidence = detail()['methodEvidence'] as Record<string, unknown>;
    evidence['failedMethods'] = ['GetToolList'];
    await expect(callWorkflowTool(brokerFor(detail({ methodEvidence: evidence })), snapshot, 'inspect', { target: 'fusion' }))
      .rejects.toThrow('invalid failed method evidence');
  });

  it('rejects empty or non-string timeline identity instead of accepting it as exact identity', async () => {
    await expect(callWorkflowTool(brokerFor(detail({
      timeline: { id: '   ', name: 'Timeline 1' }
    })), snapshot, 'inspect', { target: 'fusion' })).rejects.toThrow('invalid identity or method evidence');
    await expect(callWorkflowTool(brokerFor(detail({
      timeline: { id: 'timeline-1', name: 42 }
    })), snapshot, 'inspect', { target: 'fusion' })).rejects.toThrow('invalid identity or method evidence');
  });
});
