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

export default function RidePage() {
  const MAPBOX_TOKEN =
    (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "") as string;

  const [authLoading, setAuthLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [accountName, setAccountName] = React.useState("");

  const [town, setTown] = React.useState("Lagawe");
  const [passengerName, setPassengerName] = React.useState("");
  const [signedInPassengerName, setSignedInPassengerName] = React.useState("");
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

  const [canInfo, setCanInfo] = React.useState<CanBookInfo | null>(null);
  const [canInfoErr, setCanInfoErr] = React.useState("");

  const [geoPermission, setGeoPermission] = React.useState<"unknown" | "granted" | "denied">("unknown");
  const [geoInsideIfugao, setGeoInsideIfugao] = React.useState<boolean | null>(null);
  const [geoLat, setGeoLat] = React.useState<number | null>(null);
  const [geoLng, setGeoLng] = React.useState<number | null>(null);
  const [geoGateErr, setGeoGateErr] = React.useState("");

  const [localVerify, setLocalVerify] = React.useState("");
  const [activeCode, setActiveCode] = React.useState(() => storedGet());
  const [liveStatus, setLiveStatus] = React.useState("");
  const [liveBooking, setLiveBooking] = React.useState<TrackPayload | null>(null);
  const [liveErr, setLiveErr] = React.useState("");
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const [fareBusy, setFareBusy] = React.useState(false);

  const [feesAck, setFeesAck] = React.useState(false);
  const [showVerifyPanel, setShowVerifyPanel] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [recentTrips, setRecentTrips] = React.useState<RecentTrip[]>([]);
  const [mapResetKey, setMapResetKey] = React.useState(0);

  const sessionTokenRef = React.useRef("");
  if (!sessionTokenRef.current) {
    sessionTokenRef.current = `sess_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  const [geoFrom, setGeoFrom] = React.useState<GeoFeature[]>([]);
  const [geoTo, setGeoTo] = React.useState<GeoFeature[]>([]);
  const [geoErr, setGeoErr] = React.useState("");
  const [activeGeoField, setActiveGeoField] = React.useState<"from" | "to" | null>(null);
  const fromDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const toDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showMapPicker, setShowMapPicker] = React.useState(true);
  const [pickMode, setPickMode] = React.useState<"pickup" | "dropoff">("pickup");
  const pickModeRef = React.useRef<"pickup" | "dropoff">(pickMode);
  React.useEffect(() => {
    pickModeRef.current = pickMode;
  }, [pickMode]);

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const mbRef = React.useRef<any>(null);
  const pickupMarkerRef = React.useRef<any>(null);
  const dropoffMarkerRef = React.useRef<any>(null);

  const ROUTE_SOURCE_ID = "jride_route_source";
  const ROUTE_LAYER_ID = "jride_route_line";
  const routeAbortRef = React.useRef<AbortController | null>(null);
  const routeDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [routeInfo, setRouteInfo] = React.useState<{ distance_m: number; duration_s: number } | null>(null);
  const routeGeoRef = React.useRef<any>({ type: "FeatureCollection", features: [] });

  const pickupTouchedRef = React.useRef(false);
  const townAppliedRef = React.useRef("");

  const verified = !!canInfo?.verified;
  const nightGate = !!canInfo?.nightGate;
  const walletOk = canInfo?.wallet_ok;
  const walletLocked = !!canInfo?.wallet_locked;
  const geoOk = geoPermission === "granted" && geoInsideIfugao === true;
  const geoOrLocalOk = geoOk || !!norm(localVerify);
  const pilotTownAllowed = isPilotTown(town);

  const unverifiedBlocked =
    !verified && (nightGate || normUpper(canInfo?.code).includes("UNVERIFIED") || normUpper(canInfo?.code).includes("VERIFY"));

  const walletBlocked = walletOk === false || walletLocked;

  const allowSubmit =
    !!fromLabel.trim() &&
    numOrNull(pickupLat) !== null &&
    numOrNull(pickupLng) !== null &&
    !!toLabel.trim() &&
    numOrNull(dropLat) !== null &&
    numOrNull(dropLng) !== null &&
    !!passengerName.trim() &&
    feesAck &&
    !busy;

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
          j?.session?.user?.name ??
          j?.session?.user?.full_name ??
          j?.data?.user?.name ??
          j?.data?.user?.full_name ??
          j?.name ??
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
        if (!alive) return;

        const isAuthed = !!(j?.authed || j?.ok || j?.user || j?.session);
        const sessionName = pickName(j);

        setAuthed(isAuthed);
        setAccountName(sessionName);

        if (sessionName) {
          setSignedInPassengerName(sessionName);
          setPassengerName((prev) => norm(prev) || sessionName);
        } else {
          const recent = readRecentTrips();
          const fallbackName = norm(recent?.[0]?.passenger_name ?? "");
          if (fallbackName) setPassengerName((prev) => norm(prev) || fallbackName);
        }
      } catch {
        if (!alive) return;
        setAuthed(false);
        setAccountName("");
        const recent = readRecentTrips();
        const fallbackName = norm(recent?.[0]?.passenger_name ?? "");
        if (fallbackName) setPassengerName((prev) => norm(prev) || fallbackName);
      } finally {
        if (alive) setAuthLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  function gotoLogin() {
    if (typeof window !== "undefined") window.location.href = "/passenger-login";
  }

  async function handleLogout() {
    try {
      await fetch("/api/public/auth/logout", { method: "POST", cache: "no-store" });
    } catch {}
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {}
      window.location.replace("/passenger-login");
    }
  }

  React.useEffect(() => {
    const g = getTownGeo(town);
    const key = norm(town).toLowerCase();
    if (!g) return;
    if (townAppliedRef.current === key) return;
    townAppliedRef.current = key;

    setPickupLng(String(g.center[0]));
    setPickupLat(String(g.center[1]));
    setFromLabel(`${norm(town)} Town Proper`);
    setGeoFrom([]);
    setDropLng(String(g.center[0]));
    setDropLat(String(g.center[1]));
    setToLabel("");
    setGeoTo([]);
  }, [town]);

  React.useEffect(() => {
    if (!Number.isFinite(geoLat as any) || !Number.isFinite(geoLng as any)) return;
    if (pickupTouchedRef.current) return;
    const isDefault = pickupLat === "16.7999" && pickupLng === "121.1175";
    if (isDefault) {
      setPickupLat(String(geoLat));
      setPickupLng(String(geoLng));
    }
  }, [geoLat, geoLng, pickupLat, pickupLng]);

  React.useEffect(() => {
    if (pickupLat !== "16.7999" || pickupLng !== "121.1175") pickupTouchedRef.current = true;
  }, [pickupLat, pickupLng]);

  React.useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search || "");
      const urlCode = norm(sp.get("code") || sp.get("booking_code") || "");
      if (urlCode) {
        storedSet(urlCode);
        setActiveCode(urlCode);
      }
      const f = norm(sp.get("from") || "");
      const t = norm(sp.get("to") || "");
      if (f) setFromLabel(f);
      if (t) setToLabel(t);
    } catch {}
  }, []);

  React.useEffect(() => {
    refreshCanBook();
  }, []);

  React.useEffect(() => {
    refreshGeoGate(false);
    try {
      const v = window.localStorage.getItem(LOCAL_VERIFY_KEY);
      if (v) setLocalVerify(String(v));
    } catch {}
  }, []);

  React.useEffect(() => {
    setRecentTrips(readRecentTrips());
  }, []);

  React.useEffect(() => {
    if (activeCode) return;
    let alive = true;

    (async () => {
      try {
        const token = getToken();
        if (!token) return;
        const resp = await getJsonAuth("/api/passenger/latest-booking");
        if (!resp.ok) return;
        const code = norm(resp.json?.booking_code || "");
        if (code && alive) {
          storedSet(code);
          setActiveCode(code);
        }
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, [activeCode]);

  React.useEffect(() => {
    if (!activeCode) return;
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    let cancelled = false;

    function clearTrip(reason: string) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      storedSet("");
      setActiveCode("");
      setLiveBooking(null);
      setLiveStatus("");
      setLiveErr("");
      setFareBusy(false);
      setResult(reason);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("code");
        url.searchParams.delete("booking_code");
        window.history.replaceState({}, "", url.pathname);
      }
    }

    async function tick() {
      if (cancelled) return;

      try {
        setLiveErr("");
        const token = getToken();
        if (!token) {
          setLiveErr("AUTH_REQUIRED: Please log in to track your booking.");
          return;
        }

        const resp = await getJsonAuth(`/api/passenger/track?booking_code=${encodeURIComponent(activeCode)}`);

        if (!resp.ok) {
          const errCode = norm(resp.json?.error || "");
          const errMsg = norm(resp.json?.message || resp.json?.error || `HTTP ${resp.status}`);
          const terminalStatus = normStatus(resp.json?.status || "");
          const isTerminalResponse =
            resp.status === 409 &&
            errCode === "BOOKING_NOT_ACTIVE" &&
            ["completed", "cancelled", "rejected"].includes(terminalStatus);

          if (resp.status === 404 || errCode === "BOOKING_NOT_FOUND") {
            clearTrip("PREVIOUS_TRIP_CLEARED");
            return;
          }

          if (isTerminalResponse) {
            const terminalBooking = {
              ...(liveBooking || {}),
              booking_code: norm(resp.json?.booking_code || activeCode || ""),
              status: terminalStatus,
              completed_at: norm(resp.json?.completed_at || liveBooking?.completed_at || ""),
              cancelled_at: norm(resp.json?.cancelled_at || liveBooking?.cancelled_at || ""),
              updated_at: norm(resp.json?.completed_at || resp.json?.cancelled_at || liveBooking?.updated_at || ""),
            } as TrackPayload;

            setLiveBooking(terminalBooking);
            setLiveStatus(terminalStatus);
            setLiveErr("");

            if (terminalStatus === "completed" && pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }

            if ((terminalStatus === "cancelled" || terminalStatus === "rejected") && pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }

            return;
          }

          setLiveErr(`BOOKING_POLL_FAILED: ${errMsg}`);
          return;
        }

        const booking = (resp.json?.booking || resp.json) as TrackPayload;
        const nextStatus = normStatus(booking?.status || "");

        setLiveBooking(booking);
        setLiveStatus(nextStatus);
        setLiveErr("");

        if (nextStatus === "cancelled" || nextStatus === "rejected") {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          return;
        }

        if (nextStatus === "completed" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e: any) {
        setLiveErr(`BOOKING_POLL_ERROR: ${String(e?.message || e)}`);
      }
    }

    tick();
    pollRef.current = setInterval(tick, 3000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeCode]);

  React.useEffect(() => {
    const st = normStatus(liveStatus);
    if (!activeCode || !liveBooking || !["completed", "cancelled", "rejected"].includes(st)) return;

    const b = liveBooking;

    const recentFare =
      numValue(b?.verified_fare) ??
      numValue(b?.proposed_fare) ??
      numValue(b?.fare) ??
      null;

    const recentTotal =
      numValue(b?.total_fare) ??
      numValue(b?.total_amount) ??
      numValue(b?.grand_total) ??
      (recentFare != null
        ? recentFare +
          (numValue(b?.pickup_distance_fee) ?? 0) +
          (numValue(b?.platform_fee) ?? 0)
        : null);

    const item: RecentTrip = {
      booking_code: activeCode,
      status: st,
      passenger_name: norm(b?.passenger_name || passengerName || ""),
      driver_name: norm(b?.driver_name || ""),
      from_label: norm(b?.from_label || fromLabel || ""),
      to_label: norm(b?.to_label || toLabel || ""),
      town: norm(b?.town || town || ""),
      fare: recentFare,
      pickup_distance_fee: numValue(b?.pickup_distance_fee),
      platform_fee: numValue(b?.platform_fee),
      total: recentTotal,
      driver_to_pickup_km: numValue(b?.driver_to_pickup_km),
      trip_distance_km: numValue(b?.trip_distance_km),
      completed_at: norm(b?.completed_at || ""),
      updated_at: norm(b?.updated_at || ""),
      saved_at: new Date().toISOString(),
    };

    upsertRecentTrip(item);
    setRecentTrips(readRecentTrips());
  }, [activeCode, liveBooking, liveStatus, passengerName, fromLabel, toLabel, town]);

  React.useEffect(() => {
    if (activeGeoField !== "from") return;
    if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);
    fromDebounceRef.current = setTimeout(async () => {
      try {
        setGeoFrom(await geocodeForward(fromLabel));
      } catch {
        setGeoFrom([]);
      }
    }, 350);
    return () => {
      if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);
    };
  }, [fromLabel, activeGeoField, town]);

  React.useEffect(() => {
    if (activeGeoField !== "to") return;
    if (toDebounceRef.current) clearTimeout(toDebounceRef.current);
    toDebounceRef.current = setTimeout(async () => {
      try {
        setGeoTo(await geocodeForward(toLabel));
      } catch {
        setGeoTo([]);
      }
    }, 350);
    return () => {
      if (toDebounceRef.current) clearTimeout(toDebounceRef.current);
    };
  }, [toLabel, activeGeoField, town]);

  React.useEffect(() => {
    let cancelled = false;

    async function initMap() {
      if (!showMapPicker || !mapDivRef.current || !MAPBOX_TOKEN) return;

      if (!mbRef.current) {
        try {
          mbRef.current = await import("mapbox-gl");
        } catch {
          setGeoErr("Mapbox GL failed to load.");
          return;
        }
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
          try {
            ensureRouteLayer(mapRef.current);
          } catch {}
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
    return () => {
      cancelled = true;
    };
  }, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng, MAPBOX_TOKEN, town]);

  React.useEffect(() => {
    if (!showMapPicker || !MAPBOX_TOKEN) return;
    try {
      if (mapRef.current) ensureRouteLayer(mapRef.current);
    } catch {}

    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);

    const hasDropoff = numOrNull(dropLat) !== null && numOrNull(dropLng) !== null;
    if (!hasDropoff) {
      setRouteInfo(null);
      routeGeoRef.current = { type: "FeatureCollection", features: [] };
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    routeDebounceRef.current = setTimeout(() => {
      fetchRouteAndUpdate();
    }, 350);

    return () => {
      if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);
    };
  }, [showMapPicker, pickupLat, pickupLng, dropLat, dropLng, MAPBOX_TOKEN]);

  async function refreshCanBook() {
    setCanInfoErr("");
    try {
      const qTown = encodeURIComponent(norm(town));
      const qLat = encodeURIComponent(norm(String(geoLat ?? pickupLat ?? "")));
      const qLng = encodeURIComponent(norm(String(geoLng ?? pickupLng ?? "")));
      const qCode = norm(localVerify) ? encodeURIComponent(norm(localVerify)) : "";
      const url =
        "/api/public/passenger/can-book?town=" +
        qTown +
        (qLat ? `&pickup_lat=${qLat}` : "") +
        (qLng ? `&pickup_lng=${qLng}` : "") +
        (qCode ? `&local_verification_code=${qCode}` : "");
      const r = await getJson(url);
      if (!r.ok) {
        setCanInfoErr(`CAN_BOOK_INFO_FAILED: HTTP ${r.status}`);
        setCanInfo(null);
        return;
      }
      setCanInfo(r.json as CanBookInfo);
      if (r.json?.verified === true || norm(r.json?.verification_status).toLowerCase() === "verified") {
        setShowVerifyPanel(false);
      }
    } catch (e: any) {
      setCanInfoErr(`CAN_BOOK_INFO_ERROR: ${String(e?.message || e)}`);
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
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            setGeoGateErr("Could not read coordinates.");
            return;
          }
          setGeoPermission("granted");
          setGeoLat(lat);
          setGeoLng(lng);
          setGeoInsideIfugao(inIfugaoBBox(lat, lng));
        },
        (err: any) => {
          if (Number(err?.code) === 1) {
            setGeoPermission("denied");
            setGeoGateErr("Location permission denied.");
          } else {
            setGeoGateErr(`Location error: ${String(err?.message || err)}`);
          }
        },
        { enableHighAccuracy: isMobile, timeout: isMobile ? 15000 : 8000, maximumAge: 0 }
      );
    } catch (e: any) {
      setGeoGateErr(`Location check failed: ${String(e?.message || e)}`);
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
      if (!geo?.getCurrentPosition) {
        setGeoGateErr("Geolocation not available.");
        setGeoPermission("denied");
        return;
      }
      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || "");

      await new Promise<void>((resolve) => {
        geo.getCurrentPosition(
          (pos: any) => {
            const lat = Number(pos?.coords?.latitude);
            const lng = Number(pos?.coords?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              setGeoGateErr("Could not read coordinates.");
              resolve();
              return;
            }
            setGeoPermission("granted");
            setGeoLat(lat);
            setGeoLng(lng);
            setGeoInsideIfugao(inIfugaoBBox(lat, lng));
            resolve();
          },
          (err: any) => {
            if (Number(err?.code) === 1) {
              setGeoPermission("denied");
              setGeoGateErr("Location permission denied.");
            } else {
              setGeoGateErr(`Location error: ${String(err?.message || err)}`);
            }
            resolve();
          },
          { enableHighAccuracy: prompt && isMobile, timeout: prompt && isMobile ? 15000 : 8000, maximumAge: 60000 }
        );
      });
    } catch (e: any) {
      setGeoGateErr(`Location check failed: ${String(e?.message || e)}`);
    }
  }

  function buildQuery(label: string): string {
    const q = norm(label);
    if (!q) return "";
    if (q.length <= 4) return q;
    return `${q}, ${town}, Ifugao`;
  }

  async function geocodeForward(label: string): Promise<GeoFeature[]> {
    setGeoErr("");
    const q = buildQuery(label);
    if (!q) return [];
    if (!MAPBOX_TOKEN) {
      setGeoErr("Mapbox token missing.");
      return [];
    }

    const tGeo = getTownGeo(town);
    const proxLng = toNum(pickupLng, tGeo ? tGeo.center[0] : 121.1175);
    const proxLat = toNum(pickupLat, tGeo ? tGeo.center[1] : 16.7999);
    const bboxStr = tGeo ? [tGeo.bbox[0], tGeo.bbox[1], tGeo.bbox[2], tGeo.bbox[3]].join(",") : "";

    const url =
      "https://api.mapbox.com/search/searchbox/v1/suggest" +
      `?q=${encodeURIComponent(q)}` +
      "&limit=6&country=PH&language=en&types=poi,address,place" +
      `&proximity=${encodeURIComponent(`${proxLng},${proxLat}`)}` +
      (bboxStr ? `&bbox=${encodeURIComponent(bboxStr)}` : "") +
      `&session_token=${encodeURIComponent(sessionTokenRef.current)}` +
      `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    const arr: any[] = Array.isArray(j?.suggestions || j?.results || j?.features) ? (j.suggestions || j.results || j.features) : [];

    function pickCenter(it: any): [number, number] | undefined {
      const c1 = it?.geometry?.coordinates;
      if (Array.isArray(c1) && c1.length >= 2) return [Number(c1[0]), Number(c1[1])];
      const c2 = it?.coordinates;
      if (c2) {
        const lng = Number(c2.longitude ?? c2.lng);
        const lat = Number(c2.latitude ?? c2.lat);
        if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
      }
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

    const locals = localLandmarkMatches(q, town);
    if (locals.length) {
      const seen = new Set<string>();
      const merged: GeoFeature[] = [];
      for (const f of locals) {
        const k = norm(f.place_name || f.text).toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        merged.push(f);
      }
      for (const f of mapped) {
        const k = norm(f.place_name || f.text).toLowerCase();
        if (!k || seen.has(k)) continue;
        seen.add(k);
        merged.push(f);
      }
      return merged;
    }

    return mapped;
  }

  async function searchboxRetrieve(mapboxId: string): Promise<GeoFeature | null> {
    if (!MAPBOX_TOKEN || !mapboxId) return null;
    const url =
      "https://api.mapbox.com/search/searchbox/v1/retrieve/" +
      encodeURIComponent(mapboxId) +
      `?session_token=${encodeURIComponent(sessionTokenRef.current)}` +
      `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

    try {
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return null;
      const f0 = j?.features?.[0];
      if (!f0) return null;
      const coords = f0?.geometry?.coordinates;
      const center = Array.isArray(coords) && coords.length >= 2 ? ([Number(coords[0]), Number(coords[1])] as [number, number]) : undefined;
      return {
        id: mapboxId,
        mapbox_id: mapboxId,
        place_name: norm(f0?.properties?.place_formatted || f0?.properties?.full_address || f0?.properties?.name || ""),
        text: norm(f0?.properties?.name || ""),
        center,
      };
    } catch {
      return null;
    }
  }

  async function geocodeReverse(lng: number, lat: number): Promise<string> {
    if (!MAPBOX_TOKEN) return "";
    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(`${lng},${lat}`) +
      `.json?limit=1&country=PH&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;
    try {
      const r = await fetch(url);
      const j = await r.json().catch(() => ({}));
      return norm(j?.features?.[0]?.place_name || "");
    } catch {
      return "";
    }
  }

  async function applyGeoSelection(field: "from" | "to", f: GeoFeature) {
    const name = norm(f.place_name || f.text);
    let c = f.center;

    if ((!c || c.length !== 2) && f.mapbox_id) {
      const got = await searchboxRetrieve(String(f.mapbox_id));
      if (got?.center) {
        c = got.center;
        if (got.place_name) {
          if (field === "from") setFromLabel(got.place_name);
          else setToLabel(got.place_name);
        }
      }
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

  function ensureRouteLayer(map: any) {
    try {
      if (!map) return;
      if (!map.getSource(ROUTE_SOURCE_ID)) {
        map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: routeGeoRef.current });
      }
      if (!map.getLayer(ROUTE_LAYER_ID)) {
        map.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-width": 4, "line-opacity": 0.85 },
        });
      }
    } catch {}
  }

  function pushRouteToMap(map: any, geo: any) {
    try {
      const src = map?.getSource(ROUTE_SOURCE_ID);
      if (src?.setData) src.setData(geo);
    } catch {}
  }

  async function fetchRouteAndUpdate() {
    if (!MAPBOX_TOKEN) return;

    const plng = toNum(pickupLng, 121.1175);
    const plat = toNum(pickupLat, 16.7999);
    const dlng = toNum(dropLng, 121.1175);
    const dlat = toNum(dropLat, 16.7999);

    try {
      routeAbortRef.current?.abort();
    } catch {}

    const ac = new AbortController();
    routeAbortRef.current = ac;

    const coords = `${plng},${plat};${dlng},${dlat}`;
    const url =
      "https://api.mapbox.com/directions/v5/mapbox/driving/" +
      encodeURIComponent(coords) +
      `?geometries=geojson&overview=simplified&alternatives=false&access_token=${encodeURIComponent(MAPBOX_TOKEN)}`;

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

      if (mapRef.current) {
        ensureRouteLayer(mapRef.current);
        pushRouteToMap(mapRef.current, geo);
      }
    } catch (e: any) {
      if (String(e?.name) !== "AbortError") {
        setRouteInfo(null);
        routeGeoRef.current = { type: "FeatureCollection", features: [] };
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      }
    }
  }

  async function fareAccept() {
    const bookingId = norm(liveBooking?.id || liveBooking?.booking_id);
    if (!bookingId) return;
    setFareBusy(true);
    try {
      await postJson("/api/rides/fare-response", { booking_id: bookingId, response: "accepted" }, true);
    } finally {
      setFareBusy(false);
    }
  }

  async function fareReject() {
    const bookingId = norm(liveBooking?.id || liveBooking?.booking_id);
    if (!bookingId) return;
    setFareBusy(true);
    try {
      await postJson("/api/rides/fare-response", { booking_id: bookingId, response: "rejected" }, true);
    } finally {
      setFareBusy(false);
    }
  }

  function verifyRequestText(): string {
    return [
      "JRIDE VERIFICATION REQUEST",
      `Passenger name: ${passengerName}`,
      `Town: ${town}`,
      `Requested at: ${new Date().toISOString()}`,
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

  function handleClear() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    try {
      routeAbortRef.current?.abort();
    } catch {}
    try {
      pickupMarkerRef.current?.remove?.();
      dropoffMarkerRef.current?.remove?.();
    } catch {}
    try {
      if (mapRef.current) mapRef.current.remove();
    } catch {}

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
    storedSet("");

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
      setFromLabel(`${norm(town)} Town Proper`);
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

  async function submit() {
    setResult("");
    setBusy(true);

    const pax = Number(clampPax(vehicleType, passengerCount));
    const maxPax = vehicleType === "motorcycle" ? 1 : 4;

    if (!pax || pax <= 0) {
      setResult(`Please enter passengers (1-${maxPax}).`);
      setBusy(false);
      return;
    }
    if (pax > maxPax) {
      setResult(`Max ${maxPax} for ${vehicleType}.`);
      setBusy(false);
      return;
    }

    try {
      if (geoPermission !== "granted" || geoInsideIfugao !== true) {
        await refreshGeoGate(true);
        if (geoPermission !== "granted" || geoInsideIfugao !== true) {
          setResult("GEO_BLOCKED: Location required inside Ifugao.");
          setBusy(false);
          return;
        }
      }

      const qTown = encodeURIComponent(norm(town));
      const qLat = encodeURIComponent(norm(pickupLat));
      const qLng = encodeURIComponent(norm(pickupLng));
      const qCode = norm(localVerify) ? encodeURIComponent(norm(localVerify)) : "";
      const canUrl =
        "/api/public/passenger/can-book?town=" +
        qTown +
        (qLat ? `&pickup_lat=${qLat}` : "") +
        (qLng ? `&pickup_lng=${qLng}` : "") +
        (qCode ? `&local_verification_code=${qCode}` : "");

      const can = await getJson(canUrl);
      if (!can.ok) {
        const cj = (can.json || {}) as CanBookInfo;
        setResult(`CAN_BOOK_BLOCKED: ${normUpper(cj.code || "BLOCKED")} - ${norm(cj.message || "Not allowed")}`);
        await refreshCanBook();
        if (!cj.verified && (cj.nightGate || normUpper(cj.code).includes("UNVERIFIED"))) {
          setShowVerifyPanel(true);
        }
        return;
      }

      const book = await postJson(
        "/api/public/passenger/book",
        {
          passenger_name: passengerName,
          town,
          pickup_label: fromLabel,
          dropoff_label: toLabel,
          pickup_lat: numOrNull(pickupLat),
          pickup_lng: numOrNull(pickupLng),
          dropoff_lat: numOrNull(dropLat),
          dropoff_lng: numOrNull(dropLng),
          fees_acknowledged: feesAck,
          service: "ride",
          vehicle_type: vehicleType,
          passenger_count: pax,
          local_verification_code: norm(localVerify) ? localVerify : undefined,
        },
        true
      );

      if (!book.ok) {
        const bj = book.json || {};
        setResult(`BOOK_FAILED: ${bj.code || "FAILED"} - ${bj.message || "Insert failed"}`);
        return;
      }

      const bj = book.json || {};
      const code = norm(bj.booking?.booking_code || bj.booking_code || "");
      setResult(`BOOKED_OK${code ? ` | Code: ${code}` : ""}`);

      if (code) {
        storedSet(code);
        setActiveCode(code);
        setLiveStatus(norm(bj.booking?.status || ""));
        if (typeof window !== "undefined") {
          const url = new URL(window.location.href);
          url.searchParams.set("code", code);
          window.history.replaceState({}, "", url.toString());
        }
      }

      await refreshCanBook();
    } catch (e: any) {
      setResult(`ERROR: ${String(e?.message || e)}`);
    } finally {
      setBusy(false);
    }
  }

  function renderGeoList(field: "from" | "to") {
    const items = field === "from" ? geoFrom : geoTo;
    if (activeGeoField !== field || !items?.length) return null;

    return (
      <div className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-black/10 bg-white shadow-sm">
        {items.map((f, idx) => {
          const label = norm(f.place_name || f.text) || "(unknown)";
          return (
            <button
              key={`${f.id || ""}_${idx}`}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-black/5"
              onClick={() => applyGeoSelection(field, f)}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  const bannerMsg = activeCode ? statusMessage(liveStatus) : "";
  const bannerTn = activeCode ? statusTone(liveStatus) : "slate";

  const lb = liveBooking as TrackPayload | null;

  const proposedFareValue = numValue(lb?.proposed_fare);
  const verifiedFareValue = numValue(lb?.verified_fare);
  const payloadFareValue = numValue(lb?.fare);

  // Canonical one-architecture precedence:
  // verified_fare -> proposed_fare -> fare
  const liveFare = verifiedFareValue ?? proposedFareValue ?? payloadFareValue ?? null;

  const livePickupFee = numValue(lb?.pickup_distance_fee);
  const livePlatformFee = numValue(lb?.platform_fee);

  const backendLiveTotal =
    numValue(lb?.total_fare) ??
    numValue(lb?.total_amount) ??
    numValue(lb?.grand_total);

  const fallbackLiveTotal =
    liveFare != null
      ? liveFare + (livePickupFee ?? 0) + (livePlatformFee ?? 0)
      : null;

  const liveTotal = backendLiveTotal ?? fallbackLiveTotal;
  const hasFare = liveFare != null;
  const hasLiveTotal = liveTotal != null;

  const totalIsFallback =
    backendLiveTotal == null &&
    fallbackLiveTotal != null;

  const isFareProposed = normStatus(liveStatus) === "fare_proposed";
  const driverName = norm(lb?.driver_name || "");
  const tripFromLabel = norm(lb?.from_label || fromLabel || "");
  const tripToLabel = norm(lb?.to_label || toLabel || "");
  const tripPassengerName = norm(lb?.passenger_name || signedInPassengerName || passengerName || "");
  const tripTown = norm(lb?.town || town || "");
  const completedAt = norm(lb?.completed_at || (normStatus(liveStatus) === "completed" ? lb?.updated_at : "") || "");
  const cancelledAt = norm(lb?.cancelled_at || (["cancelled", "rejected"].includes(normStatus(liveStatus)) ? lb?.updated_at : "") || "");

  const eligibilityRows = [
    { label: "Verified", value: verified ? "YES" : "NO" },
    { label: "Night gate", value: nightGate ? "ACTIVE" : "INACTIVE" },
    { label: "Wallet", value: walletBlocked ? (walletLocked ? "LOCKED" : "BLOCKED") : "OK" },
    {
      label: "Location",
      value:
        geoPermission !== "granted"
          ? "PERMISSION REQUIRED"
          : geoInsideIfugao === true
          ? "INSIDE IFUGAO"
          : "OUTSIDE IFUGAO",
    },
    { label: "Town", value: pilotTownAllowed ? "PILOT ALLOWED" : "NOT ALLOWED" },
  ];

  const blockingReason =
    unverifiedBlocked
      ? "Verification required. Complete verification before booking."
      : walletBlocked
      ? `Wallet blocked. ${walletLocked ? "Wallet is locked." : "Maintain the required wallet balance."}`
      : !geoOrLocalOk
      ? geoPermission !== "granted"
        ? "Location permission required."
        : "Booking is allowed only inside Ifugao."
      : !pilotTownAllowed
      ? "Selected town is not yet enabled for booking."
      : !norm(toLabel) || numOrNull(dropLat) === null || numOrNull(dropLng) === null
      ? "Select a valid drop-off location."
      : !feesAck
      ? "Acknowledge the booking fees before requesting a ride."
      : "";

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7faf9_0%,#f2f7f5_48%,#eef5f2_100%)] text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <div className="rounded-[28px] border border-white/80 bg-white/90 px-5 py-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)] backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Book a Ride</h1>
              <p className="mt-1 text-sm text-slate-500">
                Fast, secure, and trackable rides with the restored passenger web booking flow.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                JRide Passenger
              </div>
              <div className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 sm:inline-flex">
                {authLoading ? "Checking session..." : authed ? `Signed in${accountName ? ` | ${accountName}` : ""}` : "Guest"}
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

        {activeCode && bannerMsg && (
          <div
            className={
              "rounded-2xl border p-4 text-sm shadow-[0_10px_30px_rgba(15,23,42,0.05)] " +
              (bannerTn === "amber"
                ? "border-amber-300 bg-amber-50 text-amber-900"
                : bannerTn === "green"
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : bannerTn === "red"
                ? "border-red-300 bg-red-50 text-red-900"
                : bannerTn === "blue"
                ? "border-emerald-200 bg-emerald-50/70 text-emerald-950"
                : "border-slate-300 bg-slate-50 text-slate-800")
            }
          >
            <div className="font-semibold">Current trip status</div>
            <div className="mt-1">{bannerMsg}</div>
            <div className="mt-2 text-[11px] opacity-75">
              Booking code: <span className="font-mono">{activeCode}</span>
            </div>
          </div>
        )}

        {activeCode && (
          <div className="space-y-4">
            {liveStatus && <StatusStepper status={liveStatus} />}

            {hasFare && (
              <div className={"rounded-xl border p-4 space-y-3 " + (isFareProposed ? "border-amber-200 bg-amber-50/50" : "border-black/10 bg-white")}>
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
                  {(livePickupFee != null && livePickupFee > 0) ||
                  (numValue(lb?.driver_to_pickup_km) != null) ? (
                    <div>
                      Pickup: {km(numValue(lb?.driver_to_pickup_km))} | {livePickupFee != null ? money(livePickupFee) : "--"}
                    </div>
                  ) : null}
                  {livePlatformFee != null && <div>Platform fee: {money(livePlatformFee)}</div>}
                </div>

                <div className="border-t border-black/10 pt-3">
                  <div className="text-base font-bold">Total to pay: {hasLiveTotal ? money(liveTotal) : "--"}</div>
                  {totalIsFallback && <div className="mt-1 text-[11px] opacity-70">Shown as display fallback while backend total is unavailable.</div>}
                  {!hasLiveTotal && <div className="mt-1 text-[11px] opacity-70">Waiting for backend total.</div>}
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

            {!hasFare && (
              <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] space-y-1">
                <div className="text-sm font-semibold">Estimated total</div>
                <div className="text-xs opacity-70">Fare will be proposed by your driver.</div>
              </div>
            )}

            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] space-y-1">
              <div className="text-sm font-semibold">Trip summary</div>
              <div className="text-sm">
                Booking code: <span className="font-mono">{activeCode}</span>
              </div>
              <div className="text-sm">Passenger: {tripPassengerName || "--"}</div>
              <div className="text-sm">Pickup: {tripFromLabel || "--"}</div>
              <div className="text-sm">Drop-off: {tripToLabel || "--"}</div>
              <div className="text-sm">Town: {tripTown || "--"}</div>
              <div className="text-sm">Status: {normStatus(liveStatus) || "--"}</div>
              <div className="text-sm">Driver: {driverName || (lb?.booking_id ? String(lb.booking_id).substring(0, 8) + "..." : "Searching...")}</div>
              <div className="text-sm">Updated: {fmtDate(lb?.updated_at)}</div>
            </div>

            <div className="rounded-2xl border border-white/80 bg-white p-4 shadow-[0_12px_32px_rgba(15,23,42,0.05)] space-y-1">
              <div className="text-sm font-semibold">Trip details</div>
              <div className="text-sm">Driver to pickup: {km(numValue(lb?.driver_to_pickup_km))}</div>
              <div className="text-sm">Trip distance: {km(numValue(lb?.trip_distance_km))}</div>
            </div>

            {liveErr && <div className="text-xs text-red-600 opacity-70">{liveErr}</div>}

            {["completed", "cancelled", "rejected"].includes(normStatus(liveStatus)) && (
              <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-[0_14px_40px_rgba(15,23,42,0.07)] space-y-3">
                <div className="text-sm font-semibold">{normStatus(liveStatus) === "completed" ? "Trip receipt" : "Trip summary"}</div>

                <div className="grid grid-cols-1 gap-1 text-sm">
                  <div>
                    Booking code: <span className="font-mono">{activeCode}</span>
                  </div>
                  <div>Status: {normStatus(liveStatus) || "--"}</div>
                  <div>Passenger: {tripPassengerName || "--"}</div>
                  <div>Driver: {driverName || "--"}</div>
                  <div>Pickup: {tripFromLabel || "--"}</div>
                  <div>Drop-off: {tripToLabel || "--"}</div>
                  <div>Fare: {hasFare ? money(liveFare) : "--"}</div>
                  <div>
                    Pickup: {km(numValue(lb?.driver_to_pickup_km))} | {livePickupFee != null ? money(livePickupFee) : "--"}
                  </div>
                  <div>Platform fee: {livePlatformFee != null ? money(livePlatformFee) : "--"}</div>
                  <div>
                    Total: {hasLiveTotal ? money(liveTotal) : "--"}
                    {totalIsFallback ? " (fallback)" : ""}
                  </div>
                  <div>Driver to pickup: {km(numValue(lb?.driver_to_pickup_km))}</div>
                  <div>Trip distance: {km(numValue(lb?.trip_distance_km))}</div>
                  <div>
                    {normStatus(liveStatus) === "completed" ? "Completed" : "Cancelled"}:{" "}
                    {fmtDate(normStatus(liveStatus) === "completed" ? completedAt : cancelledAt)}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => {
                      const receiptText = [
                        "JRide receipt",
                        `Booking code: ${activeCode}`,
                        `Status: ${normStatus(liveStatus) || "--"}`,
                        `Passenger: ${tripPassengerName || "--"}`,
                        `Driver: ${driverName || "--"}`,
                        `Pickup: ${tripFromLabel || "--"}`,
                        `Drop-off: ${tripToLabel || "--"}`,
                        `Fare: ${hasFare ? money(liveFare) : "--"}`,
                        `Pickup: ${km(numValue(lb?.driver_to_pickup_km))} | ${livePickupFee != null ? money(livePickupFee) : "--"}`,
                        `Platform fee: ${livePlatformFee != null ? money(livePlatformFee) : "--"}`,
                        `Total: ${hasLiveTotal ? money(liveTotal) : "--"}${totalIsFallback ? " (fallback)" : ""}`,
                        `Driver to pickup: ${km(numValue(lb?.driver_to_pickup_km))}`,
                        `Trip distance: ${km(numValue(lb?.trip_distance_km))}`,
                        `${normStatus(liveStatus) === "completed" ? "Completed" : "Cancelled"}: ${fmtDate(
                          normStatus(liveStatus) === "completed" ? completedAt : cancelledAt
                        )}`,
                      ].join("\n");
                      try {
                        await navigator.clipboard.writeText(receiptText);
                        setResult("RECEIPT_COPIED");
                      } catch (e: any) {
                        setResult(`COPY_FAILED: ${String(e?.message || e)}`);
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

        {!activeCode && (
          <div className="space-y-4">
            <div className="rounded-[24px] border border-white/80 bg-white/95 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)]">
              <div className="text-sm font-semibold">Booking eligibility</div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                {eligibilityRows.map((row) => (
                  <div key={row.label} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <div className="opacity-60">{row.label}</div>
                    <div className="font-semibold">{row.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {!!blockingReason && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 shadow-sm space-y-1">
                <div className="text-sm font-semibold text-red-900">Booking blocked</div>
                <div className="text-xs text-red-800">{blockingReason}</div>
              </div>
            )}

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

            {unverifiedBlocked && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 shadow-sm space-y-2">
                <div className="text-sm font-semibold text-red-900">Verification required</div>
                <div className="text-xs text-red-800">
                  Your account is not verified. Ride booking is restricted until verification is approved.
                  {canInfo?.window ? ` Night gate window: ${canInfo.window}.` : ""}
                </div>
                <button
                  onClick={() => setShowVerifyPanel(!showVerifyPanel)}
                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  {showVerifyPanel ? "Hide verification" : "Request verification"}
                </button>
              </div>
            )}

            {showVerifyPanel && (
              <div className="rounded-[24px] border border-white/80 bg-white/95 p-4 shadow-[0_14px_40px_rgba(15,23,42,0.06)] space-y-2">
                <div className="text-sm font-semibold">Verification Request</div>
                <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs">
                  {verifyRequestText()}
                </pre>
                <button
                  onClick={copyVerifyRequest}
                  className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-400"
                >
                  {copied ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
            )}

            {walletBlocked && (
              <div className="rounded-2xl border border-red-200 bg-red-50/90 p-4 shadow-sm">
                <div className="text-sm font-semibold text-red-900">Wallet requirement not met</div>
                <div className="text-xs text-red-800">
                  Balance: {String(canInfo?.wallet_balance ?? "N/A")} | Min required: {String(canInfo?.min_wallet_required ?? "N/A")} |
                  {walletLocked ? " Locked" : " Low balance"}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium">Town</label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                value={town}
                onChange={(e) => setTown(e.target.value)}
              >
                {PILOT_TOWNS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {!pilotTownAllowed && <div className="mt-1 text-xs text-amber-700">This town is not yet available for booking.</div>}
            </div>

            <div>
              <label className="text-xs font-medium">Your name</label>
              <input
                className={[
                  "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm shadow-sm",
                  signedInPassengerName ? "border-emerald-200 bg-emerald-50/50 text-slate-700" : "border-slate-200 bg-white",
                ].join(" ")}
                placeholder="Name"
                value={signedInPassengerName || passengerName}
                onChange={(e) => {
                  if (signedInPassengerName) return;
                  setPassengerName(e.target.value);
                }}
                readOnly={!!norm(signedInPassengerName)}
              />
              {signedInPassengerName ? (
                <div className="mt-1 text-xs text-slate-500">Autofilled from your signed-in passenger account.</div>
              ) : null}
            </div>

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

            <div>
              <label className="text-xs font-medium">Pickup location</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                placeholder="Search pickup..."
                value={fromLabel}
                onFocus={() => setActiveGeoField("from")}
                onChange={(e) => {
                  setFromLabel(e.target.value);
                  setActiveGeoField("from");
                }}
              />
              {renderGeoList("from")}
            </div>

            <div>
              <label className="text-xs font-medium">Drop-off location</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                placeholder="Search destination..."
                value={toLabel}
                onFocus={() => setActiveGeoField("to")}
                onChange={(e) => {
                  setToLabel(e.target.value);
                  setActiveGeoField("to");
                }}
              />
              {renderGeoList("to")}
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs opacity-70">
              <div>
                Pickup: {pickupLat}, {pickupLng}
              </div>
              <div>
                Drop-off: {dropLat || "--"}, {dropLng || "--"}
              </div>
            </div>

            {geoErr && <div className="text-xs text-red-600">{geoErr}</div>}

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
                        className={
                          "rounded-lg px-3 py-1.5 text-xs font-medium " +
                          (pickMode === "pickup"
                            ? "bg-emerald-500 text-white shadow-sm"
                            : "border border-slate-200 bg-white text-slate-700")
                        }
                      >
                        Set pickup
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickMode("dropoff")}
                        className={
                          "rounded-lg px-3 py-1.5 text-xs font-medium " +
                          (pickMode === "dropoff"
                            ? "bg-slate-800 text-white shadow-sm"
                            : "border border-slate-200 bg-white text-slate-700")
                        }
                      >
                        Set drop-off
                      </button>
                    </div>

                    <div key={mapResetKey} ref={mapDivRef} className="h-72 w-full rounded-2xl border border-emerald-100 bg-white shadow-inner" />

                    {routeInfo && (
                      <div className="text-xs opacity-70">
                        Route: {(routeInfo.distance_m / 1000).toFixed(1)} km | ~{Math.ceil(routeInfo.duration_s / 60)} min
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4 shadow-sm space-y-2">
              <div className="text-xs text-slate-700">
                Pickup is FREE within 1.5 km. A small fee applies beyond that. Review your total fare before confirming.
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={feesAck} onChange={(e) => setFeesAck(e.target.checked)} className="rounded" />
                I understand the fare shown
              </label>
            </div>

            <div>
              <label className="text-xs font-medium">Local verification code (optional)</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm"
                placeholder="Enter code if provided"
                value={localVerify}
                onChange={(e) => {
                  setLocalVerify(e.target.value);
                  try {
                    window.localStorage.setItem(LOCAL_VERIFY_KEY, e.target.value);
                  } catch {}
                }}
              />
            </div>

            <button
              onClick={submit}
              disabled={!allowSubmit}
              className="w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.28)] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Booking..." : "Request Ride"}
            </button>

            {result && (
              <div
                className={
                  "rounded-2xl border p-4 text-sm shadow-sm " +
                  (result.startsWith("BOOKED_OK") ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-700")
                }
              >
                {result.startsWith("BOOKED_OK") ? "Booking submitted. Tracking will start automatically." : result}
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
                          <div className="text-sm font-semibold text-slate-900">
                            {trip.from_label || "--"} {"->"} {trip.to_label || "--"}
                          </div>
                          <div className="text-xs text-slate-500">
                            {fmtDate(trip.completed_at || trip.updated_at || trip.saved_at)} | {trip.driver_name || "Driver pending"} | {trip.status}
                          </div>
                          <div className="text-xs text-slate-600">
                            Code: <span className="font-mono">{trip.booking_code}</span> | Total:{" "}
                            {typeof trip.total === "number" ? money(trip.total) : "--"}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              storedSet(trip.booking_code);
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