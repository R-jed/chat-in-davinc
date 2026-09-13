import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';

const SESSION_INCLUDE_KINDS = ['user', 'assistant', 'tools', 'errors', 'agents'] as const;
const REASONING_EFFORTS = ['pro', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;

const sessionInputSchema = z
  .object({
    action: z.enum(['search', 'read']).describe('search discovers recordings; read inspects one explicit recording.'),
    query: z.string().max(500).optional().describe('search only. Omit to list the 30 newest recordings.'),
    session_id: z.string().min(8).max(64).optional().describe('read only. Exact id returned by search.'),
    include: z
      .array(z.enum(SESSION_INCLUDE_KINDS))
      .min(1)
      .max(5)
      .refine((values) => new Set(values).size === values.length, 'include entries must be unique')
      .optional()
      .describe('read only. Defaults to user, assistant, tools, errors and agents.'),
    tool_call: z
      .string()
      .regex(/^T[0-9A-Z]+$/i)
      .max(16)
      .optional()
      .describe('read only. Expand one short session-local tool reference such as T2F.'),
    cursor: z
      .string()
      .min(1)
      .max(8000)
      .optional()
      .describe(
        'A short token this tool printed earlier: update_cursor, continuation_cursor, older_cursor, read_cursor or next_cursor. Copy it exactly; it carries a checksum and a mistyped copy is refused.'
      )
  })
  .superRefine((input, ctx) => {
    if (input.action === 'search') {
      for (const field of ['session_id', 'include', 'tool_call'] as const) {
        if (input[field] !== undefined) {
          ctx.addIssue({ code: 'custom', path: [field], message: `${field} is only valid with action=read` });
        }
      }
      if (input.cursor && input.query !== undefined) {
        ctx.addIssue({ code: 'custom', path: ['query'], message: 'A search continuation cursor already contains its query' });
      }
      return;
    }

    if (!input.session_id) {
      ctx.addIssue({ code: 'custom', path: ['session_id'], message: 'session_id is required with action=read' });
    }
    if (input.query !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['query'], message: 'query is only valid with action=search' });
    }
    if (input.cursor && (input.include !== undefined || input.tool_call !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['cursor'],
        message: 'A read cursor already contains its filters and mode; do not combine it with include or tool_call'
      });
    }
    if (input.tool_call && input.include !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['include'], message: 'include cannot be combined with tool_call' });
    }
  })
  .strict();

const agentsInputSchema = z
  .object({
    action: z.enum(['spawn', 'message', 'status', 'finish']).describe('What to do.'),
    context: z
      .string()
      .max(4000)
      .optional()
      .describe('spawn: shared instructions prepended to every task, e.g. repo, conventions, edit limits and validation.'),
    spawn_mode: z
      .enum(['reuse-first', 'fresh'])
      .optional()
      .describe(
        'spawn only: reuse-first (default) refuses to open fresh chats while reusable sleeping workers exist; fresh explicitly requests new independent chats.'
      ),
    workers: z
      .array(
        z.object({
          label: z.string().max(60).optional().describe('Short name shown to the user, e.g. "Security".'),
          task: z
            .string()
            .min(1)
            .max(4000)
            .describe("This worker's job: objective, relevant files, constraints and expected handoff."),
          model: z
            .string()
            .max(80)
            .optional()
            .describe('ChatGPT model slug for this worker only, e.g. to keep an expensive model for yourself. Omit for the default set in app settings.'),
          reasoning_effort: z
            .enum(REASONING_EFFORTS)
            .optional()
            .describe('How much reasoning this worker uses. Independent of model: it never selects or changes one. Omit for the default set in app settings.')
        }).strict()
      )
      .min(1)
      .max(8)
      .optional()
      .describe(
        'spawn: requested worker briefs. With the default reuse-first mode, reusable sleeping workers are returned before any fresh worker chat is opened; wake chosen sleepers explicitly with message.'
      ),
    messages: z
      .array(
        z.object({
          to: z.string().min(1).max(40).describe('Recipient.'),
          text: z.string().min(1).max(4000).describe('What to say.')
        }).strict()
      )
      .min(1)
      .max(16)
      .optional()
      .describe('message: atomic batch; prefer this to one call per recipient.'),
    to: z.string().min(1).max(40).optional().describe('message: one recipient; messaging a sleeping worker wakes it.'),
    text: z.string().min(1).max(4000).optional().describe('message: what to say.'),
    result: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('finish: factual handoff under RESULT / CHANGES / VALIDATION / BLOCKERS.')
  })
  .superRefine((input, ctx) => {
    const reject = (field: 'context' | 'spawn_mode' | 'workers' | 'messages' | 'to' | 'text' | 'result', message: string): void => {
      if (input[field] !== undefined) ctx.addIssue({ code: 'custom', path: [field], message });
    };
    if (input.action !== 'spawn') {
      reject('context', 'context is only valid with action=spawn');
      reject('spawn_mode', 'spawn_mode is only valid with action=spawn');
      reject('workers', 'workers is only valid with action=spawn');
    }
    if (input.action !== 'message') {
      reject('messages', 'messages is only valid with action=message');
      reject('to', 'to is only valid with action=message');
      reject('text', 'text is only valid with action=message');
    }
    if (input.action !== 'finish') reject('result', 'result is only valid with action=finish');
  })
  .strict();

