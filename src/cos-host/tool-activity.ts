const counts = new Map<string, number>();

export function beginCosProtectedToolActivity(sessionId: string): () => void {
  counts.set(sessionId, (counts.get(sessionId) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = Math.max(0, (counts.get(sessionId) ?? 1) - 1);
    if (next === 0) counts.delete(sessionId);
    else counts.set(sessionId, next);
  };
}

export function cosProtectedToolActivityCount(sessionId: string): number {
  return counts.get(sessionId) ?? 0;
}

export function resetCosProtectedToolActivityForTests(): void {
  counts.clear();
}
