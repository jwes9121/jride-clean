"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
] as const;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function readVendorId(): string {
  if (typeof window === "undefined") return "";
  for (const key of VENDOR_ID_KEYS) {
    const values = [window.sessionStorage.getItem(key), window.localStorage.getItem(key)];
    for (const value of values) {
      const id = clean(value);
      if (id) return id;
    }
  }
  return "";
}

function fmt(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

export default function VendorComplianceNotice() {
  const pathname = usePathname();
  const [vendorId, setVendorId] = useState("");
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    if (pathname !== "/vendor-portal") {
      setVendorId("");
      setStatus(null);
      return;
    }

    let stopped = false;
    let timer: number | null = null;
    const discover = () => {
      if (stopped) return;
      const id = readVendorId();
      if (id) {
        setVendorId(id);
        return;
      }
      timer = window.setTimeout(discover, 1200);
    };
    discover();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [pathname]);

  useEffect(() => {
    if (!vendorId || pathname !== "/vendor-portal") return;
    let stopped = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/vendor-hours?vendor_id=${encodeURIComponent(vendorId)}`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        });
        const json = await response.json().catch(() => ({}));
        if (!stopped && response.ok && json?.ok === true) setStatus(json);
      } catch {}
    };

    void load();
    const poll = window.setInterval(() => void load(), 30000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
    };
  }, [pathname, vendorId]);

  if (pathname !== "/vendor-portal" || !status) return null;

  if (status.suspended) {
    return (
      <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/80 p-4">
        <section className="w-full max-w-xl rounded-3xl border border-rose-300 bg-white p-5 text-slate-950 shadow-2xl">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">JRide vendor suspension</div>
          <h2 className="mt-1 text-2xl font-black">New Takeout orders are temporarily disabled</h2>
          <p className="mt-3 text-sm leading-6 text-slate-700">
            This suspension was applied after JRide admin reviewed a vendor compliance case. You may not reopen the store or extend business hours while the suspension is active.
          </p>
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm">
            <div><span className="font-bold">Reason:</span> {clean(status.suspension_reason) || "Vendor compliance review"}</div>
            <div className="mt-1"><span className="font-bold">Suspended until:</span> {fmt(status.suspended_until)}</div>
          </div>
          <p className="mt-4 text-xs leading-5 text-slate-500">
            Existing records are not deleted. Contact JRide administration if the sanction needs to be reviewed or corrected.
          </p>
        </section>
      </div>
    );
  }

  if (status.public_response_warning_active) {
    return (
      <div className="fixed right-3 top-3 z-[220] w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xl">
        <div className="text-xs font-black uppercase tracking-wide">JRide response notice</div>
        <div className="mt-1 text-sm font-bold">A recent-response warning is visible on your store listing.</div>
        <div className="mt-1 text-xs leading-5">{clean(status.public_response_warning_reason) || "Repeated expired Takeout orders"}</div>
        <div className="mt-1 text-[11px] text-amber-800">Notice ends: {fmt(status.public_response_warning_until)}</div>
      </div>
    );
  }

  return null;
}
