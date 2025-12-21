"use client";

import React, { useMemo } from "react";

type Driver = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone: string;
  homeTown: string;
  status: string;
};

type Trip = {
  id: string;
  pickupLat: number;
  pickupLng: number;
  zone: string;
  tripType: string;
};

type ZoneStat = {
  util: number;
  status: string; // "OK" | "WARN" | "FULL"
};

type Props = {
  drivers: Driver[];
  trip: Trip | null;
  zoneStats: Record<string, ZoneStat>;
  onAssign: (driverId: string) => void | Promise<void>;
  assignedDriverId?: string | null;
  assigningDriverId?: string | null;

  // C: lock assignment after Start Trip
  canAssign?: boolean;
  lockReason?: string;
};

function isDeliveryType(tripType: string) {
  const t = (tripType || "").toLowerCase();
  if (!t) return false;
  return t.includes("food") || t.includes("delivery") || t.includes("takeout") || t.includes("errand");
}

function isDriverAvailable(status: string) {
  const s = (status || "").toLowerCase();
  if (!s) return true;
  return s.includes("available") || s.includes("online") || s.includes("idle") || s.includes("waiting");
}

export default function SmartAutoAssignSuggestions({
  drivers,
  trip,
  zoneStats,
  onAssign,
  assignedDriverId,
  assigningDriverId,
  canAssign = true,
  lockReason,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [];
    const deliveryMode = isDeliveryType(trip.tripType);

    return drivers
      .filter((d) => {
        if (!isDriverAvailable(d.status)) return false;
  const zKey = String((d as any)?.zone || (d as any)?.town || "Unknown");
  const zStat = (zoneStats || ({} as any))[zKey];
        if (zStat && zStat.status === "FULL") return false;

        // ordinance: passengers must be same town; deliveries can be cross-town (kept as-is)
        if (!deliveryMode) return d.homeTown === trip.zone;
        return true;
      })
      .map((d) => {
        const dist = Math.sqrt(
          Math.pow(d.lat - trip.pickupLat, 2) + Math.pow(d.lng - trip.pickupLng, 2)
        );

        let score = dist;
        let label = "Nearest";

        if (!deliveryMode && d.homeTown === trip.zone) {
          score *= 0.4;
          label = "Same town (ordinance)";
        } else if (deliveryMode && d.homeTown === trip.zone) {
          label = "Same town";
        } else if (zoneStats[d.zone]?.status === "OK") {
          score *= 0.8;
          label = "Low-load zone";
        }

        return { ...d, score, label };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [drivers, trip, zoneStats]);

  if (!trip) {
    return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  }

  if (!suggestions.length) {
    const deliveryMode = isDeliveryType(trip.tripType);
    return (
      <div className="text-[11px] text-slate-400">
        {deliveryMode ? (
          <>No available drivers found near this pickup point.</>
        ) : (
          <>
            No eligible drivers from <span className="font-semibold">{trip.zone}</span> (passenger ordinance).
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {!canAssign ? (
        <div className="mb-1 rounded border bg-slate-50 p-2 text-[11px] text-slate-600">
          Assignment locked. {lockReason ? <span className="font-semibold">{lockReason}</span> : null}
        </div>
      ) : null}

      {suggestions.map((d) => {
        const isAssigned = !!assignedDriverId && d.id === assignedDriverId;
        const isAssigning = !!assigningDriverId && d.id === assigningDriverId;

        const disabled = !canAssign || isAssigning || (!!assigningDriverId && assigningDriverId !== d.id);

        // A: clear label for reassign behavior
        const label = isAssigning ? "Assigning..." : isAssigned ? "Assigned" : assignedDriverId ? "Reassign" : "Assign";

        return (
          <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <div>
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">{d.homeTown} • {d.label}</div>
            </div>

            <button
              className={[
                "rounded px-2 py-1 text-[10px] font-semibold text-white",
                disabled ? "bg-slate-300 cursor-not-allowed" : isAssigned ? "bg-emerald-500" : "bg-emerald-600 hover:bg-emerald-700",
              ].join(" ")}
              disabled={disabled}
              onClick={() => onAssign(d.id)}
              title={assignedDriverId ? "One driver per trip. Clicking Assign will REASSIGN this trip." : "Assign this trip to this driver."}
            >
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}

