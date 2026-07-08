"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import LiveTripsMap from "./components/LiveTripsMap";
import SmartAutoAssignSuggestions from "./components/SmartAutoAssignSuggestions";
import TripWalletPanel from "./components/TripWalletPanel";
import TripLifecycleActions from "./components/TripLifecycleActions";

function formatLastSeen(ageSeconds?: number) {
  if (!ageSeconds && ageSeconds !== 0) return "--";
  if (ageSeconds < 60) return ageSeconds + "s ago";
  if (ageSeconds < 3600) return Math.floor(ageSeconds / 60) + "m ago";
  return Math.floor(ageSeconds / 3600) + "h ago";
}

function formatPHDateTime(value?: string | null): string {
  if (!value) return "--";
  const d = new Date(String(value));
  if (!Number.isFinite(d.getTime())) return String(value);
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d);
  } catch {
    return String(value);
  }
}

type ZoneRow = {
  zone_id: string;
  zone_name: string;
  color_hex?: string | null;
  capacity_limit?: number | null;
  active_drivers?: number | null;
  available_slots?: number | null;
  status?: string | null;
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
  zone?: string | null;
  town?: string | null;
  driver_id?: string | null;
  assigned_driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_status?: string | null;
  toda_name?: string | null;
  zone_id?: string | null;
  wallet_balance?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type DriverRow = {
  driver_id: string;
  lat?: number;
  lng?: number;
  status?: string;
  effective_status?: string;
  updated_at?: string;
  updated_at_ph?: string;
  age_seconds?: number;
  assign_eligible?: boolean;
  is_stale?: boolean;
  name?: string;
  phone?: string;
  town?: string;
};

type PageData = {
  zones?: ZoneRow[];
  trips?: TripRow[];
  bookings?: TripRow[];
  data?: TripRow[];
  warnings?: string[];
  debug?: any;
  [k: string]: any;
};

type TicketInspectorTimelineItem = {
  at?: string | null;
  source?: string | null;
  actor?: string | null;
  action?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  evidence?: any;
};

type TicketInspectorDiagnostic = {
  severity?: string | null;
  code?: string | null;
  message?: string | null;
  evidence?: string[];
};

type TicketInspectorResponse = {
  ok?: boolean;
  query?: string;
  booking?: any;
  matches?: any[];
  timeline?: TicketInspectorTimelineItem[];
  diagnostics?: TicketInspectorDiagnostic[];
  raw?: any;
  error?: string;
  message?: string;
};

type TicketInspectorTab = "overview" | "timeline" | "diagnostics" | "raw";

const STUCK_THRESHOLDS_MIN = {
  on_the_way: 15,
  on_trip: 25,
};

const POLL_MS_FOREGROUND = 5000;
const POLL_MS_BACKGROUND = 15000;

const LIVETRIPS_PENDING_STATUSES = [
  "requested",
  "searching",
  "assigned",
  "driver_assigned",
  "accepted",
  "fare_proposed",
  "ready",
];

const LIVETRIPS_ACTIVE_STATUSES = [
  "on_the_way",
  "arrived",
  "on_trip",
];

const LIVETRIPS_DISPATCH_STATUSES = [
  ...LIVETRIPS_PENDING_STATUSES,
  ...LIVETRIPS_ACTIVE_STATUSES,
];

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}

function normTripId(t: TripRow): string {
  return String(t.uuid || t.id || t.booking_code || "");
}

function safeArray<T>(v: any): T[] {
  if (!v) return [];
  if (Array.isArray(v)) return v as T[];
  return [];
}

function parseTripsFromPageData(j: any): TripRow[] {
  if (!j) return [];
  if (!Array.isArray(j.trips)) return [];
  return safeArray<TripRow>(j.trips);
}

function parseDriversFromPayload(j: any): DriverRow[] {
  if (!j) return [];
  const candidates = [
    j.drivers,
    j.data,
    j["0"],
    Array.isArray(j) ? j : null,
  ];
  for (const c of candidates) {
    const arr = safeArray<DriverRow>(c);
    if (arr.length) return arr;
  }
  return [];
}

function minutesSince(iso?: string | null): number {
  if (!iso) return 999999;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 999999;
  const now = Date.now();
  return Math.floor((now - t) / 60000);
}

function isActiveTripStatus(s: string) {
  return LIVETRIPS_DISPATCH_STATUSES.includes(s);
}

function computeIsProblem(t: TripRow): boolean {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);

  const isStuck =
    (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) ||
    (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip);

  const hasPickup = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
  const hasDropoff = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);
  const missingCoords = isActiveTripStatus(s) && (!hasPickup || !hasDropoff);

  return isStuck || missingCoords;
}

type ViewMode = "dispatch" | "trips" | "drivers";
type HistoryRange = "today" | "week" | "month";

type FilterKey =
  | "all"
  | "dispatch"
  | "pending"
  | "active"
  | "requested"
  | "searching"
  | "assigned"
  | "accepted"
  | "fare_proposed"
  | "ready"
  | "on_the_way"
  | "arrived"
  | "on_trip"
  | "completed"
  | "cancelled"
  | "problem";

function labelOrDash(v?: any) {
  const s = String(v ?? "").trim();
  return s ? s : "--";
}

