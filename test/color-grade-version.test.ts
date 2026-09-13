import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'color-version-test'
};

function detail(currentType: number = 0): Record<string, unknown> {
  return {
    readerId: 'color.grade_version_inspect.v1',
    timeline: { id: 'timeline-1', name: 'Color Version Qualification' },
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
      timelineItemId: 'item-1',
      timelineItemName: 'BMX.mov',
      currentReadback: 'observed',
      currentVersion: { name: '版本 1', type: currentType },
      localReadback: 'observed',
      localVersionCountObserved: 1,
      localVersions: ['版本 1'],
      localVersionsTruncated: false,
      remoteReadback: 'observed',
      remoteVersionCountObserved: 1,
      remoteVersions: ['版本 1'],
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

describe('Color grade-version protected reader', () => {
  it('reports bounded local/remote names and current version without invoking version writers', async () => {
    const scripts: string[] = [];
    const output = parsed(await callWorkflowTool(brokerFor(detail(), scripts), snapshot, 'inspect', { target: 'color', view: 'versions' }));
    const result = output['result'] as Record<string, unknown>;
    const versions = result['versions'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(result).toMatchObject({ target: 'color', view: 'versions', summary: null, graph: null });
    expect(versions).toMatchObject({
      readerId: 'color.grade_version_inspect.v1',
      itemsScanned: 1,
      complete: true,
      unverified: ['versionOrdering', 'versionNameUniqueness', 'crossTypeNameIdentity', 'colorGroupVersions', 'pixelOutput', 'versionWrites']
    });
    expect((versions['items'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      timelineItemId: 'item-1',
      currentVersion: { name: '版本 1', type: 0 },
      localVersions: ['版本 1'],
      remoteVersions: ['版本 1']
    });
    expect(operation).toMatchObject({ workflow_id: 'color.grade_version_inspect.v1', status: 'partial', blast_radius: 'timeline' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('MAX_VIDEO_TRACKS = 64');
    expect(scripts[0]).toContain('MAX_ITEMS = 200');
    expect(scripts[0]).toContain('MAX_VERSION_NAMES_PER_TYPE = 64');
    expect(scripts[0]).toContain('GetVersionNameList');
    expect(scripts[0]).toContain('GetCurrentVersion');
    expect(scripts[0]).not.toMatch(/LoadVersionByName|AddVersion|DeleteVersionByName|RenameVersionByName/);
  });

  it('rejects an unqualified current-version type instead of inventing its meaning', async () => {
    await expect(callWorkflowTool(brokerFor(detail(2)), snapshot, 'inspect', { target: 'color', view: 'versions' }))
      .rejects.toThrow('invalid current version');
  });
});
