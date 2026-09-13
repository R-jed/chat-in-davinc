import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'fusion-graph-test'
};

const methods = [
  'GetFusionCompByName',
  'GetToolList',
  'GetInputList',
  'GetOutputList',
  'GetConnectedInputs',
  'GetConnectedOutput'
];

function detail(edgeOverrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    readerId: 'fusion.graph_inspect.v1',
    timeline: { id: 'timeline-1', name: 'Fusion Graph Qualification' },
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
      timelineItemId: 'item-1',
      timelineItemName: 'BMX.mov',
      compositionName: 'Composition 1',
      toolCountObserved: 2,
      tools: [
        { name: 'MediaIn1', id: 'MediaIn', inputCountObserved: 1, outputCountObserved: 1 },
        { name: 'MediaOut1', id: 'MediaOut', inputCountObserved: 1, outputCountObserved: 1 }
      ],
      edges: [{
        sourceToolName: 'MediaIn1',
        sourceToolId: 'MediaIn',
        sourceOutputId: 'Output',
        targetToolName: 'MediaOut1',
        targetToolId: 'MediaOut',
        targetInputId: 'Input',
        bidirectionalReadback: true,
        ...edgeOverrides
      }]
    }],
    methodEvidence: {
      checkedMethods: methods,
      failedMethods: [],
      compositionObjectsProbed: 1,
      toolsProbed: 2,
      outputsProbed: 2,
      edgesReadbackProbed: 1
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

describe('Fusion graph protected reader', () => {
  it('reports a bounded bidirectionally read-back MediaIn to MediaOut edge without graph mutation calls', async () => {
    const scripts: string[] = [];
    const output = parsed(await callWorkflowTool(brokerFor(detail(), scripts), snapshot, 'inspect', { target: 'fusion', view: 'graph' }));
    const result = output['result'] as Record<string, unknown>;
    const graph = result['graph'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(result).toMatchObject({ target: 'fusion', view: 'graph', summary: null });
    expect(graph).toMatchObject({
      readerId: 'fusion.graph_inspect.v1',
      compositionsObserved: 1,
      compositionsReported: 1,
      toolsObserved: 2,
      toolsReported: 2,
      edgesObserved: 1,
      edgesReported: 1,
      complete: true,
      unverified: ['controlValues', 'pixelOutput', 'graphWrites']
    });
    expect((graph['compositions'] as Array<Record<string, unknown>>)[0]?.['edges']).toEqual([
      expect.objectContaining({
        sourceToolName: 'MediaIn1',
        sourceToolId: 'MediaIn',
        sourceOutputId: 'Output',
        targetToolName: 'MediaOut1',
        targetToolId: 'MediaOut',
        targetInputId: 'Input',
        bidirectionalReadback: true
      })
    ]);
    expect(operation).toMatchObject({ workflow_id: 'fusion.graph_inspect.v1', status: 'partial', blast_radius: 'timeline' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('MAX_VIDEO_TRACKS = 64');
    expect(scripts[0]).toContain('MAX_ITEMS = 2000');
    expect(scripts[0]).toContain('MAX_COMPOSITIONS = 128');
    expect(scripts[0]).toContain('MAX_TOOLS = 512');
    expect(scripts[0]).toContain('MAX_PORTS = 4096');
    expect(scripts[0]).toContain('MAX_EDGES = 4096');
    expect(scripts[0]).toContain('GetConnectedInputs()');
    expect(scripts[0]).toContain('GetConnectedOutput()');
    expect(scripts[0]).not.toMatch(/AddFusionComp|DeleteFusionComp|AddTool|ConnectInput|SetInput|Delete\(|SetAttrs|SaveSettings/);
  });

  it('rejects a graph edge without an exact target input identity', async () => {
    await expect(callWorkflowTool(brokerFor(detail({ targetInputId: '' })), snapshot, 'inspect', { target: 'fusion', view: 'graph' }))
      .rejects.toThrow('invalid target input ID');
  });
});
