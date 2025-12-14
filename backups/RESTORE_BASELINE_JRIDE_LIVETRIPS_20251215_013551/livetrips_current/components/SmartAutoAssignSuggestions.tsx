"use client";

import React, { useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type ZoneCapRow = {
  zone_id: string;
  zone_name: string;
  color_hex: string | null;
  capacity_limit: number | null;
  active_drivers: number | null;
  available_slots: number | null;
  status: "FULL" | "NEAR" | "AVAILABLE" | string;
};

type DriverScoreRow = {
  driver_id: string;
  driver_name: string | null;
  score_0_100: number | null;
  tier: "GOLD" | "SILVER" | "NEEDS_ATTENTION" | string;
};

type DriverEarningsRow = {
  driver_id: string;
  driver_name: string | null;
  earned_today: number | null;
  earned_this_week: number | null;
  earned_this_month: number | null;
  completed_30d: number | null;
};

type Props = {
  trips: any[];
  drivers: any[];
  selectedTripId: string | null;
  onSelectTrip: (id: string | null) => void;

  zoneCaps?: ZoneCapRow[];
  driverScores?: Record<string, DriverScoreRow>;
  driverEarnings?: Record<string, DriverEarningsRow>;
  onAssigned: () => Promise<void> | void;
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

function dist2(aLat: number, aLng: number, bLat: number, bLng: number) {
  return Math.pow(aLat - bLat, 2) + Math.pow(aLng - bLng, 2);
}

function fmtPeso(n: any): string {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? "0"));
  if (!Number.isFinite(v)) return "₱0";
  return `₱${Math.round(v).toLocaleString("en-PH")}`;
}

