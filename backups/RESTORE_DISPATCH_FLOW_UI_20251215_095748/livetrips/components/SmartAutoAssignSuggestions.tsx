"use client";

import React, { useMemo } from "react";

type Driver = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone: string;      // home town / municipality
  homeTown: string;  // same as zone, but explicit
  status: string;
};

type Trip = {
  id: string;
  pickupLat: number;
  pickupLng: number;
  zone: string;      // pickup town
  tripType: string;  // "ride", "food", "delivery", etc.
};

type ZoneStat = {
  util: number;
  status: string; // "OK" | "WARN" | "FULL"
};

type Props = {
  drivers: Driver[];
  trip: Trip | null;
  zoneStats: Record<string, ZoneStat>;
  onAssign: (driverId: string) => void;
};

function isDeliveryType(tripType: string) {
  const t = (tripType || "").toLowerCase();
  if (!t) return false;
  return (
    t.includes("food") ||
    t.includes("delivery") ||
    t.includes("takeout") ||
    t.includes("errand")
  );
}

function isDriverAvailable(status: string) {
  const s = (status || "").toLowerCase();
  if (!s) return true; // be permissive if unknown
  return (
    s.includes("available") ||
    s.includes("online") ||
    s.includes("idle") ||
    s.includes("waiting")
  );
}

export default function SmartAutoAssignSuggestions({
  drivers,
  trip,
  zoneStats,
  onAssign,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [];

    const deliveryMode = isDeliveryType(trip.tripType);

    return drivers
      .filter((d) => {
        // must be available
        if (!isDriverAvailable(d.status)) return false;

        // do not use drivers from FULL zones (capacity protection)
        const zStat = zoneStats[d.zone];
        if (zStat && zStat.status === "FULL") return false;

        // ordinance: passenger / ride trips MUST use same town only
        if (!deliveryMode) {
          return d.homeTown === trip.zone;
        }

        // delivery / takeout: any town is allowed
        return true;
      })
      .map((d) => {
        const dist = Math.sqrt(
          Math.pow(d.lat - trip.pickupLat, 2) +
            Math.pow(d.lng - trip.pickupLng, 2)
        );

        let score = dist;
        let label = "Nearest";

        if (!deliveryMode && d.homeTown === trip.zone) {
          // passenger + same town (this is actually required, but we still label it)
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
    return (
      <div className="text-[11px] text-slate-400">
        Select a trip to see assignment suggestions.
      </div>
    );
  }

  if (!suggestions.length) {
    const deliveryMode = isDeliveryType(trip.tripType);
    return (
      <div className="text-[11px] text-slate-400">
        {deliveryMode ? (
          <>No available drivers found near this pickup point.</>
        ) : (
          <>
            No eligible drivers from{" "}
            <span className="font-semibold">{trip.zone}</span>{" "}
            (passenger ordinance: pickup must use driver from same town).
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {suggestions.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs"
        >
          <div>
            <div className="font-semibold">{d.name}</div>
            <div className="text-[10px] text-slate-500">
              {d.homeTown} • {d.label}
            </div>
          </div>

          <button
            className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700"
            onClick={() => onAssign(d.id)}
          >
            Assign
          </button>
        </div>
      ))}
    </div>
  );
}
