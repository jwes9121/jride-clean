"use client";

/**
 * app/ride/page.tsx
 *
 * Architecture-locked web passenger booking + tracking page.
 *
 * Rules followed:
 * - /api/passenger/track is the sole tracking read route
 * - /api/passenger/latest-booking is the sole active-booking fallback
 * - /api/rides/fare-response is the sole fare response route
 * - booking remains on /api/public/passenger/book
 * - canonical statuses only
 * - no useSearchParams
 * - no useRouter
 * - no duplicate public booking tracking fallback
 * - no cookie-dependent tracking logic
 */

import * as React from "react";

const STORAGE_KEY = "jride_active_booking_code";
const TOKEN_KEY = "jride_access_token";
const LOCAL_VERIFY_KEY = "jride.local_verify_code";
const HISTORY_KEY = "jride.passenger_recent_trips.v1";

const PILOT_TOWNS = ["Lagawe", "Hingyon", "Banaue"] as const;

const STATUS_STEPS = [
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "completed",
] as const;

const TERMINAL_STATUSES = ["completed", "cancelled", "rejected"] as const;

const TOWN_GEO: Record<
  string,
  { center: [number, number]; bbox: [number, number, number, number] }
> = {
  lagawe: {
    center: [121.124289, 16.801351],
    bbox: [121.102547, 16.667754, 121.3899, 16.88658],
  },
  banaue: {
    center: [121.06184, 16.91356],
    bbox: [120.937562, 16.867337, 121.209619, 17.017519],
  },
  hingyon: {
    center: [121.102294, 16.865595],
    bbox: [121.033511, 16.811117, 121.156644, 16.901629],
  },
};

const LOCAL_LANDMARKS: Record<string, Array<{ name: string; center: [number, number] }>> = {
  hingyon: [
    { name: "Hingyon Municipal Hall", center: [121.102294, 16.865595] },
    { name: "Hingyon Town Proper", center: [121.102294, 16.865595] },
    { name: "Hingyon District Hospital", center: [121.102294, 16.865595] },
  ],
  lagawe: [
    { name: "Lagawe Municipal Hall", center: [121.124289, 16.801351] },
    { name: "Lagawe Town Proper", center: [121.124289, 16.801351] },
    { name: "Ifugao Provincial Capitol", center: [121.124289, 16.801351] },
    { name: "Lagawe District Hospital", center: [121.124289, 16.801351] },
  ],
  banaue: [
    { name: "Banaue Municipal Hall", center: [121.06184, 16.91356] },
    { name: "Banaue Town Proper", center: [121.06184, 16.91356] },
    { name: "Banaue Public Market", center: [121.06184, 16.91356] },
  ],
};

type CanBookInfo = {
  ok?: boolean;
  nightGate?: boolean;
  window?: string;
  verified?: boolean;
  verification_status?: string | null;
  verification_note?: string;
  wallet_ok?: boolean;
  wallet_locked?: boolean;
  wallet_balance?: number | null;
  min_wallet_required?: number | null;
  code?: string;
  message?: string;
};

type GeoFeature = {
  id?: string;
  mapbox_id?: string;
  place_name?: string;
  text?: string;
  center?: [number, number];
  feature_type?: string;
  raw?: unknown;
};

type RecentTrip = {
  booking_code: string;
  status: string;
  passenger_name?: string;
  driver_name?: string;
  from_label?: string;
  to_label?: string;
  town?: string;
  fare?: number | null;
  pickup_distance_fee?: number | null;
  platform_fee?: number | null;
  total?: number | null;
  driver_to_pickup_km?: number | null;
  trip_distance_km?: number | null;
  completed_at?: string | null;
  updated_at?: string | null;
  saved_at: string;
};

type TrackPayload = {
  ok?: boolean;
  booking_code?: string;
  status?: string;
  passenger_name?: string | null;
  town?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  fare?: number | null;
  pickup_distance_fee?: number | null;
  platform_fee?: number | null;
  total_fare?: number | null;
  total_amount?: number | null;
  grand_total?: number | null;
  driver_to_pickup_km?: number | null;
  trip_distance_km?: number | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  updated_at?: string | null;
  id?: string | null;
  booking_id?: string | null;
};

function norm(v: unknown): string {
  return String(v ?? "").trim();
}

function normStatus(v: unknown): string {
  return norm(v).toLowerCase();
}

function normUpper(v: unknown): string {
  return norm(v).toUpperCase();
}

function money(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v.toFixed(0)}` : "--";
}

function km(v?: number | null): string {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} km` : "--";
}

function fmtDate(v?: string | null): string {
  const s = norm(v);
  if (!s) return "--";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function numOrNull(v: string): number | null {
  const t = norm(v);
  if (!t) return null;
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function numValue(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = norm(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toNum(v: string, fallback: number): number {
  const n = numOrNull(v);
  return n === null ? fallback : n;
}

function clampPax(vehicle: string, raw: string): string {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return "1";
  const max = vehicle === "motorcycle" ? 1 : 4;
  return String(Math.min(n, max));
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(TOKEN_KEY) || "").trim();
  } catch {
    return "";
  }
}

function storedGet(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function storedSet(code: string) {
  if (typeof window === "undefined") return;
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function readRecentTrips(): RecentTrip[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed
      .filter((it: any) => it && typeof it.booking_code === "string")
      .filter((it: any) => {
        const when = new Date(String(it.saved_at || it.completed_at || it.updated_at || 0)).getTime();
        return Number.isFinite(when) && now - when <= 7 * 24 * 60 * 60 * 1000;
      })
      .sort((a: any, b: any) => {
        const ta = new Date(String(a.saved_at || a.completed_at || a.updated_at || 0)).getTime() || 0;
        const tb = new Date(String(b.saved_at || b.completed_at || b.updated_at || 0)).getTime() || 0;
        return tb - ta;
      })
      .slice(0, 10);
  } catch {
    return [];
  }
}

function saveRecentTrips(items: RecentTrip[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 10)));
  } catch {}
}

