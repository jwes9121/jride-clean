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
  status: string;
};

type Props = {
  drivers: Driver[];
  trip: Trip | null;
  zoneStats: Record<string, ZoneStat>;
  onAssign: (driverId: string) => void;
};

function isDeliveryType(tripType: string) {
  const t = (tripType || "").toLowerCase();
  return (
    t.includes("food") ||
    t.includes("delivery") ||
    t.includes("takeout") ||
    t.includes("errand")
  );
}

function isDriverAvailable(status: string) {
  const s = (status || "").toLowerCase();
  return (
    s.includes("available") ||
    s.includes("online") ||
    s.includes("idle") ||
    s.includes("waiting")
  );
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
        if (!isDriverAvailable(d.status)) return false;

        const zStat = zoneStats[d.zone];
        if (zStat && zStat.status === "FULL") return false;

        if (!deliveryMode) {
          return d.homeTown === trip.zone;
        }

        return true;
      })
      .map((d) => {
        const dist = haversineKm(
          d.lat,
          d.lng,
          trip.pickupLat,
          trip.pickupLng
        );

        let score = dist;
        let label = "~" + dist.toFixed(2) + " km";

        if (!deliveryMode && d.homeTown === trip.zone) {
          score *= 0.4;
          label = "Same town - " + dist.toFixed(2) + " km";
        } else if (deliveryMode && d.homeTown === trip.zone) {
          label = "Same town - " + dist.toFixed(2) + " km";
        } else if (zoneStats[d.zone]?.status === "OK") {
          score *= 0.8;
          label = "Low-load - " + dist.toFixed(2) + " km";
        }

        return { ...d, score, label, dist };
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
          <>No available drivers near pickup.</>
        ) : (
          <>
            No eligible drivers from{" "}
            <span className="font-semibold">{trip.zone}</span>.
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
              {d.homeTown} - {d.label}
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