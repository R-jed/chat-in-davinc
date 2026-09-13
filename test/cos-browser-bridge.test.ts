import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  safeStorage: {
    isAsyncEncryptionAvailable: vi.fn(async () => true),
    encryptStringAsync: vi.fn(async (value: string) => Buffer.from(value, 'utf8')),
    decryptStringAsync: vi.fn(async (buffer: Buffer) => ({ result: buffer.toString('utf8'), shouldReEncrypt: false }))
  },
  shell: { openExternal: vi.fn(async () => undefined) }
}));

import { pendingWorkerSpawns, resetAgentsForTests } from '../src/cos-host/agents.js';
import {
  cosBrowserRuntime,
  cosBrowserBridgeStatus,
  resetCosBrowserBridgeForTests,
  startCosBrowserBridge,
  stopCosBrowserBridge
} from '../src/cos-host/browser-bridge.js';
import { CID_COMPANION_BRIDGE_PROTOCOL, CID_COMPANION_EXTENSION_ORIGIN } from '../src/cos-host/companion-identity.js';
import { resetCosHostConfigForTests } from '../src/cos-host/config.js';
import { cosRequestCorrelation, resetCosRequestCorrelationsForTests } from '../src/cos-host/identity.js';
import { resetCosContinuationRuntimeForTests } from '../src/cos-host/continuation-runtime.js';
import { goalObjectiveFor, resetCanonicalGoalForTests } from '../src/cos-host/canonical/goal.js';
import { pausedBrowserHelpers, resetDecisionInputForTests } from '../src/cos-host/canonical/input.js';
import {
  cosSessionForConversation,
  recordCosBrowserEventsNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';
import { resetCosProtectedToolActivityForTests } from '../src/cos-host/tool-activity.js';
import {
  attachCosHostDecisionRuntime,
  attachCosHostIdentityRuntime,
  cosHostControlRuntime,
  initCosHostRuntime,
  shutdownCosHostRuntime,
  type CosHostDecisionProjection
} from '../src/cos-host/runtime.js';
import type { CosControlCallContext } from '../src/main/cos-control-tools.js';
import { flushDurable, initDurableStore, readDurable, resetDurableForTests } from '../src/main/durable.js';
import { initSecrets, resetSecretsCacheForTests } from '../src/main/secrets.js';

const PRIME = '11111111-1111-4111-8111-111111111111';
const WORKER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const RESUMED = '44444444-4444-4444-8444-444444444444';
const HELPER = '55555555-5555-4555-8555-555555555555';

let tempDir: string | null = null;
let base = '';
let token = '';

function callContext(requestId: string): CosControlCallContext {
  return { transportSessionId: null, requestId, startedAt: Date.now() };
}

function structured(result: { structuredContent?: unknown }): Record<string, unknown> {
  return (result.structuredContent ?? {}) as Record<string, unknown>;
}

function completedGoalProjection(sessionId: string, turnId: string): CosHostDecisionProjection {
  return {
    decision: {
      schemaVersion: 1,
      sessionId,
      turnId,
      compiledAt: Date.now(),
      generation: 1,
      provenanceRevision: 1,
      decisionKind: 'finish_check',
      goalCriterion: 'Finish this exact Goal.',
      openObligation: 'Finish this exact Goal.',
      completionGap: null,
      materialUncertainty: null,
      minimumFacts: [],
      evidenceRefs: [],
      staleDependencies: [],
      sharedFocus: null,
      actionOffers: [],
      riskHints: [],
      costHints: [],
      workspace: null
    },
    completion: {
      schemaVersion: 1,
      sessionId,
      evaluatedAt: Date.now(),
      generation: 1,
      complete: true,
      criteria: [{
        criterion: 'Finish this exact Goal.',
        status: 'satisfied',
        evidenceIds: ['E-goal-complete'],
        strongestVerification: 'API_READBACK',
        blockingReason: null
      }],
      blockers: [],
      materialUnknowns: [],
      evidenceIds: ['E-goal-complete'],
      strongestVerification: 'API_READBACK'
    }
  };
}

async function bridgeFetch(route: string, init: RequestInit = {}, authorised = true): Promise<Response> {
  return await fetch(`${base}${route}`, {
    ...init,
    headers: {
      origin: CID_COMPANION_EXTENSION_ORIGIN,
      'x-extension-protocol': String(CID_COMPANION_BRIDGE_PROTOCOL),
      'x-extension-version': '0.1.0',
      ...(authorised && token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {})
    }
  });
}

async function answerNextGoalDecision(response: string, helperConversationId = HELPER): Promise<void> {
  let input: { id: string; conversationId: string | null; lifetime?: 'temporary-planner' } | null = null;
  await vi.waitFor(async () => {
    const status = await bridgeFetch('/status', { method: 'POST', body: '{}' });
    expect(status.status).toBe(200);
    const body = await status.json() as { inputs?: Array<{ id: string; conversationId: string | null; lifetime?: 'temporary-planner'; close?: boolean }> };
    input = body.inputs?.find((row) => row.close !== true) ?? null;
    expect(input).not.toBeNull();
  });
  const row = input!;
  const owner = `test-owner-${row.id}`;
  const claim = await bridgeFetch('/input/claim', {
    method: 'POST',
    body: JSON.stringify({ id: row.id, owner, conversationId: row.conversationId, requiresAuthorization: true })
  });
  expect(claim.status).toBe(200);
  expect(await claim.json()).toMatchObject({ input: { id: row.id } });
  expect((await bridgeFetch('/input/claim', {
    method: 'POST',
    body: JSON.stringify({ id: row.id, owner, conversationId: row.conversationId, authorize: true })
  })).status).toBe(200);
  const deliveredConversation = row.lifetime === 'temporary-planner'
    ? null
    : row.conversationId ?? helperConversationId;
  const ack = await bridgeFetch('/input/ack', {
    method: 'POST',
    body: JSON.stringify({ id: row.id, owner, conversationId: deliveredConversation, messageId: `helper-${row.id}` })
  });
  expect(ack.status).toBe(200);
  expect(await ack.json()).toEqual({ ok: true });
  const answer = await bridgeFetch('/input/answer', {
    method: 'POST',
    body: JSON.stringify({ id: row.id, owner, conversationId: deliveredConversation, response })
  });
  expect(answer.status).toBe(200);
  expect(await answer.json()).toEqual({ ok: true });
}

async function setup(opened: string[] = []): Promise<void> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-browser-'));
  initSecrets(tempDir);
  initDurableStore(tempDir);
  await initCosHostRuntime();
  await recordCosBrowserEventsNow(PRIME, [
    { kind: 'turn_start', turnId: 'turn-prime-control', time: 1 },
    { kind: 'user_message', turnId: 'turn-prime-control', messageId: 'prime-control', text: 'Coordinate this run.', time: 2 }
  ]);
  attachCosHostIdentityRuntime({
    resolveCaller: async (context) => {
      const conversationId = context.requestId === 'wfr_prime'
        ? PRIME
        : context.requestId === 'wfr_worker'
          ? WORKER
          : context.requestId === 'wfr_resumed'
            ? RESUMED
            : null;
      if (!conversationId) return null;
      const session = cosSessionForConversation(conversationId);
      if (!session || session.conversationId !== conversationId || !session.activeTurnId) return null;
      const message = [...session.events].reverse().find((event) =>
        (event.kind === 'user_message' || event.kind === 'assistant_message')
        && event.turnId === session.activeTurnId
      );
      if (!message || (message.kind !== 'user_message' && message.kind !== 'assistant_message')) return null;
      return {
        conversationId,
        sessionId: session.sessionId,
        turnId: session.activeTurnId,
        messageId: message.messageId,
        tool: 'agents'
      };
    }
  });
  const status = await startCosBrowserBridge({
    ports: [0],
    openExternal: async (url) => { opened.push(url); }
  });
  expect(status.port).not.toBeNull();
  base = `http://127.0.0.1:${status.port}`;
  const pair = await bridgeFetch('/pair', { method: 'POST', body: '{}' }, false);
  expect(pair.status).toBe(200);
  token = String((await pair.json() as { token?: unknown }).token ?? '');
  expect(token).not.toBe('');
  const continuity = await fetch(base + '/pair', {
    method: 'POST',
    headers: {
      origin: CID_COMPANION_EXTENSION_ORIGIN,
      'content-type': 'application/json',
      'x-extension-protocol': String(CID_COMPANION_BRIDGE_PROTOCOL)
    },
    body: '{}'
  });
  expect(continuity.status).toBe(401);
}

