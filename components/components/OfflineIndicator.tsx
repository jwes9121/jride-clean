// components/OfflineIndicator.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import offlineQueue from "../lib/offlineQueue"; // <-- default API object

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    const update = () => {
      if (!isMountedRef.current) return;
      const online = offlineQueue.isOnlineStatus();
      const length = offlineQueue.getQueueLength();
      setIsOnline(online);
      setPending(length);
    };

    // initial
    update();

    // basic listeners
    const onUp = () => update();
    const onDown = () => update();
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  if (isOnline && pending === 0) return null;

  return (
    <div className="fixed bottom-3 right-3 rounded-md px-3 py-2 text-sm shadow-md
                    bg-yellow-100 text-yellow-900">
      {!isOnline ? "You are offline" : "Pending requests"}{pending ? `: ${pending}` : ""}
    </div>
  );
}



