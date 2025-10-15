import { useEffect, useState } from "react";

/** Hook: returns current online status (true = online) */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    const handler = () =>
      setOnline(typeof navigator !== "undefined" ? navigator.onLine : true);

    if (typeof window !== "undefined") {
      window.addEventListener("online", handler);
      window.addEventListener("offline", handler);
      handler();
      return () => {
        window.removeEventListener("online", handler);
        window.removeEventListener("offline", handler);
      };
    }
  }, []);

  return online;
}

/** Minimal in-memory queue so UI can compile safely */
type OfflineItem = unknown;
let _queue: OfflineItem[] = [];

/** This is what OfflineIndicator imports */
export function getOfflineQueue(): OfflineItem[] {
  return _queue;
}

/** No-ops you can wire up later if needed */
export async function enqueue(_item: OfflineItem): Promise<void> {
  _queue.push(_item);
}
export async function flush(): Promise<void> {
  _queue = [];
}
export function clear(): void {
  _queue = [];
}
export function size(): number {
  return _queue.length;
}

/** Optional default export (not required) */
const offlineQueue = { enqueue, flush, clear, size, useOnlineStatus, getOfflineQueue };
export default offlineQueue;
