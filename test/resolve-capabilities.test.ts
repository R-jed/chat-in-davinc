import { describe, expect, it } from 'vitest';
import { resolveCapabilityRegistry } from '../src/main/resolve-capabilities.js';
import type { ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';

describe('Resolve capability registry', () => {
  it('publishes the live-qualified track writer only on the qualified Resolve 21.1 script surface', () => {
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: '21.1',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [{ name: 'run_script', description: 'sandboxed script', inputSchema: { type: 'object', properties: {} } }],
      schemaHash: 'test'
    };
    expect(resolveCapabilityRegistry(snapshot, '21.1').find((row) => row.capabilityId === 'edit.track.write')).toMatchObject({
      capabilityId: 'edit.track.write',
      symbol: 'Timeline.AddTrack/DeleteTrack',
      qualification: 'behaviorally_qualified',
      evidenceBuild: '21.1',
      status: 'available'
    });
    expect(resolveCapabilityRegistry(snapshot, '21.1').find((row) => row.capabilityId === 'color.grade_version.write')).toMatchObject({
      capabilityId: 'color.grade_version.write',
      symbol: 'TimelineItem.AddVersion + TimelineItem.LoadVersionByName + TimelineItem.DeleteVersionByName',
      qualification: 'behaviorally_qualified',
      evidenceBuild: '21.1',
      status: 'available'
    });
    expect(resolveCapabilityRegistry(snapshot, '22.0').find((row) => row.capabilityId === 'edit.track.write')).toMatchObject({
      qualification: 'runtime_observed',
      evidenceBuild: null,
      status: 'unknown'
    });
    expect(resolveCapabilityRegistry(snapshot, '22.0').find((row) => row.capabilityId === 'color.grade_version.write')).toMatchObject({
      qualification: 'runtime_observed',
      evidenceBuild: null,
      status: 'unknown'
    });
  });
});
