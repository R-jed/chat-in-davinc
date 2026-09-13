import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildProductToolList, startResolveGateway } from '../src/main/resolve-gateway.js';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { ResolveScheduler } from '../src/main/resolve-scheduler.js';
import { workflowTools } from '../src/main/workflow.js';
import {
  cosSessionForConversation,
  initCosSessionRuntime,
  recordCosBrowserEventsNow,
  rebindCosSessionConversationNow,
  resetCosSessionRuntimeForTests
} from '../src/cos-host/session-runtime.js';
import {
  observeCosRequestCorrelationNow,
  resetCosRequestCorrelationsForTests
} from '../src/cos-host/identity.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import type { CallContext, ToolKernelObservation, ToolKernelSemanticState } from '../src/main/tool-kernel.js';
import { resetAgentsForTests, restoreRetiredWorkers } from '../src/cos-host/agents.js';
import {
  attachCosHostDecisionRuntime,
  type CosHostDecisionProjection
} from '../src/cos-host/runtime.js';

function decisionProjection(
  sessionId: string,
  turnId: string,
  revision: number,
  criterion = 'Check Resolve status.'
): CosHostDecisionProjection {
  const observed = revision > 1;
  return {
    decision: {
      schemaVersion: 1,
      sessionId,
      turnId,
      compiledAt: Date.now(),
      generation: 1,
      provenanceRevision: revision,
      decisionKind: observed ? 'finish_check' : 'observe',
      goalCriterion: criterion,
      openObligation: criterion,
      completionGap: observed ? null : 'Fresh Resolve status evidence is required.',
      materialUncertainty: null,
      minimumFacts: observed
        ? [{ key: 'resolve.connection', subjectHandle: null, value: 'reachable', epistemicState: 'observed', evidenceIds: ['E-status'] }]
        : [],
      evidenceRefs: observed
        ? [{
            id: 'E-status',
            source: 'official_api',
            observedAt: 1_000 + revision,
            generation: 1,
            provenanceRevision: revision,
            workflowId: 'system.connection_status.v1',
            executionId: null,
            verificationStatus: 'passed',
            verificationLevel: 'API_READBACK',
            projectHandle: null,
            timelineHandle: null,
            targetHandle: null,
            limitations: []
          }]
        : [],
      staleDependencies: [],
      sharedFocus: null,
      actionOffers: [{
        capabilityId: 'system.connection.inspect',
        targetHandle: null,
        applicability: 'applicable',
        kind: 'observe',
        whyRelevant: 'Check whether Resolve is reachable and running.',
        advancesCriterion: criterion,
        requiredPreconditions: [],
        risk: 'low',
        expectedSemanticEffect: 'Refresh Resolve reachability and runtime-version evidence.',
        verificationRequirement: 'API_READBACK',
        implementation: {
          implementationId: 'system.connection_status.v1',
          implementationVersion: '1',
          source: 'official',
          qualification: 'behaviorally_qualified',
          evidenceBuild: '21.1-test',
          availability: 'available',
          blockingReason: null,
          remediation: null
        },
        estimatedCost: { context: 'low', resolve: 'low', latency: 'low' },
        blockingReason: null,
        remediation: null
      }],
      riskHints: [],
      costHints: [],
      workspace: null
    },
    completion: {
      schemaVersion: 1,
      sessionId,
      evaluatedAt: Date.now(),
      generation: 1,
      complete: observed,
      criteria: [{
        criterion,
        status: observed ? 'satisfied' : 'missing_evidence',
        evidenceIds: observed ? ['E-status'] : [],
        strongestVerification: observed ? 'API_READBACK' : null,
        blockingReason: observed ? null : 'Fresh Resolve status evidence is required.'
      }],
      blockers: [],
      materialUnknowns: [],
      evidenceIds: observed ? ['E-status'] : [],
      strongestVerification: observed ? 'API_READBACK' : null
    }
  };
}

async function rpc(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers
    },
    body: JSON.stringify(body)
  });
  expect(response.ok).toBe(true);
  const text = await response.text();
  if (response.headers.get('content-type')?.includes('application/json')) {
    return JSON.parse(text) as Record<string, unknown>;
  }
  const data = text.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  if (!data) throw new Error(`MCP response contained no JSON payload: ${text.slice(0, 120)}`);
  return JSON.parse(data) as Record<string, unknown>;
}

