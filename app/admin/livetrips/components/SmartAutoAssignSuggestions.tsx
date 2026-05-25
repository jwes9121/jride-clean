-"use client";

import React, { useMemo } from "react";

type AnyObj = Record<string, any>;

type ZoneStat = {
  util?: number;
  status?: string; // "OK" | "WARN" | "FULL"
};

type Props = {
  drivers: AnyObj[];
  trip: AnyObj | null;

  zoneStats?: Record<string, ZoneStat>;

  onAssign?: (driverId: string) => void | Promise<void>;

  assignedDriverId?: string | null;
  assigningDriverId?: string | null;

  forceAssign?: boolean;
  canAssign?: boolean;
  lockReason?: string;
};

function normTown(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function isOnlineLike(status: any) {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "online" || s === "available" || s === "idle" || s === "waiting";
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getTripPickup(trip: AnyObj) {
  const lat = trip?.pickup_lat ?? trip?.pickupLat ?? trip?.pickupLatitude ?? null;
  const lng = trip?.pickup_lng ?? trip?.pickupLng ?? trip?.pickupLongitude ?? null;
  return {
    lat: typeof lat === "number" ? lat : Number.isFinite(Number(lat)) ? Number(lat) : null,
    lng: typeof lng === "number" ? lng : Number.isFinite(Number(lng)) ? Number(lng) : null,
  };
}

function getTripTown(trip: AnyObj) {
  return trip?.zone ?? trip?.town ?? trip?.zone_name ?? trip?.zoneName ?? "Unknown";
}

function getDriverId(d: AnyObj) {
  return String(d?.driver_id ?? d?.id ?? "").trim();
}

function getDriverTown(d: AnyObj) {
  return d?.town ?? d?.zone ?? d?.homeTown ?? "Unknown";
}

function getDriverName(d: AnyObj) {
  return d?.name ?? d?.driver_name ?? "Driver";
}

function getDriverCoords(d: AnyObj) {
  const lat = d?.lat ?? d?.latitude ?? null;
  const lng = d?.lng ?? d?.longitude ?? null;
  return {
    lat: typeof lat === "number" ? lat : Number.isFinite(Number(lat)) ? Number(lat) : null,
    lng: typeof lng === "number" ? lng : Number.isFinite(Number(lng)) ? Number(lng) : null,
  };
}

export default function SmartAutoAssignSuggestions({
  drivers,
  trip,
  zoneStats = {},
  onAssign,
  assignedDriverId,
  assigningDriverId,
  forceAssign = false,
  canAssign = true,
  lockReason,
}: Props) {
  const suggestions = useMemo(() => {
    if (!trip) return [];

    const tripTownRaw = getTripTown(trip);
    const tripTown = normTown(tripTownRaw);

    const sameTown = (drivers || []).filter((d) => normTown(getDriverTown(d)) === tripTown);
    if (!sameTown.length) return [];

    const notFull = sameTown.filter((d) => {
      const zKey = String(getDriverTown(d) ?? "Unknown");
      const st = (zoneStats || ({} as any))[zKey];
      if (st && String(st.status || "").toUpperCase() === "FULL") return false;
      return true;
    });

    const eligible = forceAssign ? notFull : notFull.filter((d) => isOnlineLike(d?.status));
    if (!eligible.length) return [];

    const p = getTripPickup(trip);

    if (p.lat === null || p.lng === null) {
      return eligible.slice(0, 5).map((d) => ({
        id: getDriverId(d),
        name: getDriverName(d),
        town: getDriverTown(d),
        status: String(d?.status ?? ""),
        label: forceAssign ? "Same town (forced pool)" : "Same town (online)",
        score: 99999999,
        _raw: d,
      }));
    }

    const withCoords = eligible
      .map((d) => {
        const c = getDriverCoords(d);
        return { d, lat: c.lat, lng: c.lng };
      })
      .filter((x) => x.lat !== null && x.lng !== null);

    if (!withCoords.length) {
      return eligible.slice(0, 5).map((d) => ({
        id: getDriverId(d),
        name: getDriverName(d),
        town: getDriverTown(d),
        status: String(d?.status ?? ""),
        label: "Same town (no coords)",
        score: 99999999,
        _raw: d,
      }));
    }

    const scored = withCoords
      .map(({ d, lat, lng }) => {
        const distM = haversineMeters(p.lat as number, p.lng as number, lat as number, lng as number);
        const km = distM / 1000;

        const onlinePenalty = isOnlineLike(d?.status) ? 0 : 1;
        const score = distM + onlinePenalty * 2000;

        const label = onlinePenalty ? `Nearest (non-online)  -  ${km.toFixed(2)} km` : `Nearest  -  ${km.toFixed(2)} km`;

        return {
          id: getDriverId(d),
          name: getDriverName(d),
          town: getDriverTown(d),
          status: String(d?.status ?? ""),
          label,
          score,
          _raw: d,
        };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 5);

    return scored;
  }, [drivers, trip, zoneStats, forceAssign]);

  if (!trip) {
    return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  }

  if (!suggestions.length) {
    const z = getTripTown(trip);
    return (
      <div className="text-[11px] text-slate-400">
        No eligible drivers from <span className="font-semibold">{String(z || "Unknown")}</span> (same-town rule).
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

        const disabled =
          !canAssign ||
          !onAssign ||
          !d.id ||
          isAssigning ||
          (!!assigningDriverId && assigningDriverId !== d.id);

        const label = isAssigning ? "Assigning..." : isAssigned ? "Assigned" : assignedDriverId ? "Reassign" : "Assign";

        return (
          <div key={d.id} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
            <div>
              <div className="font-semibold">{d.name}</div>
              <div className="text-[10px] text-slate-500">
                {String(d.town || "")}  -  {d.label}
              </div>
            </div>

            <button
              type="button"
              className={[
                "rounded px-2 py-1 text-[10px] font-semibold text-white",
                disabled ? "bg-slate-300 cursor-not-allowed" : isAssigned ? "bg-emerald-500" : "bg-emerald-600 hover:bg-emerald-700",
              ].join(" ")}
              disabled={disabled}
              onClick={() => onAssign?.(d.id)}
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
