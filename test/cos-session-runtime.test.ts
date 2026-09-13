import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentCompletionReport, AgentDecisionFrame } from '../src/shared/agent-system.js';
import {
  attachCosHostDecisionRuntime,
  attachCosHostIdentityRuntime,
  cosHostControlRuntime,
  initCosHostRuntime,
  shutdownCosHostRuntime
} from '../src/cos-host/runtime.js';
import {
  cosSessionForConversation,
  goalFrameForCosSession,
  recordCosBrowserEventsNow,
  rebindCosSessionConversationNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';
import {
  goalObjectiveFor,
  moveGoalObjective,
  moveGoalSwitch,
  resetCanonicalGoalForTests,
  setGoalObjectiveNow,
  setGoalSwitchNow
} from '../src/cos-host/canonical/goal.js';
import { resetDecisionInputForTests } from '../src/cos-host/canonical/input.js';
import { resetAgentsForTests } from '../src/cos-host/agents.js';
import { resetCosRequestCorrelationsForTests } from '../src/cos-host/identity.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';

const CONV_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONV_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let tempDir: string | null = null;

afterEach(async () => {
  shutdownCosHostRuntime();
  resetCosSessionRuntimeForTests();
  resetCanonicalGoalForTests();
  resetDecisionInputForTests();
  resetCosRequestCorrelationsForTests();
  resetAgentsForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function decision(sessionId: string, complete: boolean): {
  decision: AgentDecisionFrame;
  completion: AgentCompletionReport;
} {
  const criterion = 'Identify the current Resolve project.';
  return {
    decision: {
      schemaVersion: 1,
      sessionId,
      turnId: 'turn-b',
      compiledAt: Date.now(),
      generation: 1,
      provenanceRevision: 1,
      decisionKind: complete ? 'finish_check' : 'observe',
      goalCriterion: criterion,
      openObligation: criterion,
      completionGap: complete ? null : 'Qualified evidence is missing.',
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
      complete,
      criteria: [{
        criterion,
        status: complete ? 'satisfied' : 'missing_evidence',
        evidenceIds: complete ? ['E1'] : [],
        strongestVerification: complete ? 'API_READBACK' : null,
        blockingReason: complete ? null : 'Qualified evidence is missing.'
      }],
      blockers: [],
      materialUnknowns: [],
      evidenceIds: complete ? ['E1'] : [],
      strongestVerification: complete ? 'API_READBACK' : null
    }
  };
}

describe('COS Session / Goal / Finish ownership', () => {
  it('keeps Session and Goal identity through continuation and lets CID evidence gate COS Finish', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-session-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();

    const created = await recordCosBrowserEventsNow(CONV_A, [
      { kind: 'turn_start', turnId: 'turn-a', time: 100 },
      { kind: 'user_message', turnId: 'turn-a', messageId: 'user-a', text: 'Identify the current Resolve project.', time: 101 }
    ]);
    await setGoalObjectiveNow(CONV_A, 'Identify the current Resolve project.');
    await setGoalSwitchNow(CONV_A, 'goal', true);
    const moved = await rebindCosSessionConversationNow(created.sessionId, CONV_A, CONV_B);
    moveGoalObjective(CONV_A, CONV_B);
    moveGoalSwitch(CONV_A, CONV_B);
    expect(moved.sessionId).toBe(created.sessionId);
    expect(moved.continuationCount).toBe(1);
    expect(goalObjectiveFor(CONV_B)).toBe('Identify the current Resolve project.');

    const active = await recordCosBrowserEventsNow(CONV_B, [
      { kind: 'turn_start', turnId: 'turn-b', time: 200 },
      { kind: 'user_message', turnId: 'turn-b', messageId: 'user-b', text: 'Continue.', time: 201 }
    ]);
    expect(active.activeTurnId).toBe('turn-b');

    attachCosHostIdentityRuntime({
      resolveCaller: async (context) =>
        context.requestId === 'wfr-session-b'
          ? {
              conversationId: CONV_B,
              sessionId: active.sessionId,
              turnId: 'turn-b',
              messageId: 'user-b',
              tool: 'session_finish'
            }
          : null
    });

    let verified = false;
    attachCosHostDecisionRuntime({
      projectSession: async (session) => decision(session.sessionId, verified)
    });

    const held = await cosHostControlRuntime.sessionFinish!({
      summary: 'Done.'
    }, {
      transportSessionId: 'mcp-b',
      requestId: 'wfr-session-b',
      startedAt: 250
    });
    expect((held.structuredContent as Record<string, unknown>)['state']).toBe('held');
    expect((held.structuredContent as Record<string, unknown>)['summary_is_evidence']).toBe(false);

    verified = true;
    const released = await cosHostControlRuntime.sessionFinish!({
      summary: 'The model says finished.'
    }, {
      transportSessionId: 'mcp-b',
      requestId: 'wfr-session-b',
      startedAt: 260
    });
    expect((released.structuredContent as Record<string, unknown>)['state']).toBe('released');

    await setGoalSwitchNow(CONV_B, 'loop', true);
    const loopHeld = await cosHostControlRuntime.sessionFinish!({
      summary: 'Still complete.'
    }, {
      transportSessionId: 'mcp-b',
      requestId: 'wfr-session-b',
      startedAt: 270
    });
    expect((loopHeld.structuredContent as Record<string, unknown>)['state']).toBe('held');

    const read = await cosHostControlRuntime.session!({
      action: 'read',
      session_id: active.sessionId
    }, {
      transportSessionId: 'mcp-b',
      requestId: 'wfr-session-b',
      startedAt: 280
    });
    expect(read.structuredContent).toMatchObject({
      action: 'read',
      session_id: active.sessionId,
      conversation_id: CONV_B,
      active_turn_id: 'turn-b'
    });
    expect(cosSessionForConversation(CONV_A)?.sessionId).toBe(active.sessionId);
    expect(cosSessionForConversation(CONV_B)?.sessionId).toBe(active.sessionId);
  });

  it('fails closed when Finish lacks exact caller or exact active turn ownership', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-session-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();
    const session = await recordCosBrowserEventsNow(CONV_A, [
      { kind: 'user_message', turnId: 'old-turn', messageId: 'user-a', text: 'Question', time: 100 }
    ]);
    attachCosHostDecisionRuntime({
      projectSession: async () => decision(session.sessionId, true)
    });
    attachCosHostIdentityRuntime({
      resolveCaller: async (context) =>
        context.requestId === 'known'
          ? {
              conversationId: CONV_A,
              sessionId: session.sessionId,
              turnId: 'old-turn',
              messageId: 'user-a',
              tool: 'session_finish'
            }
          : null
    });

    await expect(cosHostControlRuntime.sessionFinish!({
      summary: 'Done'
    }, {
      transportSessionId: null,
      requestId: 'unknown',
      startedAt: 200
    })).rejects.toThrow('Exact ChatGPT conversation identity');

    await expect(cosHostControlRuntime.sessionFinish!({
      summary: 'Done'
    }, {
      transportSessionId: null,
      requestId: 'known',
      startedAt: 200
    })).rejects.toThrow('exact active COS turn');
  });

  it('fences COS control decisions by exact Session, active Turn, tool, and Compact owner', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-control-identity-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();
    const session = await recordCosBrowserEventsNow(CONV_A, [
      { kind: 'turn_start', turnId: 'turn-a', time: 100 },
      { kind: 'user_message', turnId: 'turn-a', messageId: 'user-a', text: 'Start.', time: 101 },
      { kind: 'turn_end', turnId: 'turn-a', outcome: 'completed', time: 110 },
      { kind: 'turn_start', turnId: 'turn-b', time: 120 },
      { kind: 'user_message', turnId: 'turn-b', messageId: 'user-b', text: 'Continue.', time: 121 }
    ]);
    const identity = (conversationId: string, turnId: string, messageId: string, tool: string, sessionId = session.sessionId) => ({
      conversationId,
      sessionId,
      turnId,
      messageId,
      tool
    });
    attachCosHostIdentityRuntime({
      resolveCaller: async (context) => {
        if (context.requestId === 'agents-old') return identity(CONV_A, 'turn-a', 'user-a', 'agents');
        if (context.requestId === 'agents-wrong-tool') return identity(CONV_A, 'turn-b', 'user-b', 'session_finish');
        if (context.requestId === 'agents-wrong-session') return identity(CONV_A, 'turn-b', 'user-b', 'agents', 'wrong-session');
        if (context.requestId === 'agents-current') return identity(CONV_A, 'turn-b', 'user-b', 'agents');
        if (context.requestId === 'finish-old') return identity(CONV_A, 'turn-a', 'user-a', 'session_finish');
        if (context.requestId === 'finish-current') return identity(CONV_A, 'turn-b', 'user-b', 'session_finish');
        if (context.requestId === 'agents-source-after-compact') return identity(CONV_A, 'turn-b', 'user-b', 'agents');
        if (context.requestId === 'agents-successor') return identity(CONV_B, 'turn-c', 'user-c', 'agents');
        return null;
      }
    });
    attachCosHostDecisionRuntime({
      projectSession: async () => decision(session.sessionId, true)
    });

    await expect(cosHostControlRuntime.agents!({ action: 'status' }, {
      transportSessionId: null,
      requestId: 'agents-old',
      startedAt: 130
    })).rejects.toThrow('exact active COS turn');
    await expect(cosHostControlRuntime.agents!({ action: 'status' }, {
      transportSessionId: null,
      requestId: 'agents-wrong-tool',
      startedAt: 130
    })).rejects.toThrow('tool identity conflicts');
    await expect(cosHostControlRuntime.agents!({ action: 'status' }, {
      transportSessionId: null,
      requestId: 'agents-wrong-session',
      startedAt: 130
    })).rejects.toThrow('Exact COS Session identity is required');
    await expect(cosHostControlRuntime.agents!({ action: 'status' }, {
      transportSessionId: null,
      requestId: 'agents-current',
      startedAt: 130
    })).rejects.toThrow('No sub-agent run or worker history belongs to this conversation');

    await expect(cosHostControlRuntime.sessionFinish!({ summary: 'Done' }, {
      transportSessionId: null,
      requestId: 'finish-old',
      startedAt: 130
    })).rejects.toThrow('exact active COS turn');
    await expect(cosHostControlRuntime.sessionFinish!({ summary: 'Done' }, {
      transportSessionId: null,
      requestId: 'finish-current',
      startedAt: 130
    })).resolves.toMatchObject({ structuredContent: { state: 'released', turn_id: 'turn-b' } });

    await rebindCosSessionConversationNow(session.sessionId, CONV_A, CONV_B);
    await recordCosBrowserEventsNow(CONV_B, [
      { kind: 'turn_start', turnId: 'turn-c', time: 200 },
      { kind: 'user_message', turnId: 'turn-c', messageId: 'user-c', text: 'Continue after Compact.', time: 201 }
    ]);
    await expect(cosHostControlRuntime.agents!({ action: 'status' }, {
      transportSessionId: null,
      requestId: 'agents-source-after-compact',
      startedAt: 210
    })).rejects.toThrow('superseded by Compact & Resume');
    await expect(cosHostControlRuntime.agents!({ action: 'status' }, {
      transportSessionId: null,
      requestId: 'agents-successor',
      startedAt: 210
    })).rejects.toThrow('No sub-agent run or worker history belongs to this conversation');
  });

  it('keeps later chat directives as context without replacing the canonical Goal criterion', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-cos-goal-frame-'));
    initDurableStore(tempDir);
    await initCosHostRuntime();
    await recordCosBrowserEventsNow(CONV_A, [
      { kind: 'turn_start', turnId: 'turn-a', time: 100 },
      { kind: 'user_message', turnId: 'turn-a', messageId: 'user-a', text: 'Inspect the current project.', time: 101 },
      { kind: 'turn_end', turnId: 'turn-a', outcome: 'completed', time: 110 },
      { kind: 'turn_start', turnId: 'turn-b', time: 120 },
      { kind: 'user_message', turnId: 'turn-b', messageId: 'user-b', text: 'Also inspect the selected clip.', time: 121 },
      { kind: 'turn_end', turnId: 'turn-b', outcome: 'completed', time: 130 },
      { kind: 'turn_start', turnId: 'turn-c', time: 140 },
      { kind: 'user_message', turnId: 'turn-c', messageId: 'user-c', text: 'yes', time: 141 }
    ]);
    await setGoalObjectiveNow(CONV_A, 'Inspect the current project.');
    const session = cosSessionForConversation(CONV_A)!;
    const frame = goalFrameForCosSession(session, goalObjectiveFor(CONV_A));
    expect(frame.originalRequest?.text).toBe('Inspect the current project.');
    expect(frame.desiredOutcome).toBe('Inspect the current project.');
    expect(frame.userDirectives.map((directive) => directive.text)).toEqual(['Also inspect the selected clip.', 'yes']);
    expect(frame.corrections).toEqual([]);
    expect(frame.openObligations).toEqual(['Inspect the current project.']);
    expect(frame.completionCriteria).toEqual(['Inspect the current project.']);

    await setGoalObjectiveNow(CONV_A, 'Inspect the current project and selected clip.');
    const replaced = goalFrameForCosSession(cosSessionForConversation(CONV_A)!, goalObjectiveFor(CONV_A));
    expect(replaced.desiredOutcome).toBe('Inspect the current project and selected clip.');
    expect(replaced.completionCriteria).toEqual(['Inspect the current project and selected clip.']);
    expect(replaced.openObligations).toEqual(['Inspect the current project and selected clip.']);
  });
});
