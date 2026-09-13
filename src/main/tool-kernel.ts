import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import type { AgentEntityRef } from '../shared/agent-system.js';
import type {
  ProjectPreflightProfile,
  WorkflowAuditEntry,
  WorkflowInspectResult,
  WorkflowInspectTarget,
  WorkflowRiskAssessment
} from '../shared/types.js';
import type { ResolveBrokerSnapshot } from './resolve-broker.js';
import type { ResolveClient, ResolveSchedulerMetrics } from './resolve-scheduler.js';
import { logWarn } from './log.js';
import { assessWorkflowOperation, callWorkflowTool, workflowTools } from './workflow.js';

export type ToolKernelCaller = 'local_ui' | 'protected_mcp' | 'agent';

export type CallContext =
  | { caller: Exclude<ToolKernelCaller, 'agent'> }
  | { caller: 'agent'; sessionId: string; turnId: string; callId?: string };

export interface ToolKernelAccess {
  tools(context: CallContext): Tool[];
  call(context: CallContext, name: string, args: Record<string, unknown>): Promise<CallToolResult>;
  metrics?(context: CallContext): ToolKernelMetrics;
  releaseMetrics?(context: CallContext): void;
}

export interface ToolKernelMetrics {
  resolveCalls: number;
  resolveDurationMs: number;
}

export interface ToolKernelObservation {
  context: CallContext;
  name: string;
  args: Record<string, unknown>;
  result: CallToolResult;
}

export interface ToolKernelSemanticState {
  observe(observation: ToolKernelObservation): void;
  resolveEntity(handle: string, generation?: number): AgentEntityRef;
  invalidate(reason: string): void;
  projectToolResult?(result: CallToolResult): string;
}

export type ToolKernelInspectView =
  | 'default'
  | 'link_status'
  | 'structure'
  | 'gaps_overlaps'
  | 'source_ranges'
  | 'transitions'
  | 'annotations'
  | 'graph'
  | 'versions'
  | 'audio_processing';

export interface ToolKernelInspectRequest {
  target: WorkflowInspectTarget;
  profile?: ProjectPreflightProfile;
  itemId?: string;
  view?: ToolKernelInspectView;
}

function protectedResult<T>(result: CallToolResult): T {
  const text = result.content.find((item) => item.type === 'text')?.text;
  if (!text) throw new Error('Protected ToolKernel call returned no text result');
  let envelope: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text) as unknown;
    envelope = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    throw new Error('Protected ToolKernel call returned invalid JSON');
  }
  if (!envelope || !Object.hasOwn(envelope, 'result')) throw new Error('Protected ToolKernel call returned no result envelope');
  return envelope['result'] as T;
}

function agentTools(tools: Tool[]): Tool[] {
  const inspect = tools.find((tool) => tool.name === 'inspect');
  if (!inspect) return tools;
  const schema = inspect.inputSchema as Record<string, unknown>;
  const properties = schema['properties'];
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return tools;
  const next = properties as Record<string, unknown>;
  delete next['itemId'];
  next['itemRef'] = {
    type: 'string',
    minLength: 1,
    maxLength: 32,
    description: 'Current semantic MediaPoolItem handle such as M3. Use only a handle supplied by the current ContextPack.'
  };
  next['generation'] = {
    type: 'integer',
    minimum: 1,
    description: 'World-model generation that supplied itemRef. Required with itemRef; stale generations are refused.'
  };
  return tools;
}

interface MetricAwareResolveClient extends ResolveClient {
  runInMetricScope<T>(scope: string, operation: () => Promise<T>): Promise<T>;
  metricsFor(scope: string): ResolveSchedulerMetrics;
  releaseMetrics(scope: string): void;
}

function metricAware(client: ResolveClient): client is MetricAwareResolveClient {
  const row = client as Partial<MetricAwareResolveClient>;
  return typeof row.runInMetricScope === 'function' && typeof row.metricsFor === 'function' && typeof row.releaseMetrics === 'function';
}

function metricScope(context: CallContext): string | null {
  return context.caller === 'agent' ? `agent:${context.sessionId}:${context.turnId}` : null;
}

export class ToolKernel {
  constructor(
    private readonly resolve: ResolveClient,
    private readonly snapshot: ResolveBrokerSnapshot,
    private readonly semanticState?: ToolKernelSemanticState
  ) {}

  tools(context: CallContext): Tool[] {
    const tools = workflowTools();
    return context.caller === 'agent' ? agentTools(tools) : tools;
  }

  assess(_context: CallContext, workflowId: string): WorkflowRiskAssessment {
    return assessWorkflowOperation(workflowId);
  }

  metrics(context: CallContext): ToolKernelMetrics {
    const scope = metricScope(context);
    if (!scope || !metricAware(this.resolve)) return { resolveCalls: 0, resolveDurationMs: 0 };
    const metrics = this.resolve.metricsFor(scope);
    return { resolveCalls: metrics.calls, resolveDurationMs: metrics.durationMs };
  }

