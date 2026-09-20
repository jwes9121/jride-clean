"use client";

import { useEffect, useState } from "react";

export function reapprovalSeconds(expiresAt: string | null | undefined, now: number): number | null {
  const deadline = Date.parse(expiresAt || "");
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}

export function useReapprovalSeconds(expiresAt?: string | null, serverNow?: string | null) {
  const [now, setNow] = useState(() => Date.parse(serverNow || "") || Date.now());
  useEffect(() => {
    const received = Date.now();
    const server = Date.parse(serverNow || "") || received;
    const tick = () => setNow(server + Date.now() - received);
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt, serverNow]);
  return reapprovalSeconds(expiresAt, now);
}

export default function ReapprovalCountdown({ expiresAt, serverNow }: { expiresAt?: string | null; serverNow?: string | null }) {
  const seconds = useReapprovalSeconds(expiresAt, serverNow);
  return <p className="mt-2 font-bold" role="timer" aria-live="off">
    {seconds == null ? "Customer approval deadline is being prepared." : seconds === 0 ? "Approval time expired. Updating order..." :
      `Customer approval: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`}
  </p>;
}
