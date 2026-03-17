"use client";

import React from "react";

type Props = {
  booking: any | null;
  liveUpdatedAt: number | null;
};

export default function DriverDetailsCard({ booking, liveUpdatedAt }: Props) {
  const b: any = booking || null;

  const dName: any =
    b ? (b.driver_name ?? b.driverName ?? b.driver?.full_name ?? b.driver?.name ?? b.driver?.callsign ?? null) : null;

  const plate: any =
    b ? (b.plate_no ?? b.plate ?? b.plateNumber ?? b.driver?.plate_number ?? b.driver?.plate ?? null) : null;

  const vehicle: any =
    b ? (b.vehicle_type ?? b.vehicleType ?? b.vehicle_label ?? b.vehicle ?? b.driver?.vehicle_type ?? null) : null;

  const rel = liveUpdatedAt ? (Math.max(0, Math.floor((Date.now() - liveUpdatedAt) / 1000)) + "s ago") : "--";
  const abs = liveUpdatedAt
    ? (() => { try { return new Date(liveUpdatedAt as any).toLocaleString(); } catch { return String(liveUpdatedAt); } })()
    : "--";

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Driver details</div>
          <div className="text-xs opacity-70">Best-effort from live booking data</div>
        </div>
        <div className="text-xs rounded-full bg-black/5 px-3 py-1 font-semibold">
          LIVE
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-xl border border-black/10 p-2">
          <div className="text-xs opacity-70">Name</div>
          <div className="text-xs font-mono">{dName ? String(dName) : "--"}</div>
        </div>
        <div className="rounded-xl border border-black/10 p-2">
          <div className="text-xs opacity-70">Plate</div>
          <div className="text-xs font-mono">{plate ? String(plate) : "--"}</div>
        </div>
        <div className="rounded-xl border border-black/10 p-2">
          <div className="text-xs opacity-70">Vehicle</div>
          <div className="text-xs font-mono">{vehicle ? String(vehicle) : "--"}</div>
        </div>
      </div>

      <div className="mt-3 text-xs opacity-70">
        Last updated: <span className="font-mono">{rel}</span>
        <span className="opacity-50">{" "}({abs})</span>
      </div>
    </div>
  );
}