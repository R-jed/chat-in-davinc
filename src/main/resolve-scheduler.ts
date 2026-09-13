import { AsyncLocalStorage } from 'node:async_hooks';
import type { ResolveBroker } from './resolve-broker.js';

export type ResolveClient = Pick<ResolveBroker, 'callTool' | 'getResolveStatus'>;

export interface ResolveSchedulerMetrics {
  calls: number;
  durationMs: number;
}

interface ScopedMetrics extends ResolveSchedulerMetrics {
  touchedAt: number;
}

const MAX_METRIC_SCOPES = 128;

export class ResolveScheduler implements ResolveClient {
  private queue: Promise<void> = Promise.resolve();
  private readonly metricScope = new AsyncLocalStorage<string>();
  private readonly scopedMetrics = new Map<string, ScopedMetrics>();

  constructor(private readonly client: ResolveClient) {}

  runExclusive<T>(operation: (client: ResolveClient) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => operation(this.client), () => operation(this.client));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  runInMetricScope<T>(scope: string, operation: () => Promise<T>): Promise<T> {
    return this.metricScope.run(scope, operation);
  }

  metricsFor(scope: string): ResolveSchedulerMetrics {
    const metrics = this.scopedMetrics.get(scope);
    return metrics ? { calls: metrics.calls, durationMs: metrics.durationMs } : { calls: 0, durationMs: 0 };
  }

  releaseMetrics(scope: string): void {
    this.scopedMetrics.delete(scope);
  }

  private recordCall(durationMs: number): void {
    const scope = this.metricScope.getStore();
    if (!scope) return;
    const current = this.scopedMetrics.get(scope) ?? { calls: 0, durationMs: 0, touchedAt: Date.now() };
    current.calls += 1;
    current.durationMs += Math.max(0, durationMs);
    current.touchedAt = Date.now();
    this.scopedMetrics.set(scope, current);
    if (this.scopedMetrics.size <= MAX_METRIC_SCOPES) return;
    const oldest = [...this.scopedMetrics.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]?.[0];
    if (oldest) this.scopedMetrics.delete(oldest);
  }

  callTool(name: string, args: Record<string, unknown> = {}, timeoutMs = 8000): Promise<unknown> {
    return this.runExclusive(async (client) => {
      const startedAt = Date.now();
      try { return await client.callTool(name, args, timeoutMs); }
      finally { this.recordCall(Date.now() - startedAt); }
    });
  }

  getResolveStatus(timeoutMs = 8000): Promise<Record<string, unknown>> {
    return this.runExclusive(async (client) => {
      const startedAt = Date.now();
      try { return await client.getResolveStatus(timeoutMs); }
      finally { this.recordCall(Date.now() - startedAt); }
    });
  }
}
