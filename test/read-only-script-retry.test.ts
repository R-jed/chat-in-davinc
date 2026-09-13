import { describe, expect, it } from 'vitest';
import type { ResolveBroker, ResolveBrokerSnapshot } from '../src/main/resolve-broker.js';
import { callWorkflowTool } from '../src/main/workflow.js';

const snapshot: ResolveBrokerSnapshot = {
  serverName: 'davinci_resolve',
  serverVersion: '21.1',
  protocolVersion: '2024-11-05',
  instructions: null,
  tools: [{ name: 'run_script', description: 'fixed sandboxed reader', inputSchema: { type: 'object' } }],
  schemaHash: 'read-only-retry-test'
};

const projectResult = {
  page: 'edit',
  project: { name: 'test', id: 'project-1', timelineCount: 1 },
  timeline: { name: 'Timeline 1', id: 'timeline-1', videoTracks: 1, audioTracks: 1, subtitleTracks: 0 },
  projectSettings: null,
  timelineSettings: null
};

function text(value: Record<string, unknown>): unknown {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

describe('read-only Resolve script empty-error handling', () => {
  it('retries the qualified opaque empty ResolveMCP error exactly once for a fixed reader', async () => {
    let calls = 0;
    const broker = {
      async callTool(): Promise<unknown> {
        calls += 1;
        return calls === 1 ? text({ error: '' }) : text({ result: projectResult });
      }
    } as unknown as ResolveBroker;

    const output = await callWorkflowTool(broker, snapshot, 'inspect', { target: 'project' });
    const body = JSON.parse(output.content[0]?.type === 'text' ? output.content[0].text : '{}') as Record<string, unknown>;
    expect((body['result'] as Record<string, unknown>)['target']).toBe('project');
    expect(calls).toBe(2);
  });

  it('does not retry a non-empty ResolveMCP script error', async () => {
    let calls = 0;
    const broker = {
      async callTool(): Promise<unknown> {
        calls += 1;
        return text({ error: 'real failure' });
      }
    } as unknown as ResolveBroker;

    await expect(callWorkflowTool(broker, snapshot, 'inspect', { target: 'project' }))
      .rejects.toThrow('Project inspection returned no structured result');
    expect(calls).toBe(1);
  });
});
