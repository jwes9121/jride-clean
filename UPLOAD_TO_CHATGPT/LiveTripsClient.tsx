"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ProblemTripAlertSounds } from "./components/ProblemTripAlertSounds";
import { LivetripsKpiBanner } from "./components/LivetripsKpiBanner";
import { StuckTripWatcher } from "./components/StuckTripWatcher";
import { LiveTripsMap } from "./components/LiveTripsMap";
import AdminOpsPanel from "./components/AdminOpsPanel";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";

type LiveTrip = any;

function pickTripType(raw: any): string {
  return (
    raw?.trip_type ??
    raw?.service_type ??
    raw?.service ??
    raw?.category ??
    raw?.type ??
    "ride"
  );
}

function normalizeStatus(raw: any): string {
  const s = String(raw?.status ?? raw?.booking_status ?? raw?.ride_status ?? "")
    .trim()
    .toLowerCase();
  return s || "unknown";
}

function displayZone(raw: any): string {
  const z =
    raw?.zone ??
    raw?.town ??
    raw?.municipality ??
    raw?.from_town ??
    raw?.pickup_town ??
    raw?.home_town ??
    raw?.homeTown ??
    raw?.zone_name ??
    raw?.zoneName ??
    "Unknown";
  return String(z || "Unknown");
}

export default function LiveTripsClient() {
  const [liveTrips, setLiveTrips] = useState<LiveTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());

  // Pull live trips (dispatch view)
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data, error } = await supabase
        .from("dispatch_rides_view")
        .select("*")
        .limit(200);

      if (!cancelled) {
        if (error) {
          console.error("[livetrips] dispatch_rides_view error", error);
          setLiveTrips([]);
        } else {
          setLiveTrips((data as any[]) || []);
        }
      }
    }

    load();
    const t = setInterval(load, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  // Enhance trips for UI
  const enhancedTrips = useMemo(() => {
    return (liveTrips || []).map((raw: any) => {
      const status = normalizeStatus(raw);
      const zone = displayZone(raw);
      const tripType = pickTripType(raw);

      const pickup = {
        lat: raw?.pickup_lat ?? raw?.from_lat ?? raw?.fromLat ?? raw?.origin_lat,
        lng: raw?.pickup_lng ?? raw?.from_lng ?? raw?.fromLng ?? raw?.origin_lng,
        label: raw?.pickup_label ?? raw?.from_label ?? raw?.fromLabel ?? raw?.origin_label,
      };

      const dropoff = {
        lat: raw?.dropoff_lat ?? raw?.to_lat ?? raw?.toLat ?? raw?.destination_lat,
        lng: raw?.dropoff_lng ?? raw?.to_lng ?? raw?.toLng ?? raw?.destination_lng,
        label: raw?.dropoff_label ?? raw?.to_label ?? raw?.toLabel ?? raw?.destination_label,
      };

      return {
        ...raw,
        id: String(raw?.id ?? raw?.booking_id ?? raw?.ride_id ?? raw?.booking_code ?? raw?.code ?? ""),
        booking_code: raw?.booking_code ?? raw?.code ?? raw?.bookingCode ?? raw?.ride_code ?? raw?.rideCode ?? "",
        status,
        zone,
        tripType,
        pickup,
        dropoff,
      };
    });
  }, [liveTrips]);

  // ✅ CRITICAL FIX: stable callback prevents infinite re-render loop
  const handleStuckChange = useCallback((ids: Set<string>) => {
    setStuckTripIds(new Set(ids));
  }, []);

  return (
    <div className="w-full h-full">
      <ProblemTripAlertSounds trips={enhancedTrips} />
      <LivetripsKpiBanner trips={enhancedTrips} />
      <StuckTripWatcher trips={liveTrips} onStuckChange={handleStuckChange} />

      {/* MOBILE: stack, DESKTOP: side-by-side */}
      <div className="flex flex-col md:flex-row gap-3 p-3">
        {/* LEFT — OPS */}
        <div className="w-full md:w-[420px]">
          <AdminOpsPanel
            trips={enhancedTrips}
            selectedTripId={selectedTripId}
            onSelectTrip={(id: string | null) => setSelectedTripId(id)}
            stuckTripIds={stuckTripIds}
            onRefresh={() => {}}
          />

          <div className="mt-3">
            <SmartAutoAssignSuggestions />
          </div>
        </div>

        {/* RIGHT — MAP */}
        <div className="flex-1 min-h-[55vh] md:min-h-0">
          <LiveTripsMap
            trips={enhancedTrips}
            selectedTripId={selectedTripId}
            stuckTripIds={stuckTripIds}
          />
        </div>
      </div>
    </div>
  );
}