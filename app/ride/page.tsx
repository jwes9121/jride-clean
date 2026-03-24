"use client";

/**
 * app/ride/page.tsx — Reconstructed passenger booking + tracking page
 *
 * Source: morning zip UX blueprint + current backend contracts
 * Backend contracts (source of truth):
 *   POST /api/public/passenger/book        â†’ { ok, booking_code, booking, assign }
 *   GET  /api/public/passenger/booking?code=...  â†’ { ok, booking: { ...fields, driver_name, driver_lat, driver_lng } }
 *   GET  /api/public/passenger/can-book?town=...&pickup_lat=...&pickup_lng=... â†’ CanBookInfo
 *   POST /api/public/passenger/fare/accept  â†’ { booking_id }
 *   POST /api/public/passenger/fare/reject  â†’ { booking_id }
 *
 * No frontend fare computation. Fares displayed from backend only.
 * No admin/dispatcher route changes.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

// â”€â”€â”€ Constants â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STORAGE_KEY = "jride_active_booking_code";
const LOCAL_VERIFY_KEY = "jride.local_verify_code";
const HISTORY_KEY = "jride.passenger_recent_trips.v1";
const PILOT_TOWNS = ["Lagawe", "Hingyon", "Banaue"] as const;

const STATUS_STEPS = ["requested", "assigned", "on_the_way", "arrived", "on_trip", "completed"] as const;

const TOWN_GEO: Record<string, { center: [number, number]; bbox: [number, number, number, number] }> = {
  lagawe:  { center: [121.124289, 16.801351], bbox: [121.102547, 16.667754, 121.389900, 16.886580] },
  banaue:  { center: [121.061840, 16.913560], bbox: [120.937562, 16.867337, 121.209619, 17.017519] },
  hingyon: { center: [121.102294, 16.865595], bbox: [121.033511, 16.811117, 121.156644, 16.901629] },
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
    { name: "Banaue Municipal Hall", center: [121.061840, 16.913560] },
    { name: "Banaue Town Proper", center: [121.061840, 16.913560] },
    { name: "Banaue Public Market", center: [121.061840, 16.913560] },
  ],
};

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  raw?: any;
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

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function stored_get(): string {
  if (typeof window === "undefined") return "";
  try { return String(localStorage.getItem(STORAGE_KEY) || "").trim(); } catch { return ""; }
}

function stored_set(code: string) {
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

function numOrNull(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function toNum(s: string, fallback: number): number {
  const n = numOrNull(s);
  return n === null ? fallback : n;
}

function norm(s: any): string { return String(s || "").trim(); }
function normUpper(s: any): string { return norm(s).toUpperCase(); }

function money(v?: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return "PHP " + v.toFixed(0);
}

function km(v?: number | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "--";
  return v.toFixed(1) + " km";
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

function normStatus(s: any): string { return String(s || "").trim().toLowerCase(); }

function statusIndex(st: string): number {
  const s = normStatus(st);
  if (s === "cancelled") return -2;
  return (STATUS_STEPS as readonly string[]).indexOf(s);
}

function statusMessage(stRaw: any): string {
  const st = normStatus(stRaw);
  if (st === "requested" || st === "pending" || st === "searching") return "Looking for a nearby driver.";
  if (st === "assigned") return "A driver has been assigned to your booking.";
  if (st === "accepted") return "Your driver accepted the booking.";
  if (st === "fare_proposed") return "Your driver proposed a fare.";
  if (st === "ready") return "Fare accepted. Driver is preparing to proceed.";
  if (st === "on_the_way") return "Driver is on the way to your pickup point.";
  if (st === "arrived") return "Driver has arrived at the pickup point.";
  if (st === "on_trip") return "Trip is now in progress.";
  if (st === "completed") return "Trip completed successfully.";
  if (st === "cancelled") return "This trip was cancelled.";
  return "Updating trip status...";
}

function statusTone(stRaw: any): "blue" | "amber" | "green" | "red" | "slate" {
  const st = normStatus(stRaw);
  if (["requested", "pending", "searching", "assigned", "accepted", "ready", "on_the_way", "on_trip"].includes(st)) return "blue";
  if (st === "fare_proposed" || st === "arrived") return "amber";
  if (st === "completed") return "green";
  if (st === "cancelled") return "red";
  return "slate";
}

function isPilotTown(t: string): boolean {
  return PILOT_TOWNS.includes(norm(t) as any);
}

function getTownGeo(t: any) {
  const k = norm(t).toLowerCase();
  return TOWN_GEO[k] || null;
}

function inIfugaoBBox(lat: number, lng: number): boolean {
  return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
}

function localLandmarkMatches(q: string, townName: string): GeoFeature[] {
  const query = norm(q).toLowerCase();
  if (!query) return [];
  const tk = norm(townName).toLowerCase();
  const list = LOCAL_LANDMARKS[tk] || [];
  if (!list.length) return [];

  const toks = query.split(/\s+/).filter(Boolean);
  const hits = list.filter((it) => {
    const n = it.name.toLowerCase();
    return toks.every((t) => n.includes(t));
  });

  return hits.map((it) => ({
    id: "local:" + tk + ":" + it.name,
    text: it.name,
    place_name: it.name + ", " + townName + ", Ifugao",
    center: [it.center[0], it.center[1]] as [number, number],
  }));
}

function clampPax(v: string, raw: string): string {
  const t = norm(raw);
  if (!t) return "1";
  const n = Math.floor(Number(t));
  if (!Number.isFinite(n) || n <= 0) return "1";
  const max = v === "motorcycle" ? 1 : 4;
  return String(Math.min(n, max));
}

// â”€â”€â”€ HTTP helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getJson(url: string) {
  const r = await fetch(url, { method: "GET", cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

async function postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json: j };
}

// â”€â”€â”€ Status stepper component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function StatusStepper({ status }: { status: string }) {
  const st = normStatus(status);
  const idx = statusIndex(st);

  if (st === "cancelled") {
    return (
      <div className="mt-4">
        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
          Cancelled
        </span>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto">
      <div className="flex min-w-[720px] items-center gap-2 pb-1">
        {STATUS_STEPS.map((s, i) => {
          const done = idx >= 0 && i < idx;
          const now = idx >= 0 && i === idx;
          const bubble =
            "inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold shadow-sm " +
            (now
              ? "bg-emerald-500 text-white ring-4 ring-emerald-100"
              : done
              ? "bg-slate-800 text-white"
              : "bg-slate-100 text-slate-500 border border-slate-200");
          const label =
            "whitespace-nowrap text-[11px] " +
            (now ? "font-semibold text-slate-900" : done ? "text-slate-700" : "text-slate-400");
          const pretty =
            s === "on_the_way" ? "On the way" :
            s === "on_trip" ? "On trip" :
            s.charAt(0).toUpperCase() + s.slice(1);
          return (
            <React.Fragment key={s}>
              <div className="flex items-center gap-2">
                <span className={bubble}>{i + 1}</span>
                <span className={label}>{pretty}</span>
              </div>
              {i < STATUS_STEPS.length - 1 && <div className="h-px min-w-[28px] flex-1 bg-slate-200" />}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MAIN PAGE COMPONENT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

export default function RidePage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [accountName, setAccountName] = React.useState("");

  // â”€â”€â”€ Mapbox token â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const MAPBOX_TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "") as string;

  // â”€â”€â”€ Core state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [town, setTown] = React.useState("Lagawe");
  const [passengerName, setPassengerName] = React.useState("");
  const [signedInPassengerName, setSignedInPassengerName] = React.useState("");
  const [isPassengerSignedIn, setIsPassengerSignedIn] = React.useState(false);
  const [fromLabel, setFromLabel] = React.useState("Lagawe Town Proper");
  const [toLabel, setToLabel] = React.useState("");
  const [pickupLat, setPickupLat] = React.useState("16.7999");
  const [pickupLng, setPickupLng] = React.useState("121.1175");
  const [dropLat, setDropLat] = React.useState("");
  const [dropLng, setDropLng] = React.useState("");

  const [vehicleType, setVehicleType] = React.useState<"tricycle" | "motorcycle">("tricycle");
  const [passengerCount, setPassengerCount] = React.useState("1");

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState("");

  // â”€â”€â”€ Can-book preflight â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [canInfo, setCanInfo] = React.useState<CanBookInfo | null>(null);
  const [canInfoErr, setCanInfoErr] = React.useState("");

  // â”€â”€â”€ Geo gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [geoPermission, setGeoPermission] = React.useState<"unknown" | "granted" | "denied">("unknown");
  const [geoInsideIfugao, setGeoInsideIfugao] = React.useState<boolean | null>(null);
  const [geoLat, setGeoLat] = React.useState<number | null>(null);
  const [geoLng, setGeoLng] = React.useState<number | null>(null);
  const [geoGateErr, setGeoGateErr] = React.useState("");

  // â”€â”€â”€ Local verification code â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [localVerify, setLocalVerify] = React.useState("");

  function hasLocalVerify(): boolean { return !!norm(localVerify); }

  // â”€â”€â”€ Live tracking state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [activeCode, setActiveCode] = React.useState(() => stored_get());
  const [liveStatus, setLiveStatus] = React.useState("");
  const [liveBooking, setLiveBooking] = React.useState<any | null>(null);
  const [liveErr, setLiveErr] = React.useState("");
  const pollRef = React.useRef<any>(null);
  const [fareBusy, setFareBusy] = React.useState(false);

  // â”€â”€â”€ Fees acknowledgement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [feesAck, setFeesAck] = React.useState(false);

  // â”€â”€â”€ Verification panel â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [showVerifyPanel, setShowVerifyPanel] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [recentTrips, setRecentTrips] = React.useState<RecentTrip[]>([]);
  const [mapResetKey, setMapResetKey] = React.useState(0);

  // â”€â”€â”€ Mapbox geocode state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const sessionTokenRef = React.useRef("");
  if (!sessionTokenRef.current) {
    sessionTokenRef.current = "sess_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
  }

  const [geoFrom, setGeoFrom] = React.useState<GeoFeature[]>([]);
  const [geoTo, setGeoTo] = React.useState<GeoFeature[]>([]);
  const [geoErr, setGeoErr] = React.useState("");
  const [activeGeoField, setActiveGeoField] = React.useState<"from" | "to" | null>(null);
  const fromDebounceRef = React.useRef<any>(null);
  const toDebounceRef = React.useRef<any>(null);

  // â”€â”€â”€ Map picker state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [showMapPicker, setShowMapPicker] = React.useState(true);
  const [pickMode, setPickMode] = React.useState<"pickup" | "dropoff">("pickup");
  const pickModeRef = React.useRef<"pickup" | "dropoff">(pickMode);
  React.useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const mbRef = React.useRef<any>(null);
  const pickupMarkerRef = React.useRef<any>(null);
  const dropoffMarkerRef = React.useRef<any>(null);

  // Route preview
  const ROUTE_SOURCE_ID = "jride_route_source";
  const ROUTE_LAYER_ID = "jride_route_line";
  const routeAbortRef = React.useRef<any>(null);
  const routeDebounceRef = React.useRef<any>(null);
  const [routeInfo, setRouteInfo] = React.useState<{ distance_m: number; duration_s: number } | null>(null);
  const routeGeoRef = React.useRef<any>({ type: "FeatureCollection", features: [] });

  const pickupTouchedRef = React.useRef(false);
  const townAppliedRef = React.useRef("");

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // DERIVED STATE
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const verified = !!canInfo?.verified;
  const nightGate = !!canInfo?.nightGate;
  const walletOk = canInfo?.wallet_ok;
  const walletLocked = !!canInfo?.wallet_locked;
  const geoOk = geoPermission === "granted" && geoInsideIfugao === true;
  const geoOrLocalOk = geoOk || hasLocalVerify();
  const pilotTownAllowed = isPilotTown(town);

  const unverifiedBlocked =
    !verified && (nightGate || normUpper(canInfo?.code).includes("UNVERIFIED") || normUpper(canInfo?.code).includes("VERIFY"));
  const walletBlocked = walletOk === false || walletLocked;
  const bookingActive = !!activeCode;

  const allowSubmit =
    !busy && !unverifiedBlocked && !walletBlocked && !bookingActive &&
    pilotTownAllowed && geoOrLocalOk && feesAck &&
    !!norm(toLabel) && numOrNull(dropLat) !== null && numOrNull(dropLng) !== null;

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // EFFECTS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  // Auto-fill passenger name from session and local history
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", { method: "GET", cache: "no-store" });
        const j: any = await r.json().catch(() => null);
        if (!alive) return;
        const isAuthed = !!(j?.authed || j?.ok || j?.user || j?.session);
        const nm = norm(j?.user?.name ?? j?.user?.full_name ?? j?.profile?.full_name ?? j?.profile?.name ?? "");
        setAuthed(isAuthed);
        setAccountName(nm);
        if (nm) setPassengerName((prev) => prev || nm);
        if (!nm) {
          const recent = readRecentTrips();
          const fallback = norm(recent[0]?.passenger_name || "");
          if (fallback) setPassengerName((prev) => prev || fallback);
        }
      } catch {
        if (!alive) return;
        setAuthed(false);
        setAccountName("");
        const recent = readRecentTrips();
        const fallback = norm(recent[0]?.passenger_name || "");
        if (fallback) setPassengerName((prev) => prev || fallback);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function gotoLogin() {
    router.push("/passenger-login");
  }

  async function handleLogout() {
    try {
      await fetch("/api/public/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    if (typeof window !== "undefined") {
      window.location.replace("/passenger-login");
      return;
    }
    router.push("/passenger-login");
  }

    React.useEffect(() => {
    let alive = true;

    function pickName(j: any): string {
      return norm(
        j?.user?.name ??
        j?.user?.full_name ??
        j?.user?.display_name ??
        j?.user?.passenger_name ??
        j?.profile?.full_name ??
        j?.profile?.name ??
        j?.profile?.display_name ??
        j?.profile?.passenger_name ??
        j?.session?.user?.name ??
        j?.session?.user?.full_name ??
        j?.data?.user?.name ??
        j?.data?.user?.full_name ??
        ""
      );
    }

    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        });

        const j: any = await r.json().catch(() => null);
        const sessionName = pickName(j);

        if (!alive) return;

        if (sessionName) {
          setIsPassengerSignedIn(true);
          setSignedInPassengerName(sessionName);
          setPassengerName((prev) => norm(prev) || sessionName);
          return;
        }

        try {
          const recent = readRecentTrips();
          const fallbackName = norm(
            recent?.[0]?.passenger_name ??
            recent?.find((it: any) => norm(it?.passenger_name))?.passenger_name ??
            ""
          );

          if (fallbackName) {
            setPassengerName((prev) => norm(prev) || fallbackName);
          }
        } catch {}
      } catch {
        if (!alive) return;
        try {
          const recent = readRecentTrips();
          const fallbackName = norm(
            recent?.[0]?.passenger_name ??
            recent?.find((it: any) => norm(it?.passenger_name))?.passenger_name ??
            ""
          );

          if (fallbackName) {
            setPassengerName((prev) => norm(prev) || fallbackName);
          }
        } catch {}
      }
    })();

    return () => {
      alive = false;
    };
  }, []);
// Town change â†’ reset coords to town center
  React.useEffect(() => {
    const g = getTownGeo(town);
    const key = norm(town).toLowerCase();
    if (!g) return;
    if (townAppliedRef.current === key) return;
    townAppliedRef.current = key;

    setPickupLng(String(g.center[0]));
    setPickupLat(String(g.center[1]));
    setFromLabel(norm(town) + " Town Proper");
    setGeoFrom([]);
    setDropLng(String(g.center[0]));
    setDropLat(String(g.center[1]));
    setToLabel("");
    setGeoTo([]);
  }, [town]);

  // Use device geolocation once as initial pickup
  React.useEffect(() => {
    if (!Number.isFinite(geoLat as any) || !Number.isFinite(geoLng as any)) return;
    if (pickupTouchedRef.current) return;
    const isDefault = pickupLat === "16.7999" && pickupLng === "121.1175";
    if (isDefault) {
      setPickupLat(String(geoLat));
      setPickupLng(String(geoLng));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geoLat, geoLng]);

  React.useEffect(() => {
    if (pickupLat !== "16.7999" || pickupLng !== "121.1175") pickupTouchedRef.current = true;
  }, [pickupLat, pickupLng]);

  // Prefill from URL params
  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search || "");
      const f = norm(sp.get("from") || "");
      const t = norm(sp.get("to") || "");
      if (f) setFromLabel(f);
      if (t) setToLabel(t);
    } catch {}
  }, []);

  // Load can-book info on mount
  React.useEffect(() => { refreshCanBook(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Geo gate check on mount (no prompt)
  React.useEffect(() => {
    refreshGeoGate(false);
    try {
      const v = window.localStorage.getItem(LOCAL_VERIFY_KEY);
      if (v) setLocalVerify(String(v));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    setRecentTrips(readRecentTrips());
  }, []);

  // Cross-browser resume: if no activeCode, try server for latest active booking
  React.useEffect(() => {
    if (activeCode) return;
    let alive = true;
    (async () => {
      try {
        const resp = await getJson("/api/public/passenger/booking");
        if (!resp.ok) return;
        const b = (resp.json?.booking || resp.json) as any;
        const code = norm(b?.booking_code || b?.code || "");
        if (!code || !alive) return;
        stored_set(code);
        setActiveCode(code);
      } catch {}
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live polling
  React.useEffect(() => {
    if (!activeCode) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        setLiveErr("");
        const resp = await getJson("/api/public/passenger/booking?code=" + encodeURIComponent(activeCode));
        if (!resp.ok) {
          setLiveErr("BOOKING_POLL_FAILED: " + norm(resp.json?.message || resp.json?.error || "HTTP " + resp.status));
          return;
        }
        const b = (resp.json?.booking || resp.json) as any;
        setLiveBooking(b);
        setLiveStatus(norm(b?.status || ""));

        const terminal = norm(b?.status) === "completed" || norm(b?.status) === "cancelled";
        if (terminal && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      } catch (e: any) {
        setLiveErr("BOOKING_POLL_ERROR: " + String(e?.message || e));
      }
    }

    tick();
    pollRef.current = setInterval(tick, 3000);
    return () => { cancelled = true; if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [activeCode]);


  React.useEffect(() => {
    const st = normStatus(liveStatus);
    if (!activeCode || !liveBooking || (st !== "completed" && st !== "cancelled")) return;
    const b: any = liveBooking;
    const item: RecentTrip = {
      booking_code: activeCode,
      status: st,
      passenger_name: norm(b?.passenger_name || passengerName || ""),
      driver_name: norm(b?.driver_name || ""),
      from_label: norm(b?.from_label || fromLabel || ""),
      to_label: norm(b?.to_label || toLabel || ""),
      town: norm(b?.town || town || ""),
      fare: typeof (b?.verified_fare ?? b?.proposed_fare) === "number" ? (b?.verified_fare ?? b?.proposed_fare) : null,
      pickup_distance_fee: typeof b?.pickup_distance_fee === "number" ? b.pickup_distance_fee : null,
      platform_fee: typeof b?.platform_fee === "number" ? b.platform_fee : null,
      total:
        typeof b?.total_fare === "number" ? b.total_fare :
        typeof b?.total_amount === "number" ? b.total_amount :
        typeof b?.grand_total === "number" ? b.grand_total : null,
      driver_to_pickup_km: typeof b?.driver_to_pickup_km === "number" ? b.driver_to_pickup_km : null,
      trip_distance_km: typeof b?.trip_distance_km === "number" ? b.trip_distance_km : null,
      completed_at: norm(b?.completed_at || ""),
      updated_at: norm(b?.updated_at || ""),
      saved_at: new Date().toISOString(),
    };
    upsertRecentTrip(item);
    setRecentTrips(readRecentTrips());
  }, [activeCode, liveBooking, liveStatus, passengerName, fromLabel, toLabel, town]);

  // Debounced geocoding for pickup
  React.useEffect(() => {
    if (activeGeoField !== "from") return;
    if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);
    fromDebounceRef.current = setTimeout(async () => {
      try { setGeoFrom(await geocodeForward(fromLabel)); } catch { setGeoFrom([]); }
    }, 350);
    return () => { if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLabel, activeGeoField, town]);

  // Debounced geocoding for dropoff
  React.useEffect(() => {
    if (activeGeoField !== "to") return;
    if (toDebounceRef.current) clearTimeout(toDebounceRef.current);
    toDebounceRef.current = setTimeout(async () => {
      try { setGeoTo(await geocodeForward(toLabel)); } catch { setGeoTo([]); }
    }, 350);
    return () => { if (toDebounceRef.current) clearTimeout(toDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toLabel, activeGeoField, town]);

  // Map picker init/refresh
  React.useEffect(() => {
    let cancelled = false;
    async function initMap() {
      if (!showMapPicker || !mapDivRef.current || !MAPBOX_TOKEN) return;

      if (!mbRef.current) {
        try { mbRef.current = await import("mapbox-gl"); } catch { setGeoErr("Mapbox GL failed to load."); return; }
      }
      if (cancelled) return;

      const MapboxGL = (mbRef.current as any).default || mbRef.current;
      MapboxGL.accessToken = MAPBOX_TOKEN;

      const g0 = getTownGeo(town);
      const cLng = toNum(pickupLng, g0 ? g0.center[0] : 121.1175);
      const cLat = toNum(pickupLat, g0 ? g0.center[1] : 16.7999);

      if (!mapRef.current) {
        mapRef.current = new MapboxGL.Map({
          container: mapDivRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [cLng, cLat],
          zoom: 14,
        });
        mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");

        mapRef.current.on("load", () => {
          try { ensureRouteLayer(mapRef.current); } catch {}
        });

        mapRef.current.on("click", async (e: any) => {
          try {
            const lng = Number(e?.lngLat?.lng);
            const lat = Number(e?.lngLat?.lat);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

            if (pickModeRef.current === "pickup") {
              setPickupLat(String(lat));
              setPickupLng(String(lng));
              const name = await geocodeReverse(lng, lat);
              if (name) setFromLabel(name);
            } else {
              setDropLat(String(lat));
              setDropLng(String(lng));
              const name = await geocodeReverse(lng, lat);
              if (name) setToLabel(name);
            }
          } catch {}
        });
      }

      // Update markers
      try {
        const plng = toNum(pickupLng, 121.1175);
        const plat = toNum(pickupLat, 16.7999);
        const dlng = toNum(dropLng, 121.1175);
        const dlat = toNum(dropLat, 16.7999);

        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = new MapboxGL.Marker({ color: "#16a34a" }).setLngLat([plng, plat]).addTo(mapRef.current);
        } else {
          pickupMarkerRef.current.setLngLat([plng, plat]);
        }

        if (numOrNull(dropLat) !== null && numOrNull(dropLng) !== null) {
          if (!dropoffMarkerRef.current) {
            dropoffMarkerRef.current = new MapboxGL.Marker({ color: "#dc2626" }).setLngLat([dlng, dlat]).addTo(mapRef.current);
          } else {
            dropoffMarkerRef.current.setLngLat([dlng, dlat]);
          }
        }
      } catch {}
    }

    initMap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng]);

  // Route preview fetch
  React.useEffect(() => {
    if (!showMapPicker || !MAPBOX_TOKEN) return;
    try { if (mapRef.current) ensureRouteLayer(mapRef.current); } catch {}

    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);

    const hasDropoff = numOrNull(dropLat) !== null && numOrNull(dropLng) !== null;
    if (!hasDropoff) {
      setRouteInfo(null);
      routeGeoRef.current = { type: "FeatureCollection", features: [] };
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    routeDebounceRef.current = setTimeout(() => fetchRouteAndUpdate(), 350);
    return () => { if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker, pickupLat, pickupLng, dropLat, dropLng, MAPBOX_TOKEN]);

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // FUNCTIONS
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  async function refreshCanBook() {
    setCanInfoErr("");
    try {
      const qTown = encodeURIComponent(norm(town));
      const qLat = encodeURIComponent(norm(String(geoLat ?? pickupLat ?? "")));
      const qLng = encodeURIComponent(norm(String(geoLng ?? pickupLng ?? "")));
      const qCode = hasLocalVerify() ? encodeURIComponent(norm(localVerify)) : "";
      const url = "/api/public/passenger/can-book?town=" + qTown +
        (qLat ? "&pickup_lat=" + qLat : "") +
        (qLng ? "&pickup_lng=" + qLng : "") +
        (qCode ? "&local_verification_code=" + qCode : "");
      const r = await getJson(url);
      if (!r.ok) { setCanInfoErr("CAN_BOOK_INFO_FAILED: HTTP " + r.status); setCanInfo(null); return; }
      setCanInfo(r.json as CanBookInfo);
      if (r.json?.verified === true || norm(r.json?.verification_status).toLowerCase() === "verified") {
        setShowVerifyPanel(false);
      }
    } catch (e: any) {
      setCanInfoErr("CAN_BOOK_INFO_ERROR: " + String(e?.message || e));
      setCanInfo(null);
    }
  }

  function promptGeoFromClick() {
    setGeoGateErr("");
    try {
      const geo: any = navigator?.geolocation;
      if (!geo?.getCurrentPosition) {
        setGeoGateErr("Geolocation not available.");
        setGeoPermission("denied");
        return;
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");
      geo.getCurrentPosition(
        (pos: any) => {
          const lat = Number(pos?.coords?.latitude);
          const lng = Number(pos?.coords?.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setGeoGateErr("Could not read coordinates."); return; }
          setGeoPermission("granted");
          setGeoLat(lat);
          setGeoLng(lng);
          setGeoInsideIfugao(inIfugaoBBox(lat, lng));
        },
        (err: any) => {
          if (Number(err?.code) === 1) { setGeoPermission("denied"); setGeoGateErr("Location permission denied."); }
          else { setGeoGateErr("Location error: " + String(err?.message || err)); }
        },
        { enableHighAccuracy: isMobile, timeout: isMobile ? 15000 : 8000, maximumAge: 0 }
      );
    } catch (e: any) {
      setGeoGateErr("Location check failed: " + String(e?.message || e));
    }
  }

  async function refreshGeoGate(prompt: boolean) {
    setGeoGateErr("");
    try {
      const anyNav: any = navigator;
      if (anyNav?.permissions?.query) {
        const st = await anyNav.permissions.query({ name: "geolocation" });
        const s = String(st?.state || "");
        if (s === "granted") setGeoPermission("granted");
        else if (s === "denied") setGeoPermission("denied");
        else setGeoPermission("unknown");
        if (!prompt && s !== "granted") return;
      }

      const geo: any = navigator?.geolocation;
      if (!geo?.getCurrentPosition) { setGeoGateErr("Geolocation not available."); setGeoPermission("denied"); return; }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

      await new Promise<void>((resolve) => {
        geo.getCurrentPosition(
          (pos: any) => {
            const lat = Number(pos?.coords?.latitude);
            const lng = Number(pos?.coords?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) { setGeoGateErr("Could not read coordinates."); resolve(); return; }
            setGeoPermission("granted");
            setGeoLat(lat);
            setGeoLng(lng);
            setGeoInsideIfugao(inIfugaoBBox(lat, lng));
            resolve();
          },
          (err: any) => {
            if (Number(err?.code) === 1) { setGeoPermission("denied"); setGeoGateErr("Location permission denied."); }
            else { setGeoGateErr("Location error: " + String(err?.message || err)); }
            resolve();
          },
          { enableHighAccuracy: prompt && isMobile, timeout: prompt && isMobile ? 15000 : 8000, maximumAge: 60000 }
        );
      });
    } catch (e: any) {
      setGeoGateErr("Location check failed: " + String(e?.message || e));
    }
  }

  // â”€â”€â”€ Mapbox geocoding â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function buildQuery(label: string): string {
    const q = norm(label);
    if (!q) return "";
    if (q.length <= 4) return q;
    return q + ", " + town + ", Ifugao";
  }

  async function geocodeForward(label: string): Promise<GeoFeature[]> {
    setGeoErr("");
    const q = buildQuery(label);
    if (!q) return [];
    if (!MAPBOX_TOKEN) { setGeoErr("Mapbox token missing."); return []; }

    const tGeo = getTownGeo(town);
    const proxLng = toNum(pickupLng, tGeo ? tGeo.center[0] : 121.1175);
    const proxLat = toNum(pickupLat, tGeo ? tGeo.center[1] : 16.7999);
    const bboxStr = tGeo ? [tGeo.bbox[0], tGeo.bbox[1], tGeo.bbox[2], tGeo.bbox[3]].join(",") : "";

    const url =
      "https://api.mapbox.com/search/searchbox/v1/suggest" +
      "?q=" + encodeURIComponent(q) +
      "&limit=6&country=PH&language=en&types=poi,address,place" +
      "&proximity=" + encodeURIComponent(proxLng + "," + proxLat) +
      (bboxStr ? "&bbox=" + encodeURIComponent(bboxStr) : "") +
      "&session_token=" + encodeURIComponent(sessionTokenRef.current) +
      "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    const arr: any[] = Array.isArray(j?.suggestions || j?.results || j?.features) ? (j.suggestions || j.results || j.features) : [];

    function pickCenter(it: any): [number, number] | undefined {
      const c1 = it?.geometry?.coordinates;
      if (Array.isArray(c1) && c1.length >= 2) return [Number(c1[0]), Number(c1[1])];
      const c2 = it?.coordinates;
      if (c2) { const lng = Number(c2.longitude ?? c2.lng); const lat = Number(c2.latitude ?? c2.lat); if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat]; }
      const c3 = it?.center;
      if (Array.isArray(c3) && c3.length >= 2) return [Number(c3[0]), Number(c3[1])];
      return undefined;
    }

    const mapped: GeoFeature[] = arr.map((it) => ({
      id: String(it?.mapbox_id || it?.id || ""),
      mapbox_id: String(it?.mapbox_id || it?.id || ""),
      place_name: norm(it?.place_formatted || it?.place_name || it?.full_address || it?.name || ""),
      text: norm(it?.name || it?.text || ""),
      center: pickCenter(it),
      feature_type: norm(it?.feature_type || it?.type || ""),
      raw: it,
    }));

    // Merge local landmarks first
    const locals = localLandmarkMatches(q, town);
    if (locals.length) {
      const seen = new Set<string>();
      const merged: GeoFeature[] = [];
      for (const f of locals) { const k = norm(f.place_name || f.text).toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); merged.push(f); }
      for (const f of mapped) { const k = norm(f.place_name || f.text).toLowerCase(); if (!k || seen.has(k)) continue; seen.add(k); merged.push(f); }
      return merged;
    }

    return mapped;
  }

  async function searchboxRetrieve(mapboxId: string): Promise<GeoFeature | null> {
    if (!MAPBOX_TOKEN || !mapboxId) return null;
    const url = "https://api.mapbox.com/search/searchbox/v1/retrieve/" + encodeURIComponent(mapboxId) +
      "?session_token=" + encodeURIComponent(sessionTokenRef.current) + "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);
    try {
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      const f0 = j?.features?.[0];
      if (!f0) return null;
      const coords = f0?.geometry?.coordinates;
      const center: [number, number] | undefined = Array.isArray(coords) && coords.length >= 2 ? [Number(coords[0]), Number(coords[1])] : undefined;
      return {
        id: mapboxId, mapbox_id: mapboxId,
        place_name: norm(f0?.properties?.place_formatted || f0?.properties?.full_address || f0?.properties?.name || ""),
        text: norm(f0?.properties?.name || ""),
        center,
      };
    } catch { return null; }
  }

  async function geocodeReverse(lng: number, lat: number): Promise<string> {
    if (!MAPBOX_TOKEN) return "";
    const url = "https://api.mapbox.com/geocoding/v5/mapbox.places/" + encodeURIComponent(lng + "," + lat) +
      ".json?limit=1&country=PH&access_token=" + encodeURIComponent(MAPBOX_TOKEN);
    try {
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      return norm(j?.features?.[0]?.place_name || "");
    } catch { return ""; }
  }

  async function applyGeoSelection(field: "from" | "to", f: GeoFeature) {
    const name = norm(f.place_name || f.text);
    let c = f.center;

    if ((!c || c.length !== 2) && f.mapbox_id) {
      const got = await searchboxRetrieve(String(f.mapbox_id));
      if (got?.center) { c = got.center; if (got.place_name) { if (field === "from") setFromLabel(got.place_name); else setToLabel(got.place_name); } }
    }

    if (!c || c.length !== 2) return;
    const lng = Number(c[0]);
    const lat = Number(c[1]);

    if (field === "from") {
      if (name) setFromLabel(name);
      setPickupLat(String(lat));
      setPickupLng(String(lng));
      setGeoFrom([]);
      setActiveGeoField(null);
    } else {
      if (name) setToLabel(name);
      setDropLat(String(lat));
      setDropLng(String(lng));
      setGeoTo([]);
      setActiveGeoField(null);
    }
  }

  // â”€â”€â”€ Route preview â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function ensureRouteLayer(map: any) {
    try {
      if (!map) return;
      if (!map.getSource(ROUTE_SOURCE_ID)) map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeGeoRef.current });
      if (!map.getLayer(ROUTE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LAYER_ID, type: "line", source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-width": 4, "line-opacity": 0.85 },
        });
      }
    } catch {}
  }

  function pushRouteToMap(map: any, geo: any) {
    try { const src = map?.getSource(ROUTE_SOURCE_ID); if (src?.setData) src.setData(geo); } catch {}
  }

  async function fetchRouteAndUpdate() {
    if (!MAPBOX_TOKEN) return;
    const plng = toNum(pickupLng, 121.1175);
    const plat = toNum(pickupLat, 16.7999);
    const dlng = toNum(dropLng, 121.1175);
    const dlat = toNum(dropLat, 16.7999);

    try { routeAbortRef.current?.abort(); } catch {}
    const ac = new AbortController();
    routeAbortRef.current = ac;

    const coords = plng + "," + plat + ";" + dlng + "," + dlat;
    const url = "https://api.mapbox.com/directions/v5/mapbox/driving/" + encodeURIComponent(coords) +
      "?geometries=geojson&overview=simplified&alternatives=false&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    try {
      const r = await fetch(url, { signal: ac.signal });
      const j = await r.json().catch(() => ({}));
      const route0 = j?.routes?.[0];
      const geom = route0?.geometry;

      if (!geom?.coordinates?.length) {
        setRouteInfo(null);
        routeGeoRef.current = { type: "FeatureCollection", features: [] };
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
        return;
      }

      const geo = { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: geom }] };
      routeGeoRef.current = geo;
      setRouteInfo({ distance_m: Number(route0.distance || 0), duration_s: Number(route0.duration || 0) });
      if (mapRef.current) { ensureRouteLayer(mapRef.current); pushRouteToMap(mapRef.current, geo); }
    } catch (e: any) {
      if (String(e?.name) !== "AbortError") {
        setRouteInfo(null);
        routeGeoRef.current = { type: "FeatureCollection", features: [] };
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      }
    }
  }

  // â”€â”€â”€ Fare accept/reject â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function fareAccept() {
    const b = liveBooking as any;
    const bookingId = norm(b?.id || b?.booking_id);
    if (!bookingId) return;
    setFareBusy(true);
    try {
      await postJson("/api/public/passenger/fare/accept", { booking_id: bookingId });
    } catch {} finally { setFareBusy(false); }
  }

  async function fareReject() {
    const b = liveBooking as any;
    const bookingId = norm(b?.id || b?.booking_id);
    if (!bookingId) return;
    setFareBusy(true);
    try {
      await postJson("/api/public/passenger/fare/reject", { booking_id: bookingId });
    } catch {} finally { setFareBusy(false); }
  }

  // â”€â”€â”€ Verification helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function verifyRequestText(): string {
    return [
      "JRIDE VERIFICATION REQUEST",
      "Passenger name: " + passengerName,
      "Town: " + town,
      "Requested at: " + new Date().toISOString(),
      "Reason: Please verify my passenger account so I can book rides.",
    ].join("\n");
  }

  async function copyVerifyRequest() {
    setCopied(false);
    try {
      await navigator.clipboard.writeText(verifyRequestText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = verifyRequestText();
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {}
    }
  }

  // â”€â”€â”€ Clear booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function handleClear() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    try { routeAbortRef.current?.abort?.(); } catch {}
    try { pickupMarkerRef.current?.remove?.(); dropoffMarkerRef.current?.remove?.(); } catch {}
    try { if (mapRef.current) mapRef.current.remove(); } catch {}
    pickupMarkerRef.current = null;
    dropoffMarkerRef.current = null;
    mapRef.current = null;
    routeGeoRef.current = { type: "FeatureCollection", features: [] };

    const g = getTownGeo(town);
    setActiveCode("");
    setLiveBooking(null);
    setLiveStatus("");
    setLiveErr("");
    setResult("");
    setFareBusy(false);
    stored_set("");

    setShowVerifyPanel(false);
    setCopied(false);
    setActiveGeoField(null);
    setGeoFrom([]);
    setGeoTo([]);
    setGeoErr("");
    setShowMapPicker(true);
    setPickMode("pickup");
    setRouteInfo(null);
    setFeesAck(false);

    if (g) {
      setPickupLng(String(g.center[0]));
      setPickupLat(String(g.center[1]));
      setFromLabel(norm(town) + " Town Proper");
      setDropLng("");
      setDropLat("");
      setToLabel("");
      townAppliedRef.current = "";
      pickupTouchedRef.current = false;
    }

    setMapResetKey((v) => v + 1);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("booking_code");
      window.history.replaceState({}, "", url.pathname);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  // â”€â”€â”€ Submit booking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function submit() {
    setResult("");
    setBusy(true);

    const v = vehicleType;
    const pax = Number(clampPax(v, passengerCount));
    const maxPax = v === "motorcycle" ? 1 : 4;
    if (!pax || pax <= 0) { setResult("Please enter passengers (1-" + maxPax + ")."); setBusy(false); return; }
    if (pax > maxPax) { setResult("Max " + maxPax + " for " + v + "."); setBusy(false); return; }

    try {
      // Geo gate
      if (geoPermission !== "granted" || geoInsideIfugao !== true) {
        await refreshGeoGate(true);
        if (geoPermission !== "granted" || geoInsideIfugao !== true) {
          setResult("GEO_BLOCKED: Location required inside Ifugao.");
          setBusy(false);
          return;
        }
      }

      // Can-book check
      const qTown = encodeURIComponent(norm(town));
      const qLat = encodeURIComponent(norm(pickupLat));
      const qLng = encodeURIComponent(norm(pickupLng));
      const qCode = hasLocalVerify() ? encodeURIComponent(norm(localVerify)) : "";
      const canUrl = "/api/public/passenger/can-book?town=" + qTown +
        (qLat ? "&pickup_lat=" + qLat : "") + (qLng ? "&pickup_lng=" + qLng : "") +
        (qCode ? "&local_verification_code=" + qCode : "");
      const can = await getJson(canUrl);
      if (!can.ok) {
        const cj = (can.json || {}) as CanBookInfo;
        setResult("CAN_BOOK_BLOCKED: " + normUpper(cj.code || "BLOCKED") + " - " + norm(cj.message || "Not allowed"));
        await refreshCanBook();
        if (!cj.verified && (cj.nightGate || normUpper(cj.code).includes("UNVERIFIED"))) setShowVerifyPanel(true);
        return;
      }

      // Create booking
      const book = await postJson("/api/public/passenger/book", {
        passenger_name: passengerName,
        town,
        from_label: fromLabel,
        to_label: toLabel,
        pickup_lat: numOrNull(pickupLat),
        pickup_lng: numOrNull(pickupLng),
        dropoff_lat: numOrNull(dropLat),
        dropoff_lng: numOrNull(dropLng),
        service: "ride",
        vehicle_type: vehicleType,
        passenger_count: pax,
        local_verification_code: hasLocalVerify() ? localVerify : undefined,
      });

      if (!book.ok) {
        const bj = book.json || {};
        setResult("BOOK_FAILED: " + (bj.code || "FAILED") + " - " + (bj.message || "Insert failed"));
        return;
      }

      const bj = book.json || {};
      const code = norm(bj.booking?.booking_code || bj.booking_code || "");
      setResult("BOOKED_OK" + (code ? " | Code: " + code : ""));

      // â”€â”€ HANDOFF: store code + start tracking â”€â”€
      if (code) {
        stored_set(code);
        setActiveCode(code);
        setLiveStatus(norm(bj.booking?.status || ""));

        // Update URL so refresh preserves state
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("code", code);
          window.history.replaceState({}, "", url.toString());
        }
      }

      await refreshCanBook();
    } catch (e: any) {
      setResult("ERROR: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  // â”€â”€â”€ Geo suggestion list â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function renderGeoList(field: "from" | "to") {
    const items = field === "from" ? geoFrom : geoTo;
    if (activeGeoField !== field || !items?.length) return null;

    return (
      <div className="mt-1 rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden max-h-48 overflow-y-auto">
        {items.map((f, idx) => {
          const label = norm(f.place_name || f.text) || "(unknown)";
          return (
            <button
              key={(f.id || "") + "_" + idx}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
              onClick={() => applyGeoSelection(field, f)}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
  // RENDER
  // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

  const bannerMsg = activeCode ? statusMessage(liveStatus) : "";
  const bannerTn = activeCode ? statusTone(liveStatus) : "slate";

  // Live booking values (backend fields only)
  const lb = liveBooking as any;
  const liveFare = lb ? (lb.verified_fare ?? lb.proposed_fare ?? null) : null;
  const livePickupFee = lb?.pickup_distance_fee ?? null;
  const livePlatformFee = typeof lb?.platform_fee === "number" && Number.isFinite(lb?.platform_fee) ? lb.platform_fee : null;
  const backendLiveTotal =
    typeof lb?.total_fare === "number" && Number.isFinite(lb?.total_fare)
      ? lb.total_fare
      : typeof lb?.total_amount === "number" && Number.isFinite(lb?.total_amount)
      ? lb.total_amount
      : typeof lb?.grand_total === "number" && Number.isFinite(lb?.grand_total)
      ? lb.grand_total
      : null;
  const hasFare = typeof liveFare === "number" && Number.isFinite(liveFare);
  const fallbackLiveTotal =
    hasFare
      ? (liveFare as number) +
        (typeof livePickupFee === "number" && Number.isFinite(livePickupFee) ? livePickupFee : 0) +
        (typeof livePlatformFee === "number" && Number.isFinite(livePlatformFee) ? livePlatformFee : 0)
      : null;
  const liveTotal =
    typeof backendLiveTotal === "number" && Number.isFinite(backendLiveTotal)
      ? backendLiveTotal
      : typeof fallbackLiveTotal === "number" && Number.isFinite(fallbackLiveTotal)
      ? fallbackLiveTotal
      : null;
  const hasLiveTotal = typeof liveTotal === "number" && Number.isFinite(liveTotal);
  const totalIsFallback =
    !(typeof backendLiveTotal === "number" && Number.isFinite(backendLiveTotal)) &&
    typeof fallbackLiveTotal === "number" &&
    Number.isFinite(fallbackLiveTotal);
  const isFareProposed = normStatus(liveStatus) === "fare_proposed";
  const driverName = norm(lb?.driver_name || "");
  const tripFromLabel = norm(lb?.from_label || fromLabel || "");
  const tripToLabel = norm(lb?.to_label || toLabel || "");
  const tripPassengerName = norm(lb?.passenger_name || signedInPassengerName || passengerName || "");
  const tripTown = norm(lb?.town || town || "");
  const completedAt = norm(lb?.completed_at || (normStatus(liveStatus) === "completed" ? lb?.updated_at : "") || "");
  const cancelledAt = norm(lb?.cancelled_at || (normStatus(liveStatus) === "cancelled" ? lb?.updated_at : "") || "");
  const eligibilityRows = [
    { label: "Verified", value: verified ? "YES" : "NO" },
    { label: "Night gate", value: nightGate ? "ACTIVE" : "INACTIVE" },
    { label: "Wallet", value: walletBlocked ? (walletLocked ? "LOCKED" : "BLOCKED") : "OK" },
    { label: "Location", value: geoPermission !== "granted" ? "PERMISSION REQUIRED" : geoInsideIfugao === true ? "INSIDE IFUGAO" : "OUTSIDE IFUGAO" },
    { label: "Town", value: pilotTownAllowed ? "PILOT ALLOWED" : "NOT ALLOWED" },
  ];
  const blockingReason =
    unverifiedBlocked ? "Verification required. Complete verification before booking." :
    walletBlocked ? ("Wallet blocked. " + (walletLocked ? "Wallet is locked." : "Maintain the required wallet balance.")) :
    !geoOrLocalOk ? (geoPermission !== "granted" ? "Location permission required." : "Booking is allowed only inside Ifugao.") :
    !pilotTownAllowed ? "Selected town is not yet enabled for booking." :
    !norm(toLabel) || numOrNull(dropLat) === null || numOrNull(dropLng) === null ? "Select a valid drop-off location." :
    !feesAck ? "Acknowledge the booking fees before requesting a ride." :
    "";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7faf9_0%,#f2f7f5_48%,#eef5f2_100%)] text-slate-900">
      <div className="mx-auto max-w-5xl px-4 py-6 space-y-5">
        <div className="rounded-[28px] border border-white/80 bg-white/90 px-5 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Book a Ride</h1>
              <p className="mt-1 text-sm text-slate-500">Fast, secure, and trackable rides with a cleaner premium booking flow.</p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">JRide Passenger</div>
              <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 sm:inline-flex">
                {authLoading ? "Checking session..." : authed ? `Signed in${accountName ? ` · ${accountName}` : ""}` : "Guest"}
              </div>
              {authed ? (
                <button
                  type="button"
                  onClick={handleLogout}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Logout
                </button>
              ) : (
                <button
                  type="button"
                  onClick={gotoLogin}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_10px_24px_rgba(16,185,129,0.25)] hover:bg-emerald-400"
                >
                  Login
                </button>
              )}
            </div>
          </div>
        </div>

        {/* â”€â”€ Status banner â”€â”€ */}
        {activeCode && bannerMsg && (
          <div className={
            "rounded-2xl border p-4 text-sm shadow-[0_10px_30px_rgba(15,23,42,0.05)] " +
            (bannerTn === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" :
             bannerTn === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-900" :
             bannerTn === "red" ? "border-red-300 bg-red-50 text-red-900" :
             bannerTn === "blue" ? "border-emerald-200 bg-emerald-50/70 text-emerald-950" :
             "border-slate-300 bg-slate-50 text-slate-800")
          }>
            <div className="font-semibold">Current trip status</div>
            <div className="mt-1">{bannerMsg}</div>
            <div className="mt-2 text-[11px] opacity-75">
              Booking code: <span className="font-mono">{activeCode}</span>
            </div>
          </div>
        )}

        {/* â”€â”€ Live tracking section â”€â”€ */}
        {activeCode && (
          <div className="space-y-4">
            {/* Stepper */}
            {liveStatus && <StatusStepper status={liveStatus} />}

            {/* Money card */}
            {hasFare && (
              <div className={
                "rounded-xl border p-4 space-y-3 " +
                (isFareProposed ? "border-amber-200 bg-amber-50/50" : "border-black/10 bg-white")
              }>
                <div>
                  <div className={"text-sm font-semibold " + (isFareProposed ? "text-amber-900" : "text-slate-900")}>
                    {isFareProposed ? "Driver proposed fare" : "Trip fare summary"}
                  </div>
                  <div className="mt-1 text-xs opacity-70">
                    {isFareProposed ? "Accept to continue or request a new quote." : "Fare, pickup fee, and total shown for this trip."}
                  </div>
                </div>
                <div className="space-y-1 text-sm">
                  <div>Fare: {money(liveFare)}</div>
                  {(livePickupFee != null && livePickupFee > 0) || (typeof lb?.driver_to_pickup_km === "number" && Number.isFinite(lb?.driver_to_pickup_km)) ? (
                    <div>
                      Pickup: {km(lb?.driver_to_pickup_km)} • {livePickupFee != null ? money(livePickupFee) : "--"}
                    </div>
                  ) : null}
                  {livePlatformFee != null && <div>Platform fee: {money(livePlatformFee)}</div>}
                </div>
                <div className="border-t border-black/10 pt-3">
                  <div className="text-base font-bold">Total to pay: {hasLiveTotal ? money(liveTotal) : "--"}</div>
                  {totalIsFallback && (
                    <div className="mt-1 text-[11px] opacity-70">Shown as display fallback while backend total is unavailable.</div>
                  )}
                  {!hasLiveTotal && (
                    <div className="mt-1 text-[11px] opacity-70">Waiting for backend total.</div>
                  )}
                </div>
                {isFareProposed && (
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={fareAccept}
                      disabled={fareBusy}
                      className="rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(16,185,129,0.25)] hover:bg-emerald-400 disabled:opacity-50"
                    >
                      Accept fare
                    </button>
                    <button
                      onClick={fareReject}
                      disabled={fareBusy}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      Reject / new quote
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Estimated total (no fare yet) */}
            {!hasFare && (
              <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] space-y-1">
                <div className="text-sm font-semibold">Estimated total</div>
                <div className="text-xs opacity-70">Fare will be proposed by your driver.</div>
              </div>
            )}

            {/* Trip summary */}
            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] space-y-1">
              <div className="text-sm font-semibold">Trip summary</div>
              <div className="text-sm">Booking code: <span className="font-mono">{activeCode}</span></div>
              <div className="text-sm">Passenger: {tripPassengerName || "--"}</div>
              <div className="text-sm">Pickup: {tripFromLabel || "--"}</div>
              <div className="text-sm">Drop-off: {tripToLabel || "--"}</div>
              <div className="text-sm">Town: {tripTown || "--"}</div>
              <div className="text-sm">Status: {normStatus(liveStatus) || "--"}</div>
              <div className="text-sm">Driver: {driverName || (lb?.driver_id ? (String(lb.driver_id).substring(0, 8) + "...") : "Searching...")}</div>
              <div className="text-sm">Updated: {fmtDate(lb?.updated_at)}</div>
            </div>

            {/* Trip metrics */}
            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] space-y-1">
              <div className="text-sm font-semibold">Trip details</div>
              <div className="text-sm">Driver to pickup: {km(lb?.driver_to_pickup_km)}</div>
              <div className="text-sm">Trip distance: {km(lb?.trip_distance_km)}</div>
            </div>

            {liveErr && (
              <div className="text-xs text-red-600 opacity-70">{liveErr}</div>
            )}

            {/* Completed / cancelled receipt */}
            {(normStatus(liveStatus) === "completed" || normStatus(liveStatus) === "cancelled") && (
              <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] space-y-3">
                <div className="text-sm font-semibold">
                  {normStatus(liveStatus) === "completed" ? "Trip receipt" : "Trip summary"}
                </div>
                <div className="grid grid-cols-1 gap-1 text-sm">
                  <div>Booking code: <span className="font-mono">{activeCode}</span></div>
                  <div>Status: {normStatus(liveStatus) || "--"}</div>
                  <div>Passenger: {tripPassengerName || "--"}</div>
                  <div>Driver: {driverName || "--"}</div>
                  <div>Pickup: {tripFromLabel || "--"}</div>
                  <div>Drop-off: {tripToLabel || "--"}</div>
                  <div>Fare: {hasFare ? money(liveFare) : "--"}</div>
                  <div>Pickup: {km(lb?.driver_to_pickup_km)} • {livePickupFee != null ? money(livePickupFee) : "--"}</div>
                  <div>Platform fee: {livePlatformFee != null ? money(livePlatformFee) : "--"}</div>
                  <div>Total: {hasLiveTotal ? money(liveTotal) : "--"}{totalIsFallback ? " (fallback)" : ""}</div>
                  <div>Driver to pickup: {km(lb?.driver_to_pickup_km)}</div>
                  <div>Trip distance: {km(lb?.trip_distance_km)}</div>
                  <div>{normStatus(liveStatus) === "completed" ? "Completed" : "Cancelled"}: {fmtDate(normStatus(liveStatus) === "completed" ? completedAt : cancelledAt)}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      const receiptText = [
                        "JRide receipt",
                        "Booking code: " + activeCode,
                        "Status: " + (normStatus(liveStatus) || "--"),
                        "Passenger: " + (tripPassengerName || "--"),
                        "Driver: " + (driverName || "--"),
                        "Pickup: " + (tripFromLabel || "--"),
                        "Drop-off: " + (tripToLabel || "--"),
                        "Fare: " + (hasFare ? money(liveFare) : "--"),
                        "Pickup: " + km(lb?.driver_to_pickup_km) + " • " + (livePickupFee != null ? money(livePickupFee) : "--"),
                        "Platform fee: " + (livePlatformFee != null ? money(livePlatformFee) : "--"),
                        "Total: " + (hasLiveTotal ? money(liveTotal) : "--") + (totalIsFallback ? " (fallback)" : ""),
                        "Driver to pickup: " + km(lb?.driver_to_pickup_km),
                        "Trip distance: " + km(lb?.trip_distance_km),
                        (normStatus(liveStatus) === "completed" ? "Completed: " : "Cancelled: ") + fmtDate(normStatus(liveStatus) === "completed" ? completedAt : cancelledAt),
                      ].join("\n");
                      try {
                        await navigator.clipboard.writeText(receiptText);
                        setResult("RECEIPT_COPIED");
                      } catch (e: any) {
                        setResult("COPY_FAILED: " + String(e?.message || e));
                      }
                    }}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Copy receipt
                  </button>
                  <button
                    onClick={handleClear}
                    className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    New booking
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {/* BOOKING FORM (hidden when tracking active booking) */}
        {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}
        {!activeCode && (
          <div className="space-y-4">

            {/* Eligibility status */}
            <div className="rounded-[24px] border border-white/80 bg-white/95 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
              <div className="text-sm font-semibold">Booking eligibility</div>
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {eligibilityRows.map((row) => (
                  <div key={row.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="opacity-60">{row.label}</div>
                    <div className="font-semibold">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Blocking reason */}
            {!!blockingReason && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 shadow-sm space-y-1">
                <div className="text-sm font-semibold text-red-900">Booking blocked</div>
                <div className="text-xs text-red-800">{blockingReason}</div>
              </div>
            )}

            {/* Geo gate warning */}
            {!geoOrLocalOk && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm space-y-2">
                <div className="text-sm font-semibold text-amber-900">
                  {geoPermission !== "granted" ? "Location permission required" : "Outside Ifugao"}
                </div>
                <div className="text-xs text-amber-800">
                  {geoPermission !== "granted"
                    ? "Allow location access to book a ride. Booking requires being inside Ifugao."
                    : "Booking is only available inside Ifugao."}
                </div>
                <button
                  onClick={promptGeoFromClick}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-400"
                >
                  Enable location
                </button>
                {geoGateErr && <div className="text-xs text-red-700">{geoGateErr}</div>}
              </div>
            )}

            {/* Unverified block */}
            {unverifiedBlocked && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 shadow-sm space-y-2">
                <div className="text-sm font-semibold text-red-900">Verification required</div>
                <div className="text-xs text-red-800">
                  Your account is not verified. Ride booking is restricted until verification is approved.
                  {canInfo?.window ? (" Night gate window: " + canInfo.window + ".") : ""}
                </div>
                <button
                  onClick={() => setShowVerifyPanel(!showVerifyPanel)}
                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  {showVerifyPanel ? "Hide verification" : "Request verification"}
                </button>
              </div>
            )}

            {/* Verify panel */}
            {showVerifyPanel && (
              <div className="rounded-[24px] border border-white/80 bg-white/95 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] space-y-2">
                <div className="text-sm font-semibold">Verification Request</div>
                <pre className="text-xs bg-white border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">{verifyRequestText()}</pre>
                <button
                  onClick={copyVerifyRequest}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-400"
                >
                  {copied ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
            )}

            {/* Wallet block */}
            {walletBlocked && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 shadow-sm">
                <div className="text-sm font-semibold text-red-900">Wallet requirement not met</div>
                <div className="text-xs text-red-800">
                  Balance: {String(canInfo?.wallet_balance ?? "N/A")} |
                  Min required: {String(canInfo?.min_wallet_required ?? "N/A")} |
                  {walletLocked ? " Locked" : " Low balance"}
                </div>
              </div>
            )}

            {/* Town select */}
            <div>
              <label className="text-xs font-medium">Town</label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                value={town}
                onChange={(e) => setTown(e.target.value)}
              >
                {PILOT_TOWNS.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              {!pilotTownAllowed && (
                <div className="mt-1 text-xs text-amber-700">This town is not yet available for booking.</div>
              )}
            </div>

            {/* Passenger name */}
            <div>
              <label className="text-xs font-medium">Your name</label>
              <input
                className={[
                  "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm shadow-sm",
                  signedInPassengerName
                    ? "border-emerald-200 bg-emerald-50/50 text-slate-700"
                    : "border-slate-200 bg-white"
                ].join(" ")}
                placeholder="Name"
                value={signedInPassengerName || passengerName}
                onChange={(e) => {
                  if (signedInPassengerName) return;
                  setPassengerName(e.target.value);
                }}
                readOnly={!!signedInPassengerName}
              />
              {signedInPassengerName ? (
                <div className="mt-1 text-xs text-slate-500">
                  Autofilled from your signed-in passenger account.
                </div>
              ) : null}
            </div>

            {/* Vehicle type + pax */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Vehicle</label>
                <select
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                  value={vehicleType}
                  onChange={(e) => {
                    const v = e.target.value as "tricycle" | "motorcycle";
                    setVehicleType(v);
                    setPassengerCount(clampPax(v, passengerCount));
                  }}
                >
                  <option value="tricycle">Tricycle</option>
                  <option value="motorcycle">Motorcycle</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-medium">Passengers</label>
                <input
                  type="number"
                  min={1}
                  max={vehicleType === "motorcycle" ? 1 : 4}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                  value={passengerCount}
                  onChange={(e) => setPassengerCount(clampPax(vehicleType, e.target.value))}
                />
              </div>
            </div>

            {/* Pickup location */}
            <div>
              <label className="text-xs font-medium">Pickup location</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                placeholder="Search pickup..."
                value={fromLabel}
                onFocus={() => setActiveGeoField("from")}
                onChange={(e) => { setFromLabel(e.target.value); setActiveGeoField("from"); }}
              />
              {renderGeoList("from")}
            </div>

            {/* Dropoff location */}
            <div>
              <label className="text-xs font-medium">Drop-off location</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                placeholder="Search destination..."
                value={toLabel}
                onFocus={() => setActiveGeoField("to")}
                onChange={(e) => { setToLabel(e.target.value); setActiveGeoField("to"); }}
              />
              {renderGeoList("to")}
            </div>

            {/* Coordinates (read-only display) */}
            <div className="grid grid-cols-2 gap-3 text-xs opacity-70">
              <div>Pickup: {pickupLat}, {pickupLng}</div>
              <div>Drop-off: {dropLat || "--"}, {dropLng || "--"}</div>
            </div>

            {geoErr && <div className="text-xs text-red-600">{geoErr}</div>}

            {/* Map picker toggle */}
            {MAPBOX_TOKEN && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowMapPicker(!showMapPicker)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  {showMapPicker ? "Hide map" : "Pick on map"}
                </button>

                {showMapPicker && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPickMode("pickup")}
                        className={"rounded-lg px-3 py-1.5 text-xs font-medium " + (pickMode === "pickup" ? "bg-emerald-500 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700")}
                      >
                        Set pickup
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickMode("dropoff")}
                        className={"rounded-lg px-3 py-1.5 text-xs font-medium " + (pickMode === "dropoff" ? "bg-slate-800 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-700")}
                      >
                        Set drop-off
                      </button>
                    </div>
                    <div key={mapResetKey} ref={mapDivRef} className="w-full h-72 rounded-2xl border border-emerald-100 shadow-inner bg-white" />
                    {routeInfo && (
                      <div className="text-xs opacity-70">
                        Route: {(routeInfo.distance_m / 1000).toFixed(1)} km · ~{Math.ceil(routeInfo.duration_s / 60)} min
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Fees acknowledgement */}
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm space-y-2">
              <div className="text-xs text-slate-700">
                Fare, pickup distance fee, platform fee, and total are backend-driven. Review the quote before you proceed.
              </div>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={feesAck}
                  onChange={(e) => setFeesAck(e.target.checked)}
                  className="rounded"
                />
                I understand the fees
              </label>
            </div>

            {/* Local verification code */}
            <div>
              <label className="text-xs font-medium">Local verification code (optional)</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                placeholder="Enter code if provided"
                value={localVerify}
                onChange={(e) => {
                  setLocalVerify(e.target.value);
                  try { window.localStorage.setItem(LOCAL_VERIFY_KEY, e.target.value); } catch {}
                }}
              />
            </div>

            {/* Submit */}
            <button
              onClick={submit}
              disabled={!allowSubmit}
              className="w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.28)] hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Booking..." : "Request Ride"}
            </button>

            {/* Result */}
            {result && (
              <div className={
                "rounded-2xl border p-4 text-sm shadow-sm " +
                (result.startsWith("BOOKED_OK") ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-700")
              }>
                {result.startsWith("BOOKED_OK")
                  ? "Booking submitted! Tracking will start automatically."
                  : result}
              </div>
            )}

            {canInfoErr && <div className="text-xs text-red-600 opacity-70">{canInfoErr}</div>}

            {recentTrips.length > 0 && (
              <div className="rounded-[24px] border border-white/80 bg-white/95 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] space-y-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">Recent trips</div>
                  <div className="text-xs text-slate-500">Last 7 days on this device, up to 10 trips.</div>
                </div>
                <div className="space-y-2">
                  {recentTrips.map((trip) => (
                    <div key={trip.booking_code} className="rounded-3xl border border-slate-100 bg-slate-50/70 p-4 shadow-sm">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-1">
                          <div className="text-sm font-semibold text-slate-900">{trip.from_label || "--"} â†’ {trip.to_label || "--"}</div>
                          <div className="text-xs text-slate-500">
                            {fmtDate(trip.completed_at || trip.updated_at || trip.saved_at)} • {trip.driver_name || "Driver pending"} • {trip.status}
                          </div>
                          <div className="text-xs text-slate-600">
                            Code: <span className="font-mono">{trip.booking_code}</span> • Total: {typeof trip.total === "number" ? money(trip.total) : "--"}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              stored_set(trip.booking_code);
                              setActiveCode(trip.booking_code);
                              if (typeof window !== "undefined") {
                                const url = new URL(window.location.href);
                                url.searchParams.set("code", trip.booking_code);
                                window.history.replaceState({}, "", url.toString());
                                window.scrollTo({ top: 0, behavior: "smooth" });
                              }
                            }}
                            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            View receipt
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              handleClear();
                              setTown(trip.town || town);
                              setPassengerName((prev) => prev || trip.passenger_name || "");
                              setFromLabel(trip.from_label || "");
                              setToLabel(trip.to_label || "");
                            }}
                            className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
                          >
                            Book again
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
