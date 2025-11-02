"use client";
import { useEffect, useRef, useState } from "react";

// Must match the key used by the offline queue.
const LS_KEY = "jr_offline_queue_v1";

function safeQueueLength(): number {
  try {
    if (typeof window === "undefined") return 0;
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return 0;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.length : 0;
  } catch {
    return 0;
  }
}

function safeOnline(): boolean {
  try {
    if (typeof navigator === "undefined") return true;
    return !!navigator.onLine;
  } catch {
    return true;
  }
}

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState<boolean>(true);
  const [pending, setPending] = useState<number>(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    const update = () => {
      if (!mounted.current) return;
      setIsOnline(safeOnline());
      setPending(safeQueueLength());
    };

    update();

    if (typeof window !== "undefined") {
      window.addEventListener("online", update);
      window.addEventListener("offline", update);
      const id = window.setInterval(update, 5000);
      return () => {
        mounted.current = false;
        window.removeEventListener("online", update);
        window.removeEventListener("offline", update);
        window.clearInterval(id);
      };
    }

    return () => { mounted.current = false; };
  }, []);

  return (
    <div className="text-xs text-gray-500">
      <span>Network: {isOnline ? "online" : "offline"}</span>
      {pending > 0 && <span className="ml-2">Queued: {pending}</span>}
    </div>
  );
}
