"use client";

import React, { useEffect, useMemo, useState } from "react";
import AdminOpsPanel from "./components/AdminOpsPanel";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import LiveTripsMap from "./components/LiveTripsMap";

type Trip = any;

type Driver = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  zone: string;
  homeTown: string;
  status: string;
  updated_at?: string | null;
};

type ZoneStat = { util: number; status: string };

function normTown(z?: any) {
  const s = String(z || "Unknown").trim();
  return s || "Unknown";
}

function tripIdOf(t: any) {
  return String(t?.id ?? t?.uuid ?? t?.bookingCode ?? t?.booking_code ?? "");
}

function tripCodeOf(t: any) {
  return String(t?.bookingCode ?? t?.booking_code ?? t?.code ?? t?.id ?? "");
}

function assignedDriverIdOf(t: any) {
  return String(
    t?.driver_id ??
      t?.driverId ??
      t?.driver_uuid ??
      t?.driver_id_uuid ??
      t?.driver?.id ??
      ""
  ).trim();
}

export default function LiveTripsClient() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not loaded yet");

  const [manualDriverId, setManualDriverId] = useState<string>("");
  const [overrideDriverId, setOverrideDriverId] = useState<string>("");

  const [assigningDriverId, setAssigningDriverId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>("");

  // -----------------------------
  // LOAD TRIPS (server route)
  // -----------------------------
  async function loadTrips() {
    try {
      const r = await fetch("/api/admin/livetrips", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));

      const arr = (j?.trips ?? []) as any[];
      setTrips(arr);

      // keep selection stable; if none, select first
      if (!selectedTripId && arr.length) {
        setSelectedTripId(tripIdOf(arr[0]));
      }
    } catch (e: any) {
      console.error("loadTrips failed", e);
      setLastAction("Trips load failed: " + (e?.message ?? "unknown error"));
    }
  }

  // -----------------------------
  // LOAD DRIVERS (server route)
  // -----------------------------
  async function loadDrivers() {
    try {
      const r = await fetch("/api/admin/driver-locations", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));

      const arr = (j?.drivers ?? []) as Driver[];
      setDrivers(arr);

      const ts = new Date().toLocaleTimeString();
      setDriversDebug(
        `last: table driver_locations @ ${ts}\nsource: driver_locations\ncount: ${arr.length}\n` +
          "table driver_locations: OK — select: driver_id, lat, lng, town, status, updated_at\nrpc fallback: NO"
      );
    } catch (e: any) {
      console.error("loadDrivers failed", e);
      setDrivers([]);
      const ts = new Date().toLocaleTimeString();
      setDriversDebug(
        `last: no driver source worked @ ${ts}\ncount: 0\n` +
          `table driver_locations: ERROR — ${e?.message ?? "unknown error"}\n` +
          "rpc fallback: NO"
      );
    }
  }

  useEffect(() => {
    loadTrips();
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -----------------------------
  // SELECTED TRIP
  // -----------------------------
  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return trips.find((t: any) => tripIdOf(t) === selectedTripId) ?? null;
  }, [trips, selectedTripId]);

  const assignedDriverId = useMemo(() => {
    const id = selectedTrip ? assignedDriverIdOf(selectedTrip) : "";
    return id || null;
  }, [selectedTrip]);

  // -----------------------------
  // ZONE STATS (for suggestions)
  // -----------------------------
  const zoneStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of trips) {
      const z = normTown(t?.town ?? t?.zone ?? t?.municipality);
      counts[z] = (counts[z] || 0) + 1;
    }

    const map: Record<string, ZoneStat> = {};
    for (const [zone, count] of Object.entries(counts)) {
      // keep the same baseline behavior: simple util heuristic
      const limit = 20;
      const util = Math.round((count / limit) * 100);
      const status = util >= 100 ? "FULL" : util >= 90 ? "WARN" : "OK";
      map[zone] = { util, status };
    }
    return map;
  }, [trips]);

  // -----------------------------
  // ASSIGN (ONE driver per trip)
  // Clicking another Assign = REASSIGN same trip
  // -----------------------------
  async function assignDriver(driverId: string, tag: string) {
    if (!selectedTrip) {
      setLastAction("Assign blocked: no selected trip");
      return;
    }

    const bookingId = tripIdOf(selectedTrip);
    const bookingCode = tripCodeOf(selectedTrip);

    setAssigningDriverId(driverId);
    setLastAction(`Assigning (${tag})...`);

    try {
      const r = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          bookingId,
          bookingCode,
          driverId,
          source: tag,
        }),
      });

      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        throw new Error(j?.message ?? j?.error ?? `HTTP ${r.status}`);
      }

      setLastAction("Assigned ✓ (This is one-driver-per-trip; assigning again reassigns the same trip.)");
      await loadTrips();
      await loadDrivers();
    } catch (e: any) {
      console.error("assignDriver failed", e);
      setLastAction("Assign FAILED: " + (e?.message ?? "unknown error"));
    } finally {
      setAssigningDriverId(null);
    }
  }

  // -----------------------------
  // STATUS UPDATES (server route)
  // -----------------------------
  async function updateTripStatus(newStatus: string) {
    if (!selectedTrip) return;

    const bookingId = tripIdOf(selectedTrip);
    const bookingCode = tripCodeOf(selectedTrip);

    setLastAction(`Status → ${newStatus}...`);
    try {
      const r = await fetch("/api/dispatch/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ bookingId, bookingCode, status: newStatus }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.message ?? j?.error ?? `HTTP ${r.status}`);

      setLastAction(`Status updated ✓ (${newStatus})`);
      await loadTrips();
    } catch (e: any) {
      console.error("updateTripStatus failed", e);
      setLastAction("Status update failed: " + (e?.message ?? "unknown error"));
    }
  }

  // -----------------------------
  // NORMALIZE TRIP SHAPE FOR MAP/SUGGESTIONS
  // -----------------------------
  const tripForSuggestions = useMemo(() => {
    if (!selectedTrip) return null;

    const pickupLat = Number(
      selectedTrip?.pickupLat ??
        selectedTrip?.pickup_lat ??
        selectedTrip?.from_lat ??
        selectedTrip?.fromLat ??
        0
    );
    const pickupLng = Number(
      selectedTrip?.pickupLng ??
        selectedTrip?.pickup_lng ??
        selectedTrip?.from_lng ??
        selectedTrip?.fromLng ??
        0
    );

    const zone = normTown(selectedTrip?.town ?? selectedTrip?.zone ?? selectedTrip?.municipality);
    const tripType = String(selectedTrip?.tripType ?? selectedTrip?.type ?? selectedTrip?.service_type ?? "").trim();

    return {
      id: tripIdOf(selectedTrip),
      pickupLat,
      pickupLng,
      zone,
      tripType,
    };
  }, [selectedTrip]);

  return (
    <div className="h-[calc(100vh-80px)] w-full">
      <div className="grid h-full grid-cols-12 gap-2 p-2">
        {/* LEFT */}
        <div className="col-span-4 flex h-full flex-col gap-2 overflow-hidden">
          {/* Driver Source Debug */}
          <div className="rounded border bg-amber-50 p-2 text-[11px] text-slate-700 whitespace-pre-line">
            <div className="font-semibold mb-1">Driver Source Debug</div>
            {driversDebug}
            <div className="mt-2 flex gap-2">
              <button
                className="rounded bg-amber-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-amber-700"
                onClick={loadDrivers}
                disabled={!!assigningDriverId}
              >
                Recheck drivers
              </button>
            </div>
          </div>

          {/* Admin ops list */}
          <div className="flex-1 overflow-hidden rounded border bg-white">
            <AdminOpsPanel trips={trips} selectedTripId={selectedTripId} onSelectTrip={setSelectedTripId} />
          </div>

          {/* Trip control + wallet + manual assign */}
          <div className="rounded border bg-white p-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-xs">Trip control &amp; wallet</div>
              <div className="text-[11px] text-slate-500">
                Status: <span className="font-semibold">{String(selectedTrip?.status ?? "-")}</span>
              </div>
            </div>

            {/* NOTE: Values may show "--" until Earnings panel wires into these fields; this restores baseline UI without touching Mapbox. */}
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border p-2">
                <div className="text-[11px] text-slate-500">Fare</div>
                <div className="font-semibold">{String(selectedTrip?.fare ?? selectedTrip?.total_fare ?? "--")}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-[11px] text-slate-500">Platform fee</div>
                <div className="font-semibold">{String(selectedTrip?.platformFee ?? selectedTrip?.platform_fee ?? "--")}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-[11px] text-slate-500">Driver wallet</div>
                <div className="font-semibold">{String(selectedTrip?.driverWallet ?? selectedTrip?.driver_wallet ?? "--")}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-[11px] text-slate-500">Vendor wallet</div>
                <div className="font-semibold">{String(selectedTrip?.vendorWallet ?? selectedTrip?.vendor_wallet ?? "--")}</div>
              </div>
            </div>

            <div className="mt-2 flex gap-2">
              <select
                className="w-full rounded border px-2 py-1 text-xs"
                value={manualDriverId}
                onChange={(e) => setManualDriverId(e.target.value)}
                disabled={!selectedTrip || !!assigningDriverId}
              >
                <option value="">Select driver</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.homeTown} — {d.status}
                  </option>
                ))}
              </select>

              <button
                className={[
                  "rounded px-3 py-1 text-xs font-semibold text-white",
                  (!manualDriverId || !selectedTrip || !!assigningDriverId) ? "bg-slate-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700",
                ].join(" ")}
                disabled={!manualDriverId || !selectedTrip || !!assigningDriverId}
                onClick={() => assignDriver(manualDriverId, "manual")}
                title="Assign sets exactly ONE driver for this trip (reassigns if already assigned)."
              >
                {assigningDriverId && manualDriverId === assigningDriverId ? "Assigning..." : "Assign"}
              </button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <button
                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                disabled={!selectedTrip || !!assigningDriverId}
                onClick={() => updateTripStatus("on_the_way")}
              >
                On the way
              </button>
              <button
                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                disabled={!selectedTrip || !!assigningDriverId}
                onClick={() => updateTripStatus("on_trip")}
              >
                Start trip
              </button>
              <button
                className="rounded border bg-white px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                disabled={!selectedTrip || !!assigningDriverId}
                onClick={() => updateTripStatus("completed")}
              >
                Drop off
              </button>
            </div>

            {lastAction ? (
              <div className="mt-2 text-[11px] text-slate-600">
                Last action: <span className="font-semibold">{lastAction}</span>
              </div>
            ) : null}

            <div className="mt-2 text-[11px] text-slate-500">
              Assign is <span className="font-semibold">one driver per trip</span>. Clicking another Assign reassigns the same trip (it will not “list multiple drivers”).
            </div>
          </div>

          {/* Smart suggestions */}
          <div className="rounded border bg-white p-2">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-xs">Smart Auto-Assign Suggestions</div>
              <div className="text-[11px] text-slate-500">
                {selectedTrip ? `${normTown(selectedTrip?.town ?? selectedTrip?.zone)} load: ${zoneStats[normTown(selectedTrip?.town ?? selectedTrip?.zone)]?.util ?? 0}% (${zoneStats[normTown(selectedTrip?.town ?? selectedTrip?.zone)]?.status ?? "OK"})` : ""}
              </div>
            </div>

            <div className="mt-2">
              <SmartAutoAssignSuggestions
                drivers={drivers}
                trip={tripForSuggestions as any}
                zoneStats={zoneStats as any}
                onAssign={(driverId) => assignDriver(driverId, "smart")}
                assignedDriverId={assignedDriverId}
                assigningDriverId={assigningDriverId}
              />
            </div>
          </div>

          {/* Emergency override (kept, but uses same assign endpoint) */}
          <div className="rounded border bg-red-50 p-2">
            <div className="font-semibold text-xs text-red-700">
              Admin Emergency Override (cross-town passenger only)
            </div>
            <div className="mt-1 text-[11px] text-red-700">
              Use only in real emergencies. This bypasses the pickup-town ordinance and logs the override.
            </div>

            <div className="mt-2 flex gap-2">
              <select
                className="w-full rounded border px-2 py-1 text-xs"
                value={overrideDriverId}
                onChange={(e) => setOverrideDriverId(e.target.value)}
                disabled={!selectedTrip || !!assigningDriverId}
              >
                <option value="">Select driver (any town)</option>
                {drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — {d.homeTown} — {d.status}
                  </option>
                ))}
              </select>

              <button
                className={[
                  "rounded px-3 py-1 text-xs font-semibold text-white",
                  (!overrideDriverId || !selectedTrip || !!assigningDriverId) ? "bg-red-200 cursor-not-allowed" : "bg-red-600 hover:bg-red-700",
                ].join(" ")}
                disabled={!overrideDriverId || !selectedTrip || !!assigningDriverId}
                onClick={() => assignDriver(overrideDriverId, "override")}
              >
                {assigningDriverId && overrideDriverId === assigningDriverId ? "Assigning..." : "Override & assign"}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT (Map + existing panels) */}
        <div className="col-span-8 h-full overflow-hidden rounded border bg-white">
          <LiveTripsMap
            trips={trips}
            selectedTripId={selectedTripId}
            stuckTripIds={new Set()}
          />
        </div>
      </div>
    </div>
  );
}
