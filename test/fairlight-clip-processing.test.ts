import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'fairlight-processing-test'
};

const propertyKeys = [
  'AudioVolumeEnabled', 'AudioVolume', 'AudioPanEnabled', 'AudioPan',
  'AudioPitchEnabled', 'AudioPitchSemiTones', 'AudioPitchCents',
  'AudioVoiceIsolationEnabled', 'AudioVoiceIsolationAmount',
  'AudioDialogueLevelerEnabled', 'AudioDialogueLevelerMode',
  'AudioDialogueLevelerReduceLoudDialogue', 'AudioDialogueLevelerLiftSoftDialogue',
  'AudioDialogueLevelerBackgroundReduction', 'AudioDialogueLevelerOutputGain'
];

function detail(): Record<string, unknown> {
  return {
    readerId: 'fairlight.clip_processing_inspect.v1',
    timeline: { id: 'timeline-1', name: 'Fairlight Qualification' },
    audioTrackCount: 1,
    tracksScanned: 1,
    audioItemsObserved: 1,
    itemsScanned: 1,
    tracksTruncated: false,
    itemsTruncated: false,
    items: [{
      trackIndex: 1,
      itemIndex: 1,
      timelineItemId: 'audio-item-1',
      timelineItemName: 'BMX.mov',
      propertiesReadback: 'observed',
      missingPropertyKeys: [],
      properties: {
        AudioVolumeEnabled: true,
        AudioVolume: 0,
        AudioPanEnabled: true,
        AudioPan: 0,
        AudioPitchEnabled: true,
        AudioPitchSemiTones: 0,
        AudioPitchCents: 0,
        AudioVoiceIsolationEnabled: false,
        AudioVoiceIsolationAmount: 0,
        AudioDialogueLevelerEnabled: false,
        AudioDialogueLevelerMode: 0,
        AudioDialogueLevelerReduceLoudDialogue: false,
        AudioDialogueLevelerLiftSoftDialogue: false,
        AudioDialogueLevelerBackgroundReduction: false,
        AudioDialogueLevelerOutputGain: 0
      },
      voiceReadback: 'observed',
      voiceState: { isEnabled: false, amount: 0 },
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

describe('Fairlight clip-processing protected reader', () => {
  it('reports bounded allowlisted item processing values without exposing audio writers', async () => {
    const scripts: string[] = [];
    const output = parsed(await callWorkflowTool(brokerFor(detail(), scripts), snapshot, 'inspect', { target: 'fairlight', view: 'audio_processing' }));
    const result = output['result'] as Record<string, unknown>;
    const processing = result['clipProcessing'] as Record<string, unknown>;
    const operation = output['operation'] as Record<string, unknown>;

    expect(result).toMatchObject({ target: 'fairlight', view: 'clip_processing', summary: null });
    expect(processing).toMatchObject({
      readerId: 'fairlight.clip_processing_inspect.v1',
      audioTrackCount: 1,
      tracksScanned: 1,
      audioItemsObserved: 1,
      itemsScanned: 1,
      complete: true,
      unverified: ['automationState', 'clipEffects', 'renderedAudio', 'processingWrites']
    });
    expect((processing['items'] as Array<Record<string, unknown>>)[0]).toMatchObject({
      timelineItemId: 'audio-item-1',
      volumeDb: 0,
      pan: 0,
      pitchSemitones: 0,
      voiceIsolationEnabled: false,
      voiceIsolationAmount: 0,
      dialogueLevelerEnabled: false,
      dialogueLevelerMode: 0,
      voiceConsistency: 'matched'
    });
    expect(operation).toMatchObject({ workflow_id: 'fairlight.clip_processing_inspect.v1', status: 'partial', blast_radius: 'timeline' });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain('MAX_AUDIO_TRACKS = 64');
    expect(scripts[0]).toContain('MAX_ITEMS = 1000');
    expect(scripts[0]).toContain('GetProperties');
    expect(scripts[0]).toContain('GetVoiceIsolationState');
    for (const key of propertyKeys) expect(scripts[0]).toContain(key);
    expect(scripts[0]).not.toMatch(/SetProperties|SetVoiceIsolationState|NormalizeAudioLevel|SetSourceAudioChannelMapping/);
  });

  it('rejects a claimed Voice Isolation match when the two getter surfaces contradict', async () => {
    const malformed = detail();
    const item = (malformed['items'] as Array<Record<string, unknown>>)[0]!;
    item['voiceState'] = { isEnabled: false, amount: 1 };
    await expect(callWorkflowTool(brokerFor(malformed), snapshot, 'inspect', { target: 'fairlight', view: 'audio_processing' }))
      .rejects.toThrow('inconsistent Voice Isolation cross-check');
  });
});
