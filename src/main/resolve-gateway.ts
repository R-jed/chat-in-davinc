import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import http from 'node:http';
import { McpServer, createMcpHandler, type CallToolResult, type Tool } from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toNodeHandler } from '@modelcontextprotocol/node';
import type { ResolveGatewayStatus, WorkflowAuditEntry, WorkflowInspectResult, WorkflowRiskAssessment } from '../shared/types.js';
import { logError, logInfo, logWarn } from './log.js';
import { ResolveBroker, type ResolveBrokerSnapshot } from './resolve-broker.js';
import { ResolveScheduler } from './resolve-scheduler.js';
import {
  buildCosControlToolSurface,
  cosInboundRequestId,
  cosRequestIdFromHeader,
  type CosControlRuntimeDelegate,
  type CosControlToolName,
  withCosInboundRequestId
} from './cos-control-tools.js';
import { cosControlRuntimeBridge } from './cos-control-runtime.js';
import { cosRequestCorrelation } from '../cos-host/identity.js';
import { admitExactCosCaller } from '../cos-host/caller-admission.js';
import {
  recordCosProtectedToolCallNow,
  type CosSessionEvent
} from '../cos-host/session-runtime.js';
import { isWorkerConversation } from '../cos-host/agents.js';
import { projectCosSessionDecisionNow } from '../cos-host/runtime.js';
import type { CosHostDecisionProjection } from '../cos-host/runtime.js';
import { beginCosProtectedToolActivity } from '../cos-host/tool-activity.js';
import {
  ToolKernel,
  type CallContext,
  type ToolKernelAccess,
  type ToolKernelInspectRequest,
  type ToolKernelSemanticState
} from './tool-kernel.js';
import { agentActionDescriptors, bindAgentSemanticDispatchArgs } from './agent-action-catalog.js';

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const PRM_PREFIX = '/.well-known/oauth-protected-resource';
const TUNNEL_PROBE_HEADER = 'x-local-tunnel-probe';
export type ResolveSurface = 'raw' | 'workflow';

const DECISION_CONTEXT_TOKEN = 'decisionContextToken';

function addDecisionReceiptProperty(schema: Record<string, unknown>): void {
  if (schema.type !== 'object') return;
  const properties = schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
    ? schema.properties as Record<string, unknown>
    : {};
  schema.properties = {
    ...properties,
    [DECISION_CONTEXT_TOKEN]: {
      type: 'string',
      minLength: 16,
      maxLength: 128,
      description:
        'Opaque CID freshness receipt from the immediately preceding CID_DECISION_CONTEXT. ' +
        'Copy it exactly only after reviewing that context. It is not approval and is invalidated by context/turn/restart changes.'
    }
  };
  if (Array.isArray(schema.oneOf)) {
    for (const branch of schema.oneOf) {
      if (branch && typeof branch === 'object' && !Array.isArray(branch)) {
        addDecisionReceiptProperty(branch as Record<string, unknown>);
      }
    }
  }
}

function protectedToolWithDecisionReceipt(tool: Tool): Tool {
  const clone = structuredClone(tool);
  const schema = clone.inputSchema as Record<string, unknown>;
  if (schema?.type !== 'object') return clone;
  addDecisionReceiptProperty(schema);
  clone.inputSchema = schema as Tool['inputSchema'];
  return clone;
}

export function buildProductToolList(protectedTools: readonly Tool[]): Tool[] {
  return [
    ...buildCosControlToolSurface().tools,
    ...protectedTools.map(protectedToolWithDecisionReceipt)
  ];
}

export interface ResolveGateway {
  port: number;
  urls: Record<ResolveSurface, string>;
  /** Canonical external product endpoint. Raw remains localhost-only during migration. */
  productUrl: string;
  tunnelProbeHeaders: () => Record<string, string>;
  status: () => ResolveGatewayStatus;
  workflowInspect: (request: ToolKernelInspectRequest) => Promise<WorkflowInspectResult>;
  workflowRisk: (tool: string) => WorkflowRiskAssessment;
  workflowAudit: (limit?: number) => WorkflowAuditEntry[];
  agentKernel: ToolKernelAccess;
  stop: (options?: { forceAfterMs?: number }) => Promise<void>;
}