export default function SmartAutoAssignSuggestions(props: Props) {
  const trips = props.trips || [];
  const drivers = props.drivers || [];
  const selectedTripId = props.selectedTripId ?? null;
  const onAssigned = props.onAssigned;

  // ✅ safety defaults
  const zoneCaps: ZoneCapRow[] = Array.isArray(props.zoneCaps) ? props.zoneCaps : [];
  const driverScores: Record<string, DriverScoreRow> = props.driverScores ?? {};
  const driverEarnings: Record<string, DriverEarningsRow> = props.driverEarnings ?? {};

  const [busyId, setBusyId] = useState<string | null>(null);

  const zoneById = useMemo(() => {
    const m: Record<string, ZoneCapRow> = {};
    zoneCaps.forEach((z) => {
      if (z?.zone_id) m[String(z.zone_id)] = z;
    });
    return m;
  }, [zoneCaps]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return trips.find((t: any) =>
      String(t.id ?? t.bookingId ?? t.booking_id ?? t.bookingCode ?? t.booking_code ?? "") === String(selectedTripId)
    ) ?? null;
  }, [trips, selectedTripId]);

  const suggestions = useMemo(() => {
    if (!selectedTrip) return [];

    const pickupLat = Number(selectedTrip.pickup_lat ?? selectedTrip.from_lat ?? selectedTrip.origin_lat ?? NaN);
    const pickupLng = Number(selectedTrip.pickup_lng ?? selectedTrip.from_lng ?? selectedTrip.origin_lng ?? NaN);
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return [];

    const tripType = String(selectedTrip.tripType ?? selectedTrip.trip_type ?? selectedTrip.service_type ?? "ride");
    const deliveryMode = isDeliveryType(tripType);

    const tripZoneId = String(selectedTrip.zone_id ?? selectedTrip.booking_zone_id ?? "");
    const tripZoneName =
      selectedTrip.zone_name_resolved ??
      selectedTrip.zone_name ??
      (tripZoneId && zoneById[tripZoneId] ? zoneById[tripZoneId].zone_name : null) ??
      selectedTrip.town ??
      selectedTrip.zone ??
      selectedTrip.municipality ??
      "Unknown";

    return drivers
      .filter((d: any) => {
        const status = String(d.status ?? d.driver_status ?? "");
        if (!isDriverAvailable(status)) return false;

        const driverId = String(d.id ?? d.driver_id ?? d.driverId ?? "");
        if (!driverId) return false;

        const driverZoneId = String(d.zone_id ?? "");
        const dzRow = driverZoneId && zoneById[driverZoneId] ? zoneById[driverZoneId] : null;

        if (dzRow && String(dzRow.status).toUpperCase() === "FULL") return false;

        if (!deliveryMode) {
          if (tripZoneId && driverZoneId) return tripZoneId === driverZoneId;

          const driverZoneNameFallback =
            (driverZoneId && zoneById[driverZoneId] ? zoneById[driverZoneId].zone_name : null) ??
            String(d.town ?? d.zone ?? d.homeTown ?? d.home_town ?? "");

          return driverZoneNameFallback && driverZoneNameFallback === tripZoneName;
        }

        return true;
      })
      .map((d: any) => {
        const dLat = Number(d.lat ?? d.driver_lat ?? d.latitude ?? NaN);
        const dLng = Number(d.lng ?? d.driver_lng ?? d.longitude ?? NaN);

        const driverId = String(d.id ?? d.driver_id ?? d.driverId ?? "");
        const driverZoneId = String(d.zone_id ?? "");
        const dzRow = driverZoneId && zoneById[driverZoneId] ? zoneById[driverZoneId] : null;

        const baseDist =
          Number.isFinite(dLat) && Number.isFinite(dLng)
            ? dist2(pickupLat, pickupLng, dLat, dLng)
            : 999999;

        const scoreRow = driverId && driverScores[driverId] ? driverScores[driverId] : null;
        const score0_100 = scoreRow?.score_0_100 ?? 70;

        const earnRow = driverId && driverEarnings[driverId] ? driverEarnings[driverId] : null;
        const earnedToday = earnRow?.earned_today ?? 0;

        let rank = baseDist;
        rank *= (1 - Math.min(Math.max(score0_100, 0), 100) / 1000);
        rank *= (1 + Math.min(Math.max(earnedToday, 0), 2000) / 20000);

        const driverZoneName =
          dzRow?.zone_name ??
          String(d.town ?? d.zone ?? d.homeTown ?? d.home_town ?? "Unknown");

        let label = "Nearest";
        if (!deliveryMode && tripZoneId && driverZoneId && tripZoneId === driverZoneId) label = "Same zone (ordinance)";
        else if (!deliveryMode && driverZoneName === tripZoneName) label = "Same zone (ordinance)";
        else if (dzRow && String(dzRow.status).toUpperCase() === "AVAILABLE") label = "Low-load zone";

        return {
          driverId,
          name: String(d.driver_name ?? d.name ?? d.full_name ?? d.driverName ?? `Driver ${driverId}`),
          zone: driverZoneName,
          label,
          score0_100,
          earnedToday,
          rank,
        };
      })
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5);
  }, [selectedTrip, drivers, zoneById, driverScores, driverEarnings]);

  async function assign(driverId: string) {
    if (!selectedTrip) return;

    const bookingCode = String(selectedTrip.bookingCode ?? selectedTrip.booking_code ?? selectedTrip.code ?? selectedTrip.id ?? "");
    if (!bookingCode) {
      alert("Selected trip has no booking code/id.");
      return;
    }

    setBusyId(driverId);
    try {
      const { data, error } = await supabase.rpc("admin_assign_driver_by_code_v1", {
        p_booking_code: bookingCode,
        p_driver_id: driverId,
        p_actor: "dispatcher",
        p_reason: "smart suggestion assign",
      });

      if (error) {
        alert(`Assign failed: ${error.message}`);
        return;
      }
      if (data?.ok !== true) {
        alert(`Assign blocked: ${data?.message ?? "Unknown reason"}`);
        return;
      }

      await onAssigned?.();
      alert("Assigned.");
    } finally {
      setBusyId(null);
    }
  }

  if (!selectedTripId) {
    return <div className="text-[11px] text-slate-400">Select a trip to see assignment suggestions.</div>;
  }
  if (!selectedTrip) {
    return <div className="text-[11px] text-slate-400">Selected trip not found.</div>;
  }
  if (!suggestions.length) {
    const tripType = String(selectedTrip.tripType ?? selectedTrip.trip_type ?? selectedTrip.service_type ?? "ride");
    const deliveryMode = isDeliveryType(tripType);

    const tripZoneId = String(selectedTrip.zone_id ?? selectedTrip.booking_zone_id ?? "");
    const tripZoneName =
      selectedTrip.zone_name_resolved ??
      selectedTrip.zone_name ??
      (tripZoneId && zoneById[tripZoneId] ? zoneById[tripZoneId].zone_name : null) ??
      selectedTrip.town ??
      selectedTrip.zone ??
      selectedTrip.municipality ??
      "Unknown";

    return (
      <div className="text-[11px] text-slate-400">
        {deliveryMode ? (
          <>No available drivers found near this pickup point.</>
        ) : (
          <>
            No eligible drivers from <span className="font-semibold">{tripZoneName}</span> (passenger ordinance: pickup must use driver from same zone).
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {suggestions.map((d) => (
        <div key={d.driverId} className="flex items-center justify-between rounded border bg-white px-2 py-1 text-xs">
          <div className="min-w-0">
            <div className="font-semibold truncate">{d.name}</div>
            <div className="text-[10px] text-slate-500 truncate">
              {d.zone} • {d.label} • Score {d.score0_100 ?? "--"} • Earned {fmtPeso(d.earnedToday)}
            </div>
          </div>

          <button
            disabled={busyId === d.driverId}
            className="rounded bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            onClick={() => assign(d.driverId)}
          >
            {busyId === d.driverId ? "Assigning..." : "Assign"}
          </button>
        </div>
      ))}
    </div>
  );
}