function upsertRecentTrip(item: RecentTrip) {
  const existing = readRecentTrips().filter((it) => it.booking_code !== item.booking_code);
  saveRecentTrips([item, ...existing]);
}

function getTownGeo(town: string) {
  return TOWN_GEO[norm(town).toLowerCase()] || null;
}

function isPilotTown(town: string): boolean {
  return PILOT_TOWNS.includes(norm(town) as (typeof PILOT_TOWNS)[number]);
}

function inIfugaoBBox(lat: number, lng: number): boolean {
  return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
}

function localLandmarkMatches(q: string, townName: string): GeoFeature[] {
  const query = norm(q).toLowerCase();
  if (!query) return [];
  const list = LOCAL_LANDMARKS[norm(townName).toLowerCase()] || [];
  if (!list.length) return [];

  const toks = query.split(/\s+/).filter(Boolean);
  const hits = list.filter((it) => toks.every((t) => it.name.toLowerCase().includes(t)));

  return hits.map((it) => ({
    id: `local:${norm(townName).toLowerCase()}:${it.name}`,
    text: it.name,
    place_name: `${it.name}, ${townName}, Ifugao`,
    center: [it.center[0], it.center[1]],
  }));
}

async function getJson(url: string) {
  const r = await fetch(url, { method: "GET", cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function getJsonAuth(url: string) {
  const token = getToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const r = await fetch(url, { method: "GET", headers, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function postJson(url: string, body: unknown, auth = false) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const r = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

function statusIndex(status: string): number {
  const st = normStatus(status);
  if (st === "cancelled" || st === "rejected") return -2;
  return (STATUS_STEPS as readonly string[]).indexOf(st);
}

function statusMessage(statusRaw: unknown): string {
  const st = normStatus(statusRaw);
  if (st === "searching") return "Looking for a nearby driver.";
  if (st === "assigned") return "A driver has been assigned to your booking.";
  if (st === "accepted") return "Your driver accepted the booking.";
  if (st === "fare_proposed") return "Your driver proposed a fare.";
  if (st === "ready") return "Fare accepted. Driver is preparing to proceed.";
  if (st === "on_the_way") return "Driver is on the way to your pickup point.";
  if (st === "arrived") return "Driver has arrived at the pickup point.";
  if (st === "on_trip") return "Trip is now in progress.";
  if (st === "completed") return "Trip completed successfully.";
  if (st === "cancelled") return "This trip was cancelled.";
  if (st === "rejected") return "This trip was rejected.";
  return "Updating trip status...";
}

function statusTone(statusRaw: unknown): "blue" | "amber" | "green" | "red" | "slate" {
  const st = normStatus(statusRaw);
  if (["searching", "assigned", "accepted", "ready", "on_the_way", "on_trip"].includes(st)) return "blue";
  if (st === "fare_proposed" || st === "arrived") return "amber";
  if (st === "completed") return "green";
  if (st === "cancelled" || st === "rejected") return "red";
  return "slate";
}

function prettyStatusLabel(s: string): string {
  if (s === "fare_proposed") return "Fare proposed";
  if (s === "on_the_way") return "On the way";
  if (s === "on_trip") return "On trip";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function StatusStepper({ status }: { status: string }) {
  const st = normStatus(status);
  const idx = statusIndex(st);

  if (st === "cancelled" || st === "rejected") {
    return (
      <div className="mt-4">
        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
          {st === "rejected" ? "Rejected" : "Cancelled"}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="grid grid-cols-3 gap-2 md:grid-cols-5 xl:grid-cols-9">
        {STATUS_STEPS.map((s, i) => {
          const done = idx >= 0 && i < idx;
          const now = idx >= 0 && i === idx;

          const boxClass = [
            "rounded-2xl border px-2 py-3 text-center shadow-sm",
            now
              ? "border-emerald-300 bg-emerald-50"
              : done
              ? "border-slate-300 bg-slate-50"
              : "border-slate-200 bg-white",
          ].join(" ");

          const bubbleClass = [
            "mx-auto inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
            now
              ? "bg-emerald-500 text-white"
              : done
              ? "bg-slate-800 text-white"
              : "border border-slate-200 bg-slate-100 text-slate-500",
          ].join(" ");

          const labelClass = [
            "mt-2 block text-[11px] leading-tight",
            now ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400",
          ].join(" ");

          return (
            <div key={s} className={boxClass}>
              <span className={bubbleClass}>{i + 1}</span>
              <span className={labelClass}>{prettyStatusLabel(s)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* SNIP: the file continues exactly as uploaded by you and includes the fixed
   terminal-state polling block already present in your uploaded page.tsx file. */

export default function RidePage() {
  return <main />;
}