const sessionFinishInputSchema = z.object({ summary: z.string().min(1).max(1000) }).strict();

export type CosSessionInput = z.infer<typeof sessionInputSchema>;
export type CosAgentsInput = z.infer<typeof agentsInputSchema>;
export type CosSessionFinishInput = z.infer<typeof sessionFinishInputSchema>;
export type CosControlToolName = 'session' | 'agents' | 'session_finish';

/**
 * Exact transport evidence passed into the COS-owned runtime.
 *
 * The request id is the normalized ChatGPT x-request-id join key used by COS to associate an
 * MCP call with browser-side conversation evidence. CID carries it but never infers a
 * conversation from timing or from model-supplied arguments.
 */
export interface CosControlCallContext {
  transportSessionId: string | null;
  requestId: string | null;
  /** Wall-clock start of this exact MCP tools/call request, matching COS currentCall().startedAt. */
  startedAt: number;
}

const inboundRequestIds = new AsyncLocalStorage<string | null>();

export function cosRequestIdFromHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value) && value.length !== 1) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const id = raw.split('/')[0]!.trim();
  return id.length > 0 && id.length <= 100 && /^[a-z0-9_-]+$/i.test(id) ? id : null;
}

export function withCosInboundRequestId<T>(requestId: string | null, body: () => T): T {
  return inboundRequestIds.run(requestId, body);
}

export function cosInboundRequestId(): string | null {
  return inboundRequestIds.getStore() ?? null;
}

/**
 * The adapter deliberately owns no COS state. The future COS host binds these delegates so
 * conversation identity, worker lifecycle, durable barriers and finish holds stay authoritative
 * in COS rather than being reimplemented in CID.
 */
export interface CosControlRuntime {
  session(input: CosSessionInput, context: CosControlCallContext): Promise<CallToolResult>;
  agents(input: CosAgentsInput, context: CosControlCallContext): Promise<CallToolResult>;
  sessionFinish(input: CosSessionFinishInput, context: CosControlCallContext): Promise<CallToolResult>;
}

export type CosControlRuntimeDelegate = Partial<CosControlRuntime>;

export interface CosControlToolSurface {
  tools: Tool[];
  call(name: string, args: unknown, context: CosControlCallContext): Promise<CallToolResult>;
}

export type CosControlToolRegistrar = (
  tool: Tool,
  handler: (args: unknown, context: CosControlCallContext) => Promise<CallToolResult>
) => void;

