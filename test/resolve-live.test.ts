import { describe, expect, it } from 'vitest';
import { probeResolveMcp } from '../src/main/resolve.js';

describe.skipIf(process.env['CID_LIVE_RESOLVE'] !== '1')('installed Blackmagic ResolveMCP', () => {
  it('completes initialize, tools/list and read-only get_resolve_status', async () => {
    const probe = await probeResolveMcp();
    expect(probe.installed).toBe(true);
    expect(probe.reachable).toBe(true);
    expect(probe.serverName).toBe('davinci_resolve');
    expect(probe.protocolVersion).toBe('2024-11-05');
    expect(probe.tools).toHaveLength(14);
    expect(probe.tools).toContain('get_resolve_status');
    expect(probe.tools).toContain('run_script_unsafe');
  });
});
