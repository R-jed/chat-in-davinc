import { chmod, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  agentForConversation,
  onSwarmPersist,
  onSwarmPersistNow,
  pendingWorkerSpawns,
  resetAgentsForTests,
  swarmTransferActive
} from '../src/cos-host/agents.js';
import {
  abortCosContinuationNow,
  beginCosContinuationDestinationSendNow,
  beginCosContinuationSourceSendNow,
  bindCosContinuationSourceMessageNow,
  captureCosContinuationSummaryNow,
  commitCosContinuationFromAckNow,
  continuationByToken,
  continuationForSession,
  dispatchCosContinuationDestinationSendNow,
  dispatchCosContinuationSourceSendNow,
  openCosContinuationNow,
  resetCosContinuationRuntimeForTests
} from '../src/cos-host/continuation-runtime.js';
import { resetCosHostConfigForTests } from '../src/cos-host/config.js';
import { resetCanonicalGoalForTests } from '../src/cos-host/canonical/goal.js';
import { resetDecisionInputForTests } from '../src/cos-host/canonical/input.js';
import {
  attachCosHostBrowserRuntime,
  attachCosHostIdentityRuntime,
  bindCosWorkerConversation,
  cosHostControlRuntime,
  initCosHostRuntime,
  shutdownCosHostRuntime
} from '../src/cos-host/runtime.js';
import {
  currentCosSessionForConversation,
  recordCosBrowserEventsNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';
import {
  flushDurable,
  initDurableStore,
  readDurable,
  resetDurableForTests,
  writeDurableNow
} from '../src/main/durable.js';
import type { CosControlCallContext } from '../src/main/cos-control-tools.js';

const PRIME = '11111111-1111-4111-8111-111111111111';
const RESUMED = '22222222-2222-4222-8222-222222222222';
const WORKER = '33333333-3333-4333-8333-333333333333';

let tempDir: string | null = null;

function callContext(requestId: string): CosControlCallContext {
  return { transportSessionId: 'mcp-test', requestId, startedAt: Date.now() };
}

async function setupPrime(): Promise<string> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-continuation-'));
  initDurableStore(tempDir);
  await initCosHostRuntime();
  attachCosHostBrowserRuntime({ openWorkers: () => undefined, reviveWorkers: () => undefined });

  const session = await recordCosBrowserEventsNow(PRIME, [
    { kind: 'turn_start', turnId: 'source-turn', time: 100 },
    { kind: 'user_message', turnId: 'source-turn', messageId: 'source-user', text: 'Preserve this work.', time: 101 }
  ]);
  attachCosHostIdentityRuntime({
    resolveCaller: async (context) => context.requestId === 'wfr-prime'
      ? {
          conversationId: PRIME,
          sessionId: session.sessionId,
          turnId: 'source-turn',
          messageId: 'source-user',
          tool: 'agents'
        }
      : null
  });
  await cosHostControlRuntime.agents!({
    action: 'spawn',
    workers: [{ label: 'Continuity', task: 'Remain attached while the prime changes conversations.' }]
  }, callContext('wfr-prime'));
  await recordCosBrowserEventsNow(PRIME, [
    { kind: 'turn_end', turnId: 'source-turn', outcome: 'completed', time: 102 }
  ]);
  await flushDurable();
  return session.sessionId;
}

async function readyContinuation(sessionId: string): Promise<string> {
  const opened = await openCosContinuationNow(sessionId, PRIME);
  const token = opened.continuation.token;
  expect((await beginCosContinuationSourceSendNow(token))?.allowed).toBe(true);
  expect(await dispatchCosContinuationSourceSendNow(token)).toBe(true);
  expect(await bindCosContinuationSourceMessageNow(token, 'handoff-message', 123)).toBe(true);
  expect(await captureCosContinuationSummaryNow(token, 'Continue the same durable work.')).not.toBeNull();
  expect((await beginCosContinuationDestinationSendNow(token))?.allowed).toBe(true);
  expect(await dispatchCosContinuationDestinationSendNow(token)).toBe(true);
  await flushDurable();
  return token;
}

