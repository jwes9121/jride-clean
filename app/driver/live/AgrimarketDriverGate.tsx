"use client";

import { useEffect, useState } from "react";
import AgrimarketDriverPanel from "./AgrimarketDriverPanel";

type Props = {
  online: boolean;
};

export default function AgrimarketDriverGate({ online }: Props) {
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
  return <AgrimarketDriverPanel online={online} />;
}
