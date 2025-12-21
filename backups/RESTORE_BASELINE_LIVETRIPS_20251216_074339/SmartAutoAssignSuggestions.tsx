"use client";

import React, { useMemo } from "react";

type Driver = {
  id: string;
  uuid?: string;
  name: string;
  homeTown?: string;
  town?: string;
  zone?: string;
  status?: string;
};

type TripLite = {
  id: string;
  zone?: string;
  tripType?: string;
};

type ZoneStats = Record<string, { util: number; status: string }>;

export default function SmartAutoAssignSuggestions({
  drivers,
  trip,
  zoneStats,
  onAssign,
}: {
  drivers: Driver[];
  trip: TripLite | null;
  zoneStats?: ZoneStats;
  onAssign: (driverId: string) => void | Promise<void>;
}) {
  const zone = (trip?.zone || "Unknown").trim();

  const eligible = useMemo(() => {
    const list = (drivers || []).filter(Boolean);

    // Basic eligibility: must have id + name
    const normalized = list
      .filter((d: any) => d?.id && d?.name)
      .map((d: any) => ({
        id: String(d.id),
        name: String(d.name),
        town: String(d.homeTown ?? d.town ?? d.zone ?? ""),
        status: String(d.status ?? "available"),
      }));

    // Ordinance: same-town only (default behavior)
    if (!zone || zone === "Unknown") return normalized;

    const sameTown = normalized.filter((d) => d.town && d.town.toLowerCase() === zone.toLowerCase());
    return sameTown;
  }, [drivers, zone]);

  if (!trip) {
    return <div className="text-[11px] text-slate-500">Select a trip to see suggestions.</div>;
  }

  const z = zoneStats?.[zone];

  return (
    <div className="space-y-2">
      {z ? (
        <div className="text-[11px] text-slate-600">
          {zone} load: <b>{z.util}%</b> ({z.status})
        </div>
      ) : null}

      {eligible.length === 0 ? (
        <div className="text-[11px] text-slate-500">
          No eligible drivers from {zone} (passenger ordinance: pickup must use driver from same town).
        </div>
      ) : (
        <div className="space-y-1">
          {eligible.slice(0, 6).map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">{d.name}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {d.town || zone} • Same town (ordinance)
                </div>
              </div>

              <button
                className="rounded bg-emerald-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700"
                onClick={() => onAssign(d.id)}
              >
                Assign
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