function formatMoney(v?: any) {
  if (v == null || v === "") return "--";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return "PHP " + n.toLocaleString("en-PH", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function timelineTitle(row: TicketInspectorTimelineItem) {
  const source = String(row.source || "");
  const action = String(row.action || "");
  const to = String(row.to_status || "");

  if (action === "booking_created") return "Booking Created";

  if (source === "dispatch_actions" && action === "status_change") {
    const titles: Record<string, string> = {
      requested: "Requested",
      searching: "Searching",
      assigned: "Driver Assigned",
      accepted: "Driver Accepted",
      fare_proposed: "Fare Proposed",
      ready: "Ready for Pickup",
      on_the_way: "Driver On The Way",
      arrived: "Driver Arrived",
      on_trip: "Trip Started",
      completed: "Trip Completed",
      cancelled: "Trip Cancelled",
    };
    return titles[to] || "Status Changed";
  }

  if (source === "driver_wallet_transactions") {
    const amount = row.evidence?.amount;
    const reason = String(row.evidence?.reason || action || "");
    if (Number(amount) < 0) return "Wallet Deducted";
    if (Number(amount) > 0) return "Wallet Credited";
    return reason || "Wallet Transaction";
  }

  if (source === "driver_wallet_ledger") return "Wallet Ledger Entry";

  return action
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "--";
}

function timelineIcon(row: TicketInspectorTimelineItem) {
  const source = String(row.source || "");
  const to = String(row.to_status || "");
  if (source === "driver_wallet_transactions" || source === "driver_wallet_ledger") return "W";
  const icons: Record<string, string> = {
    assigned: "A",
    accepted: "OK",
    fare_proposed: "P",
    ready: "R",
    on_the_way: "OTW",
    arrived: "AR",
    on_trip: "GO",
    completed: "DONE",
    cancelled: "X",
  };
  return icons[to] || "EV";
}

function walletSummary(raw?: any) {
  const txs = Array.isArray(raw?.driver_wallet_transactions) ? raw.driver_wallet_transactions : [];
  const first = txs[0] || null;
  return {
    transaction: first,
    amount: first?.amount,
    reason: first?.reason,
    balanceAfter: first?.balance_after,
  };
}


function buildIncidentReport(ticket?: TicketInspectorResponse | null) {
  if (!ticket?.booking) return "No ticket loaded.";

  const booking = ticket.booking || {};
  const raw = ticket.raw || {};
  const ws = walletSummary(raw);
  const lines: string[] = [];

  lines.push("JRide Ticket Inspector Report");
  lines.push("");
  lines.push("Ticket: " + labelOrDash(booking.booking_code));
  lines.push("Status: " + labelOrDash(booking.status));
  lines.push("Service: " + labelOrDash(booking.service_type || booking.trip_type));
  lines.push("Town: " + labelOrDash(booking.town));
  lines.push("Passenger: " + labelOrDash(booking.passenger_name));
  lines.push("Driver ID: " + labelOrDash(booking.driver_id || booking.assigned_driver_id));
  lines.push("Vendor ID: " + labelOrDash(booking.vendor_id));
  lines.push("Created: " + formatPHDateTime(booking.created_at));
  lines.push("Updated: " + formatPHDateTime(booking.updated_at));
  lines.push("");

  lines.push("Timeline:");
  const timeline = Array.isArray(ticket.timeline) ? ticket.timeline : [];
  if (!timeline.length) {
    lines.push("- No timeline rows returned.");
  } else {
    for (const row of timeline) {
      const from = labelOrDash(row.from_status);
      const to = labelOrDash(row.to_status);
      const transition = from !== "--" || to !== "--" ? " [" + from + " -> " + to + "]" : "";
      lines.push("- " + formatPHDateTime(row.at) + " | " + timelineTitle(row) + transition + " | Source: " + labelOrDash(row.source) + " | Actor: " + labelOrDash(row.actor));
    }
  }
  lines.push("");

  lines.push("Wallet:");
  lines.push("- Status: " + labelOrDash(booking.wallet_settlement_status));
  lines.push("- Version: " + labelOrDash(booking.wallet_settlement_version));
  lines.push("- Settlement ID: " + labelOrDash(booking.wallet_settlement_id));
  lines.push("- Settled at: " + formatPHDateTime(booking.wallet_settled_at));
  lines.push("- Platform cut: " + formatMoney(ws.amount != null ? Math.abs(Number(ws.amount)) : booking.company_cut));
  lines.push("- Transaction reason: " + labelOrDash(ws.reason));
  lines.push("- Balance after: " + formatMoney(ws.balanceAfter));
  lines.push("");

  lines.push("Diagnostics:");
  const diagnostics = Array.isArray(ticket.diagnostics) ? ticket.diagnostics : [];
  if (!diagnostics.length) {
    lines.push("- No diagnostics returned.");
  } else {
    for (const d of diagnostics) {
      lines.push("- [" + labelOrDash(d.severity).toUpperCase() + "] " + labelOrDash(d.code) + ": " + labelOrDash(d.message));
      const evidence = Array.isArray(d.evidence) ? d.evidence : [];
      for (const ev of evidence) lines.push("  - " + String(ev));
    }
  }

  return lines.join("\n");
}

function tripPriorityScore(t: TripRow): number {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);
  let score = 0;

  if (computeIsProblem(t)) score += 1000;
  if (s === "searching") score += 300;
  if (s === "requested") score += 250;
  if (s === "assigned") score += 180;
  if (s === "accepted") score += 150;
  if (s === "fare_proposed") score += 120;
  if (s === "ready") score += 110;
  if (s === "on_the_way") score += 90;
  if (s === "arrived") score += 70;
  if (s === "on_trip") score += 60;

  if ((s === "searching" || s === "requested") && mins >= 1) score += 80;
  if (!textOrEmpty(t.driver_id) && !textOrEmpty(t.assigned_driver_id) && ["requested", "searching", "assigned"].includes(s)) score += 60;

  return score;
}

function tripPriorityReason(t: TripRow): string | null {
  const s = normStatus(t.status);
  const mins = minutesSince(t.updated_at || t.created_at || null);
  if (computeIsProblem(t)) {
    if (s === "on_the_way" && mins >= STUCK_THRESHOLDS_MIN.on_the_way) return "STUCK > 15m";
    if (s === "on_trip" && mins >= STUCK_THRESHOLDS_MIN.on_trip) return "STUCK > 25m";
    const hasPickup = Number.isFinite(t.pickup_lat as any) && Number.isFinite(t.pickup_lng as any);
    const hasDropoff = Number.isFinite(t.dropoff_lat as any) && Number.isFinite(t.dropoff_lng as any);
    if (!hasPickup || !hasDropoff) return "NO LOCATION DATA";
    return "PROBLEM";
  }
  if ((s === "searching" || s === "requested") && mins >= 1) return "WAITING";
  if (!textOrEmpty(t.driver_id) && !textOrEmpty(t.assigned_driver_id) && ["requested", "searching", "assigned"].includes(s)) return "NO DRIVER";
  return null;
}

function textOrEmpty(v?: any): string {
  return String(v ?? "").trim();
}

function statusPillClass(status: string): string {
  if (["requested", "searching"].includes(status)) return "border-amber-300 bg-amber-50 text-amber-800";
  if (["assigned", "accepted", "fare_proposed", "ready"].includes(status)) return "border-blue-300 bg-blue-50 text-blue-800";
  if (["on_the_way", "arrived", "on_trip"].includes(status)) return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (["completed"].includes(status)) return "border-slate-300 bg-slate-50 text-slate-700";
  if (["cancelled"].includes(status)) return "border-rose-300 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-white text-slate-700";
}

function seenAgoTone(ageSeconds?: number): string {
  if (!Number.isFinite(ageSeconds as number)) return "text-slate-400";
  const age = Number(ageSeconds ?? 0);
  if (age <= 30) return "text-emerald-600 font-medium";
  if (age <= 120) return "text-amber-600 font-medium";
  return "text-rose-600 font-medium";
}

function driverRowTone(d: DriverRow): string {
  if (d.assign_eligible) return "bg-emerald-50/60";
  if (d.is_stale) return "bg-rose-50/50";
  return "bg-amber-50/40";
}

function tripRowTone(t: TripRow): string {
  if (computeIsProblem(t)) return "bg-rose-50/60";
  const s = normStatus(t.status);
  if (["searching", "requested"].includes(s)) return "bg-amber-50/50";
  if (["assigned", "accepted", "fare_proposed", "ready"].includes(s)) return "bg-blue-50/40";
  return "";
}

function normalizeTripRow(t: any): TripRow {
  return {
    ...t,
    booking_code: t?.booking_code ?? t?.bookingCode ?? null,
    pickup_label: t?.pickup_label ?? t?.from_label ?? t?.fromLabel ?? null,
    dropoff_label: t?.dropoff_label ?? t?.to_label ?? t?.toLabel ?? null,
    zone: t?.zone ?? t?.town ?? t?.zone_name ?? null,
    status: t?.status ?? "requested",
  };
}

function shouldKeepTripInLiveTrips(t?: TripRow | null): boolean {
  if (!t) return false;
  const s = normStatus(t.status);
  if (!LIVETRIPS_DISPATCH_STATUSES.includes(s)) return false;
  return true;
}

function filterLiveTrips(rows: TripRow[]): TripRow[] {
  return rows.filter((row) => shouldKeepTripInLiveTrips(normalizeTripRow(row)));
}

function isHistoricalTripFilter(f: FilterKey): boolean {
  return f === "completed" || f === "cancelled";
}

function mergeTripRows(prev: TripRow[], incoming: TripRow): TripRow[] {
  const row = normalizeTripRow(incoming);
  const key = normTripId(row);
  if (!key) return prev;

  const next = prev.slice();
  const idx = next.findIndex((t) => normTripId(t) === key);

  const deleted = String((incoming as any)?._deleted ?? "").toLowerCase() === "true";
  const keep = shouldKeepTripInLiveTrips(row);
  if (deleted || !keep) {
    if (idx >= 0) next.splice(idx, 1);
    return next;
  }

  if (idx >= 0) {
    next[idx] = { ...next[idx], ...row };
  } else {
    next.unshift(row);
  }

  next.sort((a, b) => {
    const ta = new Date(a.updated_at || a.created_at || (0 as any)).getTime() || 0;
    const tb = new Date(b.updated_at || b.created_at || (0 as any)).getTime() || 0;
    return tb - ta;
  });

  return next;
}

function mergeDriverRows(prev: DriverRow[], incoming: DriverRow): DriverRow[] {
  const id = String(incoming?.driver_id || "");
  if (!id) return prev;

  const next = prev.slice();
  const idx = next.findIndex((d) => String(d.driver_id || "") === id);

  if (idx >= 0) {
    next[idx] = { ...next[idx], ...incoming };
  } else {
    next.unshift(incoming);
  }

  next.sort((a, b) => {
    const au = new Date(a.updated_at || "").getTime() || 0;
    const bu = new Date(b.updated_at || "").getTime() || 0;
    return bu - au;
  });

  return next;
}

export default function LiveTripsClient() {
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [allTrips, setAllTrips] = useState<TripRow[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("dispatch");
  const [tripFilter, setTripFilter] = useState<FilterKey>("dispatch");
  const [lastAction, setLastAction] = useState<string>("");

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [driversDebug, setDriversDebug] = useState<string>("not loaded yet");

  const [manualDriverId, setManualDriverId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [townFilter, setTownFilter] = useState<string>("all");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("today");
  const [ticketQuery, setTicketQuery] = useState<string>("");
  const [ticketInspector, setTicketInspector] = useState<TicketInspectorResponse | null>(null);
  const [ticketInspectorOpen, setTicketInspectorOpen] = useState<boolean>(false);
  const [ticketInspectorLoading, setTicketInspectorLoading] = useState<boolean>(false);
  const [ticketInspectorError, setTicketInspectorError] = useState<string>("");
  const [ticketInspectorTab, setTicketInspectorTab] = useState<TicketInspectorTab>("overview");

  const tableRef = useRef<HTMLDivElement | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshAllRef = useRef<((source?: string) => Promise<void>) | null>(null);
  const supabaseRef = useRef<SupabaseClient | null>(null);
  const channelsRef = useRef<RealtimeChannel[]>([]);

  const loadPage = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("debug", "1");
    params.set("t", String(Date.now()));
    if (isHistoricalTripFilter(tripFilter)) {
      params.set("history", tripFilter);
      params.set("range", historyRange);
    }

    const r = await fetch("/api/admin/livetrips/page-data?" + params.toString(), {
      cache: "no-store",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });
    const j: PageData = await r.json().catch(() => ({} as any));

    const z = safeArray<ZoneRow>(j.zones);
    const rawTrips = parseTripsFromPageData(j).map(normalizeTripRow);
    const trips = isHistoricalTripFilter(tripFilter) ? rawTrips : filterLiveTrips(rawTrips);

    setZones(z);
    setAllTrips(trips);

    const ids = new Set(trips.map(normTripId).filter(Boolean));
    if (selectedTripId && !ids.has(selectedTripId)) {
      setSelectedTripId(null);
    }
  }, [selectedTripId, tripFilter, historyRange]);

  const loadDrivers = useCallback(async () => {
    const ts = Date.now();
    const endpoints = [
      "/api/admin/driver_locations?t=" + ts,
      "/api/admin/driver-locations?t=" + ts,
      "/api/admin/drivers?t=" + ts,
      "/api/driver_locations?t=" + ts,
      "/api/driver-locations?t=" + ts,
    ];

    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          cache: "no-store",
          headers: {
            "Cache-Control": "no-cache",
            Pragma: "no-cache",
          },
        });
        if (!r.ok) continue;
        const j = await r.json().catch(() => ({} as any));

        const arr = parseDriversFromPayload(j);

        if (Array.isArray(arr) && arr.length) {
          setDrivers(arr);
          setDriversDebug("loaded from " + url.split("?")[0] + " (" + arr.length + ")");
          return;
        }
      } catch {
      }
    }

    setDrivers([]);
    setDriversDebug("No drivers loaded from known endpoints (check RLS / endpoint path).");
  }, []);

  const refreshAll = useCallback(async (source?: string) => {
    try {
      await Promise.all([loadPage(), loadDrivers()]);
      if (source) setLastAction("Refreshed via " + source);
    } catch (e: any) {
      if (source) setLastAction("Refresh failed via " + source + ": " + (e?.message ?? "unknown"));
    }
  }, [loadPage, loadDrivers]);

  useEffect(() => {
    refreshAllRef.current = refreshAll;
  }, [refreshAll]);

  useEffect(() => {
    refreshAllRef.current?.("initial").catch(() => {});
  }, []);

  useEffect(() => {
    refreshAllRef.current?.("filter").catch(() => {});
  }, [tripFilter, historyRange]);

  useEffect(() => {
    const clearTimer = () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };

    const schedule = () => {
      clearTimer();
      const ms = document.visibilityState === "visible" ? POLL_MS_FOREGROUND : POLL_MS_BACKGROUND;
      pollTimerRef.current = setTimeout(async () => {
        await refreshAllRef.current?.("poll");
        schedule();
      }, ms);
    };

    const onVisibilityChange = () => {
      schedule();
    };

    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearTimer();
    };
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anon) {
      setLastAction("Realtime skipped: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
      return;
    }

    const supabase = createClient(url, anon, {
      realtime: {
        params: {
          eventsPerSecond: 2,
        },
      },
    });

    supabaseRef.current = supabase;

    const channelDrivers = supabase
      .channel("livetrips-driver_locations-localstate")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        (payload) => {
          const row = (payload as any)?.new;
          if (!row || !row.driver_id) return;

          setDrivers((prev) =>
            mergeDriverRows(prev, {
              driver_id: String(row.driver_id || ""),
              lat: row.lat,
              lng: row.lng,
              status: row.status,
              updated_at: row.updated_at,
            })
          );

          setDriversDebug("realtime driver_locations");
          setLastAction("Realtime driver_locations");
        }
      )
      .subscribe();

    const channelBookings = supabase
      .channel("livetrips-bookings-localstate")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        (payload) => {
          const eventType = String((payload as any)?.eventType || "");
          const row = (payload as any)?.new || (payload as any)?.old;
          if (!row) return;

          const patch: any = { ...row };
          if (eventType === "DELETE") {
            patch._deleted = true;
          }

          setAllTrips((prev) => mergeTripRows(prev, patch));
          setLastAction("Realtime bookings");
        }
      )
      .subscribe();

    channelsRef.current = [channelDrivers, channelBookings];
    setLastAction("Realtime local-state subscribed");

    return () => {
      for (const ch of channelsRef.current) {
        try {
          supabase.removeChannel(ch);
        } catch {
        }
      }
      channelsRef.current = [];
      supabaseRef.current = null;
    };
  }, []);

  const stuckTripIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of allTrips) {
      if (computeIsProblem(t)) {
        const id = normTripId(t);
        if (id) s.add(id);
      }
    }
    return s;
  }, [allTrips]);

  const counts = useMemo(() => {
    const c = {
      all: allTrips.length,
      dispatch: 0,
      pending: 0,
      active: 0,
      requested: 0,
      searching: 0,
      assigned: 0,
      accepted: 0,
      fare_proposed: 0,
      ready: 0,
      on_the_way: 0,
      arrived: 0,
      on_trip: 0,
      completed: 0,
      cancelled: 0,
      problem: 0,
    };

    for (const t of allTrips) {
      const s = normStatus(t.status);

      if (s === "requested") c.requested++;
      if (s === "searching") c.searching++;
      if (s === "assigned") c.assigned++;
      if (s === "accepted") c.accepted++;
      if (s === "fare_proposed") c.fare_proposed++;
      if (s === "ready") c.ready++;
      if (s === "on_the_way") c.on_the_way++;
      if (s === "arrived") c.arrived++;
      if (s === "on_trip") c.on_trip++;
      if (s === "completed") c.completed++;
      if (s === "cancelled") c.cancelled++;

      if (LIVETRIPS_PENDING_STATUSES.includes(s)) c.pending++;
      if (LIVETRIPS_ACTIVE_STATUSES.includes(s)) c.active++;
      if (LIVETRIPS_DISPATCH_STATUSES.includes(s)) c.dispatch++;

      if (computeIsProblem(t)) c.problem++;
    }

    return c;
  }, [allTrips]);

  const dispatchPressure = useMemo(() => {
    const driversReady = drivers.filter((d) => Boolean(d.assign_eligible)).length;
    const searchingTrips = allTrips.filter((t) => ["requested", "searching"].includes(normStatus(t.status))).length;
    const activeTrips = allTrips.filter((t) => LIVETRIPS_ACTIVE_STATUSES.includes(normStatus(t.status))).length;
    const demandPressure = searchingTrips + activeTrips;
    let coverageLabel = "LOW";
    let coverageTone = "bg-rose-50 text-rose-700 border-rose-200";

    if (driversReady >= 6 && driversReady >= demandPressure + 2) {
      coverageLabel = "HEALTHY";
      coverageTone = "bg-emerald-50 text-emerald-700 border-emerald-200";
    } else if (driversReady >= 4) {
      coverageLabel = "OK";
      coverageTone = "bg-sky-50 text-sky-700 border-sky-200";
    } else if (driversReady >= 2) {
      coverageLabel = "FRAGILE";
      coverageTone = "bg-amber-50 text-amber-700 border-amber-200";
    }

    return {
      pending: searchingTrips,
      active: activeTrips,
      driversReady,
      coverageLabel,
      coverageTone,
    };
  }, [allTrips, drivers]);

  const townOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of allTrips) {
      const town = String(t.town || t.zone || "").trim();
      if (town) set.add(town);
    }
    for (const d of drivers) {
      const town = String(d.town || "").trim();
      if (town) set.add(town);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allTrips, drivers]);

  const queryNeedle = searchQuery.trim().toLowerCase();

  const visibleTrips = useMemo(() => {
    const f = tripFilter;
    let out: TripRow[] = [];

    if (f === "all") {
      out = allTrips.slice();
    } else if (f === "dispatch") {
      out = allTrips.filter((t) => LIVETRIPS_DISPATCH_STATUSES.includes(normStatus(t.status)));
    } else if (f === "pending") {
      out = allTrips.filter((t) => LIVETRIPS_PENDING_STATUSES.includes(normStatus(t.status)));
    } else if (f === "active") {
      out = allTrips.filter((t) => LIVETRIPS_ACTIVE_STATUSES.includes(normStatus(t.status)));
    } else if (f === "problem") {
      out = allTrips.filter((t) => stuckTripIds.has(normTripId(t)));
    } else {
      out = allTrips.filter((t) => normStatus(t.status) === f);
    }

    out = out.filter((trip) => {
      const town = String(trip.town || trip.zone || "").trim();
      if (townFilter !== "all" && town.toLowerCase() !== townFilter.toLowerCase()) return false;
      if (!queryNeedle) return true;
      const hay = [
        trip.booking_code,
        trip.passenger_name,
        trip.pickup_label,
        trip.dropoff_label,
        trip.driver_name,
        trip.driver_phone,
        town,
        trip.status,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(queryNeedle);
    });

    out.sort((a, b) => {
      const pa = tripPriorityScore(a);
      const pb = tripPriorityScore(b);
      if (pb !== pa) return pb - pa;

      const ta = new Date(a.updated_at || a.created_at || (0 as any)).getTime() || 0;
      const tb = new Date(b.updated_at || b.created_at || (0 as any)).getTime() || 0;
      return tb - ta;
    });

    return out;
  }, [allTrips, tripFilter, stuckTripIds, townFilter, queryNeedle]);

  const mapTrips = useMemo(() => {
    if (viewMode === "drivers") {
      return selectedTripId
        ? allTrips.filter((t) => normTripId(t) === selectedTripId)
        : visibleTrips.slice(0, 50);
    }
    return visibleTrips;
  }, [viewMode, allTrips, visibleTrips, selectedTripId]);

  useEffect(() => {
    if (viewMode === "drivers") return;

    if (!visibleTrips.length) {
      if (selectedTripId !== null) setSelectedTripId(null);
      return;
    }

    const ids = new Set(visibleTrips.map(normTripId).filter(Boolean));
    if (!selectedTripId || !ids.has(selectedTripId)) {
      setSelectedTripId(normTripId(visibleTrips[0]));
    }
  }, [visibleTrips, selectedTripId, viewMode]);

  const selectedTrip = useMemo(() => {
    if (!selectedTripId) return null;
    return allTrips.find((t) => normTripId(t) === selectedTripId) || null;
  }, [allTrips, selectedTripId]);

  const selectedManualDriver = useMemo(() => {
    return drivers.find((d) => String(d.driver_id || "") === manualDriverId) || null;
  }, [drivers, manualDriverId]);


  const selectedTripTown = useMemo(() => {
    return String(selectedTrip?.town || selectedTrip?.zone || "").trim().toLowerCase();
  }, [selectedTrip]);

  const selectedManualDriverTown = useMemo(() => {
    return String(selectedManualDriver?.town || "").trim().toLowerCase();
  }, [selectedManualDriver]);

  const manualAssignRequiresEmergency = useMemo(() => {
    if (!selectedTripTown || !selectedManualDriverTown) return false;
    return selectedTripTown !== selectedManualDriverTown;
  }, [selectedTripTown, selectedManualDriverTown]);

  useEffect(() => {
    if (!selectedManualDriver) return;
    if (selectedManualDriver.assign_eligible) return;
    setManualDriverId("");
  }, [selectedManualDriver]);

  const eligibleDrivers = useMemo(() => {
    return drivers.filter((d) => Boolean(d.assign_eligible));
  }, [drivers]);

  const driverRows = useMemo(() => {
  return drivers
    
    .map((d, idx) => {
        const driverId = String(d.driver_id || "");
        const driverTrips = allTrips.filter((t) => String(t.assigned_driver_id || t.driver_id || "") === driverId);
        const activeTrip = driverTrips.find((t) => {
          const s = normStatus(t.status);
          return LIVETRIPS_DISPATCH_STATUSES.includes(s);
        }) || null;

        return {
          key: driverId || String(idx),
          driver: d,
          tripCount: driverTrips.length,
          activeTrip,
        };
      })
      .sort((a, b) => {
        const ae = a.driver.assign_eligible ? 1 : 0;
        const be = b.driver.assign_eligible ? 1 : 0;
        if (be !== ae) return be - ae;

        const au = new Date(a.driver.updated_at || "").getTime() || 0;
        const bu = new Date(b.driver.updated_at || "").getTime() || 0;
        return bu - au;
      });
  }, [drivers, allTrips]);

  const filteredDriverRows = useMemo(() => {
    return driverRows.filter((row) => {
      const town = String(row.driver.town || "").trim();
      if (townFilter !== "all" && town.toLowerCase() !== townFilter.toLowerCase()) return false;
      if (!queryNeedle) return true;
      const hay = [
        row.driver.name,
        row.driver.phone,
        row.driver.town,
        row.driver.status,
        row.driver.effective_status,
        row.activeTrip?.booking_code,
      ]
        .map((v) => String(v || "").toLowerCase())
        .join(" ");
      return hay.includes(queryNeedle);
    });
  }, [driverRows, townFilter, queryNeedle]);

  function pillClass(active: boolean) {
    return [
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
      active ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
    ].join(" ");
  }

  function setFilterAndFocus(f: FilterKey) {
    setTripFilter(f);
    setTimeout(() => {
      if (tableRef.current) {
        tableRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 0);
  }

  function setModeAndFocus(mode: ViewMode) {
    setViewMode(mode);
    if (mode === "dispatch") {
      setTripFilter("dispatch");
    } else if (mode === "trips") {
      setTripFilter("pending");
    }
    setTimeout(() => {
      if (tableRef.current) {
        tableRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 0);
  }

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j && (j.error || j.message)) || "REQUEST_FAILED";
      throw new Error(msg);
    }
    return j;
  }

  async function assignDriver(bookingCode: string, driverId: string, emergencyMode?: boolean) {
    if (!bookingCode || !driverId) return;
    setLastAction(emergencyMode ? "Emergency assigning..." : "Assigning...");
    const result = await postJson("/api/dispatch/assign", {
      bookingCode,
      driverId,
      emergency_mode: emergencyMode === true,
    });
    setLastAction(result?.emergency_mode ? "Assigned via emergency" : "Assigned");
    await refreshAll("assign");
  }

  async function updateTripStatus(bookingCode: string, status: string) {
    if (!bookingCode || !status) return;
    setLastAction("Setting " + bookingCode + " -> " + status + "...");
    await postJson("/api/dispatch/status", { bookingCode, status });
    setLastAction("Status -> " + status);
    await loadPage();
  }

  async function emergencyAssignNearest(bookingCode: string) {
    if (!bookingCode) return;
    setLastAction("Emergency assigning nearest eligible driver...");
    const result = await postJson("/api/dispatch/assign", {
      bookingCode,
      emergency_mode: true,
    });
    setLastAction(result?.driver_id ? "Emergency assigned" : "Emergency assign requested");
    await refreshAll("emergency");
  }

  async function loadTicketInspector(queryOverride?: string) {
    const q = String(queryOverride ?? ticketQuery).trim();
    if (!q) {
      setTicketInspectorError("Enter a JR-UI or TO ticket code.");
      return;
    }

    setTicketInspectorLoading(true);
    setTicketInspectorError("");
    setTicketInspectorOpen(true);
    setTicketInspectorTab("overview");

    try {
      const r = await fetch("/api/admin/livetrips/ticket-inspector?q=" + encodeURIComponent(q), {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });
      const j: TicketInspectorResponse = await r.json().catch(() => ({} as any));
      if (!r.ok || j?.ok === false) {
        throw new Error(j?.message || j?.error || "Ticket inspector lookup failed");
      }
      setTicketInspector(j);
      setTicketQuery(String(j?.booking?.booking_code || q));
      setLastAction("Ticket inspected: " + String(j?.booking?.booking_code || q));
    } catch (e: any) {
      setTicketInspector(null);
      setTicketInspectorError(String(e?.message || e));
      setLastAction("Ticket inspector failed");
    } finally {
      setTicketInspectorLoading(false);
    }
  }

  const zoneStats = useMemo(() => {
    const out: Record<string, { util: number; status: string }> = {};
    for (const z of zones) {
      const key = String(z.zone_name || z.zone_id || "Unknown");
      const active = Number(z.active_drivers ?? 0);
      const cap = Number(z.capacity_limit ?? 0);
      const util = cap > 0 ? active / cap : 0;
      out[key] = {
        util,
        status: String(z.status || (util >= 1 ? "FULL" : util >= 0.8 ? "WARN" : "OK")).toUpperCase(),
      };
    }
    return out;
  }, [zones]);

  const selectedTripForSuggestions = useMemo(() => {
    if (!selectedTrip) return null;
    return {
      id: normTripId(selectedTrip),
      pickupLat: Number(selectedTrip.pickup_lat ?? 0),
      pickupLng: Number(selectedTrip.pickup_lng ?? 0),
      zone: String(selectedTrip.zone || selectedTrip.town || "Unknown"),
      tripType: String((selectedTrip as any).trip_type || (selectedTrip as any).service_type || "ride"),
    };
  }, [selectedTrip]);

  const showThresholds = "Stuck watcher thresholds: on_the_way >= " + STUCK_THRESHOLDS_MIN.on_the_way + " min, on_trip >= " + STUCK_THRESHOLDS_MIN.on_trip + " min";

  return (
    <div className="min-h-screen bg-slate-50 p-4 text-slate-900 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">LiveTrips Command Center</h1>
          <p className="mt-1 text-sm text-slate-600">Premium dispatch workspace for trip cycle monitoring, driver readiness, and rapid incident response without touching backend trip rules.</p>
        </div>
        <div className="text-xs text-gray-600 text-right">
          <div className="font-medium">Stuck watcher thresholds</div>
          <div>{"on_the_way >= " + STUCK_THRESHOLDS_MIN.on_the_way + " min, on_trip >= " + STUCK_THRESHOLDS_MIN.on_trip + " min"}</div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button className={pillClass(viewMode === "trips")} onClick={() => setModeAndFocus("trips")}>
          Trips <span className="text-xs opacity-80">{counts.all}</span>
        </button>
        <button className={pillClass(viewMode === "drivers")} onClick={() => setModeAndFocus("drivers")}>
          Drivers <span className="text-xs opacity-80">{drivers.length}</span>
        </button>
        <button className={pillClass(viewMode === "dispatch")} onClick={() => setModeAndFocus("dispatch")}>
          Dispatch <span className="text-xs opacity-80">{counts.dispatch}</span>
        </button>

        <div className="ml-auto text-xs text-gray-600 self-center">
          {lastAction ? <span>Last action: {lastAction}</span> : <span>&nbsp;</span>}
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Find faster</div>
            <div className="text-xs text-slate-500">Search booking code, passenger, driver, phone, or town. All timestamps stay on Philippine time.</div>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(280px,1fr),200px,auto]">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search booking / passenger / driver / phone"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-400 focus:bg-white"
            />
            <select
              value={townFilter}
              onChange={(e) => setTownFilter(e.target.value)}
              className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-400 focus:bg-white"
            >
              <option value="all">All towns</option>
              {townOptions.map((town) => (
                <option key={town} value={town}>{town}</option>
              ))}
            </select>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              onClick={() => { setSearchQuery(""); setTownFilter("all"); setHistoryRange("today"); }}
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-900">Search Ticket</div>
            <div className="text-xs text-slate-500">Open the forensic drawer for JR-UI or TO tickets using confirmed audit sources.</div>
          </div>
          <form
            className="grid gap-3 md:grid-cols-[minmax(280px,1fr),auto]"
            onSubmit={(e) => {
              e.preventDefault();
              loadTicketInspector().catch((err) => setTicketInspectorError(String(err?.message || err)));
            }}
          >
            <input
              value={ticketQuery}
              onChange={(e) => setTicketQuery(e.target.value)}
              placeholder="JR-UI-... or TO-..."
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm outline-none transition focus:border-emerald-400 focus:bg-white"
            />
            <button
              type="submit"
              className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
              disabled={ticketInspectorLoading}
            >
              {ticketInspectorLoading ? "Searching..." : "Open Inspector"}
            </button>
          </form>
        </div>
        {ticketInspectorError ? (
          <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {ticketInspectorError}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">Pending</div>
          <div className="text-lg font-bold text-amber-900">{dispatchPressure.pending}</div>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Active</div>
          <div className="text-lg font-bold text-emerald-900">{dispatchPressure.active}</div>
        </div>
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700">Drivers ready</div>
          <div className="text-lg font-bold text-sky-900">{dispatchPressure.driversReady}</div>
        </div>
        <div className={["rounded-lg border px-3 py-2", dispatchPressure.coverageTone].join(" ")}>
          <div className="text-[10px] font-semibold uppercase tracking-wide">Coverage</div>
          <div className="text-lg font-bold">{dispatchPressure.coverageLabel}</div>
        </div>
      </div>

      {viewMode !== "drivers" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {viewMode === "trips" ? (
            <>
              <button className={pillClass(tripFilter === "pending")} onClick={() => setFilterAndFocus("pending")}>
                Pending tickets <span className="text-xs opacity-80">{counts.pending}</span>
              </button>
              <button className={pillClass(tripFilter === "active")} onClick={() => setFilterAndFocus("active")}>
                Active trips <span className="text-xs opacity-80">{counts.active}</span>
              </button>
              <button className={pillClass(tripFilter === "all")} onClick={() => setFilterAndFocus("all")}>
                All trips <span className="text-xs opacity-80">{counts.all}</span>
              </button>
            </>
          ) : null}

          <button className={pillClass(tripFilter === "requested")} onClick={() => setFilterAndFocus("requested")}>
            Requested <span className="text-xs opacity-80">{counts.requested}</span>
          </button>
          <button className={pillClass(tripFilter === "searching")} onClick={() => setFilterAndFocus("searching")}>
            Searching <span className="text-xs opacity-80">{counts.searching}</span>
          </button>
          <button className={pillClass(tripFilter === "assigned")} onClick={() => setFilterAndFocus("assigned")}>
            Assigned <span className="text-xs opacity-80">{counts.assigned}</span>
          </button>
          <button className={pillClass(tripFilter === "accepted")} onClick={() => setFilterAndFocus("accepted")}>
            Accepted <span className="text-xs opacity-80">{counts.accepted}</span>
          </button>
          <button className={pillClass(tripFilter === "fare_proposed")} onClick={() => setFilterAndFocus("fare_proposed")}>
            Fare proposed <span className="text-xs opacity-80">{counts.fare_proposed}</span>
          </button>
          <button className={pillClass(tripFilter === "ready")} onClick={() => setFilterAndFocus("ready")}>
            Ready <span className="text-xs opacity-80">{counts.ready}</span>
          </button>
          <button className={pillClass(tripFilter === "on_the_way")} onClick={() => setFilterAndFocus("on_the_way")}>
            On the way <span className="text-xs opacity-80">{counts.on_the_way}</span>
          </button>
          <button className={pillClass(tripFilter === "arrived")} onClick={() => setFilterAndFocus("arrived")}>
            Arrived <span className="text-xs opacity-80">{counts.arrived}</span>
          </button>
          <button className={pillClass(tripFilter === "on_trip")} onClick={() => setFilterAndFocus("on_trip")}>
            On trip <span className="text-xs opacity-80">{counts.on_trip}</span>
          </button>
          <button className={pillClass(tripFilter === "completed")} onClick={() => setFilterAndFocus("completed")}>
            Completed <span className="text-xs opacity-80">{counts.completed}</span>
          </button>
          <button className={pillClass(tripFilter === "cancelled")} onClick={() => setFilterAndFocus("cancelled")}>
            Cancelled <span className="text-xs opacity-80">{counts.cancelled}</span>
          </button>
          {isHistoricalTripFilter(tripFilter) ? (
            <select
              value={historyRange}
              onChange={(e) => setHistoryRange(e.target.value as HistoryRange)}
              className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700 outline-none hover:bg-slate-50"
              title="Historical range uses Philippine time"
            >
              <option value="today">Today</option>
              <option value="week">This week</option>
              <option value="month">This month</option>
            </select>
          ) : null}
          <button
            className={[
              pillClass(tripFilter === "problem"),
              tripFilter === "problem" ? "" : "border-red-300 text-red-700 hover:bg-red-50",
            ].join(" ")}
            onClick={() => setFilterAndFocus("problem")}
            title={showThresholds}
          >
            Problem trips <span className="text-xs opacity-80">{counts.problem}</span>
          </button>
        </div>
      ) : null}

      <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        {zones.map((z) => (
          <div key={z.zone_id} className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{z.zone_name}</div>
              <div className="text-xs text-gray-600">{z.status || "-"}</div>
            </div>
            <div className="text-xs text-gray-600">
              Active: {z.active_drivers ?? 0} / Limit: {z.capacity_limit ?? "-"}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr,0.95fr]" ref={tableRef}>
        <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50/80 p-4">
            <div className="font-semibold">
              {viewMode === "drivers"
                ? "Drivers view"
                : viewMode === "trips"
                ? "Trips view"
                : tripFilter === "completed"
                ? "Completed trips"
                : tripFilter === "cancelled"
                ? "Cancelled trips"
                : tripFilter === "problem"
                ? "Problem trips"
                : "Dispatch view (Requested + Searching + Assigned + Accepted + Fare proposed + Ready + On the way + Arrived + On trip)"}
            </div>
            <div className="text-xs text-gray-600">
              {viewMode === "drivers" ? (filteredDriverRows.length + " shown") : (visibleTrips.length + " shown")}
            </div>
          </div>

          {viewMode === "drivers" ? (
            <div className="overflow-auto" style={{ maxHeight: 420 }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-white/95 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-2">Driver</th>
                    <th className="p-2">Phone</th>
                    <th className="p-2">Town</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Trips</th>
                    <th className="p-2">Last Ping (PHT)</th>
                    <th className="p-2">Seen Ago</th>
                    <th className="p-2">Eligible</th>
                    <th className="p-2">Stale</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDriverRows.length === 0 ? (
                    <tr>
                      <td className="p-3 text-gray-600" colSpan={9}>
                        No drivers in this view.
                      </td>
                    </tr>
                  ) : (
                    filteredDriverRows.map((row) => {
                      const d = row.driver;
                      const trip = row.activeTrip;
                      const isSel = trip ? selectedTripId === normTripId(trip) : false;

                      return (
                        <tr
                          key={row.key}
                          className={[
                            "border-b",
                            driverRowTone(d),
                            trip ? "cursor-pointer hover:bg-gray-50" : "",
                            isSel ? "ring-1 ring-inset ring-blue-300" : "",
                          ].join(" ")}
                          onClick={() => {
                            if (trip) {
                              setSelectedTripId(normTripId(trip));
                            }
                          }}
                        >
                          <td className="p-2 font-medium">{labelOrDash(d.name)}</td>
                          <td className="p-2">{labelOrDash(d.phone)}</td>
                          <td className="p-2">{labelOrDash(d.town)}</td>
                          <td className="p-2"><span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", statusPillClass(normStatus((d as any).effective_status ?? d.status))].join(" ")}>{labelOrDash((d as any).effective_status ?? d.status)}</span></td>
                          <td className="p-2">
                            {trip ? (
                              <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs">
                                {labelOrDash(trip.booking_code)} / {labelOrDash(trip.status)}
                              </span>
                            ) : (
                              <span className="text-gray-500">No active trip</span>
                            )}
                          </td>
                          <td className="p-2">{labelOrDash((d as any).updated_at_ph || formatLastSeen(d.age_seconds))}</td>
                          <td className={["p-2", seenAgoTone(d.age_seconds)].join(" ")}>{formatLastSeen(d.age_seconds)}</td>
                          <td className="p-2">
                            {(d as any).assign_eligible
                              ? <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">READY</span>
                              : <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">BLOCKED</span>}
                          </td>
                          <td className="p-2">
                            {(d as any).is_stale
                              ? <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">STALE</span>
                              : <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">FRESH</span>}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-auto" style={{ maxHeight: 420 }}>
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b border-slate-200 bg-white/95 backdrop-blur">
                  <tr className="text-left">
                    <th className="p-2">Code</th>
                    <th className="p-2">Passenger</th>
                    <th className="p-2">Pickup</th>
                    <th className="p-2">Dropoff</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Zone</th>
                    <th className="p-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleTrips.length === 0 ? (
                    <tr>
                      <td className="p-3 text-gray-600" colSpan={7}>
                        No trips in this view.
                      </td>
                    </tr>
                  ) : (
                    visibleTrips.map((t, idx) => {
                      const id = normTripId(t);
                      const rowKey = id || ("trip-row-" + String(idx));
                      const isSel = selectedTripId === id;
                      const isProblem = stuckTripIds.has(id);
                      const s = normStatus(t.status);

                      return (
                        <tr
                          key={rowKey}
                          className={[
                            "border-b cursor-pointer",
                            tripRowTone(t),
                            isSel ? "ring-1 ring-inset ring-blue-300" : "hover:bg-gray-50",
                          ].join(" ")}
                          onClick={() => setSelectedTripId(id)}
                        >
                          <td className="p-2 font-medium">
                            {t.booking_code || "-"}
                            {tripPriorityReason(t) ? (
                              <span className="ml-2 inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                                {tripPriorityReason(t)}
                              </span>
                            ) : null}
                          </td>
                          <td className="p-2">{t.passenger_name || "-"}</td>
                          <td className="p-2">{t.pickup_label || "-"}</td>
                          <td className="p-2">{t.dropoff_label || "-"}</td>
                          <td className="p-2">
                            <span className={["inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", statusPillClass(s)].join(" ")}>
                              {s || "-"}
                            </span>
                          </td>
                          <td className="p-2">{t.zone || t.town || "-"}</td>
                          <td className="p-2">
                            {s === "completed" || s === "cancelled" ? (
                              <span className="text-xs text-slate-400">Read-only</span>
                            ) : (
                              <div className="flex flex-wrap gap-2 items-center">
                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!t.booking_code) return;
                                    updateTripStatus(t.booking_code, "on_the_way").catch((err) => setLastAction(String(err?.message || err)));
                                  }}
                                  disabled={s !== "assigned"}
                                  title={s !== "assigned" ? "Allowed only when status=assigned" : "Mark on_the_way"}
                                >
                                  On the way
                                </button>

                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!t.booking_code) return;
                                    updateTripStatus(t.booking_code, "on_trip").catch((err) => setLastAction(String(err?.message || err)));
                                  }}
                                  disabled={s !== "on_the_way"}
                                  title={s !== "on_the_way" ? "Allowed only when status=on_the_way" : "Start trip"}
                                >
                                  Start trip
                                </button>

                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (!t.booking_code) return;
                                    updateTripStatus(t.booking_code, "completed").catch((err) => setLastAction(String(err?.message || err)));
                                  }}
                                  disabled={s !== "on_trip"}
                                  title={s !== "on_trip" ? "Allowed only when status=on_trip" : "Complete trip"}
                                >
                                  Drop off
                                </button>

                                <button
                                  className="rounded border px-2 py-1 text-xs hover:bg-gray-50"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedTripId(id);
                                    setTripFilter("problem");
                                    setViewMode("dispatch");
                                  }}
                                  title="Focus Problem trips view"
                                >
                                  Find problem
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          <div className="p-3 border-t">
            <div className="text-xs text-gray-600 mb-2">
              Drivers: {driversDebug}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="font-semibold mb-2">Trip details</div>
                {!selectedTrip ? (
                  <div className="text-sm text-gray-500">Select a trip to view details.</div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <div><span className="text-gray-500">Code:</span> <span className="font-medium">{labelOrDash(selectedTrip.booking_code)}</span></div>
                    <div><span className="text-gray-500">Passenger:</span> <span className="font-medium">{labelOrDash(selectedTrip.passenger_name)}</span></div>
                    <div><span className="text-gray-500">Pickup:</span> <span className="font-medium">{labelOrDash(selectedTrip.pickup_label)}</span></div>
                    <div><span className="text-gray-500">Dropoff:</span> <span className="font-medium">{labelOrDash(selectedTrip.dropoff_label)}</span></div>
                    <div><span className="text-gray-500">Status:</span> <span className="font-medium">{labelOrDash(selectedTrip.status)}</span></div>
                    <div><span className="text-gray-500">Town:</span> <span className="font-medium">{labelOrDash(selectedTrip.town || selectedTrip.zone)}</span></div>
                    <div><span className="text-gray-500">Updated:</span> <span className="font-medium">{formatPHDateTime(selectedTrip.updated_at)}</span></div>
                    {selectedTrip.booking_code ? (
                      <button
                        className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        onClick={() => {
                          const code = String(selectedTrip.booking_code || "");
                          setTicketQuery(code);
                          loadTicketInspector(code).catch((err) => setTicketInspectorError(String(err?.message || err)));
                        }}
                      >
                        Open Ticket Inspector
                      </button>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="font-semibold mb-2">Driver details</div>
                {!selectedTrip ? (
                  <div className="text-sm text-gray-500">Select a trip to view driver details.</div>
                ) : (
                  <div className="space-y-1 text-sm">
                    <div><span className="text-gray-500">Driver ID:</span> <span className="font-medium break-all">{labelOrDash(selectedTrip.driver_id || selectedTrip.assigned_driver_id)}</span></div>
                    <div><span className="text-gray-500">Name:</span> <span className="font-medium">{labelOrDash(selectedTrip.driver_name)}</span></div>
                    <div><span className="text-gray-500">Phone:</span> <span className="font-medium">{labelOrDash(selectedTrip.driver_phone)}</span></div>
                    <div><span className="text-gray-500">Driver status:</span> <span className="font-medium">{labelOrDash(selectedTrip.driver_status)}</span></div>
                    <div><span className="text-gray-500">TODA:</span> <span className="font-medium">{labelOrDash(selectedTrip.toda_name)}</span></div>
                    <div><span className="text-gray-500">Zone ID:</span> <span className="font-medium">{labelOrDash(selectedTrip.zone_id)}</span></div>
                  </div>
                )}
              </div>

              <TripWalletPanel trip={selectedTrip as any} />
              <TripLifecycleActions trip={selectedTrip as any} />
            </div>

            <div className="mt-4 rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
              <div className="font-semibold mb-2">Assign driver (manual)</div>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  className="border rounded px-2 py-1 text-sm min-w-[320px]"
                  value={manualDriverId}
                  onChange={(e) => setManualDriverId(e.target.value)}
                >
                  <option value="">Select eligible driver</option>
                  {drivers.map((d, idx) => {
                    const id = String(d.driver_id || "");
                    const isEligible = Boolean(d.assign_eligible);
                    const label = ((d.name || "Driver") + (d.town ? " - " + d.town : "") + ((d as any).effective_status ? " - " + (d as any).effective_status : "") + (isEligible ? "" : " - NOT ELIGIBLE")).trim();

                    return (
                      <option key={id || String(idx)} value={id} disabled={!isEligible}>
                        {label}
                      </option>
                    );
                  })}
                </select>

                <button
                  className="rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-50"
                  disabled={!selectedTrip?.booking_code || !manualDriverId || !selectedManualDriver?.assign_eligible}
                  onClick={() => {
                    if (!selectedTrip?.booking_code || !selectedManualDriver?.assign_eligible) return;
                    assignDriver(selectedTrip.booking_code, manualDriverId, manualAssignRequiresEmergency).catch((err) => setLastAction(String(err?.message || err)));
                  }}
                >
                  {manualAssignRequiresEmergency ? "Emergency assign" : "Assign"}
                </button>

                <button
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  onClick={() => {
                    refreshAll("manual").catch(() => {});
                  }}
                >
                  Refresh now
                </button>
              </div>

              <div className="mt-2 text-[11px] text-slate-500 space-y-1">
                <div>Manual assignment only allows drivers with assign_eligible = Yes.</div>
                {selectedTrip && selectedManualDriver ? (
                  <div>
                    Trip town: <span className="font-semibold">{labelOrDash(selectedTrip.town || selectedTrip.zone)}</span>
                    {" | "}
                    Driver town: <span className="font-semibold">{labelOrDash(selectedManualDriver.town)}</span>
                    {manualAssignRequiresEmergency ? " | Cross-town will use emergency mode." : " | Same-town standard assign."}
                  </div>
                ) : null}
              </div>

              <div className="mt-2">
                <SmartAutoAssignSuggestions
                  trip={selectedTripForSuggestions as any}
                  drivers={eligibleDrivers.map((d) => ({
                    id: String(d.driver_id || ""),
                    name: String(d.name || "Driver"),
                    lat: Number(d.lat ?? 0),
                    lng: Number(d.lng ?? 0),
                    zone: String(d.town || "Unknown"),
                    homeTown: String(d.town || "Unknown"),
                    status: String((d as any).effective_status || d.status || ""),
                  })) as any}
                  zoneStats={zoneStats}
                  onAssign={async (driverId) => {
                    if (!selectedTrip?.booking_code) return;
                    const suggestionDriver = eligibleDrivers.find((d) => String(d.driver_id || "") === String(driverId)) || null;
                    const suggestionDriverTown = String(suggestionDriver?.town || "").trim().toLowerCase();
                    const emergencyMode = !!selectedTripTown && !!suggestionDriverTown && selectedTripTown !== suggestionDriverTown;
                    await assignDriver(selectedTrip.booking_code, driverId, emergencyMode);
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-lg border overflow-hidden">
          <LiveTripsMap
            trips={mapTrips as any}
            drivers={drivers as any}
            selectedTripId={selectedTripId}
            stuckTripIds={stuckTripIds as any}
            townFilter={townFilter}
            onEmergencyAssign={async (bookingCode) => {
              await emergencyAssignNearest(bookingCode);
            }}
          />
        </div>
      </div>

      {ticketInspectorOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
          <div className="h-full w-full max-w-4xl overflow-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ticket Inspector</div>
                  <div className="text-xl font-bold text-slate-900">{labelOrDash(ticketInspector?.booking?.booking_code || ticketQuery)}</div>
                  <div className="text-xs text-slate-500">Rule-based forensic view from confirmed schema only.</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    disabled={!ticketInspector?.booking}
                    onClick={() => {
                      const report = buildIncidentReport(ticketInspector);
                      navigator.clipboard.writeText(report)
                        .then(() => setLastAction("Incident report copied"))
                        .catch(() => setLastAction("Copy failed"));
                    }}
                  >
                    Copy Incident Report
                  </button>
                  <button
                    className="rounded-2xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    onClick={() => setTicketInspectorOpen(false)}
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {(["overview", "timeline", "diagnostics", "raw"] as TicketInspectorTab[]).map((tab) => (
                  <button
                    key={tab}
                    className={pillClass(ticketInspectorTab === tab)}
                    onClick={() => setTicketInspectorTab(tab)}
                  >
                    {tab === "raw" ? "Raw State" : tab.charAt(0).toUpperCase() + tab.slice(1)}
                    {tab === "timeline" ? <span className="text-xs opacity-80">{ticketInspector?.timeline?.length ?? 0}</span> : null}
                    {tab === "diagnostics" ? <span className="text-xs opacity-80">{ticketInspector?.diagnostics?.length ?? 0}</span> : null}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4">
              {ticketInspectorLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Loading ticket evidence...</div>
              ) : ticketInspectorError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{ticketInspectorError}</div>
              ) : !ticketInspector ? (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No ticket loaded.</div>
              ) : ticketInspectorTab === "overview" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 font-semibold">Booking</div>
                    <div className="space-y-1 text-sm">
                      <div><span className="text-slate-500">Code:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.booking_code)}</span></div>
                      <div><span className="text-slate-500">Status:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.status)}</span></div>
                      <div><span className="text-slate-500">Service:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.service_type || ticketInspector.booking?.trip_type)}</span></div>
                      <div><span className="text-slate-500">Town:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.town)}</span></div>
                      <div><span className="text-slate-500">Created:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.created_at)}</span></div>
                      <div><span className="text-slate-500">Updated:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.updated_at)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 font-semibold">People</div>
                    <div className="space-y-1 text-sm">
                      <div><span className="text-slate-500">Passenger:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.passenger_name)}</span></div>
                      <div><span className="text-slate-500">Driver ID:</span> <span className="font-medium break-all">{labelOrDash(ticketInspector.booking?.driver_id || ticketInspector.booking?.assigned_driver_id)}</span></div>
                      <div><span className="text-slate-500">Vendor ID:</span> <span className="font-medium break-all">{labelOrDash(ticketInspector.booking?.vendor_id)}</span></div>
                      <div><span className="text-slate-500">Created by user:</span> <span className="font-medium break-all">{labelOrDash(ticketInspector.booking?.created_by_user_id)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 font-semibold">Fare fields</div>
                    <div className="space-y-1 text-sm">
                      <div><span className="text-slate-500">Proposed fare:</span> <span className="font-medium">{formatMoney(ticketInspector.booking?.proposed_fare)}</span></div>
                      <div><span className="text-slate-500">Company cut:</span> <span className="font-medium">{formatMoney(ticketInspector.booking?.company_cut)}</span></div>
                      <div><span className="text-slate-500">Driver payout:</span> <span className="font-medium">{formatMoney(ticketInspector.booking?.driver_payout)}</span></div>
                      <div><span className="text-slate-500">Takeout payable:</span> <span className="font-medium">{formatMoney(ticketInspector.booking?.takeout_total_payable)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 font-semibold">Wallet Settlement</div>
                    {(() => {
                      const ws = walletSummary(ticketInspector.raw);
                      return (
                        <div className="space-y-1 text-sm">
                          <div><span className="text-slate-500">Status:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.wallet_settlement_status)}</span></div>
                          <div><span className="text-slate-500">Version:</span> <span className="font-medium">{labelOrDash(ticketInspector.booking?.wallet_settlement_version)}</span></div>
                          <div><span className="text-slate-500">Settled at:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.wallet_settled_at)}</span></div>
                          <div><span className="text-slate-500">Platform cut:</span> <span className="font-medium">{formatMoney(ws.amount != null ? Math.abs(Number(ws.amount)) : ticketInspector.booking?.company_cut)}</span></div>
                          <div><span className="text-slate-500">Reason:</span> <span className="font-medium">{labelOrDash(ws.reason)}</span></div>
                          <div><span className="text-slate-500">Balance after:</span> <span className="font-medium">{formatMoney(ws.balanceAfter)}</span></div>
                          <div><span className="text-slate-500">Settlement ID:</span> <span className="font-medium break-all">{labelOrDash(ticketInspector.booking?.wallet_settlement_id)}</span></div>
                          <div><span className="text-slate-500">Hash:</span> <span className="font-medium break-all">{labelOrDash(ticketInspector.booking?.wallet_settlement_hash)}</span></div>
                        </div>
                      );
                    })()}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <div className="mb-2 font-semibold">Timers</div>
                    <div className="space-y-1 text-sm">
                      <div><span className="text-slate-500">Assigned at:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.assigned_at)}</span></div>
                      <div><span className="text-slate-500">Driver accept expires:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.driver_accept_expires_at || ticketInspector.booking?.takeout_driver_accept_expires_at)}</span></div>
                      <div><span className="text-slate-500">Fee expires:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.takeout_fee_expires_at || ticketInspector.booking?.takeout_fee_proposal_expires_at)}</span></div>
                      <div><span className="text-slate-500">Completed:</span> <span className="font-medium">{formatPHDateTime(ticketInspector.booking?.completed_at)}</span></div>
                    </div>
                  </div>
                </div>
              ) : ticketInspectorTab === "timeline" ? (
                <div className="space-y-2">
                  {(ticketInspector.timeline || []).length === 0 ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">No timeline rows returned.</div>
                  ) : (ticketInspector.timeline || []).map((row, idx) => (
                    <div key={String(row.at || "") + String(idx)} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 flex h-8 min-w-8 items-center justify-center rounded-full border border-slate-200 bg-slate-50 px-2 text-[10px] font-semibold text-slate-600">
                            {timelineIcon(row)}
                          </div>
                          <div>
                            <div className="font-semibold">{timelineTitle(row)}</div>
                            {row.source === "driver_wallet_transactions" ? (
                              <div className="mt-1 text-xs text-slate-600">
                                <span className="font-medium">{formatMoney(Math.abs(Number(row.evidence?.amount ?? 0)))}</span>
                                <span> deducted</span>
                                {row.evidence?.balance_after != null ? <span> - Balance after {formatMoney(row.evidence.balance_after)}</span> : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-xs text-slate-500">{formatPHDateTime(row.at)}</div>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-slate-600 md:grid-cols-4">
                        <div>Source: <span className="font-medium">{labelOrDash(row.source)}</span></div>
                        <div>Actor: <span className="font-medium break-all">{labelOrDash(row.actor)}</span></div>
                        <div>From: <span className="font-medium">{labelOrDash(row.from_status)}</span></div>
                        <div>To: <span className="font-medium">{labelOrDash(row.to_status)}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : ticketInspectorTab === "diagnostics" ? (
                <div className="space-y-2">
                  {(ticketInspector.diagnostics || []).length === 0 ? (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">No diagnostics returned by the rule engine.</div>
                  ) : (ticketInspector.diagnostics || []).map((d, idx) => (
                    <div key={String(d.code || idx)} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-600">{labelOrDash(d.severity)}</span>
                        <span className="font-semibold">{labelOrDash(d.code)}</span>
                      </div>
                      <div className="mt-1 text-slate-700">{labelOrDash(d.message)}</div>
                      {(d.evidence || []).length ? (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-500">
                          {(d.evidence || []).map((ev, evIdx) => <li key={String(evIdx)}>{String(ev)}</li>)}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <pre className="max-h-[75vh] overflow-auto rounded-2xl border border-slate-200 bg-slate-950 p-4 text-xs text-slate-100">
                  {JSON.stringify(ticketInspector.raw || ticketInspector, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
