"use client";

/**
 * app/ride/page.tsx — Reconstructed passenger booking + tracking page
 *
 * Source: morning zip UX blueprint + current backend contracts
 * Backend contracts (source of truth):
 *   POST /api/public/passenger/book        → { ok, booking_code, booking, assign }
 *   GET  /api/public/passenger/booking?code=...  → { ok, booking: { ...fields, driver_name, driver_lat, driver_lng } }
 *   GET  /api/public/passenger/can-book?town=...&pickup_lat=...&pickup_lng=... → CanBookInfo
 *   POST /api/public/passenger/fare/accept  → { booking_id }
 *   POST /api/public/passenger/fare/reject  → { booking_id }
 *
 * No frontend fare computation. Fares displayed from backend only.
 * No admin/dispatcher route changes.
 */

import * as React from "react";
import { useRouter } from "next/navigation";

// ─── Constants ───────────────────────────────────────────────────

const STORAGE_KEY = "jride_active_booking_code";
const LOCAL_VERIFY_KEY = "jride.local_verify_code";
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

// ─── Types ───────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────

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
  if (st === "completed") return "Trip completed.";
  if (st === "cancelled") return "This trip was cancelled.";
  return "Updating trip status…";
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

// ─── HTTP helpers ────────────────────────────────────────────────

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

// ─── Status stepper component ────────────────────────────────────