interface SurfaceRoute {
  id: ResolveSurface;
  basePath: string;
  prmPath: string;
  url: string;
  handler: ReturnType<typeof toNodeHandler>;
}

interface DecisionGateReceipt {
  turnId: string;
  contextFingerprint: string;
  requestId: string;
  token: string;
  state: 'ready' | 'inflight';
}

type DecisionRequestOutcome =
  | { state: 'inflight' }
  | { state: 'result'; result: CallToolResult }
  | { state: 'error'; message: string };

interface DecisionGateState {
  receipts: Map<string, DecisionGateReceipt>;
  requests: Map<string, DecisionRequestOutcome>;
}

const MAX_DECISION_REQUESTS = 50_000;

function trimDecisionRequests(state: DecisionGateState): void {
  while (state.requests.size > MAX_DECISION_REQUESTS) {
    const first = state.requests.keys().next().value as string | undefined;
    if (!first) return;
    state.requests.delete(first);
  }
}

function decisionRequestKey(sessionId: string, turnId: string, requestId: string): string {
  return `${sessionId}\u0000${turnId}\u0000${requestId}`;
}

function decisionReceiptKey(sessionId: string, turnId: string): string {
  return `${sessionId}\u0000${turnId}`;
}

function renderDecisionContext(projection: CosHostDecisionProjection): string {
  const descriptors = new Map(agentActionDescriptors().map((descriptor) => [descriptor.actionId, descriptor]));
  return JSON.stringify({
    advisoryOnly: true,
    kind: projection.decision.decisionKind,
    criterion: projection.decision.goalCriterion,
    openObligation: projection.decision.openObligation,
    gap: projection.decision.completionGap,
    uncertainty: projection.decision.materialUncertainty,
    generation: projection.decision.generation,
    provenanceRevision: projection.decision.provenanceRevision,
    focus: projection.decision.sharedFocus,
    facts: projection.decision.minimumFacts,
    evidence: projection.decision.evidenceRefs.map((evidence) => ({
      id: evidence.id,
      source: evidence.source,
      observedAt: evidence.observedAt,
      generation: evidence.generation,
      provenanceRevision: evidence.provenanceRevision ?? null,
      workflowId: evidence.workflowId,
      verificationStatus: evidence.verificationStatus,
      verificationLevel: evidence.verificationLevel,
      projectHandle: evidence.projectHandle,
      timelineHandle: evidence.timelineHandle,
      targetHandle: evidence.targetHandle,
      limitations: evidence.limitations
    })),
    staleDependencies: projection.decision.staleDependencies,
    workspace: projection.decision.workspace
      ? {
          projectHandle: projection.decision.workspace.projectHandle,
          projectLabel: projection.decision.workspace.projectLabel,
          online: projection.decision.workspace.online,
          freshness: projection.decision.workspace.freshness,
          bindingStatus: projection.decision.workspace.bindingStatus
        }
      : null,
    actionOffers: projection.decision.actionOffers.map((offer) => {
      const descriptor = offer.implementation
        ? descriptors.get(offer.implementation.implementationId)
        : undefined;
      const invoke = descriptor?.invoke
        ?.replace('<current>', String(projection.decision.generation))
        .replace('M#', offer.targetHandle ?? 'M#') ?? null;
      return {
        capabilityId: offer.capabilityId,
        targetHandle: offer.targetHandle,
        kind: offer.kind ?? null,
        applicability: offer.applicability,
        whyRelevant: offer.whyRelevant,
        advancesCriterion: offer.advancesCriterion,
        requiredPreconditions: offer.requiredPreconditions,
        risk: offer.risk,
        expectedSemanticEffect: offer.expectedSemanticEffect,
        verificationRequirement: offer.verificationRequirement,
        dispatch: offer.dispatch ?? null,
        publicVerb: descriptor?.publicVerb ?? null,
        invoke: offer.implementation?.implementationId === 'project.preflight.v1' && offer.dispatch?.profile
          ? `inspect({target:"preflight",profile:"${offer.dispatch.profile}"})`
          : invoke,
        stateBinding: {
          generation: projection.decision.generation,
          provenanceRevision: projection.decision.provenanceRevision,
          projectHandle: projection.decision.workspace?.projectHandle ?? null,
          workspaceBindingStatus: projection.decision.workspace?.bindingStatus ?? null,
          focusHandle: projection.decision.sharedFocus?.entity.handle ?? null
        },
        implementation: offer.implementation
          ? {
              implementationId: offer.implementation.implementationId,
              qualification: offer.implementation.qualification,
              availability: offer.implementation.availability,
              blockingReason: offer.implementation.blockingReason,
              remediation: offer.implementation.remediation
            }
          : null,
        blockingReason: offer.blockingReason,
        remediation: offer.remediation
      };
    }),
    completion: projection.completion.criteria.map((criterion) => ({
      criterion: criterion.criterion,
      status: criterion.status,
      evidenceIds: criterion.evidenceIds,
      strongestVerification: criterion.strongestVerification,
      blockingReason: criterion.blockingReason
    }))
  });
}

