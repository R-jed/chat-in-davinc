import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  completeAgentTurn,
  createAgentSession,
  getAgentSession,
  initAgentSessionStore,
  readAgentSessionEvents,
  resetAgentSessionStoreForTests,
  restoreAgentSessionStore,
  startAgentTurn
} from '../src/main/agent-session-store.js';
import { flushDurable, initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import type { ModelProvider } from '../src/main/model-provider.js';
import type { ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { AgentWorldModel } from '../src/main/agent-world-model.js';
import { AgentContextCompiler } from '../src/main/context-compiler.js';
import { compactAgentSession } from '../src/main/agent-compaction.js';
import { deriveAgentGoalFrame } from '../src/main/agent-goal-frame.js';
import { evaluateCompletedAgentGoal } from '../src/main/agent-goal.js';
import { ResolveScheduler } from '../src/main/resolve-scheduler.js';
import { ToolKernel, type ToolKernelAccess } from '../src/main/tool-kernel.js';
import { TurnRunner } from '../src/main/turn-runner.js';

let tempDir: string | null = null;

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [],
  schemaHash: 'test'
};

async function setup(): Promise<void> {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-agent-session-'));
  initDurableStore(tempDir);
  initAgentSessionStore(tempDir);
  await restoreAgentSessionStore();
}

afterEach(async () => {
  await flushDurable().catch(() => undefined);
  resetAgentSessionStoreForTests();
  resetDurableForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('agent session and turn runner', () => {
  it('persists the turn before a protected tool call and continues with its result', async () => {
    await setup();
    const session = await createAgentSession('Tool session');
    let toolObservedAfterIntent = false;
    const resolve = {
      async callTool(): Promise<unknown> { throw new Error('Unexpected raw tool call'); },
      async getResolveStatus(): Promise<Record<string, unknown>> {
        const events = await readAgentSessionEvents(session.id);
        toolObservedAfterIntent = events.some((event) => event.kind === 'tool_call_intent' && event.callId === 'call-1');
        return { running: true, version: '21.1' };
      }
    };
    let providerCalls = 0;
    const world = new AgentWorldModel();
    const compiler = new AgentContextCompiler(world);
    const provider: ModelProvider = {
      async complete(request) {
        providerCalls += 1;
        if (providerCalls === 1) {
          expect(request.history.some((message) => message.kind === 'user' && message.text === 'Check Resolve')).toBe(true);
          expect(request.tools.map((tool) => tool.name)).toEqual(['status', 'inspect', 'inspect_operation', 'audit', 'plan', 'execute']);
          expect(request.contextPack?.relevantActions.some((action) => action.actionId === 'system.connection_status.v1')).toBe(true);
          expect(request.contextPack?.situation.facts).toEqual([]);
          return {
            kind: 'tool_calls',
            calls: [{ id: 'call-1', name: 'inspect', arguments: { target: 'connection' } }],
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
          };
        }
        expect(request.history.some((message) => message.kind === 'tool_result' && message.callId === 'call-1' && message.ok === true)).toBe(true);
        expect(request.contextPack?.situation.facts).toEqual(expect.arrayContaining([
          expect.objectContaining({ key: 'resolve.running', value: true, epistemicState: 'observed' })
        ]));
        expect(request.contextPack?.situation.recentDeltas).toEqual(expect.arrayContaining([
          expect.objectContaining({ reason: 'Protected connection observation' })
        ]));
        return { kind: 'final', text: 'Resolve is connected.', usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 } };
      }
    };
    const runner = new TurnRunner(provider, new ToolKernel(new ResolveScheduler(resolve), snapshot, world), compiler);
    await expect(runner.run(session.id, 'Check Resolve')).resolves.toMatchObject({ text: 'Resolve is connected.' });
    expect(toolObservedAfterIntent).toBe(true);
    expect(getAgentSession(session.id)).toMatchObject({ state: 'idle', lastTurnOutcome: 'completed', activeTurnId: null });
    const events = await readAgentSessionEvents(session.id);
    expect(events.map((event) => event.kind)).toEqual([
      'session_created', 'turn_started', 'user_message', 'tool_call_intent', 'tool_call_result', 'assistant_message', 'turn_trace', 'turn_completed'
    ]);
    const trace = events.find((event) => event.kind === 'turn_trace');
    expect(trace?.kind === 'turn_trace' ? trace.trace : null).toMatchObject({
      outcome: 'completed',
      modelCalls: 2,
      providerUsage: { complete: true, inputTokens: 22, outputTokens: 9, totalTokens: 31 },
      protectedToolCalls: 1,
      protectedToolFailures: 0,
      invalidToolCalls: 0,
      redundantToolCalls: 0,
      workflowIds: ['system.connection_status.v1'],
      resolveMetricsAvailable: true,
      resolveCalls: 1,
      staleTargetFailures: 0,
      verificationFailures: 0
    });
  });

  it('accepts a COS Goal stop only after CID can bind matching passed writer evidence', async () => {
    await setup();
    const session = await createAgentSession('Verified writer');
    const world = new AgentWorldModel();
    const compiler = new AgentContextCompiler(world);
    const planId = 'plan_123e4567-e89b-42d3-a456-426614174001';
    const executionId = 'execution_123e4567-e89b-42d3-a456-426614174002';
    const kernel: ToolKernelAccess = {
      tools() {
        return [{
          name: 'execute',
          description: 'Execute one approved protected plan',
          inputSchema: {
            type: 'object',
            properties: { planId: { type: 'string' } },
            required: ['planId']
          }
        }];
      },
      async call(context, name, args) {
        expect(name).toBe('execute');
        expect(args).toEqual({ planId });
        const result = {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              result: { plan: { plan_id: planId }, state: 'consumed', execution: { execution_id: executionId, state: 'verified' } },
              operation: {
                status: 'success',
                workflow_id: 'edit.review_marker_add.v1',
                workflow_version: '1',
                execution_id: executionId,
                verification: { status: 'passed', level_reached: 'API_READBACK', checks: ['marker read back'] }
              }
            })
          }]
        };
        world.observe({ context, name, args, result });
        return result;
      }
    };
    let providerCalls = 0;
    const provider: ModelProvider = {
      async complete(request) {
        providerCalls += 1;
        if (providerCalls === 1) {
          expect(request.tools.map((tool) => tool.name)).toEqual(['execute']);
          return { kind: 'tool_calls', calls: [{ id: 'call-execute', name: 'execute', arguments: { planId } }] };
        }
        const evidence = request.contextPack?.situation.evidence.find((item) => item.executionId === executionId);
        expect(evidence).toMatchObject({
          workflowId: 'edit.review_marker_add.v1',
          verificationStatus: 'passed',
          verificationLevel: 'API_READBACK'
        });
        return { kind: 'final', text: 'The marker is in place and verified.' };
      }
    };
    const runner = new TurnRunner(provider, kernel, compiler);
    const turn = await runner.run(session.id, 'Add the approved review marker');
    expect(turn).toMatchObject({ text: 'The marker is in place and verified.' });
    let events = await readAgentSessionEvents(session.id);
    expect(events.some((event) => event.kind === 'goal_completed')).toBe(false);
    const trace = events.find((event) => event.kind === 'turn_trace');
    expect(trace?.kind === 'turn_trace' ? trace.trace.protectedToolCalls : null).toBe(1);

    const goalProvider: ModelProvider = {
      async complete(request) {
        expect(request.purpose).toBe('goal_decision');
        expect(request.tools).toEqual([]);
        expect(request.responseFormat).toMatchObject({ type: 'json_schema', name: 'goal_decision', strict: true });
        expect(request.history.filter((message) => message.kind === 'tool_call' || message.kind === 'tool_result')).toEqual([]);
        expect(request.history.filter((message) => message.kind === 'user' || message.kind === 'assistant')).toEqual([
          { kind: 'user', text: 'Add the approved review marker' },
          { kind: 'assistant', text: 'The marker is in place and verified.' }
        ]);
        return { kind: 'final', text: JSON.stringify({ action: 'stop', reply: '' }) };
      }
    };
    await expect(evaluateCompletedAgentGoal(session.id, turn.turnId, 'goal', goalProvider, compiler))
      .resolves.toMatchObject({ action: 'stop', evidenceIds: [expect.stringMatching(/^E[1-9][0-9]*$/)] });
    events = await readAgentSessionEvents(session.id);
    const completion = events.find((event) => event.kind === 'goal_completed');
    expect(completion?.kind === 'goal_completed' ? completion.evidenceIds : []).toHaveLength(1);

    const next = await startAgentTurn(session.id, 'Now inspect a different clip');
    events = await readAgentSessionEvents(session.id);
    const nextGoal = deriveAgentGoalFrame(events);
    expect(nextGoal.originalRequest?.text).toBe('Now inspect a different clip');
    expect(nextGoal.sourceUserMessages).toBe(1);
    await completeAgentTurn(session.id, next.turnId, 'Ready for the new goal.');

    let loopCalls = 0;
    const loopProvider: ModelProvider = {
      async complete(request) {
        loopCalls += 1;
        expect(request.purpose).toBe('goal_loop');
        expect(request.responseFormat).toMatchObject({
          type: 'json_schema',
          schema: { properties: { action: { enum: ['continue'] } } }
        });
        if (loopCalls === 1) return { kind: 'final', text: JSON.stringify({ action: 'stop', reply: '' }) };
        expect(request.instructions).toContain('previous answer tried to end the conversation');
        return { kind: 'final', text: JSON.stringify({ action: 'continue', reply: 'inspect the different clip now' }) };
      }
    };
    await expect(evaluateCompletedAgentGoal(session.id, next.turnId, 'loop', loopProvider, compiler))
      .resolves.toEqual({ action: 'continue', reply: 'inspect the different clip now' });
    expect(loopCalls).toBe(2);
  });

  it('blocks a COS Goal stop when CID writer verification failed', async () => {
    await setup();
    const session = await createAgentSession('Unverified writer');
    const world = new AgentWorldModel();
    const compiler = new AgentContextCompiler(world);
    const planId = 'plan_123e4567-e89b-42d3-a456-426614174003';
    const executionId = 'execution_123e4567-e89b-42d3-a456-426614174004';
    const kernel: ToolKernelAccess = {
      tools() {
        return [{ name: 'execute', inputSchema: { type: 'object' } }];
      },
      async call(context, name, args) {
        const result = {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              result: { plan: { plan_id: planId }, state: 'consumed', execution: { execution_id: executionId, state: 'failed' } },
              operation: {
                status: 'failed',
                workflow_id: 'edit.review_marker_add.v1',
                workflow_version: '1',
                execution_id: executionId,
                verification: { status: 'failed', level_reached: 'API_READBACK', checks: ['marker absent'] }
              }
            })
          }]
        };
        world.observe({ context, name, args, result });
        return result;
      }
    };
    let providerCalls = 0;
    const provider: ModelProvider = {
      async complete(request) {
        providerCalls += 1;
        if (providerCalls === 1) {
          return { kind: 'tool_calls', calls: [{ id: 'call-execute-failed', name: 'execute', arguments: { planId } }] };
        }
        const evidence = request.contextPack?.situation.evidence.find((item) => item.executionId === executionId);
        expect(evidence?.verificationStatus).toBe('failed');
        return { kind: 'final', text: 'The change is not verified, so the goal is still open.' };
      }
    };
    const runner = new TurnRunner(provider, kernel, compiler);
    const turn = await runner.run(session.id, 'Make the protected change');
    expect(turn).toMatchObject({ text: 'The change is not verified, so the goal is still open.' });
    const goalProvider: ModelProvider = {
      async complete() {
        return { kind: 'final', text: JSON.stringify({ action: 'stop', reply: '' }) };
      }
    };
    await expect(evaluateCompletedAgentGoal(session.id, turn.turnId, 'goal', goalProvider, compiler))
      .resolves.toMatchObject({ action: 'blocked', blockers: [expect.stringContaining('not verified')] });
    const events = await readAgentSessionEvents(session.id);
    expect(events.some((event) => event.kind === 'goal_completed')).toBe(false);
    const trace = events.find((event) => event.kind === 'turn_trace');
    expect(trace?.kind === 'turn_trace' ? trace.trace.verificationFailures : null).toBe(1);
  });

  it('marks a durable in-flight turn interrupted after restart without replaying it', async () => {
    await setup();
    const session = await createAgentSession('Recovery session');
    const started = await startAgentTurn(session.id, 'Do not replay this');
    expect(getAgentSession(session.id)).toMatchObject({ state: 'running', activeTurnId: started.turnId });
    await flushDurable();

    resetAgentSessionStoreForTests();
    resetDurableForTests();
    initDurableStore(tempDir!);
    initAgentSessionStore(tempDir!);
    await restoreAgentSessionStore();

    expect(getAgentSession(session.id)).toMatchObject({ state: 'idle', activeTurnId: null, lastTurnOutcome: 'interrupted' });
    const events = await readAgentSessionEvents(session.id);
    expect(events.filter((event) => event.kind === 'user_message')).toHaveLength(1);
    expect(events.filter((event) => event.kind === 'turn_interrupted')).toHaveLength(1);
    expect(events.some((event) => event.kind === 'tool_call_intent')).toBe(false);
  });

  it('compacts narrative into a durable handoff while keeping the original goal across restart', async () => {
    await setup();
    const session = await createAgentSession('Long session');
    const original = 'Keep the documentary edit intact and only inspect what still needs work.';
    for (let index = 0; index < 9; index += 1) {
      const input = index === 0 ? original : `User directive ${index}`;
      const started = await startAgentTurn(session.id, input);
      await completeAgentTurn(session.id, started.turnId, `Assistant reply ${index}`);
    }
    await flushDurable();
    resetAgentSessionStoreForTests();
    resetDurableForTests();
    initDurableStore(tempDir!);
    initAgentSessionStore(tempDir!);
    await restoreAgentSessionStore();

    const world = new AgentWorldModel();
    const compiler = new AgentContextCompiler(world);
    const handoffText = 'Continue the same documentary inspection task. Preserve the original no-edit constraint, the later user directives, and the current inspection position. No Resolve mutation has been requested or authorized. Rehydrate current Resolve state from the World Model before relying on it. '.repeat(2);
    const compactor: ModelProvider = {
      async complete(request) {
        expect(request.purpose).toBe('compaction');
        expect(request.tools).toEqual([]);
        expect(request.contextPack?.goal.originalRequest?.text).toBe(original);
        return { kind: 'final', text: handoffText, usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 } };
      }
    };
    const handoff = await compactAgentSession(session.id, compactor, compiler);
    expect(handoff.text).toBe(handoffText.trim());
    await flushDurable();
    resetAgentSessionStoreForTests();
    resetDurableForTests();
    initDurableStore(tempDir!);
    initAgentSessionStore(tempDir!);
    await restoreAgentSessionStore();

    const provider: ModelProvider = {
      async complete(request) {
        expect(request.history.some((message) => message.kind === 'user' && message.text === original)).toBe(false);
        expect(request.history[0]).toEqual({ kind: 'assistant', text: `CID_COMPACT_RESUME\n${handoffText.trim()}` });
        expect(request.history.some((message) => message.kind === 'assistant' && message.text === 'Assistant reply 0')).toBe(false);
        expect(request.contextPack?.goal.originalRequest?.text).toBe(original);
        expect(request.contextPack?.goal.sourceUserMessages).toBe(10);
        expect(request.contextPack?.goal.userDirectives.at(-1)?.text).toBe('Continue from the same goal');
        expect(request.contextPack?.budget.goalChars).toBeGreaterThan(original.length);
        return { kind: 'final', text: 'Continuing from the durable goal.' };
      }
    };
    const runner = new TurnRunner(provider, new ToolKernel(new ResolveScheduler({
      async callTool(): Promise<unknown> { throw new Error('Unexpected Resolve tool call'); },
      async getResolveStatus(): Promise<Record<string, unknown>> { throw new Error('Unexpected Resolve status call'); }
    }), snapshot, world), compiler);

    await expect(runner.run(session.id, 'Continue from the same goal')).resolves.toMatchObject({
      text: 'Continuing from the durable goal.'
    });
  });
});
