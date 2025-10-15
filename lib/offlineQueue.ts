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

/** No-op queue API — adjust later if you wire a real queue */
export async function enqueue(_item: unknown): Promise<void> {}
export async function flush(): Promise<void> {}
export function clear(): void {}
export function size(): number { return 0; }

/** Default export in case imports use `default` */
const offlineQueue = { enqueue, flush, clear, size, useOnlineStatus };
export default offlineQueue;
