"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ProblemTripAlertSounds } from "./components/ProblemTripAlertSounds";
import { LivetripsKpiBanner } from "./components/LivetripsKpiBanner";
import { StuckTripWatcher } from "./components/StuckTripWatcher";
import { LiveTripsMap } from "./components/LiveTripsMap";
import AdminOpsPanel from "./components/AdminOpsPanel";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import AdminPayoutPanel, { AdminPayoutRow } from "./components/AdminPayoutPanel";

type LiveTrip = any;

type ZoneCapRow = {
  zone_id: string;
  zone_name: string;
  color_hex: string | null;
  capacity_limit: number | null;
  active_drivers: number | null;
  available_slots: number | null;
  status: string;
};

type DriverScoreRow = {
  driver_id: string;
  driver_name: string | null;
  score_0_100: number | null;
  tier: string | null;
};

type DriverEarningsRow = {
  driver_id: string;
  driver_name: string | null;
  earned_today: number | null;
  earned_this_week: number | null;
  earned_this_month: number | null;
  completed_30d: number | null;
};

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
  const [zoneCaps, setZoneCaps] = useState<ZoneCapRow[]>([]);
  const [driverScores, setDriverScores] = useState<Record<string, DriverScoreRow>>({});
  const [driverEarnings, setDriverEarnings] = useState<Record<string, DriverEarningsRow>>({});
  const [payoutRows, setPayoutRows] = useState<AdminPayoutRow[]>([]);

  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [overrideDriverId, setOverrideDriverId] = useState<string>("");

  async function loadAll() {
    // Trips
    const tripsRes = await supabase.from("dispatch_rides_view").select("*").limit(200);
    if (tripsRes.error) console.error("[dispatch_rides_view] error:", tripsRes.error);
    setLiveTrips(tripsRes.data || []);

    // Drivers
    const drvRes = await supabase.from("mv_driver_live").select("*").limit(2000);
    if (drvRes.error) console.error("[mv_driver_live] error:", drvRes.error);
    setDrivers(drvRes.data || []);

    // Zone capacity (materialized view)
    const zRes = await supabase.from("zone_capacity_view").select("*").limit(500);
    if (zRes.error) console.error("[zone_capacity_view] error:", zRes.error);
    setZoneCaps((zRes.data as any) || []);

    // Driver score
    const sRes = await supabase.from("driver_score_view_v1").select("*").limit(5000);
    if (sRes.error) console.error("[driver_score_view_v1] error:", sRes.error);
    const scoreMap: Record<string, DriverScoreRow> = {};
    for (const r of (sRes.data as any[]) || []) {
      const id = String(r.driver_id ?? r.id ?? "");
      if (!id) continue;
      scoreMap[id] = r as any;
    }
    setDriverScores(scoreMap);

    // Driver earnings
    const eRes = await supabase.from("driver_earnings_view_v1").select("*").limit(5000);
    if (eRes.error) console.error("[driver_earnings_view_v1] error:", eRes.error);
    const earnMap: Record<string, DriverEarningsRow> = {};
    for (const r of (eRes.data as any[]) || []) {
      const id = String(r.driver_id ?? r.id ?? "");
      if (!id) continue;
      earnMap[id] = r as any;
    }
    setDriverEarnings(earnMap);

    // Admin payout requests view
    const pRes = await supabase.from("admin_driver_payout_requests_v1").select("*").limit(500);
    if (pRes.error) console.error("[admin_driver_payout_requests_v1] error:", pRes.error);
    setPayoutRows((pRes.data as any) || []);
  }

  useEffect(() => {
    loadAll();
    const t = setInterval(loadAll, 10000);
    return () => clearInterval(t);
  }, []);

  const enhancedTrips = useMemo(() => {
    return (liveTrips || []).map((t: any) => {
      const tripType = pickTripType(t);
      const delivery = isDeliveryType(tripType);
      return { ...t, tripType, isDelivery: delivery };
    });
  }, [liveTrips]);

  const handleStuckChange = useCallback((ids: Set<string>) => {
    setStuckTripIds(new Set(ids));
  }, []);

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

      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        {/* LEFT */}
        <div className="w-full md:w-[520px] md:border-r border-b md:border-b-0 flex flex-col max-h-full">
          {/* LEFT_SCROLL_CONTAINER_START */}
          <div className="flex-1 overflow-auto">
          <AdminOpsPanel
            trips={enhancedTrips}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
            zoneCaps={zoneCaps}
            driverScores={driverScores}
            driverEarnings={driverEarnings}
          />

          <div className="border-t bg-slate-50 p-2">
            <div className="text-xs font-semibold mb-1">
              Smart Auto-Assign (Ordinance-safe)
            </div>
            <SmartAutoAssignSuggestions
              trips={enhancedTrips}
              drivers={drivers}
              selectedTripId={selectedTripId}
              onSelectTrip={setSelectedTripId}
              zoneCaps={zoneCaps}
              driverScores={driverScores}
              driverEarnings={driverEarnings}
              onAssigned={async () => { await loadAll(); }}
            />
          </div>

          {/* Payout Admin Panel */}
          <div className="border-t p-2">
            <AdminPayoutPanel rows={payoutRows} onRefresh={loadAll} />
          </div>

          {/* Override assign (kept) */}
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
          {/* LEFT_SCROLL_CONTAINER_END */}
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