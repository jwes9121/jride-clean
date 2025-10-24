// TEMP STUB FOR BUILD
// TODO: implement offline job queue / sync later

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
