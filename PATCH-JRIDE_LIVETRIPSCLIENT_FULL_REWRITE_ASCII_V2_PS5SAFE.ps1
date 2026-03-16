param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

$ErrorActionPreference = 'Stop'

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

function New-Backup {
  param([Parameter(Mandatory=$true)][string]$Path)
  if (-not (Test-Path $Path)) { return }
  $stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $dir = Split-Path -Parent $Path
  $name = Split-Path -Leaf $Path
  $bakDir = Join-Path $dir '_patch_bak'
  New-Item -ItemType Directory -Path $bakDir -Force | Out-Null
  $bak = Join-Path $bakDir ($name + '.bak.LIVETRIPSCLIENT_FULL_REWRITE_ASCII_V2.' + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$target = Join-Path $RepoRoot 'app\admin\livetrips\LiveTripsClient.tsx'
if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

New-Backup -Path $target

$content = @'
"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type OfferRow = {
  booking_code?: string | null;
  driver_id?: string | null;
  offer_rank?: number | null;
  status?: string | null;
  expires_at?: string | null;
  responded_at?: string | null;
  response_source?: string | null;
};

type TripRow = {
  id?: string | number | null;
  uuid?: string | null;
  booking_code?: string | null;
  passenger_name?: string | null;
  pickup_label?: string | null;
  dropoff_label?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  status?: string | null;
  town?: string | null;
  zone?: string | null;
  driver_id?: string | null;
  assigned_driver_id?: string | null;
  driver_name?: string | null;
  driver_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  latest_offer?: OfferRow | null;
};

type DriverRow = {
  driver_id?: string | null;
  name?: string | null;
  phone?: string | null;
  town?: string | null;
  home_town?: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string | null;
  age_seconds?: number | null;
  is_stale?: boolean | null;
  current_offer_booking?: string | null;
  offer_rank?: number | null;
  offer_expiry?: string | null;
};

type PageData = {
  ok?: boolean;
  trips?: TripRow[];
  bookings?: TripRow[];
  data?: TripRow[];
  warnings?: string[];
};

type TripFilter =
  | "unassigned"
  | "dispatch"
  | "assigned"
  | "on_the_way"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem"
  | "all";

const REFRESH_MS = 15000;
const WAIT_WARN_SECONDS = 60;
const WAIT_ESCALATE_SECONDS = 180;
const STUCK_ON_THE_WAY_MIN = 15;
const STUCK_ON_TRIP_MIN = 25;

function arr<T>(v: any): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: any): string {
  return String(v == null ? "" : v).trim();
}

function lower(v: any): string {
  return str(v).toLowerCase();
}

function tripId(t: TripRow): string {
  return str(t.uuid || t.id || t.booking_code);
}

function bookingCode(t: TripRow): string {
  return str(t.booking_code || t.id || t.uuid);
}

function activeDriverId(t: TripRow): string {
  return str(t.assigned_driver_id || t.driver_id);
}

function isProblemTrip(t: TripRow): boolean {
  const s = lower(t.status);
  const mins = minutesSince(t.updated_at || t.created_at);
  return (s === "on_the_way" && mins >= STUCK_ON_THE_WAY_MIN) || (s === "on_trip" && mins >= STUCK_ON_TRIP_MIN);
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 999999;
  return Math.floor((Date.now() - ms) / 60000);
}

function secondsSince(iso?: string | null): number {
  if (!iso) return 999999;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 999999;
  return Math.max(0, Math.floor((Date.now() - ms) / 1000));
}

function formatSeenAgo(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return String(seconds) + "s";
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return String(mins) + "m";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return String(hours) + "h";
  const days = Math.floor(hours / 24);
  return String(days) + "d";
}

function formatWaiting(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  if (seconds < 60) return String(seconds) + "s";
  const mins = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (mins < 60) return String(mins) + "m " + String(remSec) + "s";
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  return String(hours) + "h " + String(remMin) + "m";
}

function formatPht(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "-";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(d);
}

