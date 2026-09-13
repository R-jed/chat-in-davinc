import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'deliver-capability-test'
};

function brokerFor(value: Record<string, unknown>): ResolveBroker {
  return {
    async callTool(): Promise<unknown> {
      return { content: [{ type: 'text', text: JSON.stringify({ result: value }) }] };
    }
  } as unknown as ResolveBroker;
}

describe('Deliver capability matrix', () => {
  it('preserves bounded current format/codec resolution evidence separately from the generic list', async () => {
    const output = await callWorkflowTool(brokerFor({
      capabilities: {
        readerId: 'deliver.capability_matrix.v1',
        videoFormatCount: 1,
        videoCodecCountObserved: 1,
        videoFormats: [{ name: 'QuickTime', extension: 'mov', codecCount: 1, codecs: [{ name: 'H.264', id: 'H264' }], codecSampleTruncated: false }],
        audioFormatCount: 0,
        audioCodecCountObserved: 0,
        audioFormats: [],
        generalResolutions: [{ width: 1920, height: 1080 }],
        currentSelection: {
          format: 'mov',
          codec: 'H264',
          resolutionCount: 2,
          resolutions: [{ width: 1920, height: 1080 }, { width: 1920, height: 1080 }],
          resolutionsTruncated: false
        },
        renderPresetCount: 2,
        renderPresets: ['Master', 'Master'],
        renderPresetsTruncated: false,
        quickExportPresetCount: 1,
        quickExportPresets: ['Quick H.264'],
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
        renderMode: 1,
        renderingInProgress: false,
        renderJobCountObserved: 0,
        renderJobs: [],
        jobsTruncated: false
      }
    }), snapshot, 'inspect', { target: 'deliver' });
    const text = output.content[0]?.type === 'text' ? output.content[0].text : '';
    const envelope = JSON.parse(text) as Record<string, unknown>;
    const result = envelope['result'] as Record<string, unknown>;
    const capabilities = result['capabilities'] as Record<string, unknown>;
    expect(capabilities['currentSelection']).toEqual({
      format: 'mov', codec: 'H264', resolutionCount: 2,
      resolutions: [{ width: 1920, height: 1080 }, { width: 1920, height: 1080 }],
      resolutionsTruncated: false
    });
    expect(capabilities['renderPresets']).toEqual(['Master', 'Master']);
    expect(capabilities['quickExportPresets']).toEqual(['Quick H.264']);
    expect((envelope['operation'] as Record<string, unknown>)['workflow_id']).toBe('deliver.settings_inspect.v1');
  });
});