function decisionContextFingerprint(sessionId: string, turnId: string, context: string): string {
  // recent/stale dependency rows are delivery deltas: ContextCompiler acknowledgement consumes
  // them after the model has seen the first DecisionFrame. They must not make the same semantic
  // state look like a new authorization-relevant revision on the model's follow-up request.
  // Material World/Goal/Workspace changes remain fenced by the rest of this exact context,
  // including generation/provenanceRevision, criterion, focus, facts, evidence and ActionOffers.
  const parsed = JSON.parse(context) as Record<string, unknown>;
  delete parsed['staleDependencies'];
  const stableContext = JSON.stringify(parsed);
  return createHash('sha256')
    .update(sessionId)
    .update('\u0000')
    .update(turnId)
    .update('\u0000')
    .update(stableContext)
    .digest('base64url');
}

function decisionContextResult(
  projection: CosHostDecisionProjection,
  token: string | null,
  note: string
): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: 'CID_DECISION_CONTEXT\n' + renderDecisionContext(projection)
      },
      ...(token
        ? [{
            type: 'text' as const,
            text:
              'CID_DECISION_RECEIPT\n' +
              JSON.stringify({ decisionContextToken: token }) +
              '\n\n' + note
          }]
        : [{ type: 'text' as const, text: note }])
    ]
  };
}

function newDecisionContextToken(): string {
  return randomBytes(24).toString('base64url');
}

function textFromCallToolResult(result: CallToolResult): string {
  return result.content
    .filter((item): item is Extract<CallToolResult['content'][number], { type: 'text' }> => item.type === 'text')
    .map((item) => item.text)
    .join('\n\n');
}