const toolDefinitions: Record<CosControlToolName, Tool> = {
  session: {
    name: 'session',
    description:
      'Search and read this app’s local recordings, including other and concurrently running chats. ' +
      'action=search lists the 30 newest sessions when query is omitted, or finds recordings containing a term. ' +
      'action=read requires session_id and returns exact user/assistant text plus compact tool headlines. ' +
      'To follow a running chat, pass the update_cursor from the previous read and only activity since then comes back. ' +
      'Pass a short T… reference as tool_call to inspect exact arguments and result. Cursors are short tokens; copy them exactly.',
    inputSchema: z.toJSONSchema(sessionInputSchema) as Tool['inputSchema'],
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  },
  agents: {
    name: 'agents',
    description:
      'Run ChatGPT workers. Reuse a suitable sleeping worker with message before spawn. Spawn defaults to a reuse-first preflight: if reusable sleeping workers exist, it opens no new chats and returns them instead. Use spawn_mode="fresh" only when a new independent chat is intentional. Sleeping/terminal workers stay in this prime conversation’s durable history. ' +
      'message: prime→worker or worker→prime; messaging a sleeping worker revives that exact existing chat when a slot is free. Replies arrive on later tool results, so never poll. ' +
      'status shows this prime’s full worker history, including sleeping/revivable and terminal/non-revivable workers, even while no run is active. finish reports a worker result and normally puts it to sleep.',
    inputSchema: z.toJSONSchema(agentsInputSchema) as Tool['inputSchema'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  },
  session_finish: {
    name: 'session_finish',
    description:
      'Use this tool only when the user explicitly requests finish-hold behavior. Signal that the current task is approaching completion and receive queued user instructions before finalization. While HELD, follow attached instructions and call again before finishing. Each call waits at most 25 seconds.',
    inputSchema: z.toJSONSchema(sessionFinishInputSchema) as Tool['inputSchema'],
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
  }
};

function inputError(tool: CosControlToolName, error: z.ZodError): Error {
  const detail = error.issues
    .map((issue) => `${issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''}${issue.message}`)
    .join('; ');
  return new Error(`Invalid ${tool} arguments: ${detail}`);
}

function runtimeUnavailable(tool: CosControlToolName): Error {
  return new Error(`COS control runtime is unavailable for ${tool}; CID will not emulate COS-owned state.`);
}

function parseSession(args: unknown): CosSessionInput {
  const parsed = sessionInputSchema.safeParse(args);
  if (!parsed.success) throw inputError('session', parsed.error);
  return parsed.data;
}

function parseAgents(args: unknown): CosAgentsInput {
  const parsed = agentsInputSchema.safeParse(args);
  if (!parsed.success) throw inputError('agents', parsed.error);
  const input = parsed.data;
  if (input.action === 'spawn' && !input.workers) {
    throw new Error('agents action=spawn requires workers.');
  }
  if (input.action === 'message') {
    const batch = input.messages ?? [];
    const single = input.to && input.text ? [{ to: input.to, text: input.text }] : [];
    if (batch.length > 0 && single.length > 0) {
      throw new Error('agents action=message takes either to+text or messages, not both.');
    }
    if (batch.length === 0 && single.length === 0) {
      throw new Error('agents action=message requires to and text, or a messages array.');
    }
  }
  if (input.action === 'finish' && !input.result) {
    throw new Error(
      'agents action=finish requires result: the report the prime reads in your place — what you changed, what you verified and what is left. Send it as result and call finish again.'
    );
  }
  return input;
}

function parseSessionFinish(args: unknown): CosSessionFinishInput {
  const parsed = sessionFinishInputSchema.safeParse(args);
  if (!parsed.success) throw inputError('session_finish', parsed.error);
  return parsed.data;
}

export function buildCosControlToolSurface(runtime: CosControlRuntimeDelegate = {}): CosControlToolSurface {
  const handlers: Record<CosControlToolName, (args: unknown, context: CosControlCallContext) => Promise<CallToolResult>> = {
    session: async (args, context) => {
      const input = parseSession(args);
      if (!runtime.session) throw runtimeUnavailable('session');
      return await runtime.session(input, context);
    },
    agents: async (args, context) => {
      const input = parseAgents(args);
      if (!runtime.agents) throw runtimeUnavailable('agents');
      return await runtime.agents(input, context);
    },
    session_finish: async (args, context) => {
      const input = parseSessionFinish(args);
      if (!runtime.sessionFinish) throw runtimeUnavailable('session_finish');
      return await runtime.sessionFinish(input, context);
    }
  };

  return {
    tools: Object.values(toolDefinitions).map((tool) => structuredClone(tool)),
    async call(name, args, context) {
      if (name !== 'session' && name !== 'agents' && name !== 'session_finish') {
        throw new Error(`Unknown COS control tool: ${name}`);
      }
      return await handlers[name](args, context);
    }
  };
}

export function registerCosControlTools(
  register: CosControlToolRegistrar,
  runtime: CosControlRuntimeDelegate = {}
): void {
  const surface = buildCosControlToolSurface(runtime);
  for (const tool of surface.tools) {
    register(tool, async (args, context) => await surface.call(tool.name, args, context));
  }
}
