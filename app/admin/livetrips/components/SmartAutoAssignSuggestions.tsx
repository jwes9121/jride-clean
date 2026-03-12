"use client";

import React, { useMemo } from "react";

type Driver = {
  id?: string | null;
  driver_id?: string | null;
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
  zone?: string | null;
  town?: string | null;
  homeTown?: string | null;
  status?: string | null;
};

type Trip = {
  id?: string | null;
  booking_code?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  zone?: string | null;
  town?: string | null;
  tripType?: string | null;
  trip_type?: string | null;
};

type ZoneStat = {
  util?: number;
  status?: string;
};

type Props = {
  drivers?: Driver[];
  trip?: Trip | null;
  zoneStats?: Record<string, ZoneStat>;
  onAssign?: (driverId: string) => void | Promise<void>;
  assignedDriverId?: string | null;
  assigningDriverId?: string | null;
  canAssign?: boolean;
  lockReason?: string;
};

function isDeliveryType(tripType: string) {
  const t = (tripType || "").toLowerCase();
  return t.includes("food") || t.includes("delivery") || t.includes("takeout") || t.includes("errand");
}

function isDriverAvailable(status: string) {
  const s = (status || "").toLowerCase();
  if (!s) return true;
  return s.includes("available") || s.includes("online") || s.includes("idle") || s.includes("waiting");
}

export default function SmartAutoAssignSuggestions({
  drivers = [],
  trip = null,
  zoneStats = {},
  onAssign,
  assignedDriverId,
  assigningDriverId,
  canAssign = true,
  lockReason,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [] as any[];

    const tripType = String(trip.tripType || trip.trip_type || "");
    const tripZone = String(trip.zone || trip.town || "");
    const pickupLat = Number(trip.pickupLat ?? trip.pickup_lat);
    const pickupLng = Number(trip.pickupLng ?? trip.pickup_lng);
    const deliveryMode = isDeliveryType(tripType);

    return drivers
      .filter((d) => {
        if (!isDriverAvailable(String(d.status || ""))) return false;
        const zKey = String(d.zone || d.town || d.homeTown || "Unknown");
        const zStat = zoneStats[zKey];
        if (zStat && zStat.status === "FULL") return false;
        if (!deliveryMode) return String(d.homeTown || d.town || d.zone || "") === tripZone;
        return true;
      })
      .map((d) => {
        const dLat = Number(d.lat);
        const dLng = Number(d.lng);
        const dist = Number.isFinite(dLat) && Number.isFinite(dLng) && Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
          ? Math.sqrt(Math.pow(dLat - pickupLat, 2) + Math.pow(dLng - pickupLng, 2))
          : 999999;

        let score = dist;
        let label = "Nearest";
        const homeTown = String(d.homeTown || d.town || d.zone || "");
        const zone = String(d.zone || d.town || homeTown || "");

        if (!deliveryMode && homeTown === tripZone) {
          score = score * 0.4;
          label = "Same town";
        } else if (deliveryMode && homeTown === tripZone) {
          label = "Same town";
        } else if ((zoneStats[zone] || {}).status === "OK") {
          score = score * 0.8;
          label = "Low-load zone";
        }

        return {
          id: String(d.id || d.driver_id || ""),
          name: String(d.name || "Driver"),
          homeTown,
          label,
          score,
        };
      })
      .filter((d) => !!d.id)
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);
  }, [drivers, trip, zoneStats]);

  if (!trip) {
    return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  }

  if (!suggestions.length) {
    const deliveryMode = isDeliveryType(String(trip.tripType || trip.trip_type || ""));
    const tripZone = String(trip.zone || trip.town || "");
    return (
      <div className="text-[11px] text-slate-400">
        {deliveryMode ? <>No available drivers found near this pickup point.</> : <>No eligible drivers from <span className="font-semibold">{tripZone}</span>.</>}
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
        const disabled = !canAssign || isAssigning || (!!assigningDriverId && assigningDriverId !== d.id) || !onAssign;
        const label = isAssigning ? "Assigning..." : isAssigned ? "Assigned" : assignedDriverId ? "Reassign" : "Assign";

        return (
          <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <div>
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">{d.homeTown || "Unknown"} - {d.label}</div>
            </div>
            <button
              className={["rounded px-2 py-1 text-[10px] font-semibold text-white", disabled ? "bg-slate-300 cursor-not-allowed" : isAssigned ? "bg-emerald-500" : "bg-emerald-600 hover:bg-emerald-700"].join(" ")}
              disabled={disabled}
              onClick={() => { if (onAssign) onAssign(d.id); }}
              title={assignedDriverId ? "One driver per trip. Clicking Assign will reassign this trip." : "Assign this trip to this driver."}
            >
              {label}
            </button>
          </div>
        );
      })}
    </div>
  );
}