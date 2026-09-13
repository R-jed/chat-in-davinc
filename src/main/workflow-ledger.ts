import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import type { ProtectedWorkflowId, WorkflowLedgerEvent, WorkflowLedgerEventType } from '../shared/types.js';
import { logError, logInfo, logWarn } from './log.js';

let ledgerPath = '';
let handle: FileHandle | null = null;
let events: WorkflowLedgerEvent[] = [];
let fatalError: string | null = null;
let queue: Promise<void> = Promise.resolve();

const EVENT_TYPES = new Set<WorkflowLedgerEventType>([
  'plan_created', 'plan_rejected', 'plan_stale', 'approval_granted', 'approval_revoked',
  'backup_started', 'backup_cancelled', 'backup_created', 'execution_prepared', 'dispatch_started', 'dispatch_returned',
  'execution_cancelled', 'verification_started', 'verification_completed', 'execution_ambiguous',
  'recovery_started', 'recovery_completed'
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseEvent(value: unknown): WorkflowLedgerEvent | null {
  if (!isRecord(value)) return null;
  if (value['ledger_schema_version'] !== 1) return null;
  if (typeof value['event_id'] !== 'string' || typeof value['event_type'] !== 'string' || !EVENT_TYPES.has(value['event_type'] as WorkflowLedgerEventType) || typeof value['recorded_at'] !== 'string') return null;
  if (!isRecord(value['payload'])) return null;
  return value as unknown as WorkflowLedgerEvent;
}

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const run = queue.then(operation, operation);
  queue = run.then(() => undefined, () => undefined);
  return run;
}

function latchRuntimeFailure(operation: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (!fatalError) {
    fatalError = `Workflow ledger ${operation} failed: ${detail}`;
    logError(fatalError);
  }
  return new Error(fatalError);
}

export async function initWorkflowLedger(userData: string): Promise<void> {
  ledgerPath = path.join(userData, 'workflow-ledger.jsonl');
  events = [];
  fatalError = null;
  queue = Promise.resolve();
  await fs.mkdir(userData, { recursive: true });

  let text = '';
  try {
    text = await fs.readFile(ledgerPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const terminated = text.length === 0 || text.endsWith('\n');
  const rawLines = text.split('\n');
  if (rawLines.at(-1) === '') rawLines.pop();
  let truncateIncompleteTail = false;
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]!;
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const trailingCrashRecord = index === rawLines.length - 1 && !terminated;
      if (trailingCrashRecord) {
        logWarn('Workflow ledger ignored one incomplete trailing crash record.');
        truncateIncompleteTail = true;
        break;
      }
      fatalError = `Workflow ledger corruption at line ${index + 1}: ${(error as Error).message}`;
      logError(fatalError);
      break;
    }
    const event = parseEvent(parsed);
    if (!event) {
      fatalError = `Workflow ledger corruption at line ${index + 1}: invalid event schema`;
      logError(fatalError);
      break;
    }
    events.push(event);
  }

  if (!fatalError) {
    if (truncateIncompleteTail) {
      const lastNewline = text.lastIndexOf('\n');
      const validPrefix = lastNewline >= 0 ? text.slice(0, lastNewline + 1) : '';
      await fs.truncate(ledgerPath, Buffer.byteLength(validPrefix, 'utf8'));
    }
    handle = await fs.open(ledgerPath, 'a+', 0o600);
    await handle.chmod(0o600).catch(() => undefined);
    logInfo(`Workflow ledger ready with ${events.length} durable event(s).`);
  } else {
    handle = null;
  }
}

export function workflowLedgerError(): string | null { return fatalError; }

export function workflowLedgerEvents(): WorkflowLedgerEvent[] {
  return structuredClone(events);
}

export function appendWorkflowLedgerEvent(options: {
  eventType: WorkflowLedgerEventType;
  planId?: string;
  approvalId?: string;
  executionId?: string;
  workflowId?: ProtectedWorkflowId;
  workflowVersion?: '1';
  payload?: Record<string, unknown>;
  flush?: boolean;
}): Promise<WorkflowLedgerEvent> {
  return enqueue(async () => {
    if (fatalError) throw new Error(fatalError);
    if (!handle) throw latchRuntimeFailure('append', new Error('Workflow ledger is not initialized'));
    const event: WorkflowLedgerEvent = {
      ledger_schema_version: 1,
      event_id: randomUUID(),
      event_type: options.eventType,
      recorded_at: new Date().toISOString(),
      ...(options.planId ? { plan_id: options.planId } : {}),
      ...(options.approvalId ? { approval_id: options.approvalId } : {}),
      ...(options.executionId ? { execution_id: options.executionId } : {}),
      ...(options.workflowId ? { workflow_id: options.workflowId } : {}),
      ...(options.workflowVersion ? { workflow_version: options.workflowVersion } : {}),
      payload: structuredClone(options.payload ?? {})
    };
    const line = `${JSON.stringify(event)}\n`;
    try {
      const write = await handle.write(line, null, 'utf8');
      const expectedBytes = Buffer.byteLength(line, 'utf8');
      if (write.bytesWritten !== expectedBytes) {
        throw new Error(`short write (${write.bytesWritten}/${expectedBytes} bytes)`);
      }
      if (options.flush) await handle.sync();
    } catch (error) {
      throw latchRuntimeFailure(options.flush ? 'write/sync' : 'write', error);
    }
    events.push(event);
    return structuredClone(event);
  });
}

export function flushWorkflowLedger(): Promise<void> {
  return enqueue(async () => {
    if (fatalError) throw new Error(fatalError);
    if (!handle) return;
    try {
      await handle.sync();
    } catch (error) {
      throw latchRuntimeFailure('sync', error);
    }
  });
}

export function closeWorkflowLedger(): Promise<void> {
  return enqueue(async () => {
    const closing = handle;
    handle = null;
    if (!closing) return;
    try {
      await closing.sync();
    } catch (error) {
      const failure = latchRuntimeFailure('sync', error);
      await closing.close().catch(() => undefined);
      throw failure;
    }
    await closing.close();
  });
}

export function resetWorkflowLedgerForTests(): void {
  handle = null;
  ledgerPath = '';
  events = [];
  fatalError = null;
  queue = Promise.resolve();
}
