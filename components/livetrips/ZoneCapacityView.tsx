"use client";

import React from "react";

export type LiveTrip = {
  id: string;
  booking_code: string;
  zone?: string | null;
  town?: string | null;
  status: string;
  driver_id?: string | null;
  driver_status?: string | null;
};

type ZoneSummary = {
  key: string;
  label: string;
  activeTrips: number;
  loadLevel: "idle" | "ok" | "busy" | "overloaded";
};

const ACTIVE_STATUSES = new Set(["pending", "assigned", "on_the_way", "on_trip"]);

function summarizeZones(trips: LiveTrip[]): ZoneSummary[] {
  const map = new Map<string, { label: string; activeTrips: number }>();

  for (const trip of trips) {
    if (!ACTIVE_STATUSES.has(trip.status)) continue;

    const key = (trip.zone || trip.town || "Unknown") as string;
    const label = key;
    const current = map.get(key) || { label, activeTrips: 0 };
    current.activeTrips += 1;
    map.set(key, current);
  }

  const summaries: ZoneSummary[] = [];
  for (const [key, value] of map.entries()) {
    const tripsCount = value.activeTrips;
    let level: ZoneSummary["loadLevel"] = "idle";

    if (tripsCount === 0) level = "idle";
    else if (tripsCount <= 2) level = "ok";
    else if (tripsCount <= 4) level = "busy";
    else level = "overloaded";

    summaries.push({
      key,
      label: value.label,
      activeTrips: tripsCount,
      loadLevel: level,
    });
  }

  summaries.sort((a, b) => a.label.localeCompare(b.label));
  return summaries;
}

const levelClasses: Record<ZoneSummary["loadLevel"], string> = {
  idle: "bg-slate-50 text-slate-600 border-slate-200",
  ok: "bg-emerald-50 text-emerald-700 border-emerald-200",
  busy: "bg-amber-50 text-amber-700 border-amber-200",
  overloaded: "bg-red-50 text-red-700 border-red-200",
};

export default function ZoneCapacityView({ trips }: { trips: LiveTrip[] }) {
  const zones = summarizeZones(trips);

  if (zones.length === 0) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
        <span className="font-medium text-slate-700">Zone Capacity</span>
        <span>No active trips.</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-medium text-slate-700">Zone Capacity</span>
        <span className="text-[10px] uppercase tracking-wide text-slate-400">
          Trips per zone
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {zones.map((z) => (
          <div
            key={z.key}
            className={
              "flex items-center gap-1 rounded-full border px-2 py-0.5 " +
              levelClasses[z.loadLevel]
            }
          >
            <span className="text-[11px] font-semibold">{z.label}</span>
            <span className="text-[10px]">
              {z.activeTrips} trip{z.activeTrips === 1 ? "" : "s"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
