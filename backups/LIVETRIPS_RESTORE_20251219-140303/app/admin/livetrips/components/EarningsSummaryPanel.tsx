"use client";

import React, { useMemo } from "react";

type Trip = any;

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function pickNum(t: Trip, keys: string[]): number {
  for (const k of keys) {
    const v = (t as any)?.[k];
    const x = Number(v);
    if (Number.isFinite(x)) return x;
  }
  return 0;
}

function money(v: number): string {
  try {
    return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(v);
  } catch {
    return `₱${v.toFixed(2)}`;
  }
}

export default function EarningsSummaryPanel({ trips }: { trips: Trip[] }) {
  const summary = useMemo(() => {
    const doneStatuses = new Set(["completed", "dropped_off", "delivered", "done", "finished"]);
    const activeStatuses = new Set(["pending", "assigned", "on_the_way", "on_trip"]);

    let active = 0;
    let completed = 0;

    let gross = 0;        // total passenger paid / fare gross
    let platform = 0;     // platform fee / service fee
    let driverNet = 0;    // what driver earns
    let vendorNet = 0;    // vendor net (for delivery/takeout), if present

    for (const t of trips || []) {
      const status = String((t as any)?.status ?? "").toLowerCase();
      if (doneStatuses.has(status)) completed++;
      if (activeStatuses.has(status)) active++;

      const fare = pickNum(t, ["fare_amount", "fare", "total_fare", "totalFare", "amount", "total_amount"]);
      const platformFee = pickNum(t, ["platform_fee", "service_fee", "total_service_fee", "serviceFee"]);
      const driverTake = pickNum(t, ["driver_earnings", "driver_cut", "driver_net", "driverNet", "driver_amount"]);
      const vendorTake = pickNum(t, ["vendor_net", "vendor_amount", "vendor_earnings"]);

      gross += n(fare);
      platform += n(platformFee);
      driverNet += n(driverTake);
      vendorNet += n(vendorTake);
    }

    return { active, completed, gross, platform, driverNet, vendorNet };
  }, [trips]);

  return (
    <div className="border-b bg-white px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold">Earnings (Today snapshot)</div>
        <a
          href="/admin/earnings"
          className="rounded border px-2 py-1 text-[11px] font-semibold hover:bg-slate-50"
        >
          Open Earnings
        </a>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded border bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500">Gross</div>
          <div className="text-sm font-semibold">{money(summary.gross)}</div>
        </div>

        <div className="rounded border bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500">Platform fees</div>
          <div className="text-sm font-semibold">{money(summary.platform)}</div>
        </div>

        <div className="rounded border bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500">Driver net</div>
          <div className="text-sm font-semibold">{money(summary.driverNet)}</div>
        </div>

        <div className="rounded border bg-slate-50 p-2">
          <div className="text-[10px] text-slate-500">Vendor net</div>
          <div className="text-sm font-semibold">{money(summary.vendorNet)}</div>
        </div>

        <div className="rounded border bg-white p-2">
          <div className="text-[10px] text-slate-500">Active trips</div>
          <div className="text-sm font-semibold">{summary.active}</div>
        </div>

        <div className="rounded border bg-white p-2">
          <div className="text-[10px] text-slate-500">Completed</div>
          <div className="text-sm font-semibold">{summary.completed}</div>
        </div>
      </div>

      <div className="mt-2 text-[10px] text-slate-500">
        Uses fields if present: fare_amount, platform_fee/service_fee, driver_cut/driver_net, vendor_net.
      </div>
    </div>
  );
}
