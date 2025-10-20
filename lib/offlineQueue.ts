// lib/offlineQueue.ts
type Task = () => Promise<unknown>;

const _queue: Task[] = [];

export type OfflineQueueApi = {
  isOnlineStatus: () => boolean;
  getQueueLength: () => number;
  enqueue: (t: Task) => void;
  // add other helpers as you need
};

const api: OfflineQueueApi = {
  isOnlineStatus: () => typeof navigator !== "undefined" ? navigator.onLine : true,
  getQueueLength: () => _queue.length,
  enqueue: (t) => _queue.push(t),
};

export default api;
// If you still need direct access elsewhere, you can also export the array:
// export { _queue as queueArray };


