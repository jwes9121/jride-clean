// In-memory offline job queue stub for production build.
// This is enough for UI components like OfflineIndicator to render safely
// without blowing up the Next.js build in Vercel.

export type OfflineJob = {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
};

// Internal queue state
let queue: OfflineJob[] = [];

// Connection state flag
let isOnlineFlag = true;

// Listener callbacks for UI updates
type Listener = () => void;
let listeners: Listener[] = [];

// Utility to notify all subscribers (like a tiny event emitter)
function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  }
}

// Public API:

// enqueueOfflineJob() - add a job to the queue
export function enqueueOfflineJob(type: string, payload: any): string {
  const job: OfflineJob = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload,
    createdAt: Date.now(),
  };
  queue.push(job);
  notify();
  return job.id;
}

// getOfflineJobs() - read all jobs
export function getOfflineJobs(): OfflineJob[] {
  return [...queue];
}

// clearOfflineJobs() - wipe queue
export function clearOfflineJobs() {
  queue = [];
  notify();
}

// getQueueLength() - convenience for UI badge/count
export function getQueueLength(): number {
  return queue.length;
}

// isOnlineStatus() - report if app thinks we're online
export function isOnlineStatus(): boolean {
  return isOnlineFlag;
}

// setOnlineStatus() - allow UI / network detector to flip status
export function setOnlineStatus(next: boolean) {
  isOnlineFlag = next;
  notify();
}

// subscribe() - OfflineIndicator (or others) can subscribe to changes
// returns unsubscribe()
export function subscribe(listener: Listener): () => void {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

// default export so older code that did `import offlineQueue from ...` still works
const offlineQueue = {
  enqueueOfflineJob,
  getOfflineJobs,
  clearOfflineJobs,
  getQueueLength,
  isOnlineStatus,
  setOnlineStatus,
  subscribe,
};

export default offlineQueue;