function rpcResultText(response: Record<string, unknown>): string {
  const result = response['result'];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const content = (result as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return '';
  return content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .filter((item) => item['type'] === 'text' && typeof item['text'] === 'string')
    .map((item) => item['text'] as string)
    .join('\n\n');
}

function decisionContextToken(response: Record<string, unknown>): string {
  const text = rpcResultText(response);
  const match = text.match(/"decisionContextToken":"([^"]+)"/);
  if (!match?.[1]) throw new Error('CID decision context result contained no receipt token');
  return match[1];
}

describe('CID product MCP surface', () => {
  it('publishes COS controls plus only the six protected Resolve verbs', () => {
    const names = buildProductToolList(workflowTools()).map((tool) => tool.name);
    expect(names).toEqual([
      'session',
      'agents',
      'session_finish',
      'status',
      'inspect',
      'inspect_operation',
      'audit',
      'plan',
      'execute'
    ]);
    expect(names).not.toContain('run_script');
    expect(names).not.toContain('run_script_unsafe');
    expect(names).not.toContain('read');
    expect(names).not.toContain('exec_command');
    expect(names).not.toContain('computer');
    expect(names).not.toContain('plugins');
  });

  it('routes the real product endpoint to protected tools and preserves COS caller evidence', async () => {
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: 'test',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [{
        name: 'run_script_unsafe',
        description: 'raw-only sentinel',
        inputSchema: { type: 'object', properties: {} }
      }],
      schemaHash: 'test-schema'
    };
    const fakeBroker = {
      start: async () => structuredClone(snapshot),
      stop: async () => undefined,
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
      getResolveStatus: async () => ({ running: true, version: 'test' })
    } as unknown as ResolveBroker;
    const scheduler = new ResolveScheduler(fakeBroker);
    let seenContext: { transportSessionId: string | null; requestId: string | null; startedAt: number } | null = null;
    const gateway = await startResolveGateway(fakeBroker, scheduler, undefined, {
      session: async (_input, context) => {
        seenContext = context;
        return { content: [{ type: 'text', text: 'session-ok' }] };
      }
    });

    try {
      expect(gateway.productUrl).toBe(gateway.urls.workflow);

      const listed = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 1, method: 'tools/list', params: {}
      });
      const names = (((listed['result'] as Record<string, unknown>)['tools'] ?? []) as Array<Record<string, unknown>>)
        .map((tool) => tool['name']);
      expect(names).toEqual([
        'session', 'agents', 'session_finish',
        'status', 'inspect', 'inspect_operation', 'audit', 'plan', 'execute'
      ]);
      expect(names).not.toContain('run_script_unsafe');

      const called = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'session', arguments: { action: 'search' } }
      }, { 'x-request-id': 'wfr_exact_join/suffix-per-hop' });
      expect((called['result'] as Record<string, unknown>)['content']).toEqual([
        { type: 'text', text: 'session-ok' }
      ]);
      expect(seenContext).toEqual(expect.objectContaining({
        transportSessionId: null,
        requestId: 'wfr_exact_join',
        startedAt: expect.any(Number)
      }));

      const raw = await rpc(gateway.urls.raw, {
        jsonrpc: '2.0', id: 3, method: 'tools/list', params: {}
      });
      const rawNames = (((raw['result'] as Record<string, unknown>)['tools'] ?? []) as Array<Record<string, unknown>>)
        .map((tool) => tool['name']);
      expect(rawNames).toEqual(['run_script_unsafe']);
    } finally {
      await gateway.stop({ forceAfterMs: 1000 });
    }
  });

  it('binds a protected product RPC to the exact COS Session and active turn', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-product-spine-'));
    const conversationId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const contextRequestId = 'wfr_protected_context';
    const parallelRequestId = 'wfr_protected_parallel';
    const dispatchRequestId = 'wfr_protected_dispatch';
    initDurableStore(tempDir);
    await initCosSessionRuntime();
    const session = await recordCosBrowserEventsNow(conversationId, [
      { kind: 'turn_start', turnId: 'turn-protected', time: Date.now() - 100 },
      {
        kind: 'user_message',
        turnId: 'turn-protected',
        messageId: 'user-protected',
        text: 'Check Resolve status.',
        time: Date.now() - 90
      }
    ]);
    let decisionRevision = 1;
    let decisionCriterion = 'Check Resolve status.';
    let decisionProjectionCalls = 0;
    attachCosHostDecisionRuntime({
      projectSession: async (current) => {
        const projected = decisionProjection(
          current.sessionId,
          current.activeTurnId ?? '',
          decisionRevision,
          decisionCriterion
        );
        // Mirrors ContextCompiler's delivery-delta acknowledgement: the first context may report
        // a stale dependency that disappears from the follow-up frame without any World/Goal
        // revision. That must not force a third request before a safe read-only dispatch.
        if (decisionRevision === 1 && decisionProjectionCalls === 0) {
          projected.decision.staleDependencies = ['project.identity'];
        }
        decisionProjectionCalls += 1;
        return projected;
      }
    });
    await observeCosRequestCorrelationNow({
      requestId: contextRequestId,
      conversationId,
      sessionId: session.sessionId,
      turnId: 'turn-protected',
      messageId: 'user-protected',
      tool: 'status',
      observedAt: Date.now()
    });
    await observeCosRequestCorrelationNow({
      requestId: parallelRequestId,
      conversationId,
      sessionId: session.sessionId,
      turnId: 'turn-protected',
      messageId: 'user-protected',
      tool: 'status',
      observedAt: Date.now()
    });

    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: 'test',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [{
        name: 'run_script_unsafe',
        description: 'raw-only sentinel',
        inputSchema: { type: 'object', properties: {} }
      }],
      schemaHash: 'test-schema'
    };
    let statusCalls = 0;
    const fakeBroker = {
      start: async () => structuredClone(snapshot),
      stop: async () => undefined,
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
      getResolveStatus: async () => {
        statusCalls += 1;
        return { running: true, version: '21.1-test' };
      }
    } as unknown as ResolveBroker;
    const scheduler = new ResolveScheduler(fakeBroker);
    let observedContext: CallContext | null = null;
    let observedArgs: Record<string, unknown> | null = null;
    const semanticState: ToolKernelSemanticState = {
      observe(observation: ToolKernelObservation): void {
        observedContext = observation.context;
        observedArgs = structuredClone(observation.args);
        decisionRevision += 1;
      },
      resolveEntity(): never {
        throw new Error('No semantic entity resolution expected');
      },
      invalidate(): void {},
      projectToolResult(result) {
        return result.content.find((item) => item.type === 'text')?.text ?? '';
      }
    };
    const gateway = await startResolveGateway(fakeBroker, scheduler, semanticState);

    try {
      const listed = await rpc(gateway.productUrl, {
        jsonrpc: '2.0', id: 10, method: 'tools/list', params: {}
      });
      const listedTools = ((listed['result'] as Record<string, unknown>)['tools'] ?? []) as Array<Record<string, unknown>>;
      const inspect = listedTools.find((tool) => tool['name'] === 'inspect');
      const properties = ((inspect?.['inputSchema'] as Record<string, unknown> | undefined)?.['properties'] ?? {}) as Record<string, unknown>;
      expect(properties).toHaveProperty('itemRef');
      expect(properties).toHaveProperty('generation');
      expect(properties).toHaveProperty('decisionContextToken');
      expect(properties).not.toHaveProperty('itemId');

      const first = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'status', arguments: {} }
      }, { 'x-request-id': contextRequestId + '/suffix-per-hop' });
      const firstText = rpcResultText(first);
      expect(firstText).toContain('CID_DECISION_CONTEXT');
      expect(firstText).toContain('NO_RESOLVE_DISPATCH');
      expect(firstText).toContain('"advisoryOnly":true');
      expect(firstText).toContain('"publicVerb":"status"');
      expect(firstText).toContain('"provenanceRevision":1');
      expect(firstText).not.toContain('21.1-test');
      expect(statusCalls).toBe(0);
      expect(observedContext).toBeNull();
      expect(cosSessionForConversation(conversationId)?.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          requestId: contextRequestId,
          turnId: 'turn-protected',
          tool: 'status',
          args: '{}',
          ok: true,
          result: expect.stringContaining('CID_DECISION_CONTEXT_ONLY')
        })
      ]));

      const replayedContext = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'status', arguments: {} }
      }, { 'x-request-id': contextRequestId + '/retry' });
      expect(replayedContext).toEqual(first);
      expect(statusCalls).toBe(0);

      // A second request that was already generated in parallel cannot know the context receipt.
      // Even though the Session/Turn/context fingerprint now has a receipt, it must not dispatch.
      const parallel = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 115,
        method: 'tools/call',
        params: { name: 'status', arguments: {} }
      }, { 'x-request-id': parallelRequestId });
      expect(rpcResultText(parallel)).toContain('CID_DECISION_CONTEXT');
      expect(rpcResultText(parallel)).toContain('NO_RESOLVE_DISPATCH');
      expect(decisionContextToken(parallel)).toBe(decisionContextToken(first));
      expect(statusCalls).toBe(0);

      await observeCosRequestCorrelationNow({
        requestId: dispatchRequestId,
        conversationId,
        sessionId: session.sessionId,
        turnId: 'turn-protected',
        messageId: 'user-protected',
        tool: 'status',
        observedAt: Date.now()
      });
      const called = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'status',
          arguments: { decisionContextToken: decisionContextToken(first) }
        }
      }, { 'x-request-id': dispatchRequestId + '/suffix-per-hop' });
      const calledText = rpcResultText(called);
      expect(calledText).toContain('21.1-test');
      expect(calledText).toContain('CID_DECISION_CONTEXT');
      expect(calledText).toContain('"provenanceRevision":2');
      expect(calledText).toContain('E-status');
      expect(calledText).not.toContain('executionId');
      expect(statusCalls).toBe(1);
      expect(observedContext).toEqual({
        caller: 'agent',
        sessionId: session.sessionId,
        turnId: 'turn-protected',
        callId: dispatchRequestId
      });
      expect(observedArgs).toEqual({});

      const recorded = cosSessionForConversation(conversationId);
      expect(recorded?.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          turnId: 'turn-protected',
          requestId: dispatchRequestId,
          tool: 'status',
          args: '{}',
          ok: true,
          result: expect.stringContaining('CID_DECISION_CONTEXT')
        })
      ]));

      const replayedResult = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'status', arguments: {} }
      }, { 'x-request-id': dispatchRequestId + '/retry' });
      expect(replayedResult).toEqual(called);
      expect(statusCalls).toBe(1);

      decisionCriterion = 'Inspect the current project instead.';
      await observeCosRequestCorrelationNow({
        requestId: 'wfr_context_changed_same_revision',
        conversationId,
        sessionId: session.sessionId,
        turnId: 'turn-protected',
        messageId: 'user-protected',
        tool: 'status',
        observedAt: Date.now()
      });
      const changedContext = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'status',
          arguments: { decisionContextToken: decisionContextToken(called) }
        }
      }, { 'x-request-id': 'wfr_context_changed_same_revision' });
      expect(rpcResultText(changedContext)).toContain('Inspect the current project instead.');
      expect(rpcResultText(changedContext)).toContain('NO_RESOLVE_DISPATCH');
      expect(rpcResultText(changedContext)).toContain('"provenanceRevision":2');
      expect(decisionContextToken(changedContext)).not.toBe(decisionContextToken(called));
      expect(statusCalls).toBe(1);

      const oldReplayAfterNewerRequest = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: { name: 'status', arguments: {} }
      }, { 'x-request-id': dispatchRequestId + '/late-retry' });
      expect(oldReplayAfterNewerRequest).toEqual(called);
      expect(statusCalls).toBe(1);
    } finally {
      await gateway.stop({ forceAfterMs: 1000 });
      attachCosHostDecisionRuntime(null);
      resetCosSessionRuntimeForTests();
      resetCosRequestCorrelationsForTests();
      resetDurableForTests();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('atomically consumes one DecisionContext receipt across concurrent exact requests', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-product-context-race-'));
    const conversationId = 'abababab-abab-4bab-8bab-abababababab';
    initDurableStore(tempDir);
    await initCosSessionRuntime();
    const session = await recordCosBrowserEventsNow(conversationId, [
      { kind: 'turn_start', turnId: 'turn-race', time: Date.now() - 100 },
      { kind: 'user_message', turnId: 'turn-race', messageId: 'user-race', text: 'Check status.', time: Date.now() - 90 }
    ]);
    attachCosHostDecisionRuntime({
      projectSession: async (current) => decisionProjection(current.sessionId, current.activeTurnId ?? '', 1)
    });
    for (const requestId of ['wfr_race_context', 'wfr_race_a', 'wfr_race_b']) {
      await observeCosRequestCorrelationNow({
        requestId,
        conversationId,
        sessionId: session.sessionId,
        turnId: 'turn-race',
        messageId: 'user-race',
        tool: 'status',
        observedAt: Date.now()
      });
    }

    let statusCalls = 0;
    let resolveStarted!: () => void;
    let releaseResolve!: () => void;
    const started = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const released = new Promise<void>((resolve) => { releaseResolve = resolve; });
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: 'test',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [],
      schemaHash: 'test-schema'
    };
    const fakeBroker = {
      start: async () => structuredClone(snapshot),
      stop: async () => undefined,
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
      getResolveStatus: async () => {
        statusCalls += 1;
        resolveStarted();
        await released;
        return { running: true, version: '21.1-race' };
      }
    } as unknown as ResolveBroker;
    const gateway = await startResolveGateway(fakeBroker, new ResolveScheduler(fakeBroker));
    const callStatus = async (requestId: string, token?: string): Promise<Record<string, unknown>> => await rpc(gateway.productUrl, {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: { name: 'status', arguments: token ? { decisionContextToken: token } : {} }
    }, { 'x-request-id': requestId });

    try {
      const context = await callStatus('wfr_race_context');
      const token = decisionContextToken(context);
      expect(statusCalls).toBe(0);

      const firstDispatch = callStatus('wfr_race_a', token);
      await started;
      const concurrent = await callStatus('wfr_race_b', token);
      expect(rpcResultText(concurrent)).toContain('NO_RESOLVE_DISPATCH');
      expect(rpcResultText(concurrent)).not.toContain('21.1-race');
      expect(statusCalls).toBe(1);

      releaseResolve();
      const completed = await firstDispatch;
      expect(rpcResultText(completed)).toContain('21.1-race');
      expect(statusCalls).toBe(1);
    } finally {
      releaseResolve?.();
      await gateway.stop({ forceAfterMs: 1000 });
      attachCosHostDecisionRuntime(null);
      resetCosSessionRuntimeForTests();
      resetCosRequestCorrelationsForTests();
      resetDurableForTests();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('uses the durable context-only tombstone after gateway restart and invalidates the old receipt', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-product-context-restart-'));
    const conversationId = 'acacacac-acac-4cac-8cac-acacacacacac';
    initDurableStore(tempDir);
    await initCosSessionRuntime();
    const session = await recordCosBrowserEventsNow(conversationId, [
      { kind: 'turn_start', turnId: 'turn-restart', time: Date.now() - 100 },
      { kind: 'user_message', turnId: 'turn-restart', messageId: 'user-restart', text: 'Check status.', time: Date.now() - 90 }
    ]);
    attachCosHostDecisionRuntime({
      projectSession: async (current) => decisionProjection(current.sessionId, current.activeTurnId ?? '', 1)
    });
    for (const requestId of ['wfr_restart_context', 'wfr_restart_after', 'wfr_restart_dispatch']) {
      await observeCosRequestCorrelationNow({
        requestId,
        conversationId,
        sessionId: session.sessionId,
        turnId: 'turn-restart',
        messageId: 'user-restart',
        tool: 'status',
        observedAt: Date.now()
      });
    }

    let statusCalls = 0;
    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: 'test',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [],
      schemaHash: 'test-schema'
    };
    const fakeBroker = {
      start: async () => structuredClone(snapshot),
      stop: async () => undefined,
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
      getResolveStatus: async () => {
        statusCalls += 1;
        return { running: true, version: '21.1-restart' };
      }
    } as unknown as ResolveBroker;
    let gateway = await startResolveGateway(fakeBroker, new ResolveScheduler(fakeBroker));
    const callStatus = async (requestId: string, token?: string): Promise<Record<string, unknown>> => await rpc(gateway.productUrl, {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: { name: 'status', arguments: token ? { decisionContextToken: token } : {} }
    }, { 'x-request-id': requestId });

    try {
      const first = await callStatus('wfr_restart_context');
      const oldToken = decisionContextToken(first);
      expect(statusCalls).toBe(0);
      expect(cosSessionForConversation(conversationId)?.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          requestId: 'wfr_restart_context',
          result: expect.stringContaining('CID_DECISION_CONTEXT_ONLY')
        })
      ]));

      await gateway.stop({ forceAfterMs: 1000 });
      gateway = await startResolveGateway(fakeBroker, new ResolveScheduler(fakeBroker));

      const replay = await callStatus('wfr_restart_context', oldToken);
      expect(rpcResultText(replay)).toContain('CID_DECISION_CONTEXT_ONLY');
      expect(rpcResultText(replay)).toContain('NO_RESOLVE_DISPATCH');
      expect(statusCalls).toBe(0);

      const afterRestart = await callStatus('wfr_restart_after', oldToken);
      expect(rpcResultText(afterRestart)).toContain('NO_RESOLVE_DISPATCH');
      const freshToken = decisionContextToken(afterRestart);
      expect(freshToken).not.toBe(oldToken);
      expect(statusCalls).toBe(0);

      const dispatched = await callStatus('wfr_restart_dispatch', freshToken);
      expect(rpcResultText(dispatched)).toContain('21.1-restart');
      expect(statusCalls).toBe(1);
    } finally {
      await gateway.stop({ forceAfterMs: 1000 }).catch(() => undefined);
      attachCosHostDecisionRuntime(null);
      resetCosSessionRuntimeForTests();
      resetCosRequestCorrelationsForTests();
      resetDurableForTests();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('denies protected mutation authority to a retired Worker conversation', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-product-retired-worker-'));
    const conversationId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const requestId = 'wfr_retired_worker';
    const dispatchRequestId = 'wfr_retired_worker_dispatch';
    initDurableStore(tempDir);
    await initCosSessionRuntime();
    const session = await recordCosBrowserEventsNow(conversationId, [
      { kind: 'turn_start', turnId: 'turn-retired', time: Date.now() - 100 },
      { kind: 'user_message', turnId: 'turn-retired', messageId: 'user-retired', text: 'Plan a write.', time: Date.now() - 90 }
    ]);
    await observeCosRequestCorrelationNow({
      requestId,
      conversationId,
      sessionId: session.sessionId,
      turnId: 'turn-retired',
      messageId: 'user-retired',
      tool: 'plan',
      observedAt: Date.now()
    });
    restoreRetiredWorkers({
      version: 1,
      savedAt: Date.now(),
      workers: [{
        id: 'worker-retired',
        conversationId,
        reason: 'test retired worker fence',
        retiredAt: Date.now()
      }]
    });
    attachCosHostDecisionRuntime({
      projectSession: async (current) => decisionProjection(
        current.sessionId,
        current.activeTurnId ?? '',
        1,
        'Plan a write.'
      )
    });

    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: 'test',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [],
      schemaHash: 'test-schema'
    };
    const fakeBroker = {
      start: async () => structuredClone(snapshot),
      stop: async () => undefined,
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
      getResolveStatus: async () => ({ running: true, version: '21.1-test' })
    } as unknown as ResolveBroker;
    const gateway = await startResolveGateway(fakeBroker, new ResolveScheduler(fakeBroker));
    try {
      const contextOnly = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 20,
        method: 'tools/call',
        params: { name: 'plan', arguments: {} }
      }, { 'x-request-id': requestId });
      expect(rpcResultText(contextOnly)).toContain('CID_DECISION_CONTEXT');
      expect(rpcResultText(contextOnly)).toContain('NO_RESOLVE_DISPATCH');

      await observeCosRequestCorrelationNow({
        requestId: dispatchRequestId,
        conversationId,
        sessionId: session.sessionId,
        turnId: 'turn-retired',
        messageId: 'user-retired',
        tool: 'plan',
        observedAt: Date.now()
      });
      const called = await rpc(gateway.productUrl, {
        jsonrpc: '2.0',
        id: 21,
        method: 'tools/call',
        params: {
          name: 'plan',
          arguments: { decisionContextToken: decisionContextToken(contextOnly) }
        }
      }, { 'x-request-id': dispatchRequestId });
      expect(JSON.stringify(called)).toContain('Worker conversations have no independent Resolve mutation authority');
      expect(cosSessionForConversation(conversationId)?.events.some((event) =>
        event.kind === 'tool_call' && event.requestId === dispatchRequestId
      )).toBe(false);
    } finally {
      await gateway.stop({ forceAfterMs: 1000 });
      attachCosHostDecisionRuntime(null);
      resetAgentsForTests();
      resetCosSessionRuntimeForTests();
      resetCosRequestCorrelationsForTests();
      resetDurableForTests();
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('requires exact durable request-to-turn correlation across stale turns and Compact successors', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-product-exact-turn-'));
    const sourceConversation = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const successorConversation = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    initDurableStore(tempDir);
    await initCosSessionRuntime();

    const startedAt = Date.now() - 10_000;
    const session = await recordCosBrowserEventsNow(sourceConversation, [
      { kind: 'turn_start', turnId: 'turn-a', time: startedAt },
      { kind: 'user_message', turnId: 'turn-a', messageId: 'user-a', text: 'Turn A', time: startedAt + 1 }
    ]);
    await observeCosRequestCorrelationNow({
      requestId: 'wfr_turn_a',
      conversationId: sourceConversation,
      sessionId: session.sessionId,
      turnId: 'turn-a',
      messageId: 'user-a',
      tool: 'status',
      observedAt: Date.now()
    });
    await recordCosBrowserEventsNow(sourceConversation, [
      { kind: 'turn_end', turnId: 'turn-a', outcome: 'completed', time: startedAt + 2 },
      { kind: 'turn_start', turnId: 'turn-b', time: startedAt + 3 },
      { kind: 'user_message', turnId: 'turn-b', messageId: 'user-b', text: 'Turn B', time: startedAt + 4 }
    ]);
    await observeCosRequestCorrelationNow({
      requestId: 'wfr_turn_b',
      conversationId: sourceConversation,
      sessionId: session.sessionId,
      turnId: 'turn-b',
      messageId: 'user-b',
      tool: 'status',
      observedAt: Date.now()
    });
    await observeCosRequestCorrelationNow({
      requestId: 'wfr_wrong_session',
      conversationId: sourceConversation,
      sessionId: 'wrong-session',
      turnId: 'turn-b',
      messageId: 'user-b',
      tool: 'status',
      observedAt: Date.now()
    });
    await observeCosRequestCorrelationNow({
      requestId: 'wfr_wrong_tool',
      conversationId: sourceConversation,
      sessionId: session.sessionId,
      turnId: 'turn-b',
      messageId: 'user-b',
      tool: 'inspect',
      observedAt: Date.now()
    });
    await observeCosRequestCorrelationNow({
      requestId: 'wfr_wrong_turn',
      conversationId: sourceConversation,
      sessionId: session.sessionId,
      turnId: 'turn-a',
      messageId: 'user-a',
      tool: 'status',
      observedAt: Date.now()
    });

    const snapshot: ResolveBrokerSnapshot = {
      serverName: 'davinci_resolve',
      serverVersion: 'test',
      protocolVersion: '2024-11-05',
      instructions: null,
      tools: [],
      schemaHash: 'test-schema'
    };
    let statusCalls = 0;
    const fakeBroker = {
      start: async () => structuredClone(snapshot),
      stop: async () => undefined,
      callTool: async () => ({ content: [{ type: 'text', text: '{}' }] }),
      getResolveStatus: async () => {
        statusCalls += 1;
        return { running: true, version: '21.1-exact-turn' };
      }
    } as unknown as ResolveBroker;
    attachCosHostDecisionRuntime({
      projectSession: async (current) => decisionProjection(
        current.sessionId,
        current.activeTurnId ?? '',
        1,
        'Keep the protected request bound to the exact current turn.'
      )
    });
    const gateway = await startResolveGateway(fakeBroker, new ResolveScheduler(fakeBroker));
    const callStatus = async (requestId: string, token?: string): Promise<Record<string, unknown>> => await rpc(gateway.productUrl, {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: {
        name: 'status',
        arguments: token ? { decisionContextToken: token } : {}
      }
    }, { 'x-request-id': requestId });

    try {
      expect(JSON.stringify(await callStatus('wfr_turn_a'))).toContain('exact active COS turn');
      expect(JSON.stringify(await callStatus('wfr_wrong_turn'))).toContain('exact active COS turn');
      expect(JSON.stringify(await callStatus('wfr_wrong_session'))).toContain('Exact COS Session identity is required');
      expect(JSON.stringify(await callStatus('wfr_wrong_tool'))).toContain('tool identity conflicts');
      expect(statusCalls).toBe(0);

      const turnBContext = await callStatus('wfr_turn_b');
      expect(rpcResultText(turnBContext)).toContain('NO_RESOLVE_DISPATCH');
      expect(statusCalls).toBe(0);
      await observeCosRequestCorrelationNow({
        requestId: 'wfr_turn_b_dispatch',
        conversationId: sourceConversation,
        sessionId: session.sessionId,
        turnId: 'turn-b',
        messageId: 'user-b',
        tool: 'status',
        observedAt: Date.now()
      });
      const turnBResult = await callStatus(
        'wfr_turn_b_dispatch',
        decisionContextToken(turnBContext)
      );
      expect(rpcResultText(turnBResult)).toContain('21.1-exact-turn');
      expect(statusCalls).toBe(1);
      expect(cosSessionForConversation(sourceConversation)?.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          requestId: 'wfr_turn_b_dispatch',
          turnId: 'turn-b',
          tool: 'status',
          ok: true
        })
      ]));

      await recordCosBrowserEventsNow(sourceConversation, [
        { kind: 'turn_end', turnId: 'turn-b', outcome: 'completed', time: startedAt + 5 }
      ]);
      await rebindCosSessionConversationNow(session.sessionId, sourceConversation, successorConversation);
      await recordCosBrowserEventsNow(successorConversation, [
        { kind: 'turn_start', turnId: 'turn-successor', time: startedAt + 6 },
        { kind: 'user_message', turnId: 'turn-successor', messageId: 'user-successor', text: 'Resume', time: startedAt + 7 }
      ]);
      await observeCosRequestCorrelationNow({
        requestId: 'wfr_successor',
        conversationId: successorConversation,
        sessionId: session.sessionId,
        turnId: 'turn-successor',
        messageId: 'user-successor',
        tool: 'status',
        observedAt: Date.now()
      });

      expect(JSON.stringify(await callStatus('wfr_turn_b'))).toContain('superseded by Compact & Resume');
      const successorContext = await callStatus('wfr_successor', decisionContextToken(turnBResult));
      expect(rpcResultText(successorContext)).toContain('NO_RESOLVE_DISPATCH');
      expect(decisionContextToken(successorContext)).not.toBe(decisionContextToken(turnBResult));
      expect(statusCalls).toBe(1);
      await observeCosRequestCorrelationNow({
        requestId: 'wfr_successor_dispatch',
        conversationId: successorConversation,
        sessionId: session.sessionId,
        turnId: 'turn-successor',
        messageId: 'user-successor',
        tool: 'status',
        observedAt: Date.now()
      });
      expect(rpcResultText(await callStatus(
        'wfr_successor_dispatch',
        decisionContextToken(successorContext)
      ))).toContain('21.1-exact-turn');
      expect(statusCalls).toBe(2);
      expect(cosSessionForConversation(successorConversation)?.events).toEqual(expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool_call',
          requestId: 'wfr_successor_dispatch',
          turnId: 'turn-successor',
          tool: 'status',
          ok: true
        })
      ]));
    } finally {
      await gateway.stop({ forceAfterMs: 1000 });
      attachCosHostDecisionRuntime(null);
      resetCosSessionRuntimeForTests();
      resetCosRequestCorrelationsForTests();
      resetDurableForTests();
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
