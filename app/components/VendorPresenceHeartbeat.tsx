"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
] as const;

function readVendorId(): string {
  if (typeof window === "undefined") return "";

  for (const key of VENDOR_ID_KEYS) {
    const values = [
      window.sessionStorage.getItem(key),
      window.localStorage.getItem(key),
    ];

    for (const value of values) {
      const id = String(value || "").trim();
      if (id) return id;
    }
  }

  return "";
}

function presenceClient(): string {
  if (typeof navigator === "undefined") return "web";
  const agent = String(navigator.userAgent || "");
  if (/Android/i.test(agent) && /\bwv\b|Version\/4\.0/i.test(agent)) {
    return "android_webview";
  }
  if (/Android/i.test(agent)) return "android_browser";
  return "web";
}

async function sendHeartbeat(): Promise<void> {
  const vendorId = readVendorId();
  if (!vendorId) return;

  await fetch("/api/vendor-presence/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    keepalive: true,
    body: JSON.stringify({
      vendor_id: vendorId,
      client: presenceClient(),
    }),
  }).catch(() => undefined);
}

export default function VendorPresenceHeartbeat() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname !== "/vendor-portal") return;

    let stopped = false;
    let heartbeatTimer: number | null = null;
    let discoveryTimer: number | null = null;

    const record = () => {
      if (stopped || document.visibilityState !== "visible") return;
      void sendHeartbeat();
    };

    const begin = () => {
      if (stopped) return;
      if (!readVendorId()) {
        discoveryTimer = window.setTimeout(begin, 2000);
        return;
      }

      record();
      heartbeatTimer = window.setInterval(record, 60000);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") record();
    };

    begin();
    window.addEventListener("focus", record);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (discoveryTimer !== null) window.clearTimeout(discoveryTimer);
      window.removeEventListener("focus", record);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pathname]);

  return null;
}
