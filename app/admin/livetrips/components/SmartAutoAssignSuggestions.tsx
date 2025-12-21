"use client";

import { useMemo } from "react";

type Driver = {
  id: string;
  name: string;
  lat: number;
  lng: number;

  // Optional fields (depending on your page-data shape)
  homeTown?: string;
  zone?: string;

  // Busy signal (varies by backend)
  current_status?: string; // e.g. "on_trip", "on_the_way"
  status?: string; // fallback
};

type Props = {
  trip: any | null;
  drivers: Driver[];
  zoneStats?: Record<string, any>;
  assignedDriverId?: string | null;
  canAssign?: boolean;
  onAssign: (driverId: string) => Promise<void>;
};

function calcDistanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function normStatus(x: any) {
  return String(x ?? "").toLowerCase().trim();
}

function isBusy(d: Driver) {
  const s = normStatus(d.current_status || d.status);
  return s === "on_trip" || s === "on_the_way" || s === "assigned";
}

export default function SmartAutoAssignSuggestions({
  trip,
  drivers,
  assignedDriverId,
  canAssign = true,
  onAssign,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip || !drivers?.length) return [];

    const lat = Number(trip.pickupLat ?? trip.pickup_lat);
    const lng = Number(trip.pickupLng ?? trip.pickup_lng);
    if (!isFinite(lat) || !isFinite(lng)) return [];

    const town = String(trip.zone ?? trip.town ?? "").toLowerCase();

    return drivers
      .filter((d) => isFinite(d.lat) && isFinite(d.lng))
      .map((d) => {
        const sameTown = String(d.homeTown ?? d.zone ?? "").toLowerCase() === town;
        return {
          ...d,
          _sameTown: sameTown,
          _dist: calcDistanceMeters(lat, lng, d.lat, d.lng),
          _busy: isBusy(d),
        };
      })
      .sort((a: any, b: any) => {
        // Busy drivers go last
        if (a._busy !== b._busy) return a._busy ? 1 : -1;
        // Same-town first
        if (a._sameTown !== b._sameTown) return a._sameTown ? -1 : 1;
        // Nearest
        return a._dist - b._dist;
      })
      .slice(0, 6);
  }, [trip, drivers]);

  if (!trip) {
    return <div className="text-xs text-slate-400">No trip selected</div>;
  }

  if (!suggestions.length) {
    return (
      <div className="text-xs text-slate-400">
        No available drivers to suggest for this trip.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {suggestions.map((d: any) => {
        const busy = !!d._busy;
        const disabled = !canAssign || assignedDriverId === d.id || busy;

        return (
          <div
            key={d.id}
            className="flex items-center justify-between rounded border p-2 text-xs"
          >
            <div className="min-w-0">
              <div className="font-medium truncate">
                {d.name}
                {d._sameTown && (
                  <span className="ml-1 text-[9px] text-emerald-400">Same town</span>
                )}
                <span className="ml-1 text-[9px] text-slate-400">Nearest</span>
                {busy && (
                  <span className="ml-1 text-[9px] text-rose-500">Busy</span>
                )}
              </div>
              {busy && (
                <div className="text-[10px] text-slate-500">
                  Driver already on an active trip.
                </div>
              )}
            </div>

            <button
              disabled={disabled}
              onClick={() => onAssign(d.id)}
              className="rounded bg-emerald-600 px-2 py-1 text-white disabled:opacity-40"
              title={busy ? "Busy driver" : "Assign"}
            >
              Assign
            </button>
          </div>
        );
      })}
    </div>
  );
}
