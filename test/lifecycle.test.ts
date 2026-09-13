import { describe, expect, it, vi } from 'vitest';
import { createWindowActivationGate } from '../src/main/window-lifecycle.js';
import { runShutdownSequence } from '../src/main/shutdown.js';

describe('app lifecycle', () => {
  it('does not reopen the window after shutdown disables activation', () => {
    const show = vi.fn();
    const gate = createWindowActivationGate(show);
    gate.request();
    gate.enable();
    gate.request();
    gate.disable();
    gate.enable();
    gate.request();
    expect(show).toHaveBeenCalledTimes(1);
  });

  it('always reaches exit even when a shutdown phase rejects', async () => {
    const exit = vi.fn();
    await runShutdownSequence([
      { name: 'broken', budgetMs: 50, run: () => [Promise.reject(new Error('boom'))] }
    ], { info: vi.fn(), warn: vi.fn(), error: vi.fn(), exit });
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
