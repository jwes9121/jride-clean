"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ProblemTripAlertSounds } from "./components/ProblemTripAlertSounds";
import { LivetripsKpiBanner } from "./components/LivetripsKpiBanner";
import { StuckTripWatcher } from "./components/StuckTripWatcher";
import { LiveTripsMap } from "./components/LiveTripsMap";
import AdminOpsPanel from "./components/AdminOpsPanel";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import type { LiveTrip } from "./components/ProblemTripAlertSounds";

// mirror capacity used in AdminOpsPanel
const ZONE_CAPACITY: Record<string, number> = {
  Kiangan: 20,
  Lagawe: 30,
  Banaue: 20,
  Hingyon: 15,
  Lamut: 20,
};

function getTripType(raw: any): string {
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

  // ===============================
  // LOAD TRIPS
  // ===============================
  const loadTrips = async () => {
    try {
      const { data, error } = await supabase.rpc(
        "admin_get_live_trips_page_data"
      );
      if (error) {
        console.error("admin_get_live_trips_page_data error:", error);
        return;
      }
      if (Array.isArray(data)) {
        setLiveTrips(data as LiveTrip[]);
      }
    } catch (err) {
      console.error("Failed to load live trips:", err);
    }
  };

  // ===============================
  // LOAD DRIVERS (driver_locations)
  // ===============================
  const loadDrivers = async () => {
    try {
      const { data, error } = await supabase
        .from("driver_locations")
        .select("driver_id, lat, lng, town, status, home_town, updated_at");

      if (error) {
        console.error("loadDrivers error:", error);
        return;
      }

      if (Array.isArray(data)) {
        setDrivers(
          data.map((d: any) => ({
            id: d.driver_id,
            name: d.driver_id
              ? `Driver ${String(d.driver_id).slice(0, 4)}`
              : "Driver",
            lat: d.lat,
            lng: d.lng,
            zone: d.home_town ?? d.town ?? "Unknown",
            homeTown: d.home_town ?? d.town ?? "Unknown",
            status: d.status ?? "available",
            updatedAt: d.updated_at,
          }))
        );
      }
    } catch (err) {
      console.error("Failed to load drivers:", err);
    }
  };

  useEffect(() => {
    loadTrips();
    loadDrivers();
    const t = setInterval(() => {
      loadTrips();
      loadDrivers();
    }, 7000);
    return () => clearInterval(t);
  }, []);

  // ===============================
  // STUCK MERGE
  // ===============================
  const enhancedTrips = useMemo<LiveTrip[]>(() => {
    return liveTrips.map((t) => {
      const id = String(t.id ?? t.bookingCode ?? "");
      return { ...t, isProblem: stuckTripIds.has(id) || t.isProblem };
    });
  }, [liveTrips, stuckTripIds]);

  // ===============================
  // SELECTED TRIP
  // ===============================
  useEffect(() => {
    if (!enhancedTrips.length) {
      setSelectedTripId(null);
      return;
    }
    if (!selectedTripId) {
      const first = enhancedTrips[0];
      setSelectedTripId(String(first.id ?? first.bookingCode ?? ""));
    }
  }, [enhancedTrips, selectedTripId]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return (
      enhancedTrips.find(
        (t) => String(t.id ?? t.bookingCode ?? "") === selectedTripId
      ) ?? null
    );
  }, [enhancedTrips, selectedTripId]);

  const selectedTripType = useMemo(
    () => (selectedTrip ? getTripType(selectedTrip) : "ride"),
    [selectedTrip]
  );

  const selectedIsDelivery = useMemo(
    () => isDeliveryType(selectedTripType),
    [selectedTripType]
  );

  // ===============================
  // ZONE UTILIZATION STATS (for auto-assign)
  // ===============================
  const zoneStats = useMemo(() => {
    const counts: Record<string, number> = {};

    enhancedTrips.forEach((t: any) => {
      const zone = t.town ?? t.zone ?? "Unknown";
      counts[zone] = (counts[zone] || 0) + 1;
    });

    const stats: Record<string, { util: number; status: string }> = {};
    Object.entries(counts).forEach(([zone, count]) => {
      const limit = ZONE_CAPACITY[zone] ?? 20;
      const util = Math.round((count / limit) * 100);
      let status: "OK" | "WARN" | "FULL" = "OK";
      if (util >= 90 && util < 100) status = "WARN";
      if (util >= 100) status = "FULL";
      stats[zone] = { util, status };
    });

    return stats;
  }, [enhancedTrips]);

  // ===============================
  // STUCK CALLBACK
  // ===============================
  const handleStuckChange = (ids: string[]) => {
    setStuckTripIds(new Set(ids));
  };

  // ===============================
  // SMART ASSIGN HANDLER (dispatcher-safe)
  // ===============================
  const handleSmartAssign = async (driverId: string) => {
    if (!selectedTrip) return;
    const bookingId = (selectedTrip as any).id;

    try {
      const { error } = await supabase.rpc("dispatcher_assign_driver", {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_actor: "dispatcher", // ordinance enforced, no cross-town passenger
        p_override_reason: null,
      });

      if (error) {
        console.error("dispatcher_assign_driver error:", error);
        return;
      }

      await loadTrips();
    } catch (err) {
      console.error("smart assign failed:", err);
    }
  };

  // ===============================
  // ADMIN EMERGENCY OVERRIDE
  // ===============================
  const overrideOptions = useMemo(() => {
    if (!selectedTrip) return [];
    // For override we allow ANY driver; panel itself is passenger-only
    return drivers.map((d: any) => ({
      value: d.id,
      label: `${d.name} • ${d.homeTown}`,
    }));
  }, [drivers, selectedTrip]);

  const handleAdminOverrideAssign = async () => {
    if (!selectedTrip || !overrideDriverId) return;
    if (selectedIsDelivery) return; // should be hidden anyway

    const bookingId = (selectedTrip as any).id;

    const reason =
      typeof window !== "undefined"
        ? window.prompt("Reason for ordinance override? (required)")
        : null;

    if (!reason || !reason.trim()) {
      return;
    }

    try {
      const { error } = await supabase.rpc("dispatcher_assign_driver", {
        p_booking_id: bookingId,
        p_driver_id: overrideDriverId,
        p_actor: "admin", // emergency override
        p_override_reason: reason.trim(),
      });

      if (error) {
        console.error("dispatcher_assign_driver override error:", error);
        return;
      }

      setOverrideDriverId("");
      await loadTrips();
    } catch (err) {
      console.error("admin override assign failed:", err);
    }
  };

  // ===============================
  // EXPORT DAILY OPS REPORT (CSV) WITH DATE PROMPT
  // ===============================
  const handleExportCsv = async () => {
    try {
      if (typeof window === "undefined") {
        console.error("Cannot export CSV on server.");
        return;
      }

      const today = new Date();
      const defaultDate = today.toISOString().slice(0, 10); // YYYY-MM-DD

      const input = window.prompt(
        "Export trips for which date? (YYYY-MM-DD)\nLeave blank for today.",
        defaultDate
      );

      if (input === null) {
        // user cancelled
        return;
      }

      const exportDate = (input && input.trim()) || defaultDate;

      const { data, error } = await supabase.rpc(
        "admin_export_daily_ops_report",
        { p_date: exportDate }
      );

      if (error) {
        console.error("admin_export_daily_ops_report error:", error);
        return;
      }

      if (!Array.isArray(data) || data.length === 0) {
        window.alert(`No trips found for ${exportDate}.`);
        return;
      }

      const rows: any[] = data;
      const headers = [
        "booking_id",
        "booking_code",
        "town",
        "status",
        "trip_type",
        "created_at",
        "assigned_driver_id",
        "override_used",
        "override_actor",
        "override_reason",
        "override_at",
      ];

      const escapeCell = (value: any) => {
        if (value === null || value === undefined) return "";
        const s = String(value);
        if (s.includes('"') || s.includes(",") || s.includes("\n")) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      };

      const lines: string[] = [];
      lines.push(headers.join(","));
      for (const row of rows) {
        lines.push(headers.map((h) => escapeCell((row as any)[h])).join(","));
      }

      const csv = lines.join("\n");

      const blob = new Blob([csv], {
        type: "text/csv;charset=utf-8;",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `jride_ops_${exportDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("export CSV failed:", err);
    }
  };

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Top toolbar with export */}
      <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2 text-xs">
        <div className="font-semibold">Live Trips</div>
        <button
          className="rounded bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-900"
          onClick={handleExportCsv}
        >
          Export today (CSV)
        </button>
      </div>

      <ProblemTripAlertSounds trips={enhancedTrips} />
      <LivetripsKpiBanner trips={enhancedTrips} />
      <StuckTripWatcher trips={liveTrips} onStuckChange={handleStuckChange} />

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT — ADMIN OPS + SMART AUTO ASSIGN + OVERRIDE */}
        <div className="w-[520px] border-r overflow-hidden flex flex-col">
          <AdminOpsPanel
            trips={enhancedTrips}
            selectedTripId={selectedTripId}
            onSelectTrip={setSelectedTripId}
          />

          {/* Smart auto-assign (ordinance-safe) */}
          <div className="border-t bg-slate-50 p-2">
            <div className="text-xs font-semibold mb-1">
              Smart Auto-Assign Suggestions
            </div>
            <SmartAutoAssignSuggestions
              drivers={drivers}
              trip={
                selectedTrip
                  ? {
                      id: String(selectedTrip.id ?? selectedTrip.bookingCode),
                      pickupLat: (selectedTrip as any).pickupLat ?? 0,
                      pickupLng: (selectedTrip as any).pickupLng ?? 0,
                      zone:
                        (selectedTrip as any).town ??
                        (selectedTrip as any).zone ??
                        "Unknown",
                      tripType: selectedTripType,
                    }
                  : null
              }
              zoneStats={zoneStats}
              onAssign={handleSmartAssign}
            />
          </div>

          {/* Admin emergency override panel */}
          <div className="border-t bg-rose-50 p-2">
            <div className="text-xs font-semibold mb-1 text-rose-700">
              Admin Emergency Override (cross-town passenger only)
            </div>
            <p className="text-[11px] text-rose-700 mb-1">
              Use only in real emergencies. This bypasses the pickup-town
              ordinance and logs the override.
            </p>

            {!selectedTrip || selectedIsDelivery ? (
              <div className="text-[11px] text-rose-400">
                Select a passenger trip to enable override.
              </div>
            ) : overrideOptions.length === 0 ? (
              <div className="text-[11px] text-rose-400">
                No drivers available to override with.
              </div>
            ) : (
              <div className="space-y-1">
                <select
                  className="w-full rounded border border-rose-200 bg-white px-2 py-1 text-[11px]"
                  value={overrideDriverId}
                  onChange={(e) => setOverrideDriverId(e.target.value)}
                >
                  <option value="">Select driver (any town)</option>
                  {overrideOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                <button
                  className="w-full rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
                  disabled={!overrideDriverId}
                  onClick={handleAdminOverrideAssign}
                >
                  Override ordinance & assign driver
                </button>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT — MAP */}
        <div className="flex-1">
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