afterEach(async () => {
  await stopCosBrowserBridge().catch(() => undefined);
  shutdownCosHostRuntime();
  await flushDurable().catch(() => undefined);
  resetCosBrowserBridgeForTests();
  resetCosContinuationRuntimeForTests();
  resetCanonicalGoalForTests();
  resetDecisionInputForTests();
  resetCosSessionRuntimeForTests();
  resetCosProtectedToolActivityForTests();
  resetCosRequestCorrelationsForTests();
  resetAgentsForTests();
  resetCosHostConfigForTests();
  resetSecretsCacheForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
  base = '';
  token = '';
});

describe('COS browser companion bridge', () => {
  it('exposes the canonical ChatGPT helper as the Goal backend', async () => {
    await setup();
    const settings = await bridgeFetch('/settings');
    expect(settings.status).toBe(200);
    expect(await settings.json()).toMatchObject({ goal: { backend: 'chatgpt', provider: 'chatgpt', hasKey: true } });
  });

  it('never persists a temporary planner prompt or answer in the durable decision outbox', async () => {
    await setup();
    const openingRequest = bridgeFetch('/goal/open', {
      method: 'POST',
      body: JSON.stringify({ text: 'Private temporary planner objective.', mode: 'goal' })
    });
    let plannerId = '';
    await vi.waitFor(async () => {
      const status = await bridgeFetch('/status', { method: 'POST', body: '{}' });
      const body = await status.json() as { inputs?: Array<{ id: string; lifetime?: 'temporary-planner' }> };
      const planner = body.inputs?.find((row) => row.lifetime === 'temporary-planner');
      expect(planner).toBeTruthy();
      plannerId = planner!.id;
    });
    const saved = await readDurable<{ entries?: Array<{ id: string; text?: string; response?: string }> }>('cos-decision-inputs');
    expect(saved?.entries?.find((entry) => entry.id === plannerId)).toMatchObject({ text: '[Temporary planner]' });
    expect(saved?.entries?.find((entry) => entry.id === plannerId)?.response).toBeUndefined();
    await answerNextGoalDecision(JSON.stringify({ action: 'continue', reply: 'Open safely.' }));
    expect((await openingRequest).status).toBe(200);
    const settled = await readDurable<{ entries?: Array<{ id: string; text?: string; response?: string }> }>('cos-decision-inputs');
    expect(settled?.entries?.find((entry) => entry.id === plannerId)).toMatchObject({ text: '[Temporary planner]' });
    expect(settled?.entries?.find((entry) => entry.id === plannerId)?.response).toBeUndefined();
  });

  it('serves COS Goal draft/ack/open and never lets Loop self-stop', async () => {
    await setup();
    const openingRequest = bridgeFetch('/goal/open', {
      method: 'POST',
      body: JSON.stringify({ text: 'Open this Goal.', mode: 'goal' })
    });
    await answerNextGoalDecision(JSON.stringify({ action: 'continue', reply: 'Start the new Goal.' }));
    const opening = await openingRequest;
    expect(opening.status).toBe(200);
    expect(await opening.json()).toEqual({ reply: 'Start the new Goal.', model: 'gpt-5.6-sol' });

    const objective = await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, text: 'Finish this exact Goal.', mode: 'goal' })
    });
    expect(objective.status).toBe(200);
    expect(await objective.json()).toMatchObject({
      objective: 'Finish this exact Goal.',
      enabled: true,
      own: true,
      mode: 'goal'
    });

    const goalEvents = await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [
          { kind: 'turn_start', turnId: 'turn-goal', time: 100 },
          { kind: 'assistant_message', turnId: 'turn-goal', messageId: 'assistant-goal', text: 'Done.', final: true, state: 'final', time: 101 },
          { kind: 'turn_end', turnId: 'turn-goal', outcome: 'completed', time: 102 }
        ]
      })
    });
    expect(goalEvents.status).toBe(200);
    const goalSession = cosSessionForConversation(PRIME)!;
    attachCosHostDecisionRuntime({
      projectSession: async () => completedGoalProjection(goalSession.sessionId, 'turn-goal')
    });

    const staleTurn = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-not-owed', clientId: 'tab-goal' })
    });
    expect(staleTurn.status).toBe(409);
    expect(await staleTurn.json()).toMatchObject({ error: 'goal_reply_not_pending' });

    const firstDraft = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-goal', clientId: 'tab-goal' })
    });
    expect(firstDraft.status).toBe(200);
    const firstDraftBody = await firstDraft.json() as { goal: { token: string } };
    const repeatedDraft = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-goal', clientId: 'tab-goal' })
    });
    expect(repeatedDraft.status).toBe(200);
    expect((await repeatedDraft.json() as { goal: { token: string } }).goal.token).toBe(firstDraftBody.goal.token);
    const wrongOwnerDraft = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-goal', clientId: 'other-tab' })
    });
    expect(wrongOwnerDraft.status).toBe(409);
    expect(await wrongOwnerDraft.json()).toMatchObject({ error: 'goal_owned_elsewhere' });

    await answerNextGoalDecision(JSON.stringify({ action: 'stop', reply: '' }));

    await vi.waitFor(async () => {
      const activity = await bridgeFetch('/activity?conversationId=' + PRIME + '&goalClient=tab-goal');
      expect(activity.status).toBe(200);
      expect(await activity.json()).toMatchObject({
        goal: { draft: { token: firstDraftBody.goal.token, turnId: 'turn-goal', stage: 'no-reply' } }
      });
    });

    const wrongOwnerAck = await bridgeFetch('/goal/ack', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: firstDraftBody.goal.token, clientId: 'other-tab' })
    });
    expect(wrongOwnerAck.status).toBe(200);
    expect(await wrongOwnerAck.json()).toEqual({ acknowledged: false });

    const ack = await bridgeFetch('/goal/ack', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: firstDraftBody.goal.token, clientId: 'tab-goal' })
    });
    expect(ack.status).toBe(200);
    expect(await ack.json()).toEqual({ acknowledged: true });
    const repeatedAck = await bridgeFetch('/goal/ack', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: firstDraftBody.goal.token, clientId: 'tab-goal' })
    });
    expect(await repeatedAck.json()).toEqual({ acknowledged: true });

    const loopObjective = await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, text: 'Keep this Loop moving.', mode: 'loop' })
    });
    expect(loopObjective.status).toBe(200);
    expect(await loopObjective.json()).toMatchObject({ enabled: true, mode: 'loop' });

    expect((await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [
          { kind: 'turn_start', turnId: 'turn-loop', time: 200 },
          { kind: 'turn_end', turnId: 'turn-loop', outcome: 'completed', time: 201 }
        ]
      })
    })).status).toBe(200);
    const loopDraft = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-loop', clientId: 'tab-loop' })
    });
    expect(loopDraft.status).toBe(200);
    const loopToken = (await loopDraft.json() as { goal: { token: string } }).goal.token;
    await answerNextGoalDecision(JSON.stringify({ action: 'stop', reply: '' }));
    await answerNextGoalDecision(JSON.stringify({ action: 'stop', reply: '' }));
    await answerNextGoalDecision(JSON.stringify({ action: 'stop', reply: '' }));
    await vi.waitFor(async () => {
      const activity = await bridgeFetch('/activity?conversationId=' + PRIME + '&goalClient=tab-loop');
      expect(await activity.json()).toMatchObject({
        goal: { draft: { token: loopToken, turnId: 'turn-loop', stage: 'failed', error: 'loop_stop_refused', retryable: true } }
      });
    });

    const cleared = await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, text: '', mode: 'goal' })
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toMatchObject({ objective: '', enabled: false, mode: 'loop' });
  });

  it('fails closed when a Goal provider asks to stop without CID Completion evidence', async () => {
    await setup();
    expect((await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, text: 'Finish only with evidence.', mode: 'goal' })
    })).status).toBe(200);
    expect((await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [
          { kind: 'turn_start', turnId: 'turn-no-completion', time: 300 },
          { kind: 'turn_end', turnId: 'turn-no-completion', outcome: 'completed', time: 301 }
        ]
      })
    })).status).toBe(200);
    const draft = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-no-completion', clientId: 'tab-no-completion' })
    });
    expect(draft.status).toBe(200);
    const token = (await draft.json() as { goal: { token: string } }).goal.token;
    await answerNextGoalDecision(JSON.stringify({ action: 'stop', reply: '' }));
    await vi.waitFor(async () => {
      const activity = await bridgeFetch('/activity?conversationId=' + PRIME + '&goalClient=tab-no-completion');
      expect(await activity.json()).toMatchObject({
        goal: {
          draft: {
            token,
            stage: 'failed',
            error: 'goal_completion_evidence_unavailable',
            retryable: true
          }
        }
      });
    });
  });

  it('requires an explicit user-authorized fresh helper after an ambiguous browser send', async () => {
    await setup();
    expect((await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, text: 'Recover this exact Goal safely.', mode: 'goal' })
    })).status).toBe(200);
    expect((await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [
          { kind: 'turn_start', turnId: 'turn-ambiguous-helper', time: 500 },
          { kind: 'turn_end', turnId: 'turn-ambiguous-helper', outcome: 'completed', time: 501 }
        ]
      })
    })).status).toBe(200);

    const first = await bridgeFetch('/goal/draft', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-ambiguous-helper', clientId: 'tab-ambiguous' })
    });
    expect(first.status).toBe(200);
    const firstToken = (await first.json() as { goal: { token: string } }).goal.token;

    let input: { id: string; conversationId: string | null } | null = null;
    await vi.waitFor(async () => {
      const status = await bridgeFetch('/status', { method: 'POST', body: '{}' });
      const body = await status.json() as { inputs?: Array<{ id: string; conversationId: string | null }> };
      input = body.inputs?.find((row) => row.conversationId === null) ?? null;
      expect(input).not.toBeNull();
    });
    const owner = `ambiguous-${input!.id}`;
    expect((await bridgeFetch('/input/claim', {
      method: 'POST',
      body: JSON.stringify({ id: input!.id, owner, conversationId: null, requiresAuthorization: true })
    })).status).toBe(200);
    expect(await (await bridgeFetch('/input/claim', {
      method: 'POST',
      body: JSON.stringify({ id: input!.id, owner, conversationId: null, authorize: true })
    })).json()).toEqual({ ok: true });

    expect(await (await bridgeFetch('/goal/ack', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: firstToken, clientId: 'tab-ambiguous' })
    })).json()).toEqual({ acknowledged: true });
    await vi.waitFor(() => expect(pausedBrowserHelpers()).toEqual([{ id: input!.id, sourceSessionId: cosSessionForConversation(PRIME)!.sessionId }]));

    let blockedToken = '';
    await vi.waitFor(async () => {
      const retried = await bridgeFetch('/goal/draft', {
        method: 'POST',
        body: JSON.stringify({ conversationId: PRIME, turnId: 'turn-ambiguous-helper', clientId: 'tab-ambiguous' })
      });
      expect(retried.status).toBe(200);
      blockedToken = (await retried.json() as { goal: { token: string } }).goal.token;
      expect(blockedToken).not.toBe(firstToken);
    });
    await vi.waitFor(async () => {
      const activity = await bridgeFetch('/activity?conversationId=' + PRIME + '&goalClient=tab-ambiguous');
      expect(await activity.json()).toMatchObject({
        goal: {
          pausedHelper: input!.id,
          draft: { token: blockedToken, stage: 'failed', error: 'goal_browser_send_unconfirmed', retryable: false }
        }
      });
    });
    expect(await (await bridgeFetch('/goal/ack', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: blockedToken, clientId: 'tab-ambiguous' })
    })).json()).toEqual({ acknowledged: true });

    const recovery = await bridgeFetch('/goal/helper/retry', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, inputId: input!.id, clientId: 'tab-ambiguous' })
    });
    expect(recovery.status).toBe(200);
    expect(await recovery.json()).toEqual({ accepted: true });
    expect(pausedBrowserHelpers()).toEqual([]);
    await answerNextGoalDecision(JSON.stringify({ action: 'continue', reply: 'Recovered with a fresh helper.' }));
    await vi.waitFor(async () => {
      const activity = await bridgeFetch('/activity?conversationId=' + PRIME + '&goalClient=tab-ambiguous');
      expect(await activity.json()).toMatchObject({
        goal: { draft: { stage: 'ready', reply: 'Recovered with a fresh helper.' } }
      });
    });
  });

  it('pins the CID extension origin and durably records exact request-id ownership', async () => {
    await setup();
    expect(cosBrowserBridgeStatus()).toMatchObject({ running: true, paired: true });

    const rejected = await fetch(`${base}/pair`, {
      method: 'POST',
      headers: {
        origin: 'https://chatgpt.com',
        'content-type': 'application/json',
        'x-extension-protocol': String(CID_COMPANION_BRIDGE_PROTOCOL)
      },
      body: '{}'
    });
    expect(rejected.status).toBe(403);

    const oldBearer = token;
    const rotate = async (): Promise<Response> => await fetch(base + '/pair', {
      method: 'POST',
      headers: {
        origin: CID_COMPANION_EXTENSION_ORIGIN,
        authorization: `Bearer ${oldBearer}`,
        'content-type': 'application/json',
        'x-extension-protocol': String(CID_COMPANION_BRIDGE_PROTOCOL)
      },
      body: '{}'
    });
    const rotations = await Promise.all([rotate(), rotate()]);
    expect(rotations.map((response) => response.status).sort()).toEqual([200, 401]);
    const winner = rotations.find((response) => response.status === 200)!;
    token = String((await winner.json() as { token?: unknown }).token ?? '');
    expect(token).not.toBe('');

    const exactTurn = await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [
          { kind: 'turn_start', turnId: 'turn-exact-bridge', time: Date.now() },
          { kind: 'user_message', turnId: 'turn-exact-bridge', messageId: 'message-1', text: 'Run exact protected work.', time: Date.now() + 1 }
        ]
      })
    });
    expect(exactTurn.status).toBe(200);

    const correlated = await bridgeFetch('/correlations', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        calls: [{ requestId: 'wfr_exact_bridge', messageId: 'message-1', turnId: 'turn-exact-bridge', tool: 'agents' }]
      })
    });
    expect(correlated.status).toBe(200);
    expect(await correlated.json()).toMatchObject({ complete: true, confirmed: ['wfr_exact_bridge'], conflicts: [] });
    expect(cosRequestCorrelation('wfr_exact_bridge')).toMatchObject({
      conversationId: PRIME,
      messageId: 'message-1',
      turnId: 'turn-exact-bridge',
      tool: 'agents'
    });

    const missingMessage = await bridgeFetch('/correlations', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        calls: [{ requestId: 'wfr_missing_message', messageId: 'does-not-exist', turnId: 'turn-exact-bridge', tool: 'agents' }]
      })
    });
    expect(missingMessage.status).toBe(200);
    expect(await missingMessage.json()).toMatchObject({ complete: false, confirmed: [], conflicts: ['wfr_missing_message'] });
    expect(cosRequestCorrelation('wfr_missing_message')).toBeNull();

    const missingTool = await bridgeFetch('/correlations', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        calls: [{ requestId: 'wfr_missing_tool', messageId: 'message-1', turnId: 'turn-exact-bridge' }]
      })
    });
    expect(missingTool.status).toBe(400);
    expect(cosRequestCorrelation('wfr_missing_tool')).toBeNull();

    const conflict = await bridgeFetch('/correlations', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: OTHER,
        calls: [{ requestId: 'wfr_exact_bridge', messageId: 'message-2', turnId: 'turn-other', tool: 'agents' }]
      })
    });
    expect(conflict.status).toBe(200);
    expect(await conflict.json()).toMatchObject({ complete: false, conflicts: ['wfr_exact_bridge'] });
    expect(cosRequestCorrelation('wfr_exact_bridge')?.conversationId).toBe(PRIME);
  });

  it('uses one durable browser command lifecycle for fresh Worker, exact revival and settled finish', async () => {
    const opened: string[] = [];
    await setup(opened);
    const agents = cosHostControlRuntime.agents!;

    const spawn = await agents({
      action: 'spawn',
      workers: [{ label: 'Bridge worker', task: 'Review the browser bridge path.' }]
    }, callContext('wfr_prime'));
    expect(structured(spawn)).toMatchObject({
      action: 'spawn',
      workers: [{ id: 'worker-1', state: 'invited' }]
    });
    const pending = pendingWorkerSpawns();
    await Promise.all([
      cosBrowserRuntime.openWorkers(pending),
      cosBrowserRuntime.openWorkers(pending)
    ]);
    await vi.waitFor(() => expect(opened).toHaveLength(1));
    const workerCommandId = new URL(opened[0]!).searchParams.get('clf');
    expect(workerCommandId).toBeTruthy();

    // A process/bridge restart restores the durable lease instead of opening a duplicate Worker
    // chat. The exact command marker remains the same browser authority.
    await stopCosBrowserBridge();
    const restarted = await startCosBrowserBridge({
      ports: [0],
      openExternal: async (url) => { opened.push(url); }
    });
    base = `http://127.0.0.1:${restarted.port}`;
    expect(opened).toHaveLength(1);

    const redeem = await bridgeFetch('/commands/redeem', {
      method: 'POST',
      body: JSON.stringify({ id: workerCommandId, client: 'fresh-document' })
    });
    expect(redeem.status).toBe(200);
    expect(await redeem.json()).toMatchObject({ command: { id: workerCommandId, type: 'worker', agent: 'worker-1' } });

    const freshAck = await bridgeFetch('/commands/ack', {
      method: 'POST',
      body: JSON.stringify({
        id: workerCommandId,
        client: 'fresh-document',
        status: 'sent',
        conversationId: WORKER,
        agent: 'worker-1'
      })
    });
    expect(freshAck.status).toBe(200);
    expect(await freshAck.json()).toMatchObject({ committed: true, conversationId: WORKER });
    await recordCosBrowserEventsNow(WORKER, [
      { kind: 'turn_start', turnId: 'turn-worker-control', time: 10 },
      { kind: 'user_message', turnId: 'turn-worker-control', messageId: 'worker-control', text: 'Review the browser bridge path.', time: 11 }
    ]);

    const workerGoal = await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: WORKER, text: 'Workers do not own Goal.', mode: 'goal' })
    });
    expect(workerGoal.status).toBe(409);
    expect(await workerGoal.json()).toMatchObject({ error: 'goal_worker_chat' });

    const finish = await agents({
      action: 'finish',
      result: 'RESULT\nBridge worker finished.\n\nCHANGES\nNone.\n\nVALIDATION\nDone.\n\nBLOCKERS\nNone.'
    }, callContext('wfr_worker'));
    expect(structured(finish)).toMatchObject({ self: 'worker-1', state: 'sleeping' });

    const wake = await agents({
      action: 'message',
      to: 'worker-1',
      text: 'Continue in this exact worker conversation.'
    }, callContext('wfr_prime'));
    expect(structured(wake)).toMatchObject({ action: 'message', waking: ['worker-1'] });

    await vi.waitFor(async () => {
      const status = await bridgeFetch('/status', { method: 'POST', body: JSON.stringify({ openConversations: [WORKER] }) });
      expect(status.status).toBe(200);
      const pending = (await status.json() as { revival?: { id?: string; conversationId?: string } }).revival ?? null;
      expect(pending).toMatchObject({ conversationId: WORKER });
    });
    const readyStatus = await bridgeFetch('/status', { method: 'POST', body: JSON.stringify({ openConversations: [WORKER] }) });
    expect(readyStatus.status).toBe(200);
    const revival = (await readyStatus.json() as { revival?: { id?: string; conversationId?: string } }).revival ?? null;
    expect(revival).toMatchObject({ conversationId: WORKER });
    expect(revival?.id).toBeTruthy();
    expect(opened).toHaveLength(1);

    const wrongRedeem = await bridgeFetch('/commands/redeem', {
      method: 'POST',
      body: JSON.stringify({ id: revival!.id, client: 'revival-document', conversationId: OTHER })
    });
    expect(wrongRedeem.status).toBe(409);

    const revivalRedeem = await bridgeFetch('/commands/redeem', {
      method: 'POST',
      body: JSON.stringify({ id: revival!.id, client: 'revival-document', conversationId: WORKER })
    });
    expect(revivalRedeem.status).toBe(200);
    expect(await revivalRedeem.json()).toMatchObject({
      command: { id: revival!.id, type: 'revive', conversationId: WORKER, text: expect.stringContaining('Continue in this exact worker conversation.') }
    });

    const revivalAck = await bridgeFetch('/commands/ack', {
      method: 'POST',
      body: JSON.stringify({ id: revival!.id, client: 'revival-document', status: 'sent', conversationId: WORKER })
    });
    expect(revivalAck.status).toBe(200);
    expect(await revivalAck.json()).toMatchObject({ committed: true, conversationId: WORKER });

    const workerStatus = await agents({ action: 'status' }, callContext('wfr_worker'));
    const workerRows = structured(workerStatus)['agents'] as Array<{ id: string; state: string }>;
    expect(workerRows.find((row) => row.id === 'worker-1')?.state).toBe('active');

    // A complete old turn is still history. Its start predates the durable revival claim, so even
    // turn_start + active final + completed turn_end cannot finish the newer active wake.
    const oldTurnStart = Date.now() - 10_000;
    const historicalFinal = await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: WORKER,
        events: [
          { kind: 'turn_start', turnId: 'old-turn', time: oldTurnStart },
          {
            kind: 'assistant_message',
            messageId: 'historical-final',
            turnId: 'old-turn',
            text: 'Old final answer replayed from the browser journal.',
            state: 'final',
            final: true,
            activeNow: true,
            time: oldTurnStart + 10
          },
          { kind: 'turn_end', turnId: 'old-turn', outcome: 'completed', time: oldTurnStart + 20 }
        ]
      })
    });
    expect(historicalFinal.status).toBe(200);
    const stillActive = await agents({ action: 'status' }, callContext('wfr_prime'));
    const stillActiveRows = structured(stillActive)['agents'] as Array<{ id: string; state: string }>;
    expect(stillActiveRows.find((row) => row.id === 'worker-1')?.state).toBe('active');

    const revivedTurnStart = Date.now();
    const events = await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: WORKER,
        events: [
          { kind: 'turn_start', turnId: 'turn-revival', time: revivedTurnStart },
          {
            kind: 'assistant_message',
            messageId: 'assistant-final',
            turnId: 'turn-revival',
            text: 'Browser observed the final worker answer.',
            state: 'final',
            final: true,
            activeNow: true,
            time: revivedTurnStart + 1
          },
          { kind: 'turn_end', turnId: 'turn-revival', outcome: 'completed', time: revivedTurnStart + 2 }
        ]
      })
    });
    expect(events.status).toBe(200);

    const reuse = await agents({
      action: 'spawn',
      workers: [{ label: 'Reuse', task: 'Use the existing worker again.' }]
    }, callContext('wfr_prime'));
    expect(structured(reuse)).toMatchObject({ outcome: 'reuse_available', reusable_total: 1 });
    expect(opened).toHaveLength(1);
  });

  it('moves one COS Session and Prime binding across manual Compact & Resume while superseding chat A', async () => {
    const opened: string[] = [];
    await setup(opened);
    const agents = cosHostControlRuntime.agents!;

    const sourceEvents = await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [
          { kind: 'turn_start', turnId: 'turn-source', time: 100 },
          { kind: 'user_message', turnId: 'turn-source', messageId: 'user-source', text: 'Keep this Goal.', time: 101 },
          { kind: 'turn_end', turnId: 'turn-source', outcome: 'completed', time: 102 }
        ]
      })
    });
    expect(sourceEvents.status).toBe(200);
    const sourceSessionId = String((await sourceEvents.json() as { sessionId?: unknown }).sessionId ?? '');
    expect(sourceSessionId).not.toBe('');
    const goal = await bridgeFetch('/goal/objective', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, text: 'Keep this Goal.', mode: 'goal' })
    });
    expect(goal.status).toBe(200);
    await recordCosBrowserEventsNow(PRIME, [
      { kind: 'turn_start', turnId: 'turn-compact-control', time: 103 },
      { kind: 'user_message', turnId: 'turn-compact-control', messageId: 'user-compact-control', text: 'Prepare the worker before compacting.', time: 104 }
    ]);

    const spawn = await agents({
      action: 'spawn',
      workers: [{ label: 'Continuity worker', task: 'Remain attached while prime compacts.' }]
    }, callContext('wfr_prime'));
    const runId = String(structured(spawn)['run_id'] ?? '');
    expect(runId).not.toBe('');
    await recordCosBrowserEventsNow(PRIME, [
      { kind: 'turn_end', turnId: 'turn-compact-control', outcome: 'completed', time: 105 }
    ]);

    const ticket = await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, ticket: true, automatic: false })
    });
    expect(ticket.status).toBe(202);
    const ticketData = await ticket.json() as { token?: string };
    const compactToken = String(ticketData.token ?? '');
    expect(compactToken).toMatch(/^[A-Za-z0-9_-]{16,64}$/);

    const openedCompact = await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, resume: true, automatic: false })
    });
    expect(openedCompact.status).toBe(202);
    const openData = await openedCompact.json() as { prompt?: string };
    expect(openData.prompt).toContain(`[[CLF-HANDOFF:${compactToken}]]`);

    expect((await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: compactToken, sourceAttempt: true })
    })).status).toBe(200);
    expect((await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({ conversationId: PRIME, token: compactToken, sourceDispatch: true })
    })).status).toBe(200);
    expect((await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        token: compactToken,
        sourceMessageId: 'source-handoff-message',
        sourceProgress: 1
      })
    })).status).toBe(200);

    const summary = await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        token: compactToken,
        summary: 'Goal remains open. Verified evidence stays in CID. Continue from the current state.'
      })
    });
    expect(summary.status).toBe(200);
    const summaryData = await summary.json() as { placement?: { id?: string } };
    const resumeCommandId = String(summaryData.placement?.id ?? '');
    expect(resumeCommandId).not.toBe('');

    const redeem = await bridgeFetch('/commands/redeem', {
      method: 'POST',
      body: JSON.stringify({ id: resumeCommandId, client: 'resume-document' })
    });
    expect(redeem.status).toBe(200);
    expect(await redeem.json()).toMatchObject({
      command: {
        id: resumeCommandId,
        type: 'resume',
        text: expect.stringContaining(`[[CLF-RESUME:${compactToken}]]`)
      }
    });
    expect((await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({ token: compactToken, destinationAttempt: true })
    })).status).toBe(200);
    expect((await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({ token: compactToken, destinationDispatch: true })
    })).status).toBe(200);

    const ack = await bridgeFetch('/commands/ack', {
      method: 'POST',
      body: JSON.stringify({
        id: resumeCommandId,
        client: 'resume-document',
        status: 'sent',
        conversationId: RESUMED
      })
    });
    expect(ack.status).toBe(200);
    expect(await ack.json()).toMatchObject({ committed: true, conversationId: RESUMED });

    const repeatedAck = await bridgeFetch('/commands/ack', {
      method: 'POST',
      body: JSON.stringify({
        id: resumeCommandId,
        client: 'resume-document',
        status: 'sent',
        conversationId: RESUMED
      })
    });
    expect(repeatedAck.status).toBe(200);
    expect(await repeatedAck.json()).toMatchObject({ committed: true, conversationId: RESUMED });

    const destinationMarker = await bridgeFetch('/compact', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: RESUMED,
        token: compactToken,
        destinationMessageId: 'resume-bootstrap-message'
      })
    });
    expect(destinationMarker.status).toBe(200);
    expect(await destinationMarker.json()).toMatchObject({ committed: true, conversationId: RESUMED });

    const current = cosSessionForConversation(RESUMED);
    expect(current).toMatchObject({
      sessionId: sourceSessionId,
      conversationId: RESUMED,
      continuationCount: 1
    });
    expect(goalObjectiveFor(RESUMED)).toBe('Keep this Goal.');
    expect(goalObjectiveFor(PRIME)).toBe('');
    expect(cosSessionForConversation(PRIME)?.sessionId).toBe(sourceSessionId);

    const resumedActivity = await bridgeFetch('/activity?conversationId=' + encodeURIComponent(RESUMED) + '&since=0');
    expect(resumedActivity.status).toBe(200);
    expect(await resumedActivity.json()).toMatchObject({
      sessionId: sourceSessionId,
      bootstrap: 'resume',
      pendingTools: 0,
      goal: { objective: 'Keep this Goal.' }
    });
    const staleActivity = await bridgeFetch('/activity?conversationId=' + encodeURIComponent(PRIME) + '&since=0');
    expect(staleActivity.status).toBe(409);

    await recordCosBrowserEventsNow(RESUMED, [
      { kind: 'turn_start', turnId: 'turn-resumed-control', time: 300 },
      { kind: 'user_message', turnId: 'turn-resumed-control', messageId: 'user-resumed-control', text: 'Inspect the resumed run.', time: 301 }
    ]);
    const resumedStatus = await agents({ action: 'status' }, callContext('wfr_resumed'));
    expect(structured(resumedStatus)).toMatchObject({ self: 'prime', run_id: runId });
    await recordCosBrowserEventsNow(RESUMED, [
      { kind: 'turn_end', turnId: 'turn-resumed-control', outcome: 'completed', time: 302 }
    ]);

    const staleEvents = await bridgeFetch('/events', {
      method: 'POST',
      body: JSON.stringify({
        conversationId: PRIME,
        events: [{ kind: 'turn_start', turnId: 'stale-turn', time: Date.now() }]
      })
    });
    expect(staleEvents.status).toBe(503);
    expect(cosSessionForConversation(RESUMED)?.activeTurnId).toBeNull();
  });
});
