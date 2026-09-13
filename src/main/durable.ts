/**
 * Adapted from Chat On Steroids `src/main/durable.ts`.
 * Copyright (c) 2026 Chat On Steroids contributors. MIT licensed.
 * See THIRD_PARTY_NOTICES.md.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logWarn } from './log.js';

const WRITE_DELAY_MS = 300;
const RETRY_MAX_MS = 5_000;

let root = '';

interface PendingWrite {
  generation: number;
  value: unknown;
}

const pending = new Map<string, PendingWrite>();
const timers = new Map<string, NodeJS.Timeout>();
const retryAttempts = new Map<string, number>();
let inFlight: Promise<void> = Promise.resolve();
let nextGeneration = 1;

export function initDurableStore(userDataDir: string): void {
  root = path.join(userDataDir, 'state');
}

export function durableStoreReady(): boolean {
  return root !== '';
}

function fileFor(name: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error(`Invalid durable state name: ${name}`);
  return path.join(root, `${name}.json`);
}

export async function readDurable<T>(name: string): Promise<T | null> {
  if (!root) return null;
  try {
    const raw = await fs.readFile(fileFor(name), 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code && code !== 'ENOENT') logWarn(`Could not read ${name} state: ${(error as Error).message}`);
    return null;
  }
}

function nextWrite(value: unknown): PendingWrite {
  return { generation: nextGeneration++, value };
}

function enqueue(write: () => Promise<void>): Promise<void> {
  const queued = inFlight.then(write);
  inFlight = queued.catch(() => undefined);
  return queued;
}

function schedule(name: string, delay: number): void {
  if (timers.has(name) || !pending.has(name)) return;
  const timer = setTimeout(() => {
    timers.delete(name);
    const slot = pending.get(name);
    if (!slot) return;
    void enqueue(() => flushOne(name, slot)).catch(() => scheduleRetry(name));
  }, delay);
  timer.unref?.();
  timers.set(name, timer);
}

function scheduleRetry(name: string): void {
  if (!pending.has(name) || timers.has(name)) return;
  const attempt = (retryAttempts.get(name) ?? 0) + 1;
  retryAttempts.set(name, attempt);
  const delay = Math.min(RETRY_MAX_MS, WRITE_DELAY_MS * 2 ** Math.min(attempt, 4));
  schedule(name, delay);
}

async function flushOne(name: string, slot: PendingWrite): Promise<void> {
  const target = fileFor(name);
  const temporary = `${target}.tmp`;
  try {
    await fs.mkdir(root, { recursive: true });
    if (slot.value === null) {
      await fs.rm(target, { force: true });
    } else {
      await fs.writeFile(temporary, JSON.stringify(slot.value), 'utf8');
      await fs.rename(temporary, target);
    }
  } catch (error) {
    logWarn(`Could not save ${name} state: ${(error as Error).message}`);
    throw error;
  }
  if (pending.get(name)?.generation === slot.generation) {
    pending.delete(name);
    retryAttempts.delete(name);
  }
}

export function writeDurableSoon(name: string, value: unknown): void {
  if (!root) return;
  pending.set(name, nextWrite(value));
  if (timers.has(name)) return;
  schedule(name, WRITE_DELAY_MS);
}

export async function writeDurableNow(name: string, value: unknown): Promise<void> {
  if (!root) return;
  const timer = timers.get(name);
  if (timer) {
    clearTimeout(timer);
    timers.delete(name);
  }
  const slot = nextWrite(value);
  pending.set(name, slot);
  try {
    await enqueue(() => flushOne(name, slot));
  } catch (error) {
    scheduleRetry(name);
    throw error;
  }
}

export async function flushDurable(): Promise<void> {
  for (const [name, timer] of timers) {
    clearTimeout(timer);
    timers.delete(name);
  }
  for (;;) {
    await inFlight;
    const entries = [...pending.entries()];
    if (entries.length === 0) return;
    let firstError: unknown = null;
    for (const [name, slot] of entries) {
      try {
        await enqueue(() => flushOne(name, slot));
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError) throw firstError;
  }
}

export function resetDurableForTests(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  pending.clear();
  retryAttempts.clear();
  root = '';
  nextGeneration = 1;
  inFlight = Promise.resolve();
}
