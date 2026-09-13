import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'color-graph-test'
};

const methods = [
  'Timeline.GetNodeGraph',
  'TimelineItem.GetNodeGraph',
  'ColorGroup.GetPreClipNodeGraph',
  'ColorGroup.GetPostClipNodeGraph',
  'Graph.GetNumNodes',
  'Graph.GetNodeLabel',
  'Graph.GetLUT',
  'Graph.GetNodeCacheMode',
  'Graph.GetToolsInNode'
];

function detail(nodeOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    readerId: 'color.graph_inventory.v1',
    timeline: { id: 'timeline-1', name: 'Color Graph Qualification' },
    nodeStackLayersReadback: 'observed',
    nodeStackLayersConfigured: 2,
    nodeStackLayersScanned: 2,
    layersTruncated: false,
    videoTrackCount: 1,
    tracksScanned: 1,
    videoItemsObserved: 1,
    itemsScanned: 1,
    colorGroupsReadback: 'observed',
    colorGroupCountObserved: 1,
    colorGroupsScanned: 1,
    colorGroupsTruncated: false,
    graphsObserved: 5,
    nodesObserved: 3,
    nodesReported: 3,
    tracksTruncated: false,
    itemsTruncated: false,
    nodesTruncated: false,
    toolsTruncated: false,
    timelineGraph: {
      scope: 'timeline',
      trackIndex: null,
      itemIndex: null,
      layerIndex: null,
      timelineItemId: null,
      timelineItemName: null,
      colorGroupIndex: null,
      colorGroupName: null,
      graphAccess: 'observed',
      nodeCountObserved: 0,
      nodesReported: 0,
      nodesTruncated: false,
      nodes: [],
      missingMethods: [],
      failedMethods: []
    },
    itemGraphs: [{
      scope: 'item',
      trackIndex: 1,
      itemIndex: 1,
      layerIndex: 1,
      timelineItemId: 'item-1',
      timelineItemName: 'BMX.mov',
      colorGroupIndex: null,
      colorGroupName: null,
      graphAccess: 'observed',
      nodeCountObserved: 1,
      nodesReported: 1,
      nodesTruncated: false,
      nodes: [{
        index: 1,
        label: '',
        lutReferencePresent: false,
        cacheMode: -1,
        cacheModeShape: 'integer',
        toolNames: [],
        toolListShape: 'null',
        toolsTruncated: false,
        ...nodeOverrides
      }],
      missingMethods: [],
      failedMethods: []
    }, {
      scope: 'item',
      trackIndex: 1,
      itemIndex: 1,
      layerIndex: 2,
      timelineItemId: 'item-1',
      timelineItemName: 'BMX.mov',
      colorGroupIndex: null,
      colorGroupName: null,
      graphAccess: 'observed',
      nodeCountObserved: 0,
      nodesReported: 0,
      nodesTruncated: false,
      nodes: [],
      missingMethods: [],
      failedMethods: []
    }],
    colorGroupGraphs: [{
      scope: 'group_pre',
      trackIndex: null,
      itemIndex: null,
      layerIndex: null,
      timelineItemId: null,
      timelineItemName: null,
      colorGroupIndex: 1,
      colorGroupName: 'CID Group Qualification',
      graphAccess: 'observed',
      nodeCountObserved: 1,
      nodesReported: 1,
      nodesTruncated: false,
      nodes: [{
        index: 1,
        label: '',
        lutReferencePresent: false,
        cacheMode: null,
        cacheModeShape: 'null',
        toolNames: [],
        toolListShape: 'null',
        toolsTruncated: false
      }],
      missingMethods: [],
      failedMethods: []
    }, {
      scope: 'group_post',
      trackIndex: null,
      itemIndex: null,
      layerIndex: null,
      timelineItemId: null,
      timelineItemName: null,
      colorGroupIndex: 1,
      colorGroupName: 'CID Group Qualification',
      graphAccess: 'observed',
      nodeCountObserved: 1,
      nodesReported: 1,
      nodesTruncated: false,
      nodes: [{
        index: 1,
        label: '',
        lutReferencePresent: false,
        cacheMode: null,
        cacheModeShape: 'null',
        toolNames: [],
        toolListShape: 'null',
        toolsTruncated: false
      }],
      missingMethods: [],
      failedMethods: []
    }],
    complete: true,
    methodEvidence: {
      checkedMethods: methods,
      fullyObservedMethods: methods,
      missingMethods: [],
      failedMethods: [],
      graphObjectsProbed: 5,
      nodesProbed: 3
    }
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

describe('Color graph protected reader', () => {
  it('reports bounded timeline, configured-layer and Color Group graph evidence without exposing LUT paths or graph writes', async () => {
    const scripts: string[] = [];
    const output = parsed(await callWorkflowTool(brokerFor(detail(), scripts), snapshot, 'inspect', { target: 'color', view: 'graph' }));
    const result = output['result'] as Record<string, unknown>;
    const graph = result['graph'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(result).toMatchObject({ target: 'color', view: 'graph', summary: null });
    expect(graph).toMatchObject({
      readerId: 'color.graph_inventory.v1',
      nodeStackLayersConfigured: 2,
      nodeStackLayersScanned: 2,
      colorGroupCountObserved: 1,
      colorGroupsScanned: 1,
      graphsObserved: 5,
      nodesObserved: 3,
      nodesReported: 3,
      complete: true,
      unverified: ['nodeTopology', 'nodeValues', 'pixelOutput', 'graphWrites']
    });
    expect((graph['itemGraphs'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      timelineItemId: 'item-1',
      layerIndex: 1,
      graphAccess: 'observed',
      nodeCountObserved: 1
    });
    expect(((graph['itemGraphs'] as Array<Record<string, unknown>>)[0]?.['nodes'] as Array<Record<string, unknown>>)[0]).toEqual({
      index: 1,
      label: '',
      lutReferencePresent: false,
      cacheMode: -1,
      cacheModeShape: 'integer',
      toolNames: [],
      toolListShape: 'null',
      toolsTruncated: false
    });
    expect(graph['colorGroupGraphs']).toEqual([
      expect.objectContaining({ scope: 'group_pre', colorGroupIndex: 1, colorGroupName: 'CID Group Qualification', graphAccess: 'observed' }),
      expect.objectContaining({ scope: 'group_post', colorGroupIndex: 1, colorGroupName: 'CID Group Qualification', graphAccess: 'observed' })
    ]);
    expect((((graph['colorGroupGraphs'] as Array<Record<string, unknown>>)[0]?.['nodes']) as Array<Record<string, unknown>>)[0]).toMatchObject({
      cacheMode: null,
      cacheModeShape: 'null',
      lutReferencePresent: false,
      toolListShape: 'null'
    });
    expect(JSON.stringify(graph)).not.toMatch(/\/Users\/|\/Volumes\/|file:\/\//);
    expect(operation).toMatchObject({ workflow_id: 'color.graph_inventory.v1', status: 'partial', blast_radius: 'timeline' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('MAX_VIDEO_TRACKS = 64');
    expect(scripts[0]).toContain('MAX_ITEMS = 200');
    expect(scripts[0]).toContain('MAX_NODE_STACK_LAYERS = 32');
    expect(scripts[0]).toContain('MAX_COLOR_GROUPS = 32');
    expect(scripts[0]).toContain('MAX_NODES = 2048');
    expect(scripts[0]).toContain('nodeStackLayers');
    expect(scripts[0]).toContain('GetNodeLabel');
    expect(scripts[0]).toContain('GetToolsInNode');
    expect(scripts[0]).toContain('GetPreClipNodeGraph');
    expect(scripts[0]).toContain('GetPostClipNodeGraph');
    expect(scripts[0]).not.toMatch(/SetLUT|SetNodeCacheMode|SetNodeEnabled|ApplyGradeFromDRX|ApplyArriCdlLut|ResetAllGrades|AddColorGroup|DeleteColorGroup|AssignToColorGroup|RemoveFromColorGroup/);
  });

  it('rejects contradictory fully-observed and missing method evidence', async () => {
    const malformed = detail();
    const timelineGraph = malformed['timelineGraph'] as Record<string, unknown>;
    timelineGraph['missingMethods'] = ['Timeline.GetNodeGraph'];
    const evidence = malformed['methodEvidence'] as Record<string, unknown>;
    evidence['missingMethods'] = ['Timeline.GetNodeGraph'];
    malformed['complete'] = false;
    await expect(callWorkflowTool(
      brokerFor(malformed),
      snapshot,
      'inspect',
      { target: 'color', view: 'graph' }
    )).rejects.toThrow('inconsistent fully-observed method evidence');
  });
});
