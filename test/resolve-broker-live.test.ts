import { describe, expect, it } from 'vitest';
import { ResolveBroker } from '../src/main/resolve-broker.js';

describe.skipIf(process.env['CID_LIVE_RESOLVE_BROKER'] !== '1')('read-only ResolveBroker', () => {
  it('owns one initialized ResolveMCP session and calls get_resolve_status', async () => {
    const broker = new ResolveBroker();
    try {
      const snapshot = await broker.start();
      expect(snapshot.serverName).toBe('davinci_resolve');
      expect(snapshot.protocolVersion).toBe('2024-11-05');
      expect(snapshot.tools).toHaveLength(14);
      expect(snapshot.tools.some((tool) => tool.name === 'run_script_unsafe')).toBe(true);
      expect(snapshot.schemaHash).toMatch(/^[a-f0-9]{64}$/);
      const status = await broker.getResolveStatus();
      expect(typeof status['running']).toBe('boolean');
    } finally {
      await broker.stop();
    }
  });
});
