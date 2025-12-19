"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { ProblemTripAlertSounds } from "./components/ProblemTripAlertSounds";
import { LivetripsKpiBanner } from "./components/LivetripsKpiBanner";
import { StuckTripWatcher } from "./components/StuckTripWatcher";
import { LiveTripsMap } from "./components/LiveTripsMap";
import type { LiveTrip } from "./components/ProblemTripAlertSounds";

export default function LiveTripsClient() {
  const [liveTrips, setLiveTrips] = useState<LiveTrip[]>([]);
  const [zoneFilter, setZoneFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [stuckTripIds, setStuckTripIds] = useState<Set<string>>(new Set());
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  // ===============================
  // LOAD TRIPS FROM SUPABASE
  // ===============================
  const loadTrips = async () => {
    try {
      const { data, error } = await supabase.rpc("admin_get_live_trips_page_data");
      if (error) {
        console.error("admin_get_live_trips_page_data error:", error);
        return;
      }
      if (Array.isArray(data)) {
        setLiveTrips(data as LiveTrip[]);
      } else {
        console.warn("Unexpected live trips data shape:", data);
        setLiveTrips([]);
      }
    } catch (err) {
      console.error("Failed to load live trips:", err);
    }
  };

  useEffect(() => {
    loadTrips();
    const timer = setInterval(loadTrips, 7000);
    return () => clearInterval(timer);
  }, []);

  // ===============================
  // ENHANCE TRIPS WITH STUCK FLAG
  // ===============================
  const enhancedTrips = useMemo<LiveTrip[]>(() => {
    if (!liveTrips) return [];
    return liveTrips.map((t) => {
      const id = String(t.id ?? t.bookingCode ?? "");
      const isStuck = stuckTripIds.has(id);
      return {
        ...t,
        isProblem: isStuck || t.isProblem,
      };
    });
  }, [liveTrips, stuckTripIds]);

  // ===============================
  // ZONE + STATUS FILTER OPTIONS
  // ===============================
  const availableZones = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const t of enhancedTrips) {
      if (t.town) set.add(String(t.town));
    }
    return Array.from(set).sort();
  }, [enhancedTrips]);

  const availableStatuses = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const t of enhancedTrips) {
      if (t.status) set.add(String(t.status));
    }
    return Array.from(set).sort();
  }, [enhancedTrips]);

  // ===============================
  // FILTERED TRIPS (ZONE + STATUS)
  // ===============================
  const filteredTrips = useMemo<LiveTrip[]>(() => {
    return enhancedTrips.filter((t) => {
      const zoneOk = zoneFilter === "all" || (t.town ?? "") === zoneFilter;
      const statusOk = statusFilter === "all" || t.status === statusFilter;
      return zoneOk && statusOk;
    });
  }, [enhancedTrips, zoneFilter, statusFilter]);

  // ===============================
  // HANDLE STUCK TRIP IDS FROM WATCHER
  // ===============================
  const handleStuckChange = (ids: string[]) => {
    setStuckTripIds(new Set(ids));
  };

  // ===============================
  // AUTO-FOCUS ON PROBLEM TRIP
  //  - If any problem trip exists, auto-select the first one
  //  - Otherwise, keep current selection if still present
  //  - If nothing selected, select first filtered trip
  // ===============================
  useEffect(() => {
    if (enhancedTrips.length === 0) {
      if (selectedTripId !== null) setSelectedTripId(null);
      return;
    }

    const current = enhancedTrips.find(
      (t) => String(t.id ?? t.bookingCode ?? "") === selectedTripId
    );

    const problemTrip = enhancedTrips.find((t) => t.isProblem);
    if (problemTrip) {
      const newId = String(problemTrip.id ?? problemTrip.bookingCode ?? "");
      if (newId !== selectedTripId) {
        setSelectedTripId(newId);
      }
      return;
    }

    if (!current) {
      const first = enhancedTrips[0];
      const firstId = String(first.id ?? first.bookingCode ?? "");
      if (firstId !== selectedTripId) {
        setSelectedTripId(firstId);
      }
    }
  }, [enhancedTrips, selectedTripId]);

  // ===============================
  // RENDER
  // ===============================
  return (
    <div className="flex h-full flex-col bg-white">
      {/* 🔔 Problem trip alert sounds (uses isProblem + heuristics) */}
      <ProblemTripAlertSounds trips={enhancedTrips} />

      {/* 📊 KPI banner (active trips, avg ETA, etc.) */}
      <LivetripsKpiBanner trips={enhancedTrips} />

      {/* 👀 Background watcher for stuck trips */}
      <StuckTripWatcher trips={liveTrips} onStuckChange={handleStuckChange} />

      <div className="flex flex-1 overflow-hidden">
        {/* LEFT SIDE — TRIP LIST + COLUMN FILTERS */}
        <div className="w-[420px] border-r flex flex-col overflow-hidden">
          {/* Filters bar */}
          <div className="border-b bg-slate-50 px-3 py-2 text-xs flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-700">
                Trip filters
              </span>
              <button
                type="button"
                className="rounded-full border border-slate-300 px-2 py-1 text-[10px] text-slate-500 hover:bg-white"
                onClick={() => {
                  setZoneFilter("all");
                  setStatusFilter("all");
                }}
              >
                Reset
              </button>
            </div>
            <div className="flex gap-2">
              {/* Zone column filter */}
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Zone / Town
                </span>
                <select
                  className="h-7 w-full rounded-md border border-slate-300 bg-white px-1 text-[11px]"
                  value={zoneFilter}
                  onChange={(e) => setZoneFilter(e.target.value)}
                >
                  <option value="all">All zones</option>
                  {availableZones.map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status column filter */}
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-slate-400">
                  Status
                </span>
                <select
                  className="h-7 w-full rounded-md border border-slate-300 bg-white px-1 text-[11px]"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                >
                  <option value="all">All statuses</option>
                  {availableStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Trip list */}
          <div className="flex-1 overflow-auto">
            {filteredTrips.length === 0 ? (
              <div className="px-3 py-4 text-xs text-slate-500">
                No trips matching current filters.
              </div>
            ) : (
              filteredTrips.map((t, index) => {
                const id = String(t.id ?? t.bookingCode ?? index);
                const isStuck = stuckTripIds.has(id);
                const isProblem = !!t.isProblem;
                const isSelected = selectedTripId === id;

                return (
                  <div
                    key={id}
                    onClick={() => setSelectedTripId(id)}
                    className={[
                      "border-b px-3 py-2 text-xs cursor-pointer transition-colors",
                      "hover:bg-slate-50",
                      isSelected ? "bg-sky-50" : "",
                      isStuck ? "bg-red-50" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    <div className="flex items-center justify-between">
                      <div className="font-semibold text-slate-900 text-sm truncate max-w-[220px]">
                        {t.bookingCode ?? id}
                      </div>
                      <div className="flex items-center gap-1">
                        {isStuck && (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                            STUCK
                          </span>
                        )}
                        {isProblem && !isStuck && (
                          <span className="rounded-full bg-amber-400 px-2 py-0.5 text-[10px] font-semibold text-slate-900">
                            PROBLEM
                          </span>
                        )}
                        {isSelected && (
                          <span className="rounded-full border border-sky-500 px-2 py-0.5 text-[10px] text-sky-700">
                            Selected
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
                      {t.town && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5">
                          {t.town}
                        </span>
                      )}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5">
                        {t.status}
                      </span>
                      {typeof t.pickupEtaSeconds === "number" && (
                        <span className="text-emerald-600">
                          ETA pickup: {Math.round(t.pickupEtaSeconds / 60)} min
                        </span>
                      )}
                      {typeof t.dropoffEtaSeconds === "number" && (
                        <span className="text-slate-500">
                          Trip ETA: {Math.round(t.dropoffEtaSeconds / 60)} min
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* RIGHT SIDE — LIVE MAP */}
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
