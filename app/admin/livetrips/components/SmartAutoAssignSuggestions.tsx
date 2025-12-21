"use client";

import React, { useMemo } from "react";

// Keep prop shapes compatible, but normalize internally so API/UI mismatches don't break suggestions.

type Driver = {
  id?: string;
  driver_id?: string;
  name?: string;
  lat?: number;
  lng?: number;
  zone?: string;
  town?: string;
  homeTown?: string;
  home_town?: string;
  status?: string;
};

type Trip = {
  id?: string;
  pickupLat?: number;
  pickupLng?: number;
  pickup_lat?: number;
  pickup_lng?: number;
  zone?: string;
  town?: string;
  tripType?: string;
  trip_type?: string;
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

  // lock assignment after Start Trip
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
  // treat on_trip/on_the_way/assigned as NOT available
  if (s.includes("on_trip") || s.includes("on the way") || s.includes("on_the_way") || s.includes("assigned")) return false;
  return s.includes("available") || s.includes("online") || s.includes("idle") || s.includes("waiting");
}

function normTown(v: any) {
  const s = String(v || "").trim();
  return s || "Unknown";
}

function pickTripZone(trip: Trip) {
  return normTown(trip.zone || trip.town);
}

function pickTripType(trip: Trip) {
  return String(trip.tripType || trip.trip_type || "").trim();
}

function pickPickupLat(trip: Trip) {
  const v = (trip.pickupLat ?? trip.pickup_lat) as any;
  return Number.isFinite(v) ? Number(v) : NaN;
}

function pickPickupLng(trip: Trip) {
  const v = (trip.pickupLng ?? trip.pickup_lng) as any;
  return Number.isFinite(v) ? Number(v) : NaN;
}

function pickDriverId(d: Driver) {
  return String(d.id || d.driver_id || "").trim();
}

function pickDriverName(d: Driver) {
  const nm = String(d.name || "").trim();
  if (nm) return nm;
  const id = pickDriverId(d);
  return id ? `Driver ${id.slice(0, 8)}` : "Driver";
}

function pickDriverTown(d: Driver) {
  return normTown(d.homeTown || d.home_town || d.town || d.zone);
}

function pickDriverZoneKey(d: Driver) {
  // zoneStats keys might be town names; fall back to whatever we have
  return normTown(d.zone || d.town || d.homeTown || d.home_town);
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

    const tripZone = pickTripZone(trip);
    const tripType = pickTripType(trip);
    const deliveryMode = isDeliveryType(tripType);

    const plat = pickPickupLat(trip);
    const plng = pickPickupLng(trip);

    if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
      return [];
    }

    return (drivers || [])
      .map((d) => {
        const id = pickDriverId(d);
        const name = pickDriverName(d);
        const homeTown = pickDriverTown(d);
        const zoneKey = pickDriverZoneKey(d);
        const status = String(d.status || "").trim();

        const lat = Number(d.lat);
        const lng = Number(d.lng);

        return {
          raw: d,
          id,
          name,
          homeTown,
          zoneKey,
          status,
          lat,
          lng,
        };
      })
      .filter((d) => {
        if (!d.id) return false;
        if (!Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return false;
        if (!isDriverAvailable(d.status)) return false;

        const zStat = (zoneStats || ({} as any))[d.zoneKey];
        if (zStat && zStat.status === "FULL") return false;

        // ordinance: passengers must be same town; deliveries can be cross-town
        if (!deliveryMode) return d.homeTown === tripZone;
        return true;
      })
      .map((d) => {
        // simple distance in degrees (fast + stable)
        const dist = Math.sqrt(Math.pow(d.lat - plat, 2) + Math.pow(d.lng - plng, 2));

        let score = dist;
        let label = "Nearest";

        if (!deliveryMode && d.homeTown === tripZone) {
          score *= 0.4;
          label = "Same town (ordinance)";
        } else if (deliveryMode && d.homeTown === tripZone) {
          label = "Same town";
        } else {
          const z = (zoneStats || ({} as any))[d.zoneKey];
          if (z?.status === "OK") {
            score *= 0.8;
            label = "Low-load zone";
          }
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
    const deliveryMode = isDeliveryType(pickTripType(trip));
    const tripZone = pickTripZone(trip);
    const plat = pickPickupLat(trip);
    const plng = pickPickupLng(trip);

    if (!Number.isFinite(plat) || !Number.isFinite(plng)) {
      return <div className="text-[11px] text-slate-400">Trip is missing pickup coordinates.</div>;
    }

    return (
      <div className="text-[11px] text-slate-400">
        {deliveryMode ? (
          <>No available drivers found near this pickup point.</>
        ) : (
          <>
            No eligible drivers from <span className="font-semibold">{tripZone}</span> (passenger ordinance).
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

        const label = isAssigning ? "Assigning..." : isAssigned ? "Assigned" : assignedDriverId ? "Reassign" : "Assign";

        return (
          <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <div>
              <div className="font-semibold">{d.name}</div>
              {/* ASCII-only separator to avoid mojibake */}
              <div className="text-[10px] text-slate-500">{d.homeTown} - {d.label}</div>
            </div>

            <button
              className={[
                "rounded px-2 py-1 text-[10px] font-semibold text-white",
                disabled
                  ? "bg-slate-300 cursor-not-allowed"
                  : isAssigned
                    ? "bg-emerald-500"
                    : "bg-emerald-600 hover:bg-emerald-700",
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