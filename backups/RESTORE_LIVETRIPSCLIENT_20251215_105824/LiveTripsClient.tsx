"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

import AdminOpsPanel from "./components/AdminOpsPanel";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripLifecycleActions from "./components/TripLifecycleActions";
import TripWalletPanel from "./components/TripWalletPanel";

import LiveTripsMap from "./components/LiveTripsMap";
import { ProblemTripAlertSounds } from "./components/ProblemTripAlertSounds";
import { LivetripsKpiBanner } from "./components/LivetripsKpiBanner";
import { StuckTripWatcher } from "./components/StuckTripWatcher";

export default function LiveTripsClient() {
  const [trips, setTrips] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [stuckIds, setStuckIds] = useState<Set<string>>(new Set());

  const loadTrips = async () => {
    const { data } = await supabase.rpc("admin_get_live_trips_page_data");
    if (Array.isArray(data)) setTrips(data);
  };

  const loadDrivers = async () => {
    const { data } = await supabase.from("driver_locations").select("*");
    if (Array.isArray(data)) setDrivers(data);
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

  const selectedTrip = useMemo(
    () => trips.find(t => String(t.id) === String(selectedTripId)) ?? null,
    [trips, selectedTripId]
  );

  return (
    <div className="flex h-full">
      {/* LEFT COLUMN */}
      <div className="w-[520px] border-r flex flex-col overflow-y-auto">
        <AdminOpsPanel
          trips={trips}
          selectedTripId={selectedTripId}
          onSelectTrip={setSelectedTripId}
        />

        {selectedTrip && (
          <>
            {/* WALLET / PAYOUT */}
            <TripWalletPanel trip={selectedTrip} />

            {/* LIFECYCLE ACTIONS */}
            <TripLifecycleActions
              trip={selectedTrip}
              drivers={drivers}
              onActionComplete={loadTrips}
            />
          </>
        )}

        <SmartAutoAssignSuggestions
          drivers={drivers}
          trip={selectedTrip}
          onAssign={loadTrips}
        />
      </div>

      {/* RIGHT COLUMN */}
      <div className="flex-1 relative">
        <ProblemTripAlertSounds trips={trips} />
        <LivetripsKpiBanner trips={trips} />
        <StuckTripWatcher trips={trips} onStuckChange={ids => setStuckIds(new Set(ids))} />
        <LiveTripsMap trips={trips} selectedTripId={selectedTripId} />
      </div>
    </div>
  );
}
