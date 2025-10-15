// Minimal in-memory queue used only so components can build safely.

export type OfflineJob = { id: string; payload?: unknown };

let _queue: OfflineJob[] = [];

/** Return current offline queue (read-only usage in UI). */
export function getOfflineQueue(): OfflineJob[] {
  return _queue;
}

/** Optionally used elsewhere in the app; harmless if never called. */
export function enqueue(job: OfflineJob) {
  _queue.push(job);
}

/** Helper to clear – not required, but nice to have. */
export function clearQueue() {
  _queue = [];
}
