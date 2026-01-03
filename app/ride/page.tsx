"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type CanBookInfo = {
  ok?: boolean;
  nightGate?: boolean;
  verified?: boolean;

  wallet_ok?: boolean;
  wallet_locked?: boolean;

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
  place_name?: string;
  text?: string;
  center?: [number, number]; // [lng, lat]
  place_type?: string[];
};

type SearchboxSuggest = {
  kind: "searchbox";
  mapbox_id: string;
  name: string;
  full_address: string;
  feature_type: string;
};

type SuggestItem =
  | { kind: "geocode"; f: GeoFeature }
  | SearchboxSuggest;

function numOrNull(s: string): number | null {
  const t = String(s || "").trim();
  if (!t) return null;
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

function norm(s: any): string {
  return String(s || "").trim();
}

function normLower(s: any): string {
  return norm(s).toLowerCase();
}

function normUpper(s: any): string {
  return norm(s).toUpperCase();
}

export default function RidePage() {
  const router = useRouter();

  // Defaults
  const DEFAULT_TOWN = "Lagawe";
  const DEFAULT_FROM_LABEL = "Lagawe Public Market";
  const DEFAULT_TO_LABEL = "Lagawe Town Plaza";
  const DEFAULT_PICKUP_LAT = "16.7999";
  const DEFAULT_PICKUP_LNG = "121.1175";
  const DEFAULT_DROP_LAT = "16.8016";
  const DEFAULT_DROP_LNG = "121.1222";

  const [town, setTown] = React.useState(DEFAULT_TOWN);
  const [passengerName, setPassengerName] = React.useState("Test Passenger A");

  const [fromLabel, setFromLabel] = React.useState(DEFAULT_FROM_LABEL);
  const [toLabel, setToLabel] = React.useState(DEFAULT_TO_LABEL);

  const [pickupLat, setPickupLat] = React.useState(DEFAULT_PICKUP_LAT);
  const [pickupLng, setPickupLng] = React.useState(DEFAULT_PICKUP_LNG);
  const [dropLat, setDropLat] = React.useState(DEFAULT_DROP_LAT);
  const [dropLng, setDropLng] = React.useState(DEFAULT_DROP_LNG);

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

  // Mapbox
  const MAPBOX_TOKEN =
    (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
      "") as string;

  const [geoErr, setGeoErr] = React.useState<string>("");

  const [activeGeoField, setActiveGeoField] = React.useState<"from" | "to" | null>(null);
  const [fromSug, setFromSug] = React.useState<SuggestItem[]>([]);
  const [toSug, setToSug] = React.useState<SuggestItem[]>([]);

  const fromDebounceRef = React.useRef<any>(null);
  const toDebounceRef = React.useRef<any>(null);

  // Map picker (kept simple)
  const [showMapPicker, setShowMapPicker] = React.useState(false);
  const [pickMode, setPickMode] = React.useState<"pickup" | "dropoff">("pickup");
  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const mbRef = React.useRef<any>(null);
  const pickupMarkerRef = React.useRef<any>(null);
  const dropoffMarkerRef = React.useRef<any>(null);

  // Route preview
  const [routePreviewGeo, setRoutePreviewGeo] = React.useState<any>(null);
  const [routePreviewErr, setRoutePreviewErr] = React.useState<string>("");

  function toNum(s: string, fallback: number): number {
    const n = numOrNull(s);
    return n === null ? fallback : n;
  }

  function buildQuery(label: string): string {
    const q = norm(label);
    if (!q) return "";
    const hasComma = q.indexOf(",") >= 0;
    if (hasComma) return q;
    const low = q.toLowerCase();
    const generic =
      q.length <= 12 ||
      low.indexOf("hospital") >= 0 ||
      low.indexOf("clinic") >= 0 ||
      low.indexOf("school") >= 0 ||
      low.indexOf("market") >= 0;

    if (generic) return q + ", " + town + ", Ifugao";
    return q + ", Ifugao";
  }

  function scoreType(placeType: string[]): number {
    const pt = placeType || [];
    if (pt.indexOf("poi") >= 0) return 0;
    if (pt.indexOf("address") >= 0) return 1;
    if (pt.indexOf("place") >= 0) return 2;
    if (pt.indexOf("locality") >= 0) return 3;
    if (pt.indexOf("region") >= 0) return 4;
    if (pt.indexOf("country") >= 0) return 5;
    return 9;
  }

  function sortGeo(feats: GeoFeature[]): GeoFeature[] {
    const arr = (feats || []).slice(0);
    arr.sort((a, b) => {
      const sa = scoreType(a.place_type || []);
      const sb = scoreType(b.place_type || []);
      if (sa !== sb) return sa - sb;
      const la = String(a.place_name || a.text || "");
      const lb = String(b.place_name || b.text || "");
      return la.localeCompare(lb);
    });
    return arr;
  }

  async function fetchGeocode(q: string, limit: number): Promise<GeoFeature[]> {
    if (!MAPBOX_TOKEN) return [];

    const proxLng = toNum(pickupLng, 121.1175);
    const proxLat = toNum(pickupLat, 16.7999);

    // Ifugao-ish bbox (approx). Keep results local, but not too tight.
    const bbox = "120.70,16.50,121.55,17.05";

    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(q) +
      ".json?autocomplete=true" +
      "&limit=" + String(limit) +
      "&country=PH" +
      "&types=poi,address,place" +
      "&language=en" +
      "&bbox=" + encodeURIComponent(bbox) +
      "&proximity=" + encodeURIComponent(String(proxLng) + "," + String(proxLat)) +
      "&fuzzyMatch=true" +
      "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    const r = await fetch(url, { method: "GET" });
    const j = (await r.json().catch(() => ({}))) as any;
    const feats = (j && j.features) ? (j.features as any[]) : [];
    return feats.map((f) => ({
      id: String(f.id || ""),
      place_name: String(f.place_name || ""),
      text: String(f.text || ""),
      center: Array.isArray(f.center) ? [Number(f.center[0]), Number(f.center[1])] : undefined,
      place_type: Array.isArray(f.place_type) ? (f.place_type.map((x: any) => String(x)) as string[]) : [],
    }));
  }

  function sessionToken(): string {
    // best-effort stable per tab
    try {
      const k = "jr_sb_sess";
      const w = window as any;
      if (w && w.sessionStorage) {
        const prev = w.sessionStorage.getItem(k);
        if (prev) return prev;
        const tok = String(Date.now()) + "-" + String(Math.random()).slice(2);
        w.sessionStorage.setItem(k, tok);
        return tok;
      }
    } catch {}
    return String(Date.now()) + "-" + String(Math.random()).slice(2);
  }

  async function searchboxSuggest(raw: string): Promise<SearchboxSuggest[]> {
    // Mapbox Searchbox Suggest API (POI-focused)
    if (!MAPBOX_TOKEN) return [];
    const q = norm(raw);
    if (!q) return [];

    const proxLng = toNum(pickupLng, 121.1175);
    const proxLat = toNum(pickupLat, 16.7999);
    const bbox = "120.70,16.50,121.55,17.05";

    const st = sessionToken();

    const url =
      "https://api.mapbox.com/search/searchbox/v1/suggest" +
      "?q=" + encodeURIComponent(q) +
      "&limit=8" +
      "&country=PH" +
      "&language=en" +
      "&proximity=" + encodeURIComponent(String(proxLng) + "," + String(proxLat)) +
      "&bbox=" + encodeURIComponent(bbox) +
      "&session_token=" + encodeURIComponent(st) +
      "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    const r = await fetch(url, { method: "GET" });
    const j = (await r.json().catch(() => ({}))) as any;

    // If token does not allow Searchbox, Mapbox often returns 401/403 with message.
    if (!r.ok) {
      const msg = String((j && (j.message || j.error)) ? (j.message || j.error) : ("HTTP " + String(r.status)));
      throw new Error("Searchbox suggest failed: " + msg);
    }

    const sug = (j && j.suggestions) ? (j.suggestions as any[]) : [];
    const out: SearchboxSuggest[] = [];
    for (const s of sug) {
      const mid = String(s.mapbox_id || "");
      if (!mid) continue;
      out.push({
        kind: "searchbox",
        mapbox_id: mid,
        name: String(s.name || s.full_address || ""),
        full_address: String(s.full_address || s.name || ""),
        feature_type: String(s.feature_type || ""),
      });
    }
    return out;
  }

  async function searchboxRetrieve(mapboxId: string): Promise<{ lng: number; lat: number; label: string } | null> {
    if (!MAPBOX_TOKEN) return null;
    const st = sessionToken();

    const url =
      "https://api.mapbox.com/search/searchbox/v1/retrieve/" +
      encodeURIComponent(mapboxId) +
      "?session_token=" + encodeURIComponent(st) +
      "&access_token=" + encodeURIComponent(MAPBOX_TOKEN);

    const r = await fetch(url, { method: "GET" });
    const j = (await r.json().catch(() => ({}))) as any;

    if (!r.ok) {
      const msg = String((j && (j.message || j.error)) ? (j.message || j.error) : ("HTTP " + String(r.status)));
      throw new Error("Searchbox retrieve failed: " + msg);
    }

    const feats = (j && j.features) ? (j.features as any[]) : [];
    if (!feats.length) return null;

    const f = feats[0];
    const coords = f && f.geometry && f.geometry.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;

    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    const props = f.properties || {};
    const label =
      String(props.name || props.full_address || props.place_formatted || props.feature_name || "") ||
      String(props.address || "") ||
      "Selected location";

    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return { lng, lat, label };
  }

  async function geocodeForward(raw: string): Promise<SuggestItem[]> {
    setGeoErr("");

    if (!MAPBOX_TOKEN) {
      setGeoErr("Mapbox token missing. Set NEXT_PUBLIC_MAPBOX_TOKEN (or NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN).");
      return [];
    }

    const q = buildQuery(raw);
    if (!q) return [];

    // Primary: Geocoding v5
    let feats: GeoFeature[] = [];
    try {
      feats = await fetchGeocode(q, 10);
    } catch (e: any) {
      // don't block; try searchbox
      feats = [];
    }

    const sorted = sortGeo(feats).slice(0, 8);
    const hasGood =
      sorted.some((f) => (f.place_type || []).indexOf("poi") >= 0) ||
      sorted.some((f) => (f.place_type || []).indexOf("address") >= 0);

    // If we only get PLACE/REGION results, fallback to Searchbox for POIs
    if (!hasGood) {
      try {
        const sbq = norm(raw) ? (norm(raw) + ", " + town + ", Ifugao") : q;
        const sb = await searchboxSuggest(sbq);
        if (sb.length) return sb;
      } catch (e: any) {
        setGeoErr(String(e?.message || e));
        // still show geocode results if any
      }
    }

    return sorted.map((f) => ({ kind: "geocode", f: f } as any));
  }

  async function geocodeReverse(lng: number, lat: number): Promise<string> {
    if (!MAPBOX_TOKEN) return "";
    const url =
      "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
      encodeURIComponent(String(lng) + "," + String(lat)) +
      ".json?limit=1&country=PH&language=en&access_token=" +
      encodeURIComponent(MAPBOX_TOKEN);
    try {
      const r = await fetch(url, { method: "GET" });
      const j = (await r.json().catch(() => ({}))) as any;
      const feats = (j && j.features) ? (j.features as any[]) : [];
      if (feats.length) return String(feats[0].place_name || "");
    } catch {}
    return "";
  }

  // Route preview (pickup -> dropoff)
  React.useEffect(() => {
    let cancelled = false;

    const t = setTimeout(async () => {
      try {
        setRoutePreviewErr("");
        if (!MAPBOX_TOKEN) { setRoutePreviewGeo(null); return; }

        const plng = numOrNull(pickupLng);
        const plat = numOrNull(pickupLat);
        const dlng = numOrNull(dropLng);
        const dlat = numOrNull(dropLat);

        if (plng === null || plat === null || dlng === null || dlat === null) {
          setRoutePreviewGeo(null);
          return;
        }

        const coords = String(plng) + "," + String(plat) + ";" + String(dlng) + "," + String(dlat);

        const url =
          "https://api.mapbox.com/directions/v5/mapbox/driving/" +
          coords +
          "?geometries=geojson&overview=full&access_token=" +
          encodeURIComponent(MAPBOX_TOKEN);

        const r = await fetch(url, { method: "GET" });
        const j = (await r.json().catch(() => ({}))) as any;

        if (!r.ok || !j || !j.routes || !j.routes.length || !j.routes[0].geometry) {
          setRoutePreviewGeo(null);
          if (!cancelled) setRoutePreviewErr("Route preview not available.");
          return;
        }

        const geom = j.routes[0].geometry;
        if (!cancelled) {
          setRoutePreviewGeo({ type: "Feature", geometry: geom, properties: {} });
        }
      } catch (e: any) {
        if (!cancelled) {
          setRoutePreviewGeo(null);
          setRoutePreviewErr("Route preview failed: " + String(e?.message || e));
        }
      }
    }, 450);

    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickupLat, pickupLng, dropLat, dropLng, MAPBOX_TOKEN]);

  async function applySuggestion(field: "from" | "to", item: SuggestItem) {
    try {
      if ((item as any).kind === "searchbox") {
        const sb = item as SearchboxSuggest;
        const got = await searchboxRetrieve(sb.mapbox_id);
        if (!got) return;

        if (field === "from") {
          setFromLabel(sb.full_address || sb.name || got.label);
          setPickupLat(String(got.lat));
          setPickupLng(String(got.lng));
          setFromSug([]);
          setActiveGeoField(null);
        } else {
          setToLabel(sb.full_address || sb.name || got.label);
          setDropLat(String(got.lat));
          setDropLng(String(got.lng));
          setToSug([]);
          setActiveGeoField(null);
        }
        return;
      }

      const f = (item as any).f as GeoFeature;
      const name = String(f.place_name || f.text || "").trim();
      const c = f.center;
      if (!c || c.length !== 2) return;

      const lng = Number(c[0]);
      const lat = Number(c[1]);

      if (field === "from") {
        if (name) setFromLabel(name);
        setPickupLat(String(lat));
        setPickupLng(String(lng));
        setFromSug([]);
        setActiveGeoField(null);
      } else {
        if (name) setToLabel(name);
        setDropLat(String(lat));
        setDropLng(String(lng));
        setToSug([]);
        setActiveGeoField(null);
      }
    } catch (e: any) {
      setGeoErr(String(e?.message || e));
    }
  }

  function badgeFor(item: SuggestItem): string {
    if ((item as any).kind === "searchbox") {
      const ft = String((item as any).feature_type || "");
      if (ft) return ft.toUpperCase();
      return "POI";
    }
    const f = (item as any).f as GeoFeature;
    const pt = (f.place_type || []).join(",");
    if (pt.indexOf("poi") >= 0) return "POI";
    if (pt.indexOf("address") >= 0) return "ADDR";
    if (pt.indexOf("place") >= 0) return "PLACE";
    return "AREA";
  }

  function labelFor(item: SuggestItem): string {
    if ((item as any).kind === "searchbox") {
      const sb = item as SearchboxSuggest;
      return String(sb.full_address || sb.name || "").trim();
    }
    const f = (item as any).f as GeoFeature;
    return String(f.place_name || f.text || "").trim();
  }

  function renderSugList(field: "from" | "to") {
    const items = field === "from" ? fromSug : toSug;
    const open = activeGeoField === field && items && items.length > 0;
    if (!open) return null;

    return (
      <div className="mt-2 rounded-xl border border-black/10 bg-white shadow-sm overflow-hidden">
        {items.map((it, idx) => {
          const label = labelFor(it) || "(unknown)";
          const badge = badgeFor(it);

          return (
            <button
              key={String(idx) + "_" + label}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-black/5"
              onClick={() => applySuggestion(field, it)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="truncate">{label}</div>
                <div className="text-[10px] px-2 py-0.5 rounded-full bg-black/5">{badge}</div>
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // Debounced autocomplete
  React.useEffect(() => {
    if (activeGeoField !== "from") return;
    if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);

    fromDebounceRef.current = setTimeout(async () => {
      try {
        const items = await geocodeForward(fromLabel);
        setFromSug(items);
      } catch (e: any) {
        setGeoErr(String(e?.message || e));
        setFromSug([]);
      }
    }, 250);

    return () => {
      if (fromDebounceRef.current) clearTimeout(fromDebounceRef.current);
      fromDebounceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromLabel, activeGeoField, town]);

  React.useEffect(() => {
    if (activeGeoField !== "to") return;
    if (toDebounceRef.current) clearTimeout(toDebounceRef.current);

    toDebounceRef.current = setTimeout(async () => {
      try {
        const items = await geocodeForward(toLabel);
        setToSug(items);
      } catch (e: any) {
        setGeoErr(String(e?.message || e));
        setToSug([]);
      }
    }, 250);

    return () => {
      if (toDebounceRef.current) clearTimeout(toDebounceRef.current);
      toDebounceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toLabel, activeGeoField, town]);

  // Map picker init / refresh + route draw
  React.useEffect(() => {
    let cancelled = false;

    async function initMap() {
      if (!showMapPicker) return;
      if (!mapDivRef.current) return;

      if (!MAPBOX_TOKEN) {
        setGeoErr("Map picker requires Mapbox token.");
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
      if (mbAny && mbAny.default) mbAny.default.accessToken = MAPBOX_TOKEN;
      else if (mbAny) mbAny.accessToken = MAPBOX_TOKEN;

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
          } catch {}
        });
      } else {
        try { mapRef.current.setCenter([centerLng, centerLat]); } catch {}
      }

      // Markers
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
      } catch {}

      function drawRoutePreviewLine() {
        try {
          if (!mapRef.current) return;
          const map = mapRef.current;
          if (!(map && (map.isStyleLoaded ? map.isStyleLoaded() : (map.loaded && map.loaded())))) return;

          const srcId = "route-preview";
          const layerId = "route-preview-line";

          try { if (map.getLayer(layerId)) map.removeLayer(layerId); } catch {}
          try { if (map.getSource(srcId)) map.removeSource(srcId); } catch {}

          if (!routePreviewGeo) return;

          map.addSource(srcId, { type: "geojson", data: routePreviewGeo });

          map.addLayer({
            id: layerId,
            type: "line",
            source: srcId,
            layout: { "line-join": "round", "line-cap": "round" },
            paint: { "line-width": 4, "line-opacity": 0.85, "line-color": "#2563eb" },
          });
        } catch {}
      }

      try {
        const map = mapRef.current;
        if (map) {
          if (!(map && (map.isStyleLoaded ? map.isStyleLoaded() : (map.loaded && map.loaded())))) {
            try { map.once("load", () => { drawRoutePreviewLine(); }); } catch {}
          } else {
            drawRoutePreviewLine();
          }

          if (!routePreviewGeo) {
            try { if (map.getLayer("route-preview-line")) map.removeLayer("route-preview-line"); } catch {}
            try { if (map.getSource("route-preview")) map.removeSource("route-preview"); } catch {}
          }
        }
      } catch {}
    }

    initMap();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showMapPicker, pickMode, pickupLat, pickupLng, dropLat, dropLng, routePreviewGeo, MAPBOX_TOKEN]);

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
    } catch (e: any) {
      setCanInfoErr("CAN_BOOK_INFO_ERROR: " + String(e?.message || e));
      setCanInfo(null);
    }
  }

  React.useEffect(() => { refreshCanBook(); }, []);

  // Live polling
  React.useEffect(() => {
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

  const canCode = normUpper(canInfo?.code);
  const canMsg = norm(canInfo?.message);

  const unverifiedBlocked =
    !verified &&
    (nightGate ||
      canCode.indexOf("UNVERIFIED") >= 0 ||
      canCode.indexOf("VERIFY") >= 0 ||
      (canMsg && canMsg.toLowerCase().indexOf("verify") >= 0));

  const walletBlocked = walletOk === false || walletLocked === true;
  const allowSubmit = !busy && !unverifiedBlocked && !walletBlocked;

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

  async function submit() {
    setResult("");
    setBusy(true);

    try {
      const can = await postJson("/api/public/passenger/can-book", { town, service: "ride" });
      if (!can.ok) {
        const cj = (can.json || {}) as any;
        const code = normUpper(cj.code || cj.error_code);
        const msg = norm(cj.message) || "Not allowed";
        setResult("CAN_BOOK_BLOCKED: " + (code || "BLOCKED") + " - " + msg);
        await refreshCanBook();
        return;
      }

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
      } else {
        lines.push("assign: (none)");
      }

      setResult(lines.join("\n"));

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

  function clearAll() {
    setResult("");
    setGeoErr("");
    setFromSug([]);
    setToSug([]);
    setActiveGeoField(null);
    setShowMapPicker(false);
    setPickMode("pickup");

    setFromLabel(DEFAULT_FROM_LABEL);
    setToLabel(DEFAULT_TO_LABEL);
    setPickupLat(DEFAULT_PICKUP_LAT);
    setPickupLng(DEFAULT_PICKUP_LNG);
    setDropLat(DEFAULT_DROP_LAT);
    setDropLng(DEFAULT_DROP_LNG);

    setActiveCode("");
    setLiveStatus("");
    setLiveDriverId("");
    setLiveUpdatedAt(null);
    setLiveErr("");
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

        {routePreviewErr ? (
          <div className="mt-2 text-xs font-mono whitespace-pre-wrap rounded-xl border border-black/10 p-3">
            {routePreviewErr}
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

        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Passenger</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Passenger name</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={passengerName}
              onChange={(e) => setPassengerName(e.target.value)}
            />

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Town</label>
            <select
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={town}
              onChange={(e) => setTown(e.target.value)}
            >
              <option value="Lagawe">Lagawe</option>
              <option value="Kiangan">Kiangan</option>
              <option value="Lamut">Lamut</option>
              <option value="Hingyon">Hingyon</option>
              <option value="Banaue">Banaue</option>
            </select>
          </div>

          <div className="rounded-2xl border border-black/10 p-4">
            <div className="font-semibold mb-3">Route</div>

            <label className="block text-xs font-semibold opacity-70 mb-1">Pickup label</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={fromLabel}
              onFocus={() => { setActiveGeoField("from"); }}
              onChange={(e) => { setFromLabel(e.target.value); setActiveGeoField("from"); }}
            />
            {renderSugList("from")}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lat</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={pickupLat} onChange={(e) => setPickupLat(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Pickup lng</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={pickupLng} onChange={(e) => setPickupLng(e.target.value)} />
              </div>
            </div>

            <label className="block text-xs font-semibold opacity-70 mb-1 mt-3">Dropoff label</label>
            <input
              className="w-full rounded-xl border border-black/10 px-3 py-2"
              value={toLabel}
              onFocus={() => { setActiveGeoField("to"); }}
              onChange={(e) => { setToLabel(e.target.value); setActiveGeoField("to"); }}
            />
            {renderSugList("to")}

            <div className="grid grid-cols-2 gap-3 mt-2">
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lat</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={dropLat} onChange={(e) => setDropLat(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold opacity-70 mb-1">Dropoff lng</label>
                <input className="w-full rounded-xl border border-black/10 px-3 py-2" value={dropLng} onChange={(e) => setDropLng(e.target.value)} />
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
              >
                Pick pickup
              </button>

              <button
                type="button"
                disabled={!MAPBOX_TOKEN || !showMapPicker}
                className={"rounded-xl border border-black/10 px-3 py-2 text-xs font-semibold " + ((!MAPBOX_TOKEN || !showMapPicker) ? "opacity-50" : "hover:bg-black/5")}
                onClick={() => setPickMode("dropoff")}
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
                  Tap the map to set {pickMode}. Markers: green pickup, red dropoff. Route preview: blue line.
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
            className={"rounded-xl px-5 py-2 font-semibold text-white " + (!allowSubmit ? "bg-slate-400" : "bg-blue-600 hover:bg-blue-500")}
          >
            {busy ? "Booking..." : "Submit booking"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={clearAll}
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
              last update: {liveUpdatedAt ? Math.max(0, Math.floor((Date.now() - liveUpdatedAt) / 1000)) + "s ago" : "--"}
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
