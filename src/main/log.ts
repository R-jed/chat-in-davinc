import { appendFileSync, readFileSync, renameSync, statSync } from 'node:fs';
import type { LogEntry } from '../shared/types.js';

const MAX_ENTRIES = 300;
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const entries: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();
let logFile: string | null = null;
let logBytes = 0;

export function initLog(file: string): void {
  logFile = file;
  try { logBytes = statSync(file).size; } catch { logBytes = 0; }
  entries.length = 0;
  try {
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-MAX_ENTRIES);
    for (const line of lines) {
      const match = /^(\S+)\s{2}(info|warn|error)\s+(.*)$/.exec(line);
      if (!match) continue;
      const [, rawTime, rawLevel, message] = match;
      if (!rawTime || !rawLevel || message === undefined) continue;
      const time = Date.parse(rawTime);
      if (!Number.isFinite(time)) continue;
      entries.push({ time, level: rawLevel as LogEntry['level'], message });
    }
  } catch { /* no previous activity is fine */ }
}

export function redact(message: string): string {
  return message
    .replace(/\bsk-[A-Za-z0-9_*.-]{4,}/g, 'sk-***')
    .replace(/\b[A-Za-z0-9_-]{48,}\b/g, '***');
}

function write(entry: LogEntry): void {
  if (!logFile) return;
  const line = `${new Date(entry.time).toISOString()}  ${entry.level.padEnd(5)}  ${entry.message}\n`;
  try {
    if (logBytes >= MAX_LOG_BYTES) {
      renameSync(logFile, `${logFile}.1`);
      logBytes = 0;
    }
    appendFileSync(logFile, line, 'utf8');
    logBytes += Buffer.byteLength(line);
  } catch {
    logFile = null;
  }
}

export function log(level: LogEntry['level'], raw: string): void {
  const entry: LogEntry = { time: Date.now(), level, message: redact(raw) };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  write(entry);
  for (const listener of listeners) {
    try { listener(entry); } catch { /* renderer may already be gone */ }
  }
}

export const logInfo = (message: string): void => log('info', message);
export const logWarn = (message: string): void => log('warn', message);
export const logError = (message: string): void => log('error', message);
export const getLog = (): LogEntry[] => [...entries];
export function onLog(listener: (entry: LogEntry) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
