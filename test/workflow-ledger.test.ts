import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendWorkflowLedgerEvent,
  closeWorkflowLedger,
  initWorkflowLedger,
  resetWorkflowLedgerForTests,
  workflowLedgerError,
  workflowLedgerEvents
} from '../src/main/workflow-ledger.js';

let tempDir: string | null = null;

afterEach(async () => {
  await closeWorkflowLedger().catch(() => undefined);
  resetWorkflowLedgerForTests();
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = null;
});

describe('durable workflow ledger', () => {
  it('flushes and replays durable events', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-ledger-test-'));
    await initWorkflowLedger(tempDir);
    await appendWorkflowLedgerEvent({
      eventType: 'plan_created',
      planId: 'plan_test',
      workflowId: 'edit.review_marker_add.v1',
      workflowVersion: '1',
      payload: { plan_hash: 'abc' },
      flush: true
    });
    await closeWorkflowLedger();

    const persisted = await readFile(path.join(tempDir, 'workflow-ledger.jsonl'), 'utf8');
    expect(persisted.endsWith('\n')).toBe(true);

    resetWorkflowLedgerForTests();
    await initWorkflowLedger(tempDir);
    expect(workflowLedgerError()).toBeNull();
    expect(workflowLedgerEvents()).toHaveLength(1);
    expect(workflowLedgerEvents()[0]).toMatchObject({ event_type: 'plan_created', plan_id: 'plan_test' });
  });

  it('ignores only an incomplete trailing crash record', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-ledger-test-'));
    const valid = JSON.stringify({
      ledger_schema_version: 1, event_id: 'event-1', event_type: 'plan_created',
      recorded_at: '2026-09-10T00:00:00.000Z', payload: {}
    });
    await writeFile(path.join(tempDir, 'workflow-ledger.jsonl'), `${valid}\n{"ledger_schema_version":1`, { mode: 0o600 });
    await initWorkflowLedger(tempDir);
    expect(workflowLedgerError()).toBeNull();
    expect(workflowLedgerEvents()).toHaveLength(1);
    await appendWorkflowLedgerEvent({ eventType: 'plan_rejected', planId: 'plan_test', payload: { reason: 'test' }, flush: true });
    await closeWorkflowLedger();
    resetWorkflowLedgerForTests();
    await initWorkflowLedger(tempDir);
    expect(workflowLedgerError()).toBeNull();
    expect(workflowLedgerEvents().map((event) => event.event_type)).toEqual(['plan_created', 'plan_rejected']);
  });

  it('fails closed on corruption before the trailing record', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-ledger-test-'));
    await writeFile(path.join(tempDir, 'workflow-ledger.jsonl'), '{bad json}\n{}\n', { mode: 0o600 });
    await initWorkflowLedger(tempDir);
    expect(workflowLedgerError()).toContain('corruption at line 1');
    await expect(appendWorkflowLedgerEvent({ eventType: 'plan_created', payload: {} })).rejects.toThrow('corruption at line 1');
  });

  it('does not excuse a complete trailing record with an invalid schema', async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'cid-ledger-test-'));
    await writeFile(path.join(tempDir, 'workflow-ledger.jsonl'), '{}', { mode: 0o600 });
    await initWorkflowLedger(tempDir);
    expect(workflowLedgerError()).toContain('invalid event schema');
  });
});
