export interface AsyncActionGate {
  run<T>(key: string, action: () => Promise<T>): Promise<T | undefined>;
  isActive(key: string): boolean;
}

export function createAsyncActionGate(): AsyncActionGate {
  const active = new Set<string>();
  return {
    async run<T>(key: string, action: () => Promise<T>): Promise<T | undefined> {
      if (active.has(key)) return undefined;
      active.add(key);
      try {
        return await action();
      } finally {
        active.delete(key);
      }
    },
    isActive(key: string): boolean {
      return active.has(key);
    }
  };
}

export interface LatestAsyncIntentResult<T> {
  value: T;
  current: boolean;
  started: boolean;
}

export interface LatestAsyncIntentGate {
  run<T>(key: string, action: () => Promise<T>): Promise<LatestAsyncIntentResult<T>>;
}

export function createLatestAsyncIntentGate(): LatestAsyncIntentGate {
  let currentKey: string | null = null;
  const active = new Map<string, Promise<unknown>>();
  return {
    async run<T>(key: string, action: () => Promise<T>): Promise<LatestAsyncIntentResult<T>> {
      currentKey = key;
      const existing = active.get(key) as Promise<T> | undefined;
      if (existing) {
        return { value: await existing, current: currentKey === key, started: false };
      }
      const task = action();
      active.set(key, task);
      try {
        return { value: await task, current: currentKey === key, started: true };
      } finally {
        if (active.get(key) === task) active.delete(key);
      }
    }
  };
}

export type MenuNavigationKey = 'ArrowDown' | 'ArrowUp' | 'ArrowRight' | 'ArrowLeft' | 'Home' | 'End';

export function nextMenuIndex(currentIndex: number, key: MenuNavigationKey, count: number): number {
  if (count <= 0) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (currentIndex < 0) return key === 'ArrowUp' || key === 'ArrowLeft' ? count - 1 : 0;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (currentIndex + 1) % count;
  return (currentIndex - 1 + count) % count;
}

export function nextSidebarPeek(
  current: boolean,
  eligible: boolean,
  pointerInsideSidebar: boolean,
  pointerInsideEdgeZone: boolean
): boolean {
  if (!eligible) return false;
  if (!current) return pointerInsideEdgeZone;
  return pointerInsideSidebar || pointerInsideEdgeZone;
}
