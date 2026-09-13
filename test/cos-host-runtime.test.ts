import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resetAgentsForTests, type WorkerSpawn } from '../src/cos-host/agents.js';
import { resetCosHostConfigForTests } from '../src/cos-host/config.js';
import {
  attachCosHostBrowserRuntime,
  attachCosHostIdentityRuntime,
  acknowledgeCosWorkerRevival,
  bindCosWorkerConversation,
  claimCosWorkerRevival,
  cosHostControlRuntime,
  finishCosWorkerConversationNow,
  initCosHostRuntime,
  shutdownCosHostRuntime,
  type CosWorkerRevivalRequest
} from '../src/cos-host/runtime.js';
import { flushDurable, initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import type { CosControlCallContext } from '../src/main/cos-control-tools.js';
import { cosControlRuntimeBridge } from '../src/main/cos-control-runtime.js';
import { resetCosContinuationRuntimeForTests } from '../src/cos-host/continuation-runtime.js';
import {
  recordCosBrowserEventsNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';

let tempDir: string | null = null;

afterEach(async () => {
  shutdownCosHostRuntime();
  await flushDurable().catch(() => undefined);
  resetAgentsForTests();
  resetCosContinuationRuntimeForTests();
  resetCosSessionRuntimeForTests();
  resetCosHostConfigForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function structured(result: Awaited<ReturnType<NonNullable<typeof cosHostControlRuntime.agents>>>): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

function callContext(requestId: string, transportSessionId: string | null = null): CosControlCallContext {
  return { transportSessionId, requestId, startedAt: Date.now() };
}

describe('COS host multi-agent runtime', () => {
  it('reuses a sleeping worker before opening a fresh worker chat', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-host-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();

    const opened: WorkerSpawn[][] = [];
    const revived: CosWorkerRevivalRequest[][] = [];
    attachCosHostBrowserRuntime({
      openWorkers: (workers) => { opened.push([...workers]); },
      reviveWorkers: (workers) => { revived.push([...workers]); }
    });
    const primeSession = await recordCosBrowserEventsNow('conv-prime', [
      { kind: 'turn_start', turnId: 'turn-prime', time: 1 },
      { kind: 'user_message', turnId: 'turn-prime', messageId: 'message-prime', text: 'Coordinate workers.', time: 2 }
    ]);
    let workerSessionId: string | null = null;
    attachCosHostIdentityRuntime({
      resolveCaller: async (context) => {
        if (context.requestId === 'wfr_prime') return {
          conversationId: 'conv-prime',
          sessionId: primeSession.sessionId,
          turnId: 'turn-prime',
          messageId: 'message-prime',
          tool: 'agents'
        };
        if (context.requestId === 'wfr_worker' && workerSessionId) return {
          conversationId: 'conv-worker',
          sessionId: workerSessionId,
          turnId: 'turn-worker',
          messageId: 'message-worker',
          tool: 'agents'
        };
        return null;
      }
    });

    const agents = cosHostControlRuntime.agents!;
    const spawn = await agents({
      action: 'spawn',
      workers: [{ label: 'Review', task: 'Review the current migration slice.' }]
    }, callContext('wfr_prime'));
    const spawnState = structured(spawn);
    expect(spawnState['became_prime']).toBe(true);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toHaveLength(1);
    const worker = opened[0]![0]!;
    expect(worker.id).toBe('worker-1');
    expect(bindCosWorkerConversation(worker.id, 'conv-worker', worker.runId)).toBe(true);
    workerSessionId = (await recordCosBrowserEventsNow('conv-worker', [
      { kind: 'turn_start', turnId: 'turn-worker', time: 3 },
      { kind: 'user_message', turnId: 'turn-worker', messageId: 'message-worker', text: 'Review the current migration slice.', time: 4 }
    ])).sessionId;

    const finished = await agents({
      action: 'finish',
      result: 'RESULT\nReview complete.\n\nCHANGES\nNone.\n\nVALIDATION\nChecked.\n\nBLOCKERS\nNone.'
    }, callContext('wfr_worker'));
    expect(structured(finished)).toMatchObject({ action: 'finish', self: 'worker-1', state: 'sleeping' });

    const reuseFirst = await agents({
      action: 'spawn',
      workers: [{ label: 'Follow-up', task: 'Review the follow-up migration slice.' }]
    }, callContext('wfr_prime'));
    expect(structured(reuseFirst)).toMatchObject({
      action: 'spawn',
      outcome: 'reuse_available',
      reusable_total: 1
    });
    expect(reuseFirst.content.some(
      (part) => part.type === 'text' && part.text.includes('[worker-1 reported]')
    )).toBe(true);
    expect(opened).toHaveLength(1);

    const message = await agents({
      action: 'message',
      to: 'worker-1',
      text: 'Continue with the follow-up review in this same chat.'
    }, callContext('wfr_prime'));
    expect(structured(message)).toMatchObject({ action: 'message', waking: ['worker-1'] });
    expect(revived).toHaveLength(1);
    expect(revived[0]![0]).toMatchObject({ id: 'worker-1', conversationId: 'conv-worker' });
    expect(revived[0]![0]).not.toHaveProperty('text');
    expect(revived[0]![0]).not.toHaveProperty('messageIds');

    const revival = revived[0]![0]!;
    const payload = await claimCosWorkerRevival(revival.id, revival.conversationId, 'revive-1', revival.runId);
    expect(payload).toMatchObject({ id: 'worker-1', conversationId: 'conv-worker' });
    expect(payload?.text).toContain('Continue with the follow-up review in this same chat.');
    expect(await acknowledgeCosWorkerRevival({
      workerId: revival.id,
      conversationId: revival.conversationId,
      runId: revival.runId,
      commandId: 'revive-stale',
      status: 'sent'
    })).toBe(false);
    expect(await acknowledgeCosWorkerRevival({
      workerId: revival.id,
      conversationId: revival.conversationId,
      runId: revival.runId,
      commandId: 'revive-stale',
      status: 'failed',
      error: 'stale browser document'
    })).toBe(false);
    expect(await acknowledgeCosWorkerRevival({
      workerId: revival.id,
      conversationId: 'conv-not-worker',
      runId: revival.runId,
      commandId: 'revive-1',
      status: 'sent'
    })).toBe(false);
    expect(await acknowledgeCosWorkerRevival({
      workerId: revival.id,
      conversationId: revival.conversationId,
      runId: revival.runId,
      commandId: 'revive-1',
      status: 'sent'
    })).toBe(true);
    expect(await acknowledgeCosWorkerRevival({
      workerId: revival.id,
      conversationId: revival.conversationId,
      runId: revival.runId,
      commandId: 'revive-1',
      status: 'sent'
    })).toBe(true);
    expect(await acknowledgeCosWorkerRevival({
      workerId: revival.id,
      conversationId: revival.conversationId,
      runId: revival.runId,
      commandId: 'revive-stale',
      status: 'sent'
    })).toBe(false);

    const workerStatus = await agents({ action: 'status' }, callContext('wfr_worker'));
    const workerRows = structured(workerStatus)['agents'] as Array<{ id: string; state: string }>;
    expect(workerRows.find((row) => row.id === 'worker-1')?.state).toBe('active');

    expect(await finishCosWorkerConversationNow('conv-worker', 'Browser observed the settled worker answer.')).toBe(true);
    const afterBrowserFinish = await agents({
      action: 'spawn',
      workers: [{ label: 'Reuse again', task: 'Keep using the same worker conversation.' }]
    }, callContext('wfr_prime'));
    expect(structured(afterBrowserFinish)).toMatchObject({
      action: 'spawn',
      outcome: 'reuse_available',
      reusable_total: 1
    });
    expect(opened).toHaveLength(1);

    const secondWake = await agents({
      action: 'message',
      to: 'worker-1',
      text: 'Start the second follow-up in this same chat.'
    }, callContext('wfr_prime'));
    expect(structured(secondWake)).toMatchObject({ action: 'message', waking: ['worker-1'] });
    expect(revived).toHaveLength(2);
    const secondRequest = revived[1]![0]!;
    const secondPayload = await claimCosWorkerRevival(
      secondRequest.id,
      secondRequest.conversationId,
      'revive-2',
      secondRequest.runId
    );
    expect(secondPayload?.text).toContain('Start the second follow-up in this same chat.');
    expect(await acknowledgeCosWorkerRevival({
      workerId: secondRequest.id,
      conversationId: secondRequest.conversationId,
      runId: secondRequest.runId,
      commandId: 'revive-2',
      status: 'sent'
    })).toBe(true);
    await agents({ action: 'status' }, callContext('wfr_worker'));

    const queuedWhileActive = await agents({
      action: 'message',
      to: 'worker-1',
      text: 'This arrived while the worker was already active.'
    }, callContext('wfr_prime'));
    expect(structured(queuedWhileActive)).toMatchObject({ action: 'message', waking: [] });
    expect(revived).toHaveLength(2);

    expect(await finishCosWorkerConversationNow('conv-worker', 'Second browser-observed final answer.')).toBe(true);
    expect(revived).toHaveLength(3);
    expect(revived[2]![0]).toMatchObject({ id: 'worker-1', conversationId: 'conv-worker' });
    expect(revived[2]![0]).not.toHaveProperty('text');
  });

  it('restores a reusable sleeping worker instead of creating a replacement after restart', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-host-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();

    const opened: WorkerSpawn[][] = [];
    attachCosHostBrowserRuntime({
      openWorkers: (workers) => { opened.push([...workers]); },
      reviveWorkers: () => undefined
    });
    const primeSession = await recordCosBrowserEventsNow('conv-prime', [
      { kind: 'turn_start', turnId: 'turn-prime', time: 1 },
      { kind: 'user_message', turnId: 'turn-prime', messageId: 'message-prime', text: 'Coordinate workers.', time: 2 }
    ]);
    let workerSessionId: string | null = null;
    attachCosHostIdentityRuntime({
      resolveCaller: async (context) =>
        context.requestId === 'wfr_worker'
          ? workerSessionId ? {
              conversationId: 'conv-worker',
              sessionId: workerSessionId,
              turnId: 'turn-worker',
              messageId: 'message-worker',
              tool: 'agents'
            } : null
          : {
              conversationId: 'conv-prime',
              sessionId: primeSession.sessionId,
              turnId: 'turn-prime',
              messageId: 'message-prime',
              tool: 'agents'
            }
    });

    const agents = cosHostControlRuntime.agents!;
    const spawn = await agents({
      action: 'spawn',
      workers: [{ label: 'Reusable', task: 'Preserve this worker across restart.' }]
    }, callContext('wfr_prime'));
    const worker = opened[0]![0]!;
    expect(bindCosWorkerConversation(worker.id, 'conv-worker', worker.runId)).toBe(true);
    workerSessionId = (await recordCosBrowserEventsNow('conv-worker', [
      { kind: 'turn_start', turnId: 'turn-worker', time: 3 },
      { kind: 'user_message', turnId: 'turn-worker', messageId: 'message-worker', text: 'Preserve this worker across restart.', time: 4 }
    ])).sessionId;
    await agents({
      action: 'finish',
      result: 'RESULT\nReusable worker finished the first assignment.'
    }, callContext('wfr_worker'));
    expect(structured(spawn)['run_id']).toBe(worker.runId);
    await flushDurable();

    shutdownCosHostRuntime();
    resetAgentsForTests();
    await initCosHostRuntime();
    attachCosHostBrowserRuntime({
      openWorkers: (workers) => { opened.push([...workers]); },
      reviveWorkers: () => undefined
    });
    attachCosHostIdentityRuntime({
      resolveCaller: async () => ({
        conversationId: 'conv-prime',
        sessionId: primeSession.sessionId,
        turnId: 'turn-prime',
        messageId: 'message-prime',
        tool: 'agents'
      })
    });

    const afterRestart = await agents({
      action: 'spawn',
      workers: [{ label: 'Should not open', task: 'Use existing context first.' }]
    }, callContext('wfr_prime'));
    expect(structured(afterRestart)).toMatchObject({
      action: 'spawn',
      outcome: 'reuse_available',
      reusable_total: 1
    });
    expect(opened).toHaveLength(1);
  });

  it('fails closed when exact caller identity or browser worker ownership is absent', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-host-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();
    const agents = cosControlRuntimeBridge.agents;

    await expect(cosControlRuntimeBridge.session({ action: 'search' }, callContext('wfr_unknown', 'mcp-session'))).resolves.toMatchObject({
      structuredContent: { action: 'search', sessions: [] }
    });
    await expect(cosControlRuntimeBridge.sessionFinish({ summary: 'done' }, callContext('wfr_unknown', 'mcp-session'))).rejects.toThrow(
      'Exact ChatGPT conversation identity is required for session_finish'
    );

    await expect(agents({ action: 'status' }, callContext('wfr_unknown', 'mcp-session'))).rejects.toThrow(
      'Exact ChatGPT conversation identity is required for agents'
    );

    const primeSession = await recordCosBrowserEventsNow('conv-prime', [
      { kind: 'turn_start', turnId: 'turn-prime', time: 1 },
      { kind: 'user_message', turnId: 'turn-prime', messageId: 'message-prime', text: 'Coordinate workers.', time: 2 }
    ]);
    attachCosHostIdentityRuntime({
      resolveCaller: async () => ({
        conversationId: 'conv-prime',
        sessionId: primeSession.sessionId,
        turnId: 'turn-prime',
        messageId: 'message-prime',
        tool: 'agents'
      })
    });
    await expect(agents({
      action: 'spawn',
      workers: [{ task: 'Do not create a browserless worker.' }]
    }, callContext('wfr_prime', 'mcp-session'))).rejects.toThrow(
      'browser worker runtime is unavailable'
    );

    shutdownCosHostRuntime();
    await expect(agents({ action: 'status' }, callContext('wfr_prime', 'mcp-session'))).rejects.toThrow('not attached');
  });
});
