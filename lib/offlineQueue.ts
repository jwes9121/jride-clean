
// TEMP STUB FOR BUILD
// TODO: real offline queue for PWA mode



export type OfflineJob = {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
};

let queue: OfflineJob[] = [];


export function enqueueOfflineJob(type: string, payload: any) {
  const job: OfflineJob = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,

let isOnline = true;

// simple list of listeners for UI updates
type Listener = () => void;
const listeners: Listener[] = [];

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore listener errors
    }
  }
}

// enqueue new offline job
export function enqueueOfflineJob(type: string, payload: any) {
  const job: OfflineJob = {
    id: Date.now().toString() + "-" + Math.random().toString(16).slice(2),

    type,
    payload,
    createdAt: Date.now(),
  };
  queue.push(job);

  return job.id;
}


  notify();
  return job.id;
}

// read queued jobs

export function getOfflineJobs() {
  return [...queue];
}


export function clearOfflineJobs() {
  queue = [];
}

// Some code does: import offlineQueue from "../lib/offlineQueue"
// We'll give them a default object that matches that expectation.

// clear queue
export function clearOfflineJobs() {
  queue = [];
  notify();
}

// ---- extra helpers expected by OfflineIndicator.tsx ----

// return current "online" status
export function isOnlineStatus() {
  return isOnline;
}

// fake the pending count
export function getQueueLength() {
  return queue.length;
}

// allow UI to watch for changes
export function onChange(cb: () => void) {
  if (typeof cb === "function") {
    listeners.push(cb);
  }
  return () => {
    const idx = listeners.indexOf(cb);
    if (idx >= 0) {
      listeners.splice(idx, 1);
    }
  };
}

// let something else toggle online/offline if needed
export function setOnlineStatus(next: boolean) {
  isOnline = next;
  notify();
}

// default export to satisfy existing imports:
//   import offlineQueue from "../lib/offlineQueue"

const offlineQueueDefault = {
  enqueueOfflineJob,
  getOfflineJobs,
  clearOfflineJobs,

};

export default offlineQueueDefault;

  isOnlineStatus,
  getQueueLength,
  onChange,
  setOnlineStatus,
};

export default offlineQueueDefault;

