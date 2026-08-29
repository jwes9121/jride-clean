"use client";

import { useEffect, useState } from "react";
import AgrimarketDispatchPanel from "./AgrimarketDispatchPanel";

export default function AgrimarketDispatchGate() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/agrimarket/status", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancelled) setEnabled(Boolean(payload?.enabled));
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;
  return <AgrimarketDispatchPanel />;
}