function projectProtectedResultForAgent(
  _tool: Tool,
  semanticState: ToolKernelSemanticState | undefined,
  result: CallToolResult
): CallToolResult {
  if (!semanticState?.projectToolResult) return result;
  try {
    return { content: [{ type: 'text', text: semanticState.projectToolResult(result) }] };
  } catch (error) {
    logWarn(`Agent semantic result projection failed after protected success: ${(error as Error).message}`);
    return {
      content: [{
        type: 'text',
        text: 'CID_PROTECTED_RESULT_WITHHELD: The protected call completed, but its bounded semantic projection failed. Raw payload was not exposed.'
      }]
    };
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function jsonError(res: http.ServerResponse, status: number, error: string): void {
  const body = JSON.stringify({ error });
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

function readBoundedJsonBody(
  req: http.IncomingMessage
): Promise<{ body?: unknown; error?: 'payload_too_large' | 'invalid_json' }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (value: { body?: unknown; error?: 'payload_too_large' | 'invalid_json' }): void => {
      if (done) return;
      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      resolve(value);
    };
    const onData = (chunk: Buffer | string): void => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += bytes.length;
      if (total > MAX_BODY_BYTES) {
        finish({ error: 'payload_too_large' });
        req.resume();
        return;
      }
      chunks.push(bytes);
    };
    const onEnd = (): void => {
      try {
        const text = Buffer.concat(chunks, total).toString('utf8');
        finish({ body: text.length === 0 ? undefined : JSON.parse(text) });
      } catch {
        finish({ error: 'invalid_json' });
      }
    };
    const onError = (): void => finish({ error: 'invalid_json' });
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function metadata(resource: string, name: string): string {
  return JSON.stringify({
    resource,
    resource_name: name,
    authorization_servers: [],
    scopes_supported: []
  });
}

async function callProtectedKernel(
  kernel: ToolKernel,
  context: CallContext,
  name: string,
  args: Record<string, unknown>,
  noteToolCall: (name: string) => void,
  workflowAudit: WorkflowAuditEntry[]
): Promise<CallToolResult> {
  const started = Date.now();
  try {
    const result = await kernel.call(context, name, args, workflowAudit);
    const durationMs = Date.now() - started;
    workflowAudit.push({
      id: `${started}-${workflowAudit.length + 1}`,
      tool: name,
      startedAt: started,
      durationMs,
      outcome: 'success'
    });
    if (workflowAudit.length > 100) workflowAudit.splice(0, workflowAudit.length - 100);
    noteToolCall(name);
    logInfo(`Resolve tool completed: ${name} (${(durationMs / 1000).toFixed(3)}s)`);
    return result;
  } catch (error) {
    const durationMs = Date.now() - started;
    workflowAudit.push({
      id: `${started}-${workflowAudit.length + 1}`,
      tool: name,
      startedAt: started,
      durationMs,
      outcome: 'failure'
    });
    if (workflowAudit.length > 100) workflowAudit.splice(0, workflowAudit.length - 100);
    throw error;
  }
}

function buildSurfaceServer(
  scheduler: ResolveScheduler,
  kernel: ToolKernel,
  snapshot: ResolveBrokerSnapshot,
  surface: ResolveSurface,
  noteToolCall: (name: string) => void,
  workflowAudit: WorkflowAuditEntry[],
  decisionGate: DecisionGateState,
  semanticState?: ToolKernelSemanticState,
  cosRuntime: CosControlRuntimeDelegate = cosControlRuntimeBridge
): McpServer {
  const raw = surface === 'raw';
  const cos = raw ? null : buildCosControlToolSurface(cosRuntime);
  const server = new McpServer(
    {
      name: raw ? (snapshot.serverName ?? 'davinci_resolve') : 'chat_in_davinci',
      version: raw ? (snapshot.serverVersion ?? '0.0.0') : '0.1.0'
    },
    {
      capabilities: { tools: {} },
      instructions: raw
        ? (snapshot.instructions ?? undefined)
        : 'Chat in DaVinci product surface. COS session/agent controls and protected DaVinci tools share this one connector; no raw scripting, filesystem, terminal, Desktop, or plugin escape hatch is available.'
    }
  );
  const tools: Tool[] = raw
    ? structuredClone(snapshot.tools)
    : buildProductToolList(kernel.tools({ caller: 'agent', sessionId: 'schema', turnId: 'schema' }));
  server.server.setRequestHandler('tools/list', async () => ({ tools }));
  server.server.setRequestHandler('tools/call', async (request, context) => {
    const tool = tools.find((item) => item.name === request.params.name);
    if (!tool) throw new Error(`Tool is not available on this connector: ${request.params.name}`);
    const started = Date.now();
    const supplied = request.params.arguments;
    const args = supplied && typeof supplied === 'object' && !Array.isArray(supplied)
      ? supplied as Record<string, unknown>
      : {};
    const decisionContextToken = typeof args[DECISION_CONTEXT_TOKEN] === 'string'
      ? args[DECISION_CONTEXT_TOKEN].slice(0, 128)
      : null;
    const kernelArgs = { ...args };
    delete kernelArgs[DECISION_CONTEXT_TOKEN];
    if (!raw && cos && (request.params.name === 'session' || request.params.name === 'agents' || request.params.name === 'session_finish')) {
      const result = await cos.call(request.params.name satisfies CosControlToolName, args, {
        transportSessionId: context.sessionId ?? null,
        requestId: cosInboundRequestId(),
        startedAt: started
      });
      noteToolCall(request.params.name);
      logInfo(`COS control tool completed: ${request.params.name} (${((Date.now() - started) / 1000).toFixed(3)}s)`);
      return result;
    }
    if (!raw) {
      const requestId = cosInboundRequestId();
      const correlation = cosRequestCorrelation(requestId);
      if (!requestId || !correlation) {
        throw new Error('Exact COS Session identity is required for protected product tools');
      }
      const exactCaller = admitExactCosCaller(correlation, request.params.name);
      const session = exactCaller.session;
      const workerMutation = isWorkerConversation(correlation.conversationId) && tool.annotations?.readOnlyHint !== true;
      const correlatedTurnId = exactCaller.turnId;
      const requestKey = decisionRequestKey(session.sessionId, correlatedTurnId, requestId);
      const priorOutcome = decisionGate.requests.get(requestKey);
      if (priorOutcome?.state === 'result') return structuredClone(priorOutcome.result);
      if (priorOutcome?.state === 'error') throw new Error(priorOutcome.message);
      if (priorOutcome?.state === 'inflight') {
        throw new Error('Exact protected request is already in flight; duplicate dispatch is refused');
      }
      const priorToolCall = [...session.events].reverse().find(
        (event): event is Extract<CosSessionEvent, { kind: 'tool_call' }> =>
          event.kind === 'tool_call'
          && event.turnId === correlatedTurnId
          && event.requestId === requestId
      );
      if (priorToolCall) {
        if (priorToolCall.tool !== request.params.name) {
          throw new Error('Exact COS request id was already consumed by a different protected tool');
        }
        if (!priorToolCall.ok) {
          const message = priorToolCall.result || 'Prior protected request failed';
          decisionGate.requests.set(requestKey, { state: 'error', message });
          throw new Error(message);
        }
        if (priorToolCall.result.includes('CID_DECISION_CONTEXT')) {
          const replay = { content: [{ type: 'text' as const, text: priorToolCall.result }] };
          decisionGate.requests.set(requestKey, { state: 'result', result: replay });
          return replay;
        }
        const currentDecision = await projectCosSessionDecisionNow(session.sessionId);
        if (!currentDecision || currentDecision.decision.turnId !== correlatedTurnId) {
          throw new Error('Current CID DecisionFrame is unavailable for this exact COS turn');
        }
        const replay = decisionContextResult(
          currentDecision,
          null,
          'NO_RESOLVE_DISPATCH: This exact request already has a durable protected tool-call record. ' +
            'Issue a new exact request after reviewing the current DecisionFrame; the old request will not be dispatched again.'
        );
        decisionGate.requests.set(requestKey, { state: 'result', result: structuredClone(replay) });
        return replay;
      }

      decisionGate.requests.set(requestKey, { state: 'inflight' });
      trimDecisionRequests(decisionGate);

      try {
        const beforeDecision = await projectCosSessionDecisionNow(session.sessionId);
        if (!beforeDecision || beforeDecision.decision.turnId !== correlatedTurnId) {
          throw new Error('Current CID DecisionFrame is unavailable for this exact COS turn');
        }
        const beforeContext = renderDecisionContext(beforeDecision);
        const beforeFingerprint = decisionContextFingerprint(session.sessionId, correlatedTurnId, beforeContext);
        const receiptKey = decisionReceiptKey(session.sessionId, correlatedTurnId);
        let receipt = decisionGate.receipts.get(receiptKey);
        if (receipt?.state === 'inflight') {
          const gated = decisionContextResult(
            beforeDecision,
            null,
            'NO_RESOLVE_DISPATCH: Another protected request is already in flight for this exact Session/Turn. ' +
              'Wait for that result and its refreshed DecisionFrame before issuing a new exact request.'
          );
          await recordCosProtectedToolCallNow({
            sessionId: session.sessionId,
            turnId: correlatedTurnId,
            requestId,
            tool: request.params.name,
            args: kernelArgs,
            ok: true,
            result: 'CID_DECISION_CONTEXT_ONLY\nNO_RESOLVE_DISPATCH: protected request was context-gated while another exact request was in flight.'
          });
          decisionGate.requests.set(requestKey, { state: 'result', result: structuredClone(gated) });
          return gated;
        }
        if (!receipt || receipt.turnId !== correlatedTurnId || receipt.contextFingerprint !== beforeFingerprint) {
          receipt = {
            turnId: correlatedTurnId,
            contextFingerprint: beforeFingerprint,
            requestId,
            token: newDecisionContextToken(),
            state: 'ready'
          };
          decisionGate.receipts.set(receiptKey, receipt);
        }
        if (!decisionContextToken || !safeEqual(decisionContextToken, receipt.token)) {
          const gated = decisionContextResult(
            beforeDecision,
            receipt.token,
            'NO_RESOLVE_DISPATCH: Re-evaluate the requested protected action against this bounded current DecisionFrame. ' +
              'If it is still appropriate, issue a new exact tool request and copy decisionContextToken exactly. ' +
              'This receipt only proves you reviewed this exact context; it is not approval. ' +
              'Requests created in parallel before this result cannot carry the receipt and therefore cannot dispatch.'
          );
          await recordCosProtectedToolCallNow({
            sessionId: session.sessionId,
            turnId: correlatedTurnId,
            requestId,
            tool: request.params.name,
            args: kernelArgs,
            ok: true,
            result: 'CID_DECISION_CONTEXT_ONLY\nNO_RESOLVE_DISPATCH: exact request received decision context but did not execute Resolve.'
          });
          decisionGate.requests.set(requestKey, { state: 'result', result: structuredClone(gated) });
          return gated;
        }

        if (workerMutation) {
          throw new Error('COS Worker conversations have no independent Resolve mutation authority');
        }

        // Consume the one-shot receipt synchronously before the first dispatch await. A
        // concurrent exact request carrying the same token will observe the inflight state and
        // cannot enter ToolKernel. Success publishes a fresh token; failure deletes this receipt.
        decisionGate.receipts.set(receiptKey, {
          ...receipt,
          requestId,
          state: 'inflight'
        });

        const callContext: CallContext = {
          caller: 'agent',
          sessionId: session.sessionId,
          turnId: correlatedTurnId,
          callId: requestId
        };
        const dispatchArgs = bindAgentSemanticDispatchArgs(
          beforeDecision.decision.actionOffers,
          request.params.name,
          kernelArgs
        );
        const releaseActivity = beginCosProtectedToolActivity(session.sessionId);
        try {
          let result: CallToolResult;
          try {
            result = await callProtectedKernel(kernel, callContext, request.params.name, dispatchArgs, noteToolCall, workflowAudit);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const held = decisionGate.receipts.get(receiptKey);
            if (held?.state === 'inflight' && held.requestId === requestId) {
              decisionGate.receipts.delete(receiptKey);
            }
            await recordCosProtectedToolCallNow({
              sessionId: session.sessionId,
              turnId: correlatedTurnId,
              requestId,
              tool: request.params.name,
              args: dispatchArgs,
              ok: false,
              result: message
            }).catch(() => undefined);
            throw error;
          }

          const projectedResult = projectProtectedResultForAgent(tool, semanticState, result);
          let nextDecision: CosHostDecisionProjection | null = null;
          try {
            nextDecision = await projectCosSessionDecisionNow(session.sessionId);
          } catch (error) {
            logWarn(`CID DecisionFrame refresh failed after protected success: ${(error as Error).message}`);
          }

          let emitted: CallToolResult;
          if (nextDecision?.decision.turnId === correlatedTurnId) {
            const nextContext = renderDecisionContext(nextDecision);
            const nextReceipt: DecisionGateReceipt = {
              turnId: correlatedTurnId,
              contextFingerprint: decisionContextFingerprint(session.sessionId, correlatedTurnId, nextContext),
              requestId,
              token: newDecisionContextToken(),
              state: 'ready'
            };
            decisionGate.receipts.set(receiptKey, nextReceipt);
            emitted = {
              ...projectedResult,
              content: [
                ...projectedResult.content,
                { type: 'text', text: 'CID_DECISION_CONTEXT\n' + nextContext },
                {
                  type: 'text',
                  text:
                    'CID_DECISION_RECEIPT\n' +
                    JSON.stringify({ decisionContextToken: nextReceipt.token }) +
                    '\n\nUse this receipt only with a new exact protected request after reviewing this refreshed context.'
                }
              ]
            };
          } else {
            // The protected call may already have reached Resolve. Do not relabel that execution
            // as failed merely because the advisory next-frame projection failed, and do not let
            // a later request inherit the old context receipt. The next exact request must gate.
            decisionGate.receipts.delete(receiptKey);
            emitted = {
              ...projectedResult,
              content: [
                ...projectedResult.content,
                {
                  type: 'text',
                  text: 'CID_DECISION_CONTEXT_UNAVAILABLE\nNO_RESOLVE_DISPATCH_NEXT: The protected call completed, but a refreshed DecisionFrame could not be bound to this exact active COS turn. A new exact request must receive fresh CID decision context before any further Resolve dispatch.'
                }
              ]
            };
          }
          await recordCosProtectedToolCallNow({
            sessionId: session.sessionId,
            turnId: correlatedTurnId,
            requestId,
            tool: request.params.name,
            args: dispatchArgs,
            ok: true,
            result: textFromCallToolResult(emitted)
          }).catch((error) => {
            logWarn('COS Session tool-result recording failed after protected success: ' + (error as Error).message);
          });
          decisionGate.requests.set(requestKey, { state: 'result', result: structuredClone(emitted) });
          return emitted;
        } finally {
          releaseActivity();
        }
      } catch (error) {
        const held = decisionGate.receipts.get(decisionReceiptKey(session.sessionId, correlatedTurnId));
        if (held?.state === 'inflight' && held.requestId === requestId) {
          decisionGate.receipts.delete(decisionReceiptKey(session.sessionId, correlatedTurnId));
        }
        decisionGate.requests.set(requestKey, {
          state: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }
    }
    const result = await scheduler.callTool(request.params.name, args);
    if (tool.annotations?.readOnlyHint !== true) {
      semanticState?.invalidate(`Raw Resolve tool ${request.params.name} may have changed state`);
    }
    noteToolCall(request.params.name);
    logInfo(`Resolve tool completed: ${request.params.name} (${((Date.now() - started) / 1000).toFixed(3)}s)`);
    return server.server.projectCallToolResult(result as CallToolResult, tool['outputSchema']);
  });
  return server;
}

export async function startResolveGateway(
  broker: ResolveBroker,
  scheduler: ResolveScheduler,
  semanticState?: ToolKernelSemanticState,
  cosRuntime: CosControlRuntimeDelegate = cosControlRuntimeBridge
): Promise<ResolveGateway> {
  const snapshot = await broker.start();
  const kernel = new ToolKernel(scheduler, snapshot, semanticState);
  let rawRequestAt: number | null = null;
  let workflowRequestAt: number | null = null;
  let lastToolCallAt: number | null = null;
  let lastToolName: string | null = null;
  const workflowAudit: WorkflowAuditEntry[] = [];
  // Shared across createMcpHandler's per-request McpServer instances. Keeping this state inside
  // buildSurfaceServer would gate every HTTP request forever because that factory is recreated for
  // each request. The Session tool-call journal remains the durable replay fence after restart.
  const decisionGate: DecisionGateState = {
    receipts: new Map(),
    requests: new Map()
  };
  let tunnelProbeToken = randomBytes(16).toString('hex');

  const noteToolCall = (name: string): void => {
    lastToolCallAt = Date.now();
    lastToolName = name;
  };
  const agentKernel: ToolKernelAccess = {
    tools: (context) => {
      if (context.caller !== 'agent') throw new Error('Agent ToolKernel access requires Agent call context');
      return kernel.tools(context);
    },
    call: async (context, name, args) => {
      if (context.caller !== 'agent') throw new Error('Agent ToolKernel access requires Agent call context');
      return await callProtectedKernel(kernel, context, name, args, noteToolCall, workflowAudit);
    },
    metrics: (context) => {
      if (context.caller !== 'agent') throw new Error('Agent ToolKernel access requires Agent call context');
      return kernel.metrics(context);
    },
    releaseMetrics: (context) => {
      if (context.caller !== 'agent') throw new Error('Agent ToolKernel access requires Agent call context');
      kernel.releaseMetrics(context);
    }
  };
  const surfacePaths: Array<{ id: ResolveSurface; basePath: string }> = [
    { id: 'raw', basePath: `/mcp/raw/${randomBytes(32).toString('base64url')}` },
    { id: 'workflow', basePath: `/mcp/workflow/${randomBytes(32).toString('base64url')}` }
  ];

  const routes: SurfaceRoute[] = surfacePaths.map((surface) => ({
    ...surface,
    prmPath: `${PRM_PREFIX}${surface.basePath}`,
    url: '',
    handler: toNodeHandler(
      createMcpHandler(() => buildSurfaceServer(
        scheduler,
        kernel,
        snapshot,
        surface.id,
        noteToolCall,
        workflowAudit,
        decisionGate,
        semanticState,
        cosRuntime
      )),
      { onerror: (error) => logError(`Local MCP handler error (${surface.id}): ${error.message}`) }
    )
  }));
  const checkHost = localhostHostValidation();
  const checkOrigin = localhostOriginValidation();

  const server = http.createServer((req, res) => {
    const pathOnly = (req.url ?? '').split('?')[0] ?? '';
    const route = routes.find((candidate) => safeEqual(pathOnly, candidate.basePath)) ?? null;
    const prmRoute = routes.find((candidate) => safeEqual(pathOnly, candidate.prmPath)) ?? null;
    const tunnelProbe = req.headers[TUNNEL_PROBE_HEADER] === tunnelProbeToken;
    const startedAt = Date.now();

    res.on('finish', () => {
      const shape = route ? `mcp/${route.id}` : prmRoute ? `oauth-metadata/${prmRoute.id}` : 'unknown-route';
      const line = `${req.method ?? '?'} ${shape} → ${res.statusCode} in ${Date.now() - startedAt}ms${tunnelProbe ? ' (tunnel probe)' : ''}`;
      const optional = res.statusCode === 405 && route !== null && (req.method === 'GET' || req.method === 'DELETE');
      const expectedProbe = tunnelProbe && res.statusCode === 415 && route !== null && req.method === 'POST';
      if (optional || expectedProbe) logInfo(`request ${line}`);
      else if (res.statusCode >= 400) logWarn(`request ${line}`);
      else logInfo(`request ${line}`);
    });

    if (prmRoute) {
      if (!checkHost(req, res) || !checkOrigin(req, res)) return;
      const body = metadata(prmRoute.url, prmRoute.id === 'raw' ? 'Chat in DaVinci Raw' : 'Chat in DaVinci');
      res.writeHead(200, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(body)
      });
      res.end(body);
      return;
    }
    if (!route) {
      jsonError(res, 404, 'not_found');
      return;
    }
    if (!checkHost(req, res) || !checkOrigin(req, res)) return;

    const requestId = cosRequestIdFromHeader(req.headers['x-request-id']);
    const dispatchRoute = (body?: unknown): void => {
      withCosInboundRequestId(requestId, () => {
        void route.handler(req, res, body);
      });
    };

    if (!tunnelProbe) {
      if (route.id === 'raw') rawRequestAt = Date.now();
      else workflowRequestAt = Date.now();
    }

    const declared = Number(req.headers['content-length'] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      jsonError(res, 413, 'payload_too_large');
      return;
    }
    if (req.method === 'POST' && req.headers['content-length'] === undefined) {
      void readBoundedJsonBody(req).then((parsed) => {
        if (parsed.error === 'payload_too_large') return jsonError(res, 413, 'payload_too_large');
        if (parsed.error === 'invalid_json') return jsonError(res, 400, 'invalid_json');
        dispatchRoute(parsed.body);
      });
      return;
    }
    dispatchRoute();
  });

  server.headersTimeout = 30_000;
  server.requestTimeout = 300_000;
  server.maxRequestsPerSocket = 0;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await broker.stop();
    throw new Error('Could not determine the local MCP server port');
  }
  server.on('error', (error) => logError(`Local MCP server error: ${error.message}`));
  for (const route of routes) route.url = `http://127.0.0.1:${address.port}${route.basePath}`;
  const urls = Object.fromEntries(routes.map((route) => [route.id, route.url])) as Record<ResolveSurface, string>;
  logInfo(`Local Resolve MCP gateway started on 127.0.0.1:${address.port}`);

  return {
    port: address.port,
    urls,
    productUrl: urls.workflow,
    tunnelProbeHeaders: () => ({ [TUNNEL_PROBE_HEADER]: tunnelProbeToken }),
    status: () => ({
      active: server.listening,
      rawRequestAt,
      workflowRequestAt,
      lastToolCallAt,
      lastToolName,
      schemaHash: snapshot.schemaHash
    }),
    workflowInspect: async (request) => await kernel.inspect({ caller: 'local_ui' }, request),
    workflowRisk: (tool) => kernel.assess({ caller: 'local_ui' }, tool),
    workflowAudit: (limit = 20) => workflowAudit.slice(-Math.max(1, Math.min(20, limit))).reverse(),
    agentKernel,
    stop: (options = {}) => new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        tunnelProbeToken = '';
        void broker.stop().finally(resolve);
      };
      const force = options.forceAfterMs === undefined
        ? null
        : setTimeout(() => {
            if (settled) return;
            server.closeAllConnections();
            finish();
          }, options.forceAfterMs);
      server.close(() => {
        if (force) clearTimeout(force);
        finish();
      });
    })
  };
}
