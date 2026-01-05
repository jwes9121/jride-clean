"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type CanBookInfo = {
  ok?: boolean;
  nightGate?: boolean;
  window?: string;

  verified?: boolean;
  verification_source?: string;
  verification_note?: string;

  verification_status?: string | null;
  verification_raw_status?: string | null;

  wallet_ok?: boolean;
  wallet_locked?: boolean;
  wallet_balance?: number | null;
  min_wallet_required?: number | null;
  wallet_source?: string;
  wallet_note?: string;

  code?: string;
  message?: string;
};

type AssignInfo = {
  ok?: boolean;
  driver_id?: string | null;
  note?: string | null;
  update_ok?: boolean;
  update_error?: string | null;
};

type BookingRow = {
  id?: string | null;
  booking_code?: string | null;
  driver_id?: string | null;
  status?: string | null;
};

type BookResp = {
  ok?: boolean;
  booking_code?: string;
  code?: string;
  message?: string;
  booking?: BookingRow | null;
  assign?: AssignInfo | null;
};

type GeoFeature = {
  id?: string;
  mapbox_id?: string;
  place_name?: string;
  text?: string;
  center?: [number, number]; // [lng, lat]
  feature_type?: string;
  raw?: any;
};

function numOrNull(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function norm(s: any): string {
  return String(s || "").trim();
}

function normUpper(s: any): string {
  return norm(s).toUpperCase();
}

function verificationStatusLabelFromApi(canInfo: any): string {
  const s = String(canInfo?.verification_status || "").toLowerCase();
  if (!s || s === "not_submitted") return "Not submitted";
  if (s === "submitted") return "Submitted (dispatcher review)";
  if (s === "pending_admin") return "Pending admin approval";
  if (s === "verified") return "Verified";
  if (s === "rejected") return "Rejected";
  return String(canInfo?.verification_status || "");
}
function verificationStatusLabel(info: any): string {
  if (!info) return "Not submitted";
  if (info.verified === true) return "Verified";
  const note = String(info.verification_note || "").toLowerCase();
  if (note.indexOf("pre_approved_dispatcher") >= 0) return "Pending admin approval";
  if (note.indexOf("dispatcher") >= 0) return "Pending admin approval";
  if (note) return "Submitted (dispatcher review)";
  return "Not submitted";
}

export default function RidePage() {
  const router = useRouter();

  const [town, setTown] = React.useState("Lagawe");
  const [passengerName, setPassengerName] = React.useState("Test Passenger A");

  // Phase 12A (UI-only): Vehicle type + passenger count
  const [vehicleType, setVehicleType] = React.useState<"tricycle" | "motorcycle">("tricycle");
  const [passengerCount, setPassengerCount] = React.useState<string>("1");

  function paxMaxForVehicle(v: string): number {
    return v === "motorcycle" ? 1 : 4;
  }

  function clampPax(v: string, raw: string): string {
    const t = String(raw || "").trim();
    if (!t) return "1";
    const n = Math.floor(Number(t));
    if (!Number.isFinite(n) || n <= 0) return "1";
    const max = paxMaxForVehicle(v);
    return String(Math.min(n, max));
  }


  const [fromLabel, setFromLabel] = React.useState("Lagawe Public Market");
  const [toLabel, setToLabel] = React.useState("Lagawe Town Plaza");

  const [pickupLat, setPickupLat] = React.useState("16.7999");
  const [pickupLng, setPickupLng] = React.useState("121.1175");
  const [dropLat, setDropLat] = React.useState("16.8016");
  const [dropLng, setDropLng] = React.useState("121.1222");

  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<string>("");

  const [activeCode, setActiveCode] = React.useState<string>("");
  const [liveStatus, setLiveStatus] = React.useState<string>("");
  const [liveDriverId, setLiveDriverId] = React.useState<string>("");
  const [liveUpdatedAt, setLiveUpdatedAt] = React.useState<number | null>(null);
  const [liveErr, setLiveErr] = React.useState<string>("");
  const pollRef = React.useRef<any>(null);

  const [canInfo, setCanInfo] = React.useState<CanBookInfo | null>(null);
  const [canInfoErr, setCanInfoErr] = React.useState<string>("");

  const [showVerifyPanel, setShowVerifyPanel] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  // ===== Mapbox geocode + map tap picker (UI-only) =====
  const MAPBOX_TOKEN =
    (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      "") as string;

  // Mapbox Searchbox session token (improves relevance + grouping). UI-only.
  const sessionTokenRef = React.useRef<string>("");
  if (!sessionTokenRef.current) {
    sessionTokenRef.current =
      "sess_" + Math.random().toString(36).slice(2) + "_" + Date.now().toString(36);
  }

  const [geoFrom, setGeoFrom] = React.useState<GeoFeature[]>([]);
  const [geoTo, setGeoTo] = React.useState<GeoFeature[]>([]);

  // Selected suggestion highlight (UI-only)
  const [selectedGeoFromId, setSelectedGeoFromId] = React.useState<string>("");
  const [selectedGeoToId, setSelectedGeoToId] = React.useState<string>("");

  const [geoErr, setGeoErr] = React.useState<string>("");
  const [activeGeoField, setActiveGeoField] = React.useState<"from" | "to" | null>(null);

  const fromDebounceRef = React.useRef<any>(null);
  const toDebounceRef = React.useRef<any>(null);

  // Keyboard navigation for suggestions (UI-only)
  const [geoNavFromIdx, setGeoNavFromIdx] = React.useState<number>(-1);
  const [geoNavToIdx, setGeoNavToIdx] = React.useState<number>(-1);


  const [showMapPicker, setShowMapPicker] = React.useState(false);
  const [pickMode, setPickMode] = React.useState<"pickup" | "dropoff">("pickup");
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const mbRef = React.useRef<any>(null);
  const pickupMarkerRef = React.useRef<any>(null);
  const dropoffMarkerRef = React.useRef<any>(null);

  // ===== Route preview polyline (UI-only) =====
  const ROUTE_SOURCE_ID = "jride_route_source";
  const ROUTE_LAYER_ID = "jride_route_line";
  const routeAbortRef = React.useRef<any>(null);
  const routeDebounceRef = React.useRef<any>(null);
  const [routeErr, setRouteErr] = React.useState<string>("");
  const [routeInfo, setRouteInfo] = React.useState<{ distance_m: number; duration_s: number } | null>(null);
  const routeGeoRef = React.useRef<any>({
    type: "FeatureCollection",
    features: [],
  });

  function hasBothPoints(): boolean {
    const plng = toNum(pickupLng, 121.1175);
    const plat = toNum(pickupLat, 16.7999);
    const dlng = toNum(dropLng, 121.1222);
    const dlat = toNum(dropLat, 16.8016);
    return Number.isFinite(plng) && Number.isFinite(plat) && Number.isFinite(dlng) && Number.isFinite(dlat);
  }

  function emptyRouteGeo(): any {
    return { type: "FeatureCollection", features: [] };
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
    } catch {
      // ignore
    }
  }

  function pushRouteToMap(map: any, geo: any) {
    try {
      if (!map) return;
      const src = map.getSource(ROUTE_SOURCE_ID);
      if (src && src.setData) src.setData(geo);
    } catch {
      // ignore
    }
  }

  async function fetchRouteAndUpdate() {
    setRouteErr("");

    if (!MAPBOX_TOKEN) {
      setRouteErr("Route preview requires Mapbox token.");
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    if (!hasBothPoints()) {
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    const plng = toNum(pickupLng, 121.1175);
    const plat = toNum(pickupLat, 16.7999);
    const dlng = toNum(dropLng, 121.1222);
    const dlat = toNum(dropLat, 16.8016);

    // Cancel in-flight request
    try {
      if (routeAbortRef.current) routeAbortRef.current.abort();
    } catch {
      // ignore
    }
    const ac = new AbortController();
    routeAbortRef.current = ac;

    // Directions API (no traffic for now; can switch to driving-traffic later)
    const coords = String(plng) + "," + String(plat) + ";" + String(dlng) + "," + String(dlat);
    const url =
      "https://api.mapbox.com/directions/v5/mapbox/driving/" +
      encodeURIComponent(coords) +
      "?geometries=geojson&overview=simplified&alternatives=false&access_token=" +
      encodeURIComponent(MAPBOX_TOKEN);

    try {
      const r = await fetch(url, { method: "GET", signal: ac.signal });
      const j = (await r.json().catch(() => ({}))) as any;

      if (!r.ok) {
        setRouteErr("Directions failed: HTTP " + String(r.status));
        setRouteInfo(null);
        routeGeoRef.current = emptyRouteGeo();
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
        return;
      }

      const route0 = (j && j.routes && Array.isArray(j.routes) && j.routes.length) ? j.routes[0] : null;
      const geom = route0 && route0.geometry ? route0.geometry : null;

      if (!geom || !geom.coordinates || !Array.isArray(geom.coordinates) || geom.coordinates.length < 2) {
        setRouteErr("Directions returned no route geometry.");
        setRouteInfo(null);
        routeGeoRef.current = emptyRouteGeo();
        if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
        return;
      }

      const geo = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: geom,
          },
        ],
      };

      routeGeoRef.current = geo;
      setRouteInfo({
        distance_m: Number(route0.distance || 0),
        duration_s: Number(route0.duration || 0),
      });

      if (mapRef.current) {
        ensureRouteLayer(mapRef.current);
        pushRouteToMap(mapRef.current, geo);
      }
    } catch (e: any) {
      const msg = String(e && e.name ? e.name : "") === "AbortError" ? "" : String(e?.message || e);
      if (msg) setRouteErr("Directions error: " + msg);
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
    }
  }


  function toNum(s: string, fallback: number): number {
    const n = numOrNull(s);
    return n === null ? fallback : n;
  }

  function buildQuery(label: string): string {
    const q0 = norm(label);
    if (!q0) return "";

    // Keep short acronyms intact (e.g., "IGH") to avoid pushing results to province/town only.
    const q = q0.replace(/\s+/g, " ").trim();
    if (q.length <= 4) return q;

    // Light context bias without hard-locking.
    // Example: "Ifugao General Hospital" -> "... , Lagawe, Ifugao"
    return q + ", " + town + ", Ifugao";
  }

  async function geocodeForward(label: string): Promise<GeoFeature[]> {
    setGeoErr("");
    const q = buildQuery(label);
    if (!q) return [];

    if (!MAPBOX_TOKEN) {
      setGeoErr("Mapbox token missing. Set NEXT_PUBLIC_MAPBOX_TOKEN (or NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN).");
      return [];
    }

    // Bias near current pickup if available
    const proxLng = toNum(pickupLng, 121.1175);
    const proxLat = toNum(pickupLat, 16.7999);

    // Lagawe bias bbox (minLng,minLat,maxLng,maxLat)
    // Keep it as a bias only (not a hard filter).
    const lagaweBbox = "121.08,16.77,121.16,16.83";
    const useBbox = (String(town || "").toLowerCase() === "lagawe");

    const base =
      "https://api.mapbox.com/search/searchbox/v1/suggest" +
      "?q=" + encodeURIComponent(q) +
      "&limit=6" +
      "&country=PH" +
      "&language=en" +
      "&types=poi,address,place" +
      "&proximity=" + encodeURIComponent(String(proxLng) + "," + String(proxLat)) +
      (useBbox ? ("&bbox=" + encodeURIComponent(lagaweBbox)) : "") +
      "&session_token=" + encodeURIComponent(sessionTokenRef.current) +
      "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    const r = await fetch(base, { method: "GET" });
    const j = (await r.json().catch(() => ({}))) as any;

    const arr = (j && (j.suggestions || j.results || j.features)) ? (j.suggestions || j.results || j.features) : [];
    const items: any[] = Array.isArray(arr) ? arr : [];

    function pickCenter(it: any): [number, number] | undefined {
      // Try a few common shapes without assuming one schema.
      const c1 = it?.geometry?.coordinates;
      if (Array.isArray(c1) && c1.length >= 2) return [Number(c1[0]), Number(c1[1])];

      const c2 = it?.coordinates;
      if (c2 && typeof c2 === "object") {
        const lng = Number(c2.longitude ?? c2.lng ?? c2.lon);
        const lat = Number(c2.latitude ?? c2.lat);
        if (Number.isFinite(lng) && Number.isFinite(lat)) return [lng, lat];
      }

      const c3 = it?.center;
      if (Array.isArray(c3) && c3.length >= 2) return [Number(c3[0]), Number(c3[1])];

      return undefined;
    }

    const mapped: GeoFeature[] = items.map((it) => {
      const id = String(it?.mapbox_id || it?.id || "");
      const name = String(it?.name || it?.text || "").trim();
      const formatted = String(it?.place_formatted || it?.place_name || it?.full_address || "").trim();

      const ft = String(it?.feature_type || it?.type || "").trim();
      const labelOut = (formatted || name || "").trim();

      return {
        id,
        mapbox_id: id,
        place_name: labelOut,
        text: name || labelOut,
        center: pickCenter(it),
        feature_type: ft as any,
        raw: it,
      } as any;
    });

    // Rank POIs first, then address, then place (keep stable ordering for same rank).
    const rank = (f: any): number => {
      const t = String(f?.feature_type || "").toLowerCase();
      if (t === "poi") return 0;
      if (t === "address") return 1;
      if (t === "place") return 2;
      return 9;
    };

    mapped.sort((a: any, b: any) => rank(a) - rank(b));

    // Filter out entries that cannot be applied (need center)
    return mapped;
  }

    async function searchboxRetrieve(mapboxId: string): Promise<GeoFeature | null> {
    if (!MAPBOX_TOKEN) return null;
    const id = String(mapboxId || "").trim();
    if (!id) return null;

    const url =
      "https://api.mapbox.com/search/searchbox/v1/retrieve/" +
      encodeURIComponent(id) +
      "?session_token=" + encodeURIComponent(sessionTokenRef.current) +
      "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    try {
      const r = await fetch(url, { method: "GET" });
      const j = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) return null;

      // retrieve returns "features" in GeoJSON-like shape
      const feats = (j && j.features && Array.isArray(j.features)) ? j.features : [];
      if (!feats.length) return null;

      const f0 = feats[0] || {};
      const coords = f0?.geometry?.coordinates;
      const name = String(f0?.properties?.name || f0?.properties?.place_formatted || f0?.properties?.full_address || "").trim();
      const formatted = String(f0?.properties?.place_formatted || f0?.properties?.full_address || "").trim();
      const ft = String(f0?.properties?.feature_type || f0?.properties?.type || "").trim();

      let center: [number, number] | undefined = undefined;
      if (Array.isArray(coords) && coords.length >= 2) center = [Number(coords[0]), Number(coords[1])];

      const labelOut = (formatted || name || "").trim();

      return {
        id: id,
        mapbox_id: id,
        place_name: labelOut || name,
        text: name || labelOut,
        center,
        feature_type: ft,
        raw: f0,
      };
    } catch {
      return null;
    }
  }
