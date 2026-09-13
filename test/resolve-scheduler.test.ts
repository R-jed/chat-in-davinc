import { describe, expect, it } from 'vitest';
import { ResolveScheduler } from '../src/main/resolve-scheduler.js';

describe('ResolveScheduler', () => {
  it('serializes Resolve calls in submission order', async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstWait = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const client = {
      async callTool(name: string): Promise<unknown> {
        events.push(`start:${name}`);
        if (name === 'first') await firstWait;
        events.push(`end:${name}`);
        return name;
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return {}; }
    };
    const scheduler = new ResolveScheduler(client);

    const first = scheduler.callTool('first');
    const second = scheduler.callTool('second');
    await Promise.resolve();
    expect(events).toEqual(['start:first']);
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual(['first', 'second']);
    expect(events).toEqual(['start:first', 'end:first', 'start:second', 'end:second']);
  });

  it('continues the queue after a failed Resolve call', async () => {
    const events: string[] = [];
    const client = {
      async callTool(name: string): Promise<unknown> {
        events.push(name);
        if (name === 'fails') throw new Error('expected failure');
        return name;
      },
      async getResolveStatus(): Promise<Record<string, unknown>> { return {}; }
    };
    const scheduler = new ResolveScheduler(client);

    await expect(scheduler.callTool('fails')).rejects.toThrow('expected failure');
    await expect(scheduler.callTool('next')).resolves.toBe('next');
    expect(events).toEqual(['fails', 'next']);
  });
});