  releaseMetrics(context: CallContext): void {
    const scope = metricScope(context);
    if (scope && metricAware(this.resolve)) this.resolve.releaseMetrics(scope);
  }

  async inspect(context: CallContext, request: ToolKernelInspectRequest): Promise<WorkflowInspectResult> {
    const args: Record<string, unknown> = { target: request.target };
    if (request.profile !== undefined) args['profile'] = request.profile;
    if (request.itemId !== undefined) args['itemId'] = request.itemId;
    if (request.view !== undefined && request.view !== 'default') args['view'] = request.view;
    return protectedResult<WorkflowInspectResult>(await this.call(context, 'inspect', args));
  }

  async call(
    context: CallContext,
    name: string,
    args: Record<string, unknown>,
    audit: readonly WorkflowAuditEntry[] = []
  ): Promise<CallToolResult> {
    const normalized = this.normalizeArgs(context, name, args);
    const invoke = async (): Promise<CallToolResult> => {
      // Deliver and the default Color pipeline read current project/timeline state while their
      // fixed result shapes intentionally omit exact authority identity. Reuse the existing
      // protected Project observation immediately before either reader so the World Model either
      // confirms the current binding or advances its generation before their evidence is accepted.
      const identityFencedInspect = name === 'inspect'
        && (normalized['target'] === 'deliver'
          || (normalized['target'] === 'color' && normalized['view'] === undefined));
      if (identityFencedInspect && this.semanticState) {
        const identityArgs = { target: 'project' };
        const identityResult = await callWorkflowTool(this.resolve, this.snapshot, 'inspect', identityArgs, audit);
        this.semanticState.observe({ context, name: 'inspect', args: identityArgs, result: identityResult });
      }
      return await callWorkflowTool(this.resolve, this.snapshot, name, normalized, audit);
    };
    const scope = metricScope(context);
    const result = scope && metricAware(this.resolve)
      ? await this.resolve.runInMetricScope(scope, invoke)
      : await invoke();
    if (this.semanticState) {
      try {
        this.semanticState.observe({ context, name, args: normalized, result });
      } catch (error) {
        // Semantic projection is downstream evidence bookkeeping. It must never turn a
        // successfully returned (and possibly already dispatched) protected call into a retryable failure.
        logWarn(`Agent semantic-state observation failed after ${name}: ${(error as Error).message}`);
      }
    }
    return result;
  }

  private normalizeArgs(context: CallContext, name: string, args: Record<string, unknown>): Record<string, unknown> {
    const normalized = structuredClone(args);
    if (context.caller !== 'agent') return normalized;
    if (name === 'plan' && (normalized['workflowId'] === 'edit.review_marker_add.v1' || normalized['workflowId'] === 'color.grade_version_create.v1')) {
      if (Object.hasOwn(normalized, 'targetItemId')) {
        throw new Error('Agent item-scoped planning uses a semantic itemRef, not a raw Resolve TimelineItem ID');
      }
      if (!this.semanticState) throw new Error('Agent semantic entity resolution is unavailable');
      if (normalized['target'] !== 'timeline_item') throw new Error('Agent item-scoped mutation target must be timeline_item');
      const handle = normalized['itemRef'];
      const generation = normalized['generation'];
      if (typeof handle !== 'string' || handle.length < 1 || handle.length > 32) throw new Error('Invalid Agent mutation itemRef');
      if (!Number.isInteger(generation) || (generation as number) < 1) throw new Error('Agent mutation itemRef requires its current world-model generation');
      const entity = this.semanticState.resolveEntity(handle, generation as number);
      if (entity.kind !== 'timeline_item') throw new Error('Agent mutation itemRef does not identify a TimelineItem');
      delete normalized['itemRef'];
      delete normalized['generation'];
      normalized['targetItemId'] = entity.exactId;
      return normalized;
    }
    if (name !== 'inspect') return normalized;
    if (Object.hasOwn(normalized, 'itemId')) {
      throw new Error('Agent media inspection uses a semantic itemRef, not a raw Resolve itemId');
    }
    if (!Object.hasOwn(normalized, 'itemRef')) return normalized;
    if (!this.semanticState) throw new Error('Agent semantic entity resolution is unavailable');
    if (normalized['target'] !== 'media') throw new Error('itemRef is supported only for Agent media inspection');
    const handle = normalized['itemRef'];
    const generation = normalized['generation'];
    if (typeof handle !== 'string' || handle.length < 1 || handle.length > 32) throw new Error('Invalid Agent itemRef');
    if (!Number.isInteger(generation) || (generation as number) < 1) throw new Error('Agent itemRef requires its current world-model generation');
    const entity = this.semanticState.resolveEntity(handle, generation as number);
    if (entity.kind !== 'media_pool_item') throw new Error('Agent itemRef does not identify a Media Pool item');
    delete normalized['itemRef'];
    delete normalized['generation'];
    normalized['itemId'] = entity.exactId;
    return normalized;
  }
}
