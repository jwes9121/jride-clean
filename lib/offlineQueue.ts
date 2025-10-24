// TEMP STUB FOR BUILD
// TODO: implement offline job queue / retry later logic for PWA mode

export type OfflineJob = {
  id: string;
  type: string;
  payload: any;
  createdAt: number;
};

let queue: OfflineJob[] = [];

// add a job to offline queue
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

// read queued jobs
export function getOfflineJobs() {
  return [...queue];
}

// clear queue (e.g. after syncing)
export function clearOfflineJobs() {
  queue = [];
}
