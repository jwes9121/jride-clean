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
    type,
    payload,
    createdAt: Date.now(),
  };
  queue.push(job);
  return job.id;
}

export function getOfflineJobs() {
  return [...queue];
}

export function clearOfflineJobs() {
  queue = [];
}

// Some code does: import offlineQueue from "../lib/offlineQueue"
// We'll give them a default object that matches that expectation.
const offlineQueueDefault = {
  enqueueOfflineJob,
  getOfflineJobs,
  clearOfflineJobs,
};

export default offlineQueueDefault;
