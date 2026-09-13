import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cosRequestCorrelation,
  observeCosRequestCorrelationNow,
  resetCosRequestCorrelationsForTests,
  restoreCosRequestCorrelations
} from '../src/cos-host/identity.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';

let tempDir: string | null = null;

afterEach(async () => {
  resetCosRequestCorrelationsForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

async function init(): Promise<void> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-identity-'));
  initDurableStore(tempDir);
  await restoreCosRequestCorrelations();
}

describe('COS exact request identity', () => {
  it('keeps the first proven request owner and refuses a conflicting conversation', async () => {
    await init();
    const first = {
      requestId: 'wfr_exact',
      conversationId: 'conv-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      messageId: 'message-a',
      tool: 'agents',
      observedAt: 100
    };

    await expect(observeCosRequestCorrelationNow(first)).resolves.toBe('stored');
    await expect(observeCosRequestCorrelationNow({ ...first, observedAt: 200 })).resolves.toBe('same');
    await expect(observeCosRequestCorrelationNow({ ...first, conversationId: 'conv-b', observedAt: 300 })).resolves.toBe('refused');
    await expect(observeCosRequestCorrelationNow({ ...first, sessionId: 'session-b', observedAt: 300 })).resolves.toBe('refused');
    await expect(observeCosRequestCorrelationNow({ ...first, turnId: 'turn-b', observedAt: 300 })).resolves.toBe('refused');
    await expect(observeCosRequestCorrelationNow({ ...first, tool: 'status', observedAt: 300 })).resolves.toBe('refused');
    expect(cosRequestCorrelation('wfr_exact')).toMatchObject({
      requestId: 'wfr_exact',
      conversationId: 'conv-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      tool: 'agents'
    });
  });

  it('restores exact request ownership from durable state after process-local reset', async () => {
    await init();
    await observeCosRequestCorrelationNow({
      requestId: 'wfr_restart',
      conversationId: 'conv-restart',
      sessionId: 'session-restart',
      turnId: 'turn-restart',
      messageId: 'message-restart',
      tool: 'status',
      observedAt: 100
    });

    resetCosRequestCorrelationsForTests();
    expect(cosRequestCorrelation('wfr_restart')).toBeNull();
    await restoreCosRequestCorrelations();
    expect(cosRequestCorrelation('wfr_restart')).toMatchObject({
      requestId: 'wfr_restart',
      conversationId: 'conv-restart',
      sessionId: 'session-restart',
      turnId: 'turn-restart',
      tool: 'status'
    });
  });
});