function injectOneSwarmBarrierFailure(): void {
  let fail = true;
  // Prevent the cheap mirror from racing the injected fsync-equivalent failure and accidentally
  // making the moved Prime durable before the simulated crash boundary is inspected.
  onSwarmPersist(() => undefined);
  onSwarmPersistNow(async (snapshot) => {
    if (fail) {
      fail = false;
      throw new Error('injected swarm durability failure');
    }
    await writeDurableNow('cos-swarm', snapshot);
  });
}

afterEach(async () => {
  shutdownCosHostRuntime();
  await flushDurable().catch(() => undefined);
  resetAgentsForTests();
  resetCosContinuationRuntimeForTests();
  resetCosSessionRuntimeForTests();
  resetCanonicalGoalForTests();
  resetDecisionInputForTests();
  resetCosHostConfigForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('COS Compact & Resume durable authority', () => {
  it('does not publish a Prime transfer when the continuation transaction record cannot become durable', async () => {
    const sessionId = await setupPrime();
    const stateDir = path.join(tempDir!, 'state');
    await chmod(stateDir, 0o500);
    try {
      await expect(openCosContinuationNow(sessionId, PRIME)).rejects.toBeTruthy();
    } finally {
      await chmod(stateDir, 0o700);
    }
    expect(continuationForSession(sessionId)).toBeNull();
    expect(swarmTransferActive()).toBe(false);

    // Once storage is available, the same source can create one clean transaction normally.
    const opened = await openCosContinuationNow(sessionId, PRIME);
    expect(opened.started).toBe(true);
    expect(continuationForSession(sessionId)?.token).toBe(opened.continuation.token);
    expect(swarmTransferActive()).toBe(true);
  });

  it('keeps durable Prime authority on source A when a source-owned continuation aborts', async () => {
    const sessionId = await setupPrime();
    const opened = await openCosContinuationNow(sessionId, PRIME);
    const token = opened.continuation.token;
    expect(swarmTransferActive()).toBe(true);
    const before = await readDurable<{ primeConversationId?: string | null }>('cos-swarm');
    expect(before?.primeConversationId).toBe(PRIME);

    expect(await abortCosContinuationNow(token, 'cancel before source send')).toBe(true);
    expect(continuationByToken(token)).toMatchObject({ state: 'aborted' });
    expect(swarmTransferActive()).toBe(false);
    expect(currentCosSessionForConversation(PRIME)?.sessionId).toBe(sessionId);
    const after = await readDurable<{ primeConversationId?: string | null }>('cos-swarm');
    expect(after?.primeConversationId).toBe(PRIME);

    // Process restart restores the same durable owner and never resurrects the volatile transfer.
    shutdownCosHostRuntime();
    resetAgentsForTests();
    resetCosContinuationRuntimeForTests();
    resetCosSessionRuntimeForTests();
    await initCosHostRuntime();
    expect(currentCosSessionForConversation(PRIME)?.sessionId).toBe(sessionId);
    expect(agentForConversation(PRIME)).toBe('prime');
    expect(swarmTransferActive()).toBe(false);
    expect(continuationByToken(token)).toMatchObject({ state: 'aborted' });
  });

  it('recovers forward instead of aborting after Session B crossed the durable cut', async () => {
    const sessionId = await setupPrime();
    const token = await readyContinuation(sessionId);
    injectOneSwarmBarrierFailure();

    await expect(commitCosContinuationFromAckNow(token, RESUMED)).rejects.toThrow('injected swarm durability failure');
    expect(currentCosSessionForConversation(RESUMED)?.sessionId).toBe(sessionId);
    expect(currentCosSessionForConversation(PRIME)).toBeNull();
    expect(continuationByToken(token)).toMatchObject({ state: 'awaiting-chat', to: null });

    // Timeout/failed-ACK settlement is no longer allowed to publish an irreversible abort once
    // Session=B. It drains the pending Prime durability barrier and commits the same transaction.
    expect(await abortCosContinuationNow(token, 'injected browser failure after Session rebind')).toBe(false);
    expect(continuationByToken(token)).toMatchObject({
      state: 'committed',
      to: RESUMED,
      destinationSend: { state: 'sent', conversationId: RESUMED }
    });
    expect(agentForConversation(PRIME)).toBeNull();
    expect(agentForConversation(RESUMED)).toBe('prime');
    expect(await commitCosContinuationFromAckNow(token, RESUMED)).toBe('already-committed');
  });

  it('restarts from Session=B / durable Prime=A and deterministically converges forward', async () => {
    const sessionId = await setupPrime();
    const token = await readyContinuation(sessionId);
    injectOneSwarmBarrierFailure();

    await expect(commitCosContinuationFromAckNow(token, RESUMED)).rejects.toThrow('injected swarm durability failure');
    const swarmBefore = await readDurable<{ primeConversationId?: string | null }>('cos-swarm');
    expect(swarmBefore?.primeConversationId).toBe(PRIME);
    expect(currentCosSessionForConversation(RESUMED)?.sessionId).toBe(sessionId);

    // Simulate process death: discard only in-memory authorities and leave the exact durable
    // intermediate on disk. Runtime startup must repair Prime first, persist it, then mark the
    // continuation committed; A and B must never both be authoritative after recovery.
    shutdownCosHostRuntime();
    resetAgentsForTests();
    resetCosContinuationRuntimeForTests();
    resetCosSessionRuntimeForTests();
    await initCosHostRuntime();

    expect(currentCosSessionForConversation(RESUMED)?.sessionId).toBe(sessionId);
    expect(currentCosSessionForConversation(PRIME)).toBeNull();
    expect(continuationByToken(token)).toMatchObject({ state: 'committed', to: RESUMED });
    expect(agentForConversation(PRIME)).toBeNull();
    expect(agentForConversation(RESUMED)).toBe('prime');
    expect((await readDurable<{ primeConversationId?: string | null }>('cos-swarm'))?.primeConversationId).toBe(RESUMED);
    expect(await commitCosContinuationFromAckNow(token, RESUMED)).toBe('already-committed');
  });

  it('repairs an old aborted-on-disk intermediate when the durable Session already owns B', async () => {
    const sessionId = await setupPrime();
    const token = await readyContinuation(sessionId);
    injectOneSwarmBarrierFailure();
    await expect(commitCosContinuationFromAckNow(token, RESUMED)).rejects.toThrow('injected swarm durability failure');

    const saved = await readDurable<{
      version: 1;
      savedAt: number;
      continuations: Array<Record<string, unknown>>;
    }>('cos-continuations');
    expect(saved).not.toBeNull();
    const rows = saved!.continuations.map((row) =>
      row['token'] === token ? { ...row, state: 'aborted', error: 'injected old split-brain terminal' } : row
    );
    await writeDurableNow('cos-continuations', { ...saved!, continuations: rows });

    shutdownCosHostRuntime();
    resetAgentsForTests();
    resetCosContinuationRuntimeForTests();
    resetCosSessionRuntimeForTests();
    await initCosHostRuntime();

    expect(continuationByToken(token)).toMatchObject({ state: 'committed', to: RESUMED, error: null });
    expect(agentForConversation(PRIME)).toBeNull();
    expect(agentForConversation(RESUMED)).toBe('prime');
  });

  it('refuses to rebind a Session onto an existing Worker conversation', async () => {
    const sessionId = await setupPrime();
    const pending = pendingWorkerSpawns()[0];
    expect(pending).toBeTruthy();
    expect(bindCosWorkerConversation(pending!.id, WORKER, pending!.runId)).toBe(true);
    const token = await readyContinuation(sessionId);

    expect(await commitCosContinuationFromAckNow(token, WORKER)).toBe('rejected');
    expect(currentCosSessionForConversation(PRIME)?.sessionId).toBe(sessionId);
    expect(currentCosSessionForConversation(WORKER)).toBeNull();
    expect(continuationByToken(token)).toMatchObject({ state: 'awaiting-chat', to: null });
  });
});