async function geocodeReverse(lng: number, lat: number): Promise<string> {
    if (!MAPBOX_TOKEN) return "";
    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(String(lng) + "," + String(lat)) +
      ".json?limit=1&country=PH&access_token=" +
      encodeURIComponent(MAPBOX_TOKEN);
    try {
      const r = await fetch(url, { method: "GET" });
      const j = (await r.json().catch(() => ({}))) as any;
      const feats = (j && j.features) ? (j.features as any[]) : [];
      if (feats.length) return String(feats[0].place_name || "");
    } catch {
      // ignore
    }
    return "";
  }

  async function applyGeoSelection(field: "from" | "to", f: GeoFeature) {
    const name = String(f.place_name || f.text || "").trim();
    let c = f.center;

    // Searchbox /suggest often has no coordinates. Retrieve on select using mapbox_id.
    if ((!c || c.length !== 2) && f.mapbox_id) {
      const got = await searchboxRetrieve(String(f.mapbox_id));
      if (got && got.center && got.center.length === 2) {
        c = got.center;
        // Prefer retrieve formatted name if present
        const nm = String(got.place_name || got.text || "").trim();
        if (nm) {
          if (field === "from") setFromLabel(nm);
          else setToLabel(nm);
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
            {
        const _selId = String(((f as any).mapbox_id || (f as any).id || "")).trim();
        if (_selId) setSelectedGeoToId(_selId);
      }
      if (name) setToLabel(name);
      setDropLat(String(lat));
      setDropLng(String(lng));
      setGeoTo([]);
      setActiveGeoField(null);
    }
  }

  function renderGeoList(field: "from" | "to") {
    const items = field === "from" ? geoFrom : geoTo;
    const open = activeGeoField === field && items && items.length > 0;

    if (!open) return null;

    const activeIdx = field === "from" ? geoNavFromIdx : geoNavToIdx;
    const selectedId = field === "from" ? selectedGeoFromId : selectedGeoToId;

    return (
      <div className="mt-2 rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
        {items.map((f, idx) => {
          const label = String(f.place_name || f.text || "").trim() || "(unknown)";
          const id = String((f.mapbox_id || f.id || "")).trim();

          const isActive = idx === activeIdx;
          const isSelected = !!selectedId && !!id && selectedId === id;

          const cls =
            "w-full text-left px-3 py-2 text-sm " +
            (isActive ? "bg-black/10 " : "hover:bg-black/5 ") +
            (isSelected ? "font-semibold " : "");

          return (
            <button
              key={(f.id || "") + "_" + String(idx)}
              type="button"
              className={cls}
              onMouseEnter={() => {
                if (field === "from") setGeoNavFromIdx(idx);
                else setGeoNavToIdx(idx);
              }}
              onClick={() => {
                if (id) {
                  if (field === "from") setSelectedGeoFromId(id);
                  else setSelectedGeoToId(id);
                }
                applyGeoSelection(field, f);
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  // Debounced geocoding for pickup label
  React.useEffect(() => {
    if (activeGeoField !== "from") return;
    if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);
    fromDebounceRef.current = setTimeout(async () => {
      try {
        const feats = await geocodeForward(fromLabel);
        setGeoFrom(feats);
      } catch (e: any) {
        setGeoErr("Geocode failed: " + String(e?.message || e));
        setGeoFrom([]);
      }
    }, 350);
    return () => {
      if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);
      fromDebounceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLabel, activeGeoField, town]);

  // Debounced geocoding for dropoff label
  React.useEffect(() => {
    if (activeGeoField !== "to") return;
    if (toDebounceRef.current) clearTimeout(toDebounceRef.current);
    toDebounceRef.current = setTimeout(async () => {
      try {
        const feats = await geocodeForward(toLabel);
        setGeoTo(feats);
      } catch (e: any) {
        setGeoErr("Geocode failed: " + String(e?.message || e));
        setGeoTo([]);
      }
    }, 350);
    return () => {
      if (toDebounceRef.current) clearTimeout(toDebounceRef.current);
      toDebounceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toLabel, activeGeoField, town]);

  // Map picker init / refresh
  React.useEffect(() => {
    let cancelled = false;

    async function initMap() {
      if (!showMapPicker) return;
      if (!mapDivRef.current) return;

      if (!MAPBOX_TOKEN) {
        setGeoErr("Map picker requires Mapbox token. Set NEXT_PUBLIC_MAPBOX_TOKEN (or NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN).");
        return;
      }

      if (!mbRef.current) {
        try {
          const mb = await import("mapbox-gl");
          mbRef.current = mb;
        } catch (e: any) {
          setGeoErr("Mapbox GL failed to load. Ensure mapbox-gl is installed.");
          return;
        }
      }

      if (cancelled) return;

      const mbAny = mbRef.current as any;
      if (mbAny && mbAny.default) {
        mbAny.default.accessToken = MAPBOX_TOKEN;
      } else if (mbAny) {
        mbAny.accessToken = MAPBOX_TOKEN;
      }

      const MapboxGL = (mbAny && mbAny.default) ? mbAny.default : mbAny;

      const centerLng = toNum(pickupLng, 121.1175);
      const centerLat = toNum(pickupLat, 16.7999);

      if (!mapRef.current) {
        mapRef.current = new MapboxGL.Map({
          container: mapDivRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [centerLng, centerLat],
          zoom: 14,
        });

        mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");

        mapRef.current.on("load", () => {
          try {
            ensureRouteLayer(mapRef.current);
            // Push current route state (may be empty)
            pushRouteToMap(mapRef.current, routeGeoRef.current);
          } catch {
            // ignore
          }
        });

        mapRef.current.on("click", async (e: any) => {
          try {
            const lng = Number(e?.lngLat?.lng);
            const lat = Number(e?.lngLat?.lat);
            if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

            if (pickMode === "pickup") {
              setPickupLat(String(lat));
              setPickupLng(String(lng));
              const name = await geocodeReverse(lng, lat);
              if (name) setFromLabel(name);
            } else {
              setDropLat(String(lat));
              setDropLng(String(lng));
              const name2 = await geocodeReverse(lng, lat);
              if (name2) setToLabel(name2);
            }
          } catch {
            // ignore
          }
        });
      } else {
        // Recenter map when toggled
        try {
          mapRef.current.setCenter([centerLng, centerLat]);
        } catch {
          // ignore
        }
      }

      // Update markers on each render
      try {
        const plng = toNum(pickupLng, 121.1175);
        const plat = toNum(pickupLat, 16.7999);
        const dlng = toNum(dropLng, 121.1222);
        const dlat = toNum(dropLat, 16.8016);

        if (!pickupMarkerRef.current) {
          pickupMarkerRef.current = new MapboxGL.Marker({ color: "#16a34a" }).setLngLat([plng, plat]).addTo(mapRef.current);
        } else {
          pickupMarkerRef.current.setLngLat([plng, plat]);
        }

        if (!dropoffMarkerRef.current) {
          dropoffMarkerRef.current = new MapboxGL.Marker({ color: "#dc2626" }).setLngLat([dlng, dlat]).addTo(mapRef.current);
        } else {
          dropoffMarkerRef.current.setLngLat([dlng, dlat]);
        }
      } catch {
        // ignore
      }
    }

    initMap();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng]);

  // Route preview fetch effect (UI-only)
  React.useEffect(() => {
    if (!showMapPicker) return;

    // Ensure layer exists if map already initialized
    try {
      if (mapRef.current) ensureRouteLayer(mapRef.current);
    } catch {
      // ignore
    }

    if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);

    // Only fetch when both pickup + dropoff are set
    if (!hasBothPoints()) {
      setRouteInfo(null);
      routeGeoRef.current = emptyRouteGeo();
      if (mapRef.current) pushRouteToMap(mapRef.current, routeGeoRef.current);
      return;
    }

    routeDebounceRef.current = setTimeout(async () => {
      await fetchRouteAndUpdate();
    }, 350);

    return () => {
      if (routeDebounceRef.current) clearTimeout(routeDebounceRef.current);
      routeDebounceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker, pickupLat, pickupLng, dropLat, dropLng, MAPBOX_TOKEN]);


  async function getJson(url: string) {
    const r = await fetch(url, { method: "GET", cache: "no-store" });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const j = (await r.json().catch(() => ({}))) as any;
    return { ok: r.ok, status: r.status, json: j };
  }

  async function refreshCanBook() {
    setCanInfoErr("");
    try {
      const r = await getJson("/api/public/passenger/can-book");
      if (!r.ok) {
        setCanInfoErr("CAN_BOOK_INFO_FAILED: HTTP " + r.status);
        setCanInfo(null);
        return;
      }
      setCanInfo(r.json as CanBookInfo);
      // AUTO_CLOSE_VERIFY_PANEL_ON_REFRESH
      try {
        const st = String((r.json as any)?.verification_status || "").toLowerCase();
        if (st === "verified" || (r.json as any)?.verified === true) {
          setShowVerifyPanel(false);
        }
      } catch {
        // ignore
      }
    } catch (e: any) {
      setCanInfoErr("CAN_BOOK_INFO_ERROR: " + String(e?.message || e));
      setCanInfo(null);
    }
  }

  React.useEffect(() => {
    refreshCanBook();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    // Live status polling:
    // GET /api/public/passenger/booking?code=BOOKING_CODE
    if (!activeCode) return;

    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        setLiveErr("");
        const url = "/api/public/passenger/booking?code=" + encodeURIComponent(activeCode);
        const resp = await getJson(url);

        if (!resp.ok) {
          const msg =
            (resp.json && (resp.json.message || resp.json.error))
              ? String(resp.json.message || resp.json.error)
              : "HTTP " + String(resp.status);
          setLiveErr("BOOKING_POLL_FAILED: " + msg);
          return;
        }

        const j = resp.json || {};
        const b = (j.booking || (j.data && j.data.booking) || (j.payload && j.payload.booking) || j) as any;

        const st = String((b && b.status) ? b.status : (j.status || "")) || "";
        const did = String((b && b.driver_id) ? b.driver_id : (j.driver_id || "")) || "";

        setLiveStatus(st);
        setLiveDriverId(did);
        setLiveUpdatedAt(Date.now());

        const terminal = st === "completed" || st === "cancelled";
        if (terminal && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e: any) {
        setLiveErr("BOOKING_POLL_ERROR: " + String(e?.message || e));
      }
    }

    tick();
    pollRef.current = setInterval(() => { tick(); }, 3000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [activeCode]);

  const verified = !!canInfo?.verified;
  const nightGate = !!canInfo?.nightGate;

  const walletOk = canInfo?.wallet_ok;
  const walletLocked = !!canInfo?.wallet_locked;

  function pill(text: string, good: boolean) {
    return (
      <span
        className={
          "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold " +
          (good ? "bg-green-600 text-white" : "bg-slate-200 text-slate-800")
        }
      >
        {text}
      </span>
    );
  }

  const walletPillText =
    walletOk === undefined ? "Wallet: (no data)" : walletOk ? "Wallet: OK" : walletLocked ? "Wallet: LOCKED" : "Wallet: LOW";
  const walletPillGood = walletOk === true;

  const canCode = normUpper(canInfo?.code);
  const canMsg = norm(canInfo?.message);

  const unverifiedBlocked =
    !verified &&
    (
      nightGate ||
      canCode.indexOf("UNVERIFIED") >= 0 ||
      canCode.indexOf("VERIFY") >= 0 ||
      canMsg.toLowerCase().indexOf("verify") >= 0
    );

  const walletBlocked =
    walletOk === false || walletLocked === true;

    const bookingSubmitted = !!activeCode;
  const allowSubmit = !busy && !unverifiedBlocked && !walletBlocked && !bookingSubmitted;

  function blockTitle(): string {
    if (unverifiedBlocked) return "Verification required";
    if (walletBlocked) return "Wallet requirement not met";
    if (canCode || canMsg) return "Booking blocked";
    return "Booking blocked";
  }

  function blockBody(): string {
    if (unverifiedBlocked) {
      const win = norm(canInfo?.window);
      const extra = win ? (" Night gate window: " + win + ".") : "";
      return "Your account is not verified. Ride booking is restricted during night gate hours until verification is approved." + extra;
    }
    if (walletBlocked) {
      const bal = canInfo?.wallet_balance;
      const min = canInfo?.min_wallet_required;
      const locked = !!canInfo?.wallet_locked;
      const parts: string[] = [];
      parts.push("Your wallet does not meet the minimum requirement to book a ride.");
      parts.push("Balance: " + String(bal ?? "null") + " | Min required: " + String(min ?? "null") + " | Locked: " + String(locked));
      return parts.join(" ");
    }
    if (canCode || canMsg) {
      return (canCode ? (canCode + ": ") : "") + (canMsg || "Not allowed right now.");
    }
    return "Not allowed right now.";
  }

  function verifyRequestText(): string {
    const now = new Date();
    const lines: string[] = [];
    lines.push("JRIDE VERIFICATION REQUEST");
    lines.push("Passenger name: " + passengerName);
    lines.push("Town: " + town);
    lines.push("Requested at: " + now.toISOString());
    lines.push("Reason: Please verify my passenger account so I can book rides.");
    lines.push("Notes: " + (nightGate ? "Night gate is ON and booking is blocked while unverified." : "Booking is blocked while unverified."));
    return lines.join("\n");
  }

  async function copyVerifyRequest() {
    setCopied(false);
    try {
      const text = verifyRequestText();
      if (navigator && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
        await (navigator as any).clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
        return;
      }
    } catch {
      // ignore
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = verifyRequestText();
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function submit() {
    setResult("");
    setBusy(true);
    // PHASE12A_VALIDATE_VEHICLE_PAX (UI-only)
    const v = (vehicleType === "motorcycle") ? "motorcycle" : "tricycle";
    const pax = Number(clampPax(v, passengerCount));
    const maxPax = paxMaxForVehicle(v);

    if (!pax || !Number.isFinite(pax) || pax <= 0) {
      setResult("Please enter passengers (1 to " + String(maxPax) + ").");
      setBusy(false);
      return;
    }
    if (pax > maxPax) {
      setResult("Too many passengers for " + v + ". Max is " + String(maxPax) + ".");
      setBusy(false);
      return;
    }


    try {
      // 1) Gate check (server-authoritative)
      const can = await postJson("/api/public/passenger/can-book", {
        town,
        service: "ride",
      });

      if (!can.ok) {
        const cj = (can.json || {}) as CanBookInfo;
        const code = normUpper((cj as any).code || (cj as any).error_code);
        const msg = norm((cj as any).message) || "Not allowed";

        setResult("CAN_BOOK_BLOCKED: " + (code || "BLOCKED") + " - " + msg);

        // Refresh visible status pills/cards
        await refreshCanBook();

        // If this looks like an unverified block, open the UX panel automatically
        const looksUnverified =
          (!cj.verified && (!!cj.nightGate)) ||
          code.indexOf("UNVERIFIED") >= 0 ||
          code.indexOf("VERIFY") >= 0 ||
          msg.toLowerCase().indexOf("verify") >= 0;

        if (looksUnverified) if (!(String((canInfo as any)?.verification_status || "`").toLowerCase() === "verified" || verified === true)) { setShowVerifyPanel(true); }
        return;
      }

      // 2) Create booking (no debug flags)
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
      });

      if (!book.ok) {
        const bj = (book.json || {}) as BookResp;
        setResult("BOOK_FAILED: " + (bj.code || "FAILED") + " - " + (bj.message || "Insert failed"));
        return;
      }

      const bj = (book.json || {}) as BookResp;
      const lines: string[] = [];

      lines.push("BOOKED_OK");
      if (bj.booking_code) lines.push("booking_code: " + bj.booking_code);
      if (bj.booking && bj.booking.id) lines.push("booking_id: " + String(bj.booking.id));
      if (bj.booking && bj.booking.status) lines.push("status: " + String(bj.booking.status));
      if (bj.booking && bj.booking.driver_id) lines.push("driver_id: " + String(bj.booking.driver_id));

      if (bj.assign) {
        lines.push("assign.ok: " + String(!!bj.assign.ok));
        if (bj.assign.driver_id) lines.push("assign.driver_id: " + String(bj.assign.driver_id));
        if (bj.assign.note) lines.push("assign.note: " + String(bj.assign.note));
        if (bj.assign.update_ok !== undefined) lines.push("assign.update_ok: " + String(!!bj.assign.update_ok));
        if (bj.assign.update_error) lines.push("assign.update_error: " + String(bj.assign.update_error));
      } else {
        lines.push("assign: (none)");
      }

      
      // PHASE12B_BACKEND_PROBE (read-only): does backend return vehicle_type / passenger_count?
      try {
        const b: any = (bj && ((bj as any).booking || bj)) as any;
        const vtRaw: any = b ? (b.vehicle_type || b.vehicleType) : "";
        const pcRaw: any = b ? (b.passenger_count ?? b.passengerCount) : "";

        const vt = String(vtRaw || "").trim();
        const pc =
          (pcRaw === null || pcRaw === undefined || pcRaw === "")
            ? ""
            : String(pcRaw).trim();

        if (vt || pc) {
          lines.push("vehicle_type: " + (vt || "(none)"));
          lines.push("passenger_count: " + (pc || "(none)"));
        } else {
          lines.push("vehicle_type/passenger_count: (not returned by API)");
        }
      } catch {
        lines.push("vehicle_type/passenger_count: (probe error)");
      }
      setResult(lines.join("\n"));

      // 3) Start live polling after booking (if we have a booking_code)
      const code = norm((bj.booking && bj.booking.booking_code) ? bj.booking.booking_code : (bj.booking_code || ""));
      if (code) {
        setActiveCode(code);
        setLiveStatus(String((bj.booking && bj.booking.status) ? bj.booking.status : ""));
        setLiveDriverId(String((bj.booking && bj.booking.driver_id) ? bj.booking.driver_id : ""));
        setLiveUpdatedAt(Date.now());
      }

      await refreshCanBook();
    } catch (e: any) {
      setResult("ERROR: " + String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Book a Ride</h1>
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Back
          </button>
        </div>

        <p className="mt-2 text-sm opacity-70">Phase 11B: unverified UX + verification request (UI-only).</p>

        <div className="mt-3 flex flex-wrap gap-2 items-center">
          {pill("Verified: " + (verified ? "YES" : "NO"), verified)}
          {pill("Night gate now: " + (nightGate ? "ON" : "OFF"), !nightGate)}
          {pill(walletPillText, walletPillGood)}
          <button
            type="button"
            onClick={refreshCanBook}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-1 text-xs font-semibold"
          >
            Refresh status
          </button>
          {!verified ? (
            <button
              type="button"
              onClick={() => router.push("/verify")}
              className="rounded-xl border border-black/10 hover:bg-black/5 px-3 py-1 text-xs font-semibold"
            >
              Verify account
            </button>
          ) : null}
        </div>

        {geoErr ? (
          <div className="mt-3 text-xs font-mono whitespace-pre-wrap rounded-xl border border-amber-300 bg-amber-50 p-3">
            {geoErr}
          </div>
        ) : null}

        {!MAPBOX_TOKEN ? (
          <div className="mt-3 text-xs rounded-xl border border-amber-300 bg-amber-50 p-3">
            Mapbox token missing. Autocomplete and map tap picker are disabled. Set <b>NEXT_PUBLIC_MAPBOX_TOKEN</b> (or <b>NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN</b>).
          </div>
        ) : null}

        {canInfoErr ? (
          <div className="mt-3 text-xs font-mono whitespace-pre-wrap rounded-xl border border-black/10 p-3">
            {canInfoErr}
          </div>
        ) : null}

        {(unverifiedBlocked || walletBlocked || (canCode || canMsg)) ? (
          <div className="mt-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-amber-900">{blockTitle()}</div>
                <div className="mt-1 text-sm text-amber-900/80">
                  {blockBody()}
                </div>
                {(canCode || canMsg) ? (
                  <div className="mt-2 text-xs text-amber-900/70">
                    Details: <span className="font-mono">{(canCode || "BLOCKED")}</span>{canMsg ? (" - " + canMsg) : ""}
                  </div>
                ) : null}
              </div>

              {!verified ? (
                <button
                  type="button"
                  className="rounded-xl bg-amber-900 text-white px-4 py-2 text-sm font-semibold hover:bg-amber-800"
                  onClick={() => router.push("/verify")}
                >
                  Go to verification
                </button>
              ) : null}
            </div>

            {showVerifyPanel && unverifiedBlocked ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-white p-3">
                <div className="font-semibold text-sm">Verification required</div>

                <div className="mt-2 text-xs opacity-70">
                  Current status: <b>{verificationStatusLabelFromApi(canInfo)}</b>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="rounded-xl bg-black text-white px-4 py-2 text-xs font-semibold hover:bg-black/90"
                    onClick={() => router.push("/verify")}
                  >
                    Go to verification
                  </button>

                  <button
                    type="button"
                    className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 text-xs font-semibold"
                    onClick={refreshCanBook}
                  >
                    Refresh status
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Passenger</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Passenger name</label>
            <input
              className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
              value={passengerName}
              onChange={(e) => setPassengerName(e.target.value)}
            />

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Town</label>
            <select
              className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
              value={town}
              onChange={(e) => setTown(e.target.value)}
            >
              <option value="Lagawe">Lagawe</option>
              <option value="Kiangan">Kiangan</option>
              <option value="Lamut">Lamut</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
            </select>
            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Vehicle type</label>
            <select
              className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
              value={vehicleType}
              disabled={busy || bookingSubmitted}
              onChange={(e) => {
                const v = (e.target.value as any) === "motorcycle" ? "motorcycle" : "tricycle";
                setVehicleType(v);
                setPassengerCount((prev) => clampPax(v, prev));
              }}
            >
              <option value="tricycle">Tricycle (max 4 passengers)</option>
              <option value="motorcycle">Motorcycle (max 1 passenger)</option>
            </select>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Passengers</label>
            <input
              className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
              type="number"
              inputMode="numeric"
              min={1}
              max={paxMaxForVehicle(vehicleType)}
              step={1}
              disabled={busy || bookingSubmitted}
              value={passengerCount}
              onChange={(e) => {
                setPassengerCount(clampPax(vehicleType, e.target.value));
              }}
            />

            <div className="mt-2 text-xs opacity-70">
              Fare is proposed by drivers. You can accept to proceed or reject to request another driver quote.
            </div>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Route</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Pickup label</label>
            <input
              className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
              value={fromLabel}
              onFocus={() => { setActiveGeoField("from"); }}
              onChange={(e) => { setFromLabel(e.target.value); setActiveGeoField("from"); setGeoNavFromIdx(-1); }}
              onKeyDown={(e) => {
                const items = geoFrom || [];
                const open = activeGeoField === "from" && items.length > 0;

                if (e.key === "Escape") {
                  e.preventDefault();
                  setActiveGeoField(null);
                  setGeoFrom([]);
                  setGeoNavFromIdx(-1);
                  return;
                }

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("from"); return; }
                  const next = Math.min((geoNavFromIdx < 0 ? 0 : geoNavFromIdx + 1), items.length - 1);
                  setGeoNavFromIdx(next);
                  return;
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("from"); return; }
                  const prev = Math.max((geoNavFromIdx < 0 ? items.length - 1 : geoNavFromIdx - 1), 0);
                  setGeoNavFromIdx(prev);
                  return;
                }

                if (e.key === "Enter") {
                  if (!open) return;
                  e.preventDefault();
                  const idx = geoNavFromIdx < 0 ? 0 : geoNavFromIdx;
                  const f = items[idx];
                  if (f) {
                    const id = String((f.mapbox_id || f.id || "")).trim();
                    if (id) setSelectedGeoFromId(id);
                    applyGeoSelection("from", f);
                  }
                }
              }}
            />
            {renderGeoList("from")}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lat</label>
                <input
                  className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
                  value={pickupLat}
                  onChange={(e) => setPickupLat(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lng</label>
                <input
                  className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
                  value={pickupLng}
                  onChange={(e) => setPickupLng(e.target.value)}
                />
              </div>
            </div>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Dropoff label</label>
            <input
              className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
              value={toLabel}
              onFocus={() => { setActiveGeoField("to"); }}
              onChange={(e) => { setToLabel(e.target.value); setActiveGeoField("to"); setGeoNavToIdx(-1); }}
              onKeyDown={(e) => {
                const items = geoTo || [];
                const open = activeGeoField === "to" && items.length > 0;

                if (e.key === "Escape") {
                  e.preventDefault();
                  setActiveGeoField(null);
                  setGeoTo([]);
                  setGeoNavToIdx(-1);
                  return;
                }

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("to"); return; }
                  const next = Math.min((geoNavToIdx < 0 ? 0 : geoNavToIdx + 1), items.length - 1);
                  setGeoNavToIdx(next);
                  return;
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  if (!open) { setActiveGeoField("to"); return; }
                  const prev = Math.max((geoNavToIdx < 0 ? items.length - 1 : geoNavToIdx - 1), 0);
                  setGeoNavToIdx(prev);
                  return;
                }

                if (e.key === "Enter") {
                  if (!open) return;
                  e.preventDefault();
                  const idx = geoNavToIdx < 0 ? 0 : geoNavToIdx;
                  const f = items[idx];
                  if (f) {
                    const id = String((f.mapbox_id || f.id || "")).trim();
                    if (id) setSelectedGeoToId(id);
                    applyGeoSelection("to", f);
                  }
                }
              }}
            />
            {renderGeoList("to")}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lat</label>
                <input
                  className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
                  value={dropLat}
                  onChange={(e) => setDropLat(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lng</label>
                <input
                  className={"w-full rounded-xl border border-black/10 px-3 py-2 " + ((busy || bookingSubmitted) ? "opacity-60" : "")}
                  value={dropLng}
                  onChange={(e) => setDropLng(e.target.value)}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <button
                type="button"
                disabled={!MAPBOX_TOKEN}
                className={"rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold " + (!MAPBOX_TOKEN ? "opacity-50" : "hover:bg-black/5")}
                onClick={() => { setShowMapPicker((v) => !v); }}
              >
                {showMapPicker ? "Hide map picker" : "Pick on map"}
              </button>

              <button
                type="button"
                disabled={!MAPBOX_TOKEN || !showMapPicker}
                className={"rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold " + ((!MAPBOX_TOKEN || !showMapPicker) ? "opacity-50" : "hover:bg-black/5")}
                onClick={() => setPickMode("pickup")}
                title="Next tap on the map sets pickup"
              >
                Pick pickup
              </button>

              <button
                type="button"
                disabled={!MAPBOX_TOKEN || !showMapPicker}
                className={"rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold " + ((!MAPBOX_TOKEN || !showMapPicker) ? "opacity-50" : "hover:bg-black/5")}
                onClick={() => setPickMode("dropoff")}
                title="Next tap on the map sets dropoff"
              >
                Pick dropoff
              </button>

              <span className="text-xs opacity-70">
                Mode: <b>{pickMode === "pickup" ? "Pickup" : "Dropoff"}</b> (tap map to set)
              </span>
            </div>

            {showMapPicker ? (
              <div className="mt-3 rounded-2xl border border-black/10 overflow-hidden">
                <div className="px-3 py-2 text-xs opacity-70 border-b border-black/10 bg-white">
                  <div>
                    Tap the map to set {pickMode}. Markers: green pickup, red dropoff.
                  </div>

                  {hasBothPoints() ? (
                    <div className="mt-2 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px]">
                          {routeInfo ? "Route ready" : "Route loading"}
                        </span>
                        <span className="text-[11px]">
                          {routeInfo
                            ? (Math.round(routeInfo.distance_m / 10) / 100) + " km, " + Math.round(routeInfo.duration_s / 60) + " min"
                            : "Fetching route..."}
                          {routeErr ? (" | " + routeErr) : ""}
                        </span>
                      </div>

                      <div className="text-[11px]">
                        Pickup near: <b>{String(fromLabel || "").trim() || "(unset)"}</b>
                      </div>
                      <div className="text-[11px]">
                        Dropoff near: <b>{String(toLabel || "").trim() || "(unset)"}</b>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px]">
                      Route preview: set both pickup and dropoff.
                    </div>
                  )}
                </div>
                <div ref={mapDivRef} style={{ height: 260, width: "100%" }} />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-3 items-center">
          <button
            type="button"
            disabled={!allowSubmit}
            onClick={submit}
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (!allowSubmit ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500")
            }
            title={bookingSubmitted ? "Booking already submitted. Press Clear to book again." : (!allowSubmit ? "Booking is blocked by rules above" : "Submit booking")}
          >
            {busy ? "Booking..." : (bookingSubmitted ? "Booking submitted" : "Submit booking")}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setResult("");
              setActiveCode("");
              setLiveStatus("");
              setLiveDriverId("");
              setLiveUpdatedAt(null);
              setLiveErr("");
            }}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
          >
            Clear
          </button>

          {!verified ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => router.push("/verify")}
              className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
            >
              Go to verification
            </button>
          ) : null}
        </div>

        {result ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm">
            <div className="font-semibold">Result</div>
            <div className="mt-1 font-mono text-xs whitespace-pre-wrap">{result}</div>
          </div>
        ) : null}

        {activeCode ? (
          <div className="mt-4 rounded-xl border border-black/10 bg-white p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">Trip status (live)</div>
              <button
                className="text-xs rounded-lg border border-black/10 px-2 py-1 hover:bg-black/5"
                onClick={() => {
                  setActiveCode("");
                  setLiveStatus("");
                  setLiveDriverId("");
                  setLiveUpdatedAt(null);
                  setLiveErr("");
                }}
              >
                Clear
              </button>
            </div>

            <div className="mt-1 text-xs font-mono">
              code: <span className="font-semibold">{activeCode}</span>
            </div>

            <div className="mt-2">
              <span className="text-xs opacity-70">status:</span>{" "}
              <span className="font-mono text-xs">{liveStatus || "(loading)"}</span>
            </div>

            <div className="mt-1">
              <span className="text-xs opacity-70">driver_id:</span>{" "}
              <span className="font-mono text-xs">{liveDriverId || "(none)"}</span>
            </div>

            <div className="mt-1 text-xs opacity-70">
              last update:{" "}
              {liveUpdatedAt ? Math.max(0, Math.floor((Date.now() - liveUpdatedAt) / 1000)) + "s ago" : "--"}
            </div>

            {liveErr ? (
              <div className="mt-2 rounded-lg border border-red-500/20 bg-red-50 p-2 text-xs font-mono">
                {liveErr}
              </div>
            ) : null}

            <div className="mt-2 text-xs opacity-70">
              Polling: /api/public/passenger/booking?code=...
            </div>
          </div>
        ) : null}

        <div className="mt-6 text-xs opacity-70">Next: connect request-verification API (Phase 11C).</div>
      </div>
    </main>
  );
}