function StatusStepper({ status }: { status: string }) {
  const st = normStatus(status);
  const idx = statusIndex(st);

  if (st === "cancelled") {
    return (
      <div className="mt-3">
        <span className="inline-flex items-center rounded-full bg-red-600 text-white px-3 py-1 text-xs font-semibold">
          Cancelled
        </span>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        {STATUS_STEPS.map((s, i) => {
          const done = idx >= 0 && i < idx;
          const now = idx >= 0 && i === idx;

          const bubble =
            "inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold " +
            (now ? "bg-blue-600 text-white" : done ? "bg-black/70 text-white" : "bg-slate-200 text-slate-700");

          const label = "text-[11px] " + (now ? "font-semibold" : done ? "opacity-80" : "opacity-50");

          const pretty =
            s === "on_the_way" ? "On the way" :
            s === "on_trip" ? "On trip" :
            (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, " ");

          return (
            <div key={s} className="flex items-center gap-2">
              <div className={bubble}>{i + 1}</div>
              <div className={label}>{pretty}</div>
              {i < STATUS_STEPS.length - 1 && (
                <div className={"w-6 h-[2px] " + (done ? "bg-black/40" : "bg-black/10")} />
              )}
            </div>
          );
        })}
      </div>
      {idx < 0 && (
        <div className="mt-2 text-xs opacity-70">
          Status: <span className="font-mono">{st || "(loading)"}</span>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN PAGE COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function RidePage() {
  const router = useRouter();

  // ─── Mapbox token ──────────────────────────────────────────────
  const MAPBOX_TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "") as string;

  // ─── Core state ────────────────────────────────────────────────
  const [town, setTown] = React.useState("Lagawe");
  const [passengerName, setPassengerName] = React.useState("");
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

  // ─── Can-book preflight ────────────────────────────────────────
  const [canInfo, setCanInfo] = React.useState<CanBookInfo | null>(null);
  const [canInfoErr, setCanInfoErr] = React.useState("");

  // ─── Geo gate ──────────────────────────────────────────────────
  const [geoPermission, setGeoPermission] = React.useState<"unknown" | "granted" | "denied">("unknown");
  const [geoInsideIfugao, setGeoInsideIfugao] = React.useState<boolean | null>(null);
  const [geoLat, setGeoLat] = React.useState<number | null>(null);
  const [geoLng, setGeoLng] = React.useState<number | null>(null);
  const [geoGateErr, setGeoGateErr] = React.useState("");

  // ─── Local verification code ───────────────────────────────────
  const [localVerify, setLocalVerify] = React.useState("");

  function hasLocalVerify(): boolean { return !!norm(localVerify); }

  // ─── Live tracking state ───────────────────────────────────────
  const [activeCode, setActiveCode] = React.useState(() => stored_get());
  const [liveStatus, setLiveStatus] = React.useState("");
  const [liveBooking, setLiveBooking] = React.useState<any | null>(null);
  const [liveErr, setLiveErr] = React.useState("");
  const pollRef = React.useRef<any>(null);
  const [fareBusy, setFareBusy] = React.useState(false);

  // ─── Fees acknowledgement ──────────────────────────────────────
  const [feesAck, setFeesAck] = React.useState(false);

  // ─── Verification panel ────────────────────────────────────────
  const [showVerifyPanel, setShowVerifyPanel] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // ─── Mapbox geocode state ──────────────────────────────────────
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

  // ─── Map picker state ──────────────────────────────────────────
  const [showMapPicker, setShowMapPicker] = React.useState(false);
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

  // ═══════════════════════════════════════════════════════════════
  // DERIVED STATE
  // ═══════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════
  // EFFECTS
  // ═══════════════════════════════════════════════════════════════

  // Auto-fill passenger name from session
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", { method: "GET" });
        const j: any = await r.json().catch(() => null);
        const nm = norm(j?.user?.name ?? j?.user?.full_name ?? j?.profile?.full_name ?? j?.profile?.name ?? "");
        if (alive && nm) setPassengerName((prev) => prev || nm);
      } catch {}
    })();
    return () => { alive = false; };
  }, []);

  // Town change → reset coords to town center
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

  // ═══════════════════════════════════════════════════════════════
  // FUNCTIONS
  // ═══════════════════════════════════════════════════════════════

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

  // ─── Mapbox geocoding ──────────────────────────────────────────

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

  // ─── Route preview ─────────────────────────────────────────────

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

  // ─── Fare accept/reject ────────────────────────────────────────

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

  // ─── Verification helpers ──────────────────────────────────────

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

  // ─── Clear booking ─────────────────────────────────────────────

  function handleClear() {
    setActiveCode("");
    setLiveBooking(null);
    setLiveStatus("");
    setLiveErr("");
    setResult("");
    stored_set("");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("booking_code");
      window.history.replaceState({}, "", url.pathname);
    }
  }

  // ─── Submit booking ────────────────────────────────────────────

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

      // ── HANDOFF: store code + start tracking ──
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

  // ─── Geo suggestion list ───────────────────────────────────────

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

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════

  const bannerMsg = activeCode ? statusMessage(liveStatus) : "";
  const bannerTn = activeCode ? statusTone(liveStatus) : "slate";

  // Live booking values (backend fields only)
  const lb = liveBooking as any;
  const liveFare = lb ? (lb.verified_fare ?? lb.proposed_fare ?? null) : null;
  const livePickupFee = lb?.pickup_distance_fee ?? null;
  const livePlatformFee = typeof lb?.platform_fee === "number" && Number.isFinite(lb?.platform_fee) ? lb.platform_fee : null;
  const liveTotal =
    typeof lb?.total_fare === "number" && Number.isFinite(lb?.total_fare)
      ? lb.total_fare
      : typeof lb?.total_amount === "number" && Number.isFinite(lb?.total_amount)
      ? lb.total_amount
      : typeof lb?.grand_total === "number" && Number.isFinite(lb?.grand_total)
      ? lb.grand_total
      : null;
  const hasFare = typeof liveFare === "number" && Number.isFinite(liveFare);
  const hasLiveTotal = typeof liveTotal === "number" && Number.isFinite(liveTotal);
  const isFareProposed = normStatus(liveStatus) === "fare_proposed";
  const driverName = norm(lb?.driver_name || "");
  const tripFromLabel = norm(lb?.from_label || fromLabel || "");
  const tripToLabel = norm(lb?.to_label || toLabel || "");
  const tripPassengerName = norm(lb?.passenger_name || passengerName || "");
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
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-2xl p-4 space-y-4">

        {/* ── Status banner ── */}
        {activeCode && bannerMsg && (
          <div className={
            "rounded-xl border p-3 text-sm " +
            (bannerTn === "amber" ? "border-amber-300 bg-amber-50 text-amber-900" :
             bannerTn === "green" ? "border-green-300 bg-green-50 text-green-900" :
             bannerTn === "red" ? "border-red-300 bg-red-50 text-red-900" :
             bannerTn === "blue" ? "border-blue-300 bg-blue-50 text-blue-900" :
             "border-slate-300 bg-slate-50 text-slate-800")
          }>
            <div className="font-semibold">Current trip status</div>
            <div className="mt-1">{bannerMsg}</div>
            <div className="mt-2 text-[11px] opacity-75">
              Booking code: <span className="font-mono">{activeCode}</span>
            </div>
          </div>
        )}

        {/* ── Live tracking section ── */}
        {activeCode && (
          <div className="space-y-4">
            {/* Stepper */}
            {liveStatus && <StatusStepper status={liveStatus} />}

            {/* Fare proposal with accept/reject */}
            {isFareProposed && hasFare && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
                <div className="text-sm font-semibold text-amber-900">Fare Proposed</div>
                <div className="text-lg font-bold">{money(liveFare)}</div>
                {livePickupFee != null && livePickupFee > 0 && (
                  <div className="text-xs opacity-70">Pickup distance fee: {money(livePickupFee)}</div>
                )}
                {livePlatformFee != null && (
                  <div className="text-xs opacity-70">Platform fee: {money(livePlatformFee)}</div>
                )}
                <div className="text-sm font-semibold">
                  Total to pay: {hasLiveTotal ? money(liveTotal) : "--"}
                </div>
                {!hasLiveTotal && (
                  <div className="text-[11px] opacity-70">Waiting for backend total.</div>
                )}
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={fareAccept}
                    disabled={fareBusy}
                    className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    Accept fare
                  </button>
                  <button
                    onClick={fareReject}
                    disabled={fareBusy}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                  >
                    Reject / new quote
                  </button>
                </div>
              </div>
            )}

            {/* Fare summary (non-proposal states) */}
            {!isFareProposed && hasFare && (
              <div className="rounded-lg border border-black/10 p-3 space-y-1">
                <div className="text-sm font-semibold">Total to pay</div>
                <div className="text-sm">Fare: {money(liveFare)}</div>
                {livePickupFee != null && livePickupFee > 0 && (
                  <div className="text-sm">Pickup distance fee: {money(livePickupFee)}</div>
                )}
                {livePlatformFee != null && (
                  <div className="text-sm">Platform fee: {money(livePlatformFee)}</div>
                )}
                <div className="text-sm font-semibold">Total: {hasLiveTotal ? money(liveTotal) : "--"}</div>
              </div>
            )}

            {/* Estimated total (no fare yet) */}
            {!hasFare && (
              <div className="rounded-lg border border-black/10 p-3 space-y-1">
                <div className="text-sm font-semibold">Estimated total</div>
                <div className="text-xs opacity-70">Fare will be proposed by your driver.</div>
              </div>
            )}

            {/* Trip summary */}
            <div className="rounded-lg border border-black/10 p-3 space-y-1">
              <div className="text-sm font-semibold">Trip summary</div>
              <div className="text-sm">Booking code: <span className="font-mono">{activeCode}</span></div>
              <div className="text-sm">Passenger: {tripPassengerName || "--"}</div>
              <div className="text-sm">Pickup: {tripFromLabel || "--"}</div>
              <div className="text-sm">Drop-off: {tripToLabel || "--"}</div>
              <div className="text-sm">Town: {tripTown || "--"}</div>
              <div className="text-sm">Status: {normStatus(liveStatus) || "--"}</div>
              <div className="text-sm">Updated: {fmtDate(lb?.updated_at)}</div>
            </div>

            {/* Driver info */}
            <div className="rounded-lg border border-black/10 p-3 space-y-1">
              <div className="text-sm font-semibold">Driver</div>
              <div className="text-sm">{driverName || (lb?.driver_id ? (String(lb.driver_id).substring(0, 8) + "…") : "Searching…")}</div>
            </div>

            {/* Trip metrics */}
            <div className="rounded-lg border border-black/10 p-3 space-y-1">
              <div className="text-sm font-semibold">Trip details</div>
              <div className="text-sm">Driver to pickup: {km(lb?.driver_to_pickup_km)}</div>
              <div className="text-sm">Trip distance: {km(lb?.trip_distance_km)}</div>
            </div>

            {liveErr && (
              <div className="text-xs text-red-600 opacity-70">{liveErr}</div>
            )}

            {/* Completed / cancelled receipt */}
            {(normStatus(liveStatus) === "completed" || normStatus(liveStatus) === "cancelled") && (
              <div className="rounded-xl border border-black/10 p-4 space-y-3">
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
                  <div>Pickup distance fee: {livePickupFee != null ? money(livePickupFee) : "--"}</div>
                  <div>Platform fee: {livePlatformFee != null ? money(livePlatformFee) : "--"}</div>
                  <div>Total: {hasLiveTotal ? money(liveTotal) : "--"}</div>
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
                        "Pickup distance fee: " + (livePickupFee != null ? money(livePickupFee) : "--"),
                        "Platform fee: " + (livePlatformFee != null ? money(livePlatformFee) : "--"),
                        "Total: " + (hasLiveTotal ? money(liveTotal) : "--"),
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
                    className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                  >
                    Copy receipt
                  </button>
                  <button
                    onClick={handleClear}
                    className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                  >
                    New booking
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════ */}
        {/* BOOKING FORM (hidden when tracking active booking) */}
        {/* ═══════════════════════════════════════════════════════ */}
        {!activeCode && (
          <div className="space-y-4">
            <h1 className="text-2xl font-semibold">Book a Ride</h1>

            {/* Eligibility status */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
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
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-1">
                <div className="text-sm font-semibold text-red-900">Booking blocked</div>
                <div className="text-xs text-red-800">{blockingReason}</div>
              </div>
            )}

            {/* Geo gate warning */}
            {!geoOrLocalOk && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 space-y-2">
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
                  className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500"
                >
                  Enable location
                </button>
                {geoGateErr && <div className="text-xs text-red-700">{geoGateErr}</div>}
              </div>
            )}

            {/* Unverified block */}
            {unverifiedBlocked && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 space-y-2">
                <div className="text-sm font-semibold text-red-900">Verification required</div>
                <div className="text-xs text-red-800">
                  Your account is not verified. Ride booking is restricted until verification is approved.
                  {canInfo?.window ? (" Night gate window: " + canInfo.window + ".") : ""}
                </div>
                <button
                  onClick={() => setShowVerifyPanel(!showVerifyPanel)}
                  className="rounded-lg border border-red-300 px-3 py-1.5 text-xs text-red-800 hover:bg-red-100"
                >
                  {showVerifyPanel ? "Hide verification" : "Request verification"}
                </button>
              </div>
            )}

            {/* Verify panel */}
            {showVerifyPanel && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-2">
                <div className="text-sm font-semibold">Verification Request</div>
                <pre className="text-xs bg-white border border-slate-200 rounded p-2 overflow-x-auto whitespace-pre-wrap">{verifyRequestText()}</pre>
                <button
                  onClick={copyVerifyRequest}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
                >
                  {copied ? "Copied!" : "Copy to clipboard"}
                </button>
              </div>
            )}

            {/* Wallet block */}
            {walletBlocked && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
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
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
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
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                placeholder="Name"
                value={passengerName}
                onChange={(e) => setPassengerName(e.target.value)}
              />
            </div>

            {/* Vehicle type + pax */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium">Vehicle</label>
                <select
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
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
                  className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                  value={passengerCount}
                  onChange={(e) => setPassengerCount(clampPax(vehicleType, e.target.value))}
                />
              </div>
            </div>

            {/* Pickup location */}
            <div>
              <label className="text-xs font-medium">Pickup location</label>
              <input
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                placeholder="Search pickup…"
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
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                placeholder="Search destination…"
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
                  className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-medium hover:bg-slate-50"
                >
                  {showMapPicker ? "Hide map" : "Pick on map"}
                </button>

                {showMapPicker && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPickMode("pickup")}
                        className={"rounded-lg px-3 py-1.5 text-xs font-medium " + (pickMode === "pickup" ? "bg-green-600 text-white" : "border border-black/10")}
                      >
                        Set pickup
                      </button>
                      <button
                        type="button"
                        onClick={() => setPickMode("dropoff")}
                        className={"rounded-lg px-3 py-1.5 text-xs font-medium " + (pickMode === "dropoff" ? "bg-red-600 text-white" : "border border-black/10")}
                      >
                        Set drop-off
                      </button>
                    </div>
                    <div ref={mapDivRef} className="w-full h-64 rounded-lg border border-black/10" />
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
            <div className="rounded-lg border border-black/10 p-3 space-y-2">
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
                className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
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
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? "Booking…" : "Request Ride"}
            </button>

            {/* Result */}
            {result && (
              <div className={
                "rounded-lg border p-3 text-sm " +
                (result.startsWith("BOOKED_OK") ? "border-green-200 bg-green-50 text-green-900" : "border-red-200 bg-red-50 text-red-700")
              }>
                {result.startsWith("BOOKED_OK")
                  ? "Booking submitted! Tracking will start automatically."
                  : result}
              </div>
            )}

            {canInfoErr && <div className="text-xs text-red-600 opacity-70">{canInfoErr}</div>}
          </div>
        )}
      </div>
    </main>
  );
}