function waitingTone(seconds: number): string {
  if (seconds >= WAIT_ESCALATE_SECONDS) return "text-red-700 font-semibold";
  if (seconds >= WAIT_WARN_SECONDS) return "text-amber-700 font-semibold";
  return "text-gray-900";
}

function offerTone(status: string): string {
  const s = lower(status);
  if (s === "accepted") return "text-green-700 font-semibold";
  if (s === "rejected" || s === "expired" || s === "cancelled" || s === "skipped") return "text-red-700 font-semibold";
  if (s === "offered") return "text-blue-700 font-semibold";
  return "text-gray-700";
}

function pillClass(active: boolean): string {
  return active
    ? "px-3 py-1.5 rounded-full border text-sm bg-black text-white border-black"
    : "px-3 py-1.5 rounded-full border text-sm bg-white text-gray-800 border-gray-300 hover:bg-gray-50";
}

async function getJson(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(str((json as any).error || (json as any).message || "REQUEST_FAILED"));
  }
  return json;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(str((json as any).error || (json as any).message || "REQUEST_FAILED"));
  }
  return json;
}

export default function LiveTripsClient() {
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState("");
  const [lastAction, setLastAction] = useState("");
  const [tripFilter, setTripFilter] = useState<TripFilter>("unassigned");
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [assigning, setAssigning] = useState(false);
  const [sendingOfferCode, setSendingOfferCode] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");

  const loadPage = useCallback(async () => {
    setLoading(true);
    setLastError("");
    try {
      const [page, driverFeed] = await Promise.all([
        getJson("/api/admin/livetrips/page-data?debug=1"),
        getJson("/api/admin/driver-locations"),
      ]);

      const nextTrips = arr<TripRow>((page as PageData).trips).length
        ? arr<TripRow>((page as PageData).trips)
        : arr<TripRow>((page as PageData).bookings).length
          ? arr<TripRow>((page as PageData).bookings)
          : arr<TripRow>((page as PageData).data);

      const nextDrivers = arr<DriverRow>((driverFeed as any).drivers).length
        ? arr<DriverRow>((driverFeed as any).drivers)
        : arr<DriverRow>(driverFeed);

      setTrips(nextTrips);
      setDrivers(nextDrivers);

      setSelectedTripId(function keepOrPick(prev) {
        if (prev && nextTrips.some(function (t) { return tripId(t) === prev; })) return prev;
        const firstUnassigned = nextTrips.find(function (t) {
          return lower(t.status) === "requested" && !activeDriverId(t);
        });
        return firstUnassigned ? tripId(firstUnassigned) : (nextTrips[0] ? tripId(nextTrips[0]) : "");
      });
    } catch (err: any) {
      setLastError(str(err && err.message ? err.message : err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(function initLoad() {
    void loadPage();
    const timer = window.setInterval(function () {
      void loadPage();
    }, REFRESH_MS);
    return function cleanup() {
      window.clearInterval(timer);
    };
  }, [loadPage]);

  const counts = useMemo(function buildCounts() {
    const out: Record<TripFilter, number> = {
      unassigned: 0,
      dispatch: 0,
      assigned: 0,
      on_the_way: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
      all: trips.length,
    };

    for (const t of trips) {
      const s = lower(t.status);
      const noDriver = !activeDriverId(t);
      if (s === "requested" && noDriver) out.unassigned += 1;
      if (s === "requested" || s === "assigned" || s === "on_the_way") out.dispatch += 1;
      if (s === "assigned") out.assigned += 1;
      if (s === "on_the_way") out.on_the_way += 1;
      if (s === "on_trip") out.on_trip += 1;
      if (s === "completed") out.completed += 1;
      if (s === "cancelled") out.cancelled += 1;
      if (isProblemTrip(t)) out.problem += 1;
    }
    return out;
  }, [trips]);

  const visibleTrips = useMemo(function filterTrips() {
    return trips.filter(function (t) {
      const s = lower(t.status);
      const noDriver = !activeDriverId(t);
      if (tripFilter === "unassigned") return s === "requested" && noDriver;
      if (tripFilter === "dispatch") return s === "requested" || s === "assigned" || s === "on_the_way";
      if (tripFilter === "assigned") return s === "assigned";
      if (tripFilter === "on_the_way") return s === "on_the_way";
      if (tripFilter === "on_trip") return s === "on_trip";
      if (tripFilter === "completed") return s === "completed";
      if (tripFilter === "cancelled") return s === "cancelled";
      if (tripFilter === "problem") return isProblemTrip(t);
      return true;
    });
  }, [tripFilter, trips]);

  const selectedTrip = useMemo(function findSelectedTrip() {
    return visibleTrips.find(function (t) { return tripId(t) === selectedTripId; })
      || trips.find(function (t) { return tripId(t) === selectedTripId; })
      || null;
  }, [selectedTripId, trips, visibleTrips]);

  const selectableDrivers = useMemo(function filterDrivers() {
    const town = str(selectedTrip && (selectedTrip.town || selectedTrip.zone));
    return drivers.filter(function (d) {
      const status = lower(d.status);
      const okStatus = !status || status === "online" || status === "available" || status === "active" || status === "idle";
      if (!okStatus) return false;
      if (!town) return true;
      const driverTown = str(d.town || d.home_town);
      return !driverTown || lower(driverTown) === lower(town);
    });
  }, [drivers, selectedTrip]);

  async function sendOffer(code: string) {
    if (!code) return;
    try {
      setSendingOfferCode(code);
      setLastAction("Sending offer for " + code + "...");
      await postJson("/api/dispatch/offer", {
        bookingCode: code,
        timeoutSeconds: 8,
        source: "admin_livetrips",
      });
      setLastAction("Offer sent for " + code);
      await loadPage();
    } catch (err: any) {
      setLastError(str(err && err.message ? err.message : err));
    } finally {
      setSendingOfferCode("");
    }
  }

  async function assignDriver() {
    if (!selectedTrip) return;
    const code = bookingCode(selectedTrip);
    const driverId = selectedDriverId;
    if (!code || !driverId) return;
    try {
      setAssigning(true);
      setLastAction("Assigning " + code + "...");
      await postJson("/api/dispatch/assign", { bookingCode: code, driverId: driverId });
      setLastAction("Assigned " + code);
      await loadPage();
    } catch (err: any) {
      setLastError(str(err && err.message ? err.message : err));
    } finally {
      setAssigning(false);
    }
  }

  const selectedTripCode = bookingCode(selectedTrip || {});

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Live Trips</h1>
          <p className="text-sm text-gray-600">Dispatch queue, unassigned bookings, latest offers, and driver freshness.</p>
        </div>
        <div className="text-right text-xs text-gray-600 space-y-1">
          <div>Refresh: {loading ? "loading" : "idle"}</div>
          <div>{lastAction || "No recent action"}</div>
          <button className="px-3 py-1.5 rounded border text-sm" onClick={function () { void loadPage(); }}>
            Refresh now
          </button>
        </div>
      </div>

      {lastError ? (
        <div className="rounded border border-red-300 bg-red-50 text-red-800 px-3 py-2 text-sm">
          {lastError}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button className={pillClass(tripFilter === "unassigned")} onClick={function () { setTripFilter("unassigned"); }}>Unassigned {counts.unassigned}</button>
        <button className={pillClass(tripFilter === "dispatch")} onClick={function () { setTripFilter("dispatch"); }}>Dispatch {counts.dispatch}</button>
        <button className={pillClass(tripFilter === "assigned")} onClick={function () { setTripFilter("assigned"); }}>Assigned {counts.assigned}</button>
        <button className={pillClass(tripFilter === "on_the_way")} onClick={function () { setTripFilter("on_the_way"); }}>On the way {counts.on_the_way}</button>
        <button className={pillClass(tripFilter === "on_trip")} onClick={function () { setTripFilter("on_trip"); }}>On trip {counts.on_trip}</button>
        <button className={pillClass(tripFilter === "completed")} onClick={function () { setTripFilter("completed"); }}>Completed {counts.completed}</button>
        <button className={pillClass(tripFilter === "cancelled")} onClick={function () { setTripFilter("cancelled"); }}>Cancelled {counts.cancelled}</button>
        <button className={pillClass(tripFilter === "problem")} onClick={function () { setTripFilter("problem"); }}>Problem {counts.problem}</button>
        <button className={pillClass(tripFilter === "all")} onClick={function () { setTripFilter("all"); }}>All {counts.all}</button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-lg border overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
            <div className="font-semibold">Trips</div>
            <div className="text-xs text-gray-600">{visibleTrips.length} shown</div>
          </div>
          <div className="overflow-auto" style={{ maxHeight: 560 }}>
            <table className="min-w-full text-sm">
              <thead className="bg-white sticky top-0 z-10">
                <tr className="border-b text-left">
                  <th className="px-3 py-2">Booking</th>
                  <th className="px-3 py-2">Passenger</th>
                  <th className="px-3 py-2">Town</th>
                  <th className="px-3 py-2">Pickup</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Waiting</th>
                  <th className="px-3 py-2">Offer</th>
                  <th className="px-3 py-2">Driver</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visibleTrips.map(function (t) {
                  const code = bookingCode(t);
                  const waitingSeconds = secondsSince(t.created_at);
                  const latestOffer = t.latest_offer || null;
                  const isSelected = tripId(t) === tripId(selectedTrip || {});
                  return (
                    <tr
                      key={tripId(t)}
                      className={"border-b align-top cursor-pointer " + (isSelected ? "bg-blue-50" : "bg-white")}
                      onClick={function () {
                        setSelectedTripId(tripId(t));
                        setSelectedDriverId(activeDriverId(t));
                      }}
                    >
                      <td className="px-3 py-2 font-medium">{code || "-"}</td>
                      <td className="px-3 py-2">{str(t.passenger_name) || "-"}</td>
                      <td className="px-3 py-2">{str(t.town || t.zone) || "-"}</td>
                      <td className="px-3 py-2">{str(t.pickup_label) || "-"}</td>
                      <td className="px-3 py-2">{str(t.status) || "requested"}</td>
                      <td className={"px-3 py-2 " + waitingTone(waitingSeconds)}>{formatWaiting(waitingSeconds)}</td>
                      <td className="px-3 py-2">
                        <div className={offerTone(str(latestOffer && latestOffer.status))}>{str(latestOffer && latestOffer.status) || "-"}</div>
                        <div className="text-xs text-gray-600">rank {str(latestOffer && latestOffer.offer_rank) || "-"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div>{str(t.driver_name) || str(t.assigned_driver_id || t.driver_id) || "-"}</div>
                        <div className="text-xs text-gray-600">{str(t.driver_status) || "-"}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {(lower(t.status) === "requested" && !activeDriverId(t)) ? (
                            <button
                              className="px-2 py-1 rounded border text-xs bg-white hover:bg-gray-50 disabled:opacity-50"
                              disabled={sendingOfferCode === code}
                              onClick={function (e) {
                                e.stopPropagation();
                                void sendOffer(code);
                              }}
                            >
                              {sendingOfferCode === code ? "Sending..." : "Send offer"}
                            </button>
                          ) : null}
                          {latestOffer ? (
                            <button
                              className="px-2 py-1 rounded border text-xs bg-white hover:bg-gray-50 disabled:opacity-50"
                              disabled={sendingOfferCode === code}
                              onClick={function (e) {
                                e.stopPropagation();
                                void sendOffer(code);
                              }}
                            >
                              {sendingOfferCode === code ? "Sending..." : "Retry offer"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!visibleTrips.length ? (
                  <tr>
                    <td className="px-3 py-6 text-center text-gray-500" colSpan={9}>No trips found for this filter.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <div className="px-3 py-2 border-b bg-gray-50 font-semibold">Selected trip</div>
          <div className="p-3 space-y-3 text-sm">
            <div>
              <div className="text-xs text-gray-500">Booking</div>
              <div className="font-medium">{selectedTripCode || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Passenger</div>
              <div>{str(selectedTrip && selectedTrip.passenger_name) || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Pickup</div>
              <div>{str(selectedTrip && selectedTrip.pickup_label) || "-"}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Latest offer</div>
              <div>{str(selectedTrip && selectedTrip.latest_offer && selectedTrip.latest_offer.status) || "-"}</div>
              <div className="text-xs text-gray-600">driver {str(selectedTrip && selectedTrip.latest_offer && selectedTrip.latest_offer.driver_id) || "-"}</div>
            </div>

            <div className="rounded border p-3 space-y-2">
              <div className="font-semibold">Assign driver (manual)</div>
              <select
                className="w-full rounded border px-2 py-2"
                value={selectedDriverId}
                onChange={function (e) { setSelectedDriverId(e.target.value); }}
              >
                <option value="">Select driver</option>
                {selectableDrivers.map(function (d) {
                  const id = str(d.driver_id);
                  const label = (str(d.name) || id || "Unknown") + " | " + (str(d.town) || "-") + " | " + (str(d.status) || "-");
                  return <option key={id} value={id}>{label}</option>;
                })}
              </select>
              <button
                className="w-full px-3 py-2 rounded border bg-black text-white disabled:opacity-50"
                disabled={!selectedTripCode || !selectedDriverId || assigning}
                onClick={function () { void assignDriver(); }}
              >
                {assigning ? "Assigning..." : "Assign selected driver"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="px-3 py-2 border-b bg-gray-50 flex items-center justify-between">
          <div className="font-semibold">Drivers</div>
          <div className="text-xs text-gray-600">{drivers.length} loaded</div>
        </div>
        <div className="overflow-auto" style={{ maxHeight: 360 }}>
          <table className="min-w-full text-sm">
            <thead className="bg-white sticky top-0 z-10">
              <tr className="border-b text-left">
                <th className="px-3 py-2">Driver</th>
                <th className="px-3 py-2">Town</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Last Ping (PHT)</th>
                <th className="px-3 py-2">Seen Ago</th>
                <th className="px-3 py-2">Stale</th>
                <th className="px-3 py-2">Active Offer</th>
              </tr>
            </thead>
            <tbody>
              {drivers.map(function (d) {
                const seenSeconds = Number(d.age_seconds != null ? d.age_seconds : secondsSince(d.updated_at));
                return (
                  <tr key={str(d.driver_id)} className="border-b">
                    <td className="px-3 py-2">
                      <div className="font-medium">{str(d.name) || str(d.driver_id) || "-"}</div>
                      <div className="text-xs text-gray-600">{str(d.phone) || "-"}</div>
                    </td>
                    <td className="px-3 py-2">{str(d.town || d.home_town) || "-"}</td>
                    <td className="px-3 py-2">{str(d.status) || "-"}</td>
                    <td className="px-3 py-2">{formatPht(d.updated_at)}</td>
                    <td className="px-3 py-2">{formatSeenAgo(seenSeconds)}</td>
                    <td className="px-3 py-2">{d.is_stale ? "Yes" : "No"}</td>
                    <td className="px-3 py-2">
                      <div>{str(d.current_offer_booking) || "-"}</div>
                      <div className="text-xs text-gray-600">rank {str(d.offer_rank) || "-"}</div>
                    </td>
                  </tr>
                );
              })}
              {!drivers.length ? (
                <tr>
                  <td className="px-3 py-6 text-center text-gray-500" colSpan={7}>No drivers loaded.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
'@

if ($content.ToCharArray() | Where-Object { [int]$_ -gt 127 } | Select-Object -First 1) {
  throw 'Generated content is not ASCII-clean.'
}

Write-Utf8NoBom -Path $target -Content $content
Write-Host "[OK] Wrote: $target"
Write-Host '[OK] LiveTripsClient.tsx fully rewritten as ASCII-safe replacement.'
