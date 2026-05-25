"use client";

import React, { useEffect, useMemo, useState } from "react";
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
    raw?.booking_type ??
    raw?.type ??
    "ride"
  );
}

function isDeliveryType(type: string): boolean {
  const t = (type || "").toLowerCase();
  if (!t) return false;
  return (
    t.includes("food") ||
    t.includes("delivery") ||
    t.includes("takeout") ||
    t.includes("errand")
  );
}

export default function LiveTripsClient() {
  const [liveTrips, setLiveTrips] = useState<LiveTrip[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [overrideDriverId, setOverrideDriverId] = useState<string>("");

  async function load() {
    const { data: trips } = await supabase
      .from("dispatch_rides_view")
      .select("*")
      .limit(200);

    const { data: driversData } = await supabase
      .from("mv_driver_live")
      .select("*")
      .limit(2000);

    setLiveTrips(trips || []);
    setDrivers(driversData || []);
  }

  useEffect(() => { load(); }, []);

  const enhancedTrips = useMemo(() => {
    return (liveTrips || []).map((t: any) => {
      const tripType = pickTripType(t);
      const delivery = isDeliveryType(tripType);

      return {
        ...t,
        tripType,
        isDelivery: delivery,
      };
    });
  }, [liveTrips]);

  function handleStuckChange(ids: Set<string>) {
    setStuckTripIds(new Set(ids));
  }

  async function handleExportCsv() {
    const rows = enhancedTrips || [];
    const headers = Object.keys(rows?.[0] || {});
    const csv = [
      headers.join(","),
      ...rows.map((r: any) =>
        headers.map((h) => JSON.stringify(r[h] ?? "")).join(",")
      ),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `livetrips_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Top toolbar */}
      <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2 text-xs">
        <div className="font-semibold">Live Trips</div>
        <button
          className="rounded bg-slate-800 px-3 py-2 text-[12px] font-semibold text-white hover:bg-slate-900"
          onClick={handleExportCsv}
        >
          Export (CSV)
        </button>
      </div>

      <ProblemTripAlertSounds trips={enhancedTrips} />
      <LivetripsKpiBanner trips={enhancedTrips} />
      <StuckTripWatcher trips={liveTrips} onStuckChange={handleStuckChange} />

      {/* MOBILE: stack, DESKTOP: side-by-side */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* LEFT */}
        <div className="w-full md:w-[520px] md:border-r border-b md:border-b-0 overflow-hidden flex flex-col">
          <AdminOpsPanel
            trips={enhancedTrips}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
          />

          {/* Smart auto-assign */}
          <div className="border-t bg-slate-50 p-2">
            <div className="text-xs font-semibold mb-1">
              Smart Auto-Assign (Ordinance-safe)
            </div>
            <SmartAutoAssignSuggestions
              trips={enhancedTrips}
              drivers={drivers}
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
            />
          </div>

          {/* Override assign (bigger on mobile) */}
          <div className="border-t bg-white p-2">
            <div className="text-xs font-semibold mb-2">Override Assign (Admin)</div>
            <div className="flex flex-col gap-2 md:flex-row md:items-center">
              <input
                value={overrideDriverId}
                onChange={(e) => setOverrideDriverId(e.target.value)}
                placeholder="Driver UUID"
                className="w-full rounded border px-3 py-2 text-sm font-mono"
              />
              <button
                className="w-full md:w-auto rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
                onClick={() => alert("Override assign handler is unchanged in this pass.")}
              >
                Override & Assign
              </button>
            </div>
            <div className="mt-2 text-[11px] text-slate-600">
              Mobile-first layout: list above, map below. Desktop remains side-by-side.
            </div>
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
