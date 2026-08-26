"use client";

import * as React from "react";

const TOKEN_KEY = "jride_access_token";
const CONFIRMED_SOURCE = "errand_confirmed_route";
const ACTUAL_SOURCE = "errand_actual_route";
const PICKUP_SOURCE = "errand_pickup_route";
const PREVIEW_SOURCE = "errand_preview_route";
const CONFIRMED_LAYER = "errand_confirmed_route_line";
const ACTUAL_LAYER = "errand_actual_route_line";
const PICKUP_LAYER = "errand_pickup_route_line";
const PREVIEW_LAYER = "errand_preview_route_line";

type Point = {
  label: string;
  lat: number;
  lng: number;
  kind: "stage0" | "stop" | "final";
  sequence?: number | null;
};

type Props = {
  bookingId: string;
  stage0: Point | null;
  stops: Point[];
  finalPoint: Point | null;
  errandStage?: string | null;
  currentStopSequence?: number | null;
};

type SimpleCoord = { lat: number; lng: number };

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function finite(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return text(
      localStorage.getItem(TOKEN_KEY) ||
        localStorage.getItem("jride_passenger_token") ||
        ""
    );
  } catch {
    return "";
  }
}

function emptyCollection() {
  return { type: "FeatureCollection", features: [] as any[] };
}

function lineCollection(coordinates: number[][]) {
  if (coordinates.length < 2) return emptyCollection();
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates },
      },
    ],
  };
}

function routeGeometryFromLegs(legs: any[]): any {
  const features = (Array.isArray(legs) ? legs : [])
    .map((leg: any, index: number) => {
      const geometry = leg?.geometry;
      if (
        !geometry ||
        geometry.type !== "LineString" ||
        !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.length < 2
      ) {
        return null;
      }
      return {
        type: "Feature",
        properties: {
          index,
          from: text(leg?.fromLabel),
          to: text(leg?.toLabel),
          distance_km: finite(leg?.distanceKm),
        },
        geometry,
      };
    })
    .filter(Boolean);

  return { type: "FeatureCollection", features };
}

function adjustmentGeometry(adjustments: any[]): any[] {
  const features: any[] = [];
  for (const adjustment of Array.isArray(adjustments) ? adjustments : []) {
    const legs = Array.isArray(adjustment?.route_legs)
      ? adjustment.route_legs
      : Array.isArray(adjustment?.adjustment_route_legs)
        ? adjustment.adjustment_route_legs
        : [];
    for (const leg of legs) {
      const geometry = leg?.geometry;
      if (
        geometry?.type === "LineString" &&
        Array.isArray(geometry?.coordinates) &&
        geometry.coordinates.length >= 2
      ) {
        features.push({
          type: "Feature",
          properties: {
            adjustment: true,
            type: text(adjustment?.adjustment_type || adjustment?.type),
          },
          geometry,
        });
      }
    }
  }
  return features;
}

function actualGeometry(points: any[]): any {
  const coordinates = (Array.isArray(points) ? points : [])
    .map((point: any) => {
      const lat = finite(point?.lat);
      const lng = finite(point?.lng);
      return lat == null || lng == null ? null : [lng, lat];
    })
    .filter(Boolean) as number[][];

  return lineCollection(coordinates);
}

function samePlace(a: Point | null, b: Point | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) <= 0.00003 && Math.abs(a.lng - b.lng) <= 0.00003;
}

function stageIsConfirmed(stageRaw: unknown): boolean {
  const stage = text(stageRaw).toLowerCase();
  return [
    "task_confirmed",
    "going_to_stop",
    "waiting_at_stop",
    "going_to_final",
    "waiting_at_final_handoff",
    "unreachable_escalated",
    "completed",
  ].includes(stage);
}

async function fetchDisplayRoute(
  token: string,
  coords: SimpleCoord[]
): Promise<any> {
  if (!token || coords.length < 2) return emptyCollection();
  const usable = coords.slice(0, 25);
  const coordinateText = usable.map((p) => `${p.lng},${p.lat}`).join(";");
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinateText}` +
    `?alternatives=false&geometries=geojson&overview=simplified&steps=false&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return emptyCollection();
  const json: any = await response.json().catch(() => ({}));
  const geometry = Array.isArray(json?.routes) ? json.routes[0]?.geometry : null;
  if (
    geometry?.type !== "LineString" ||
    !Array.isArray(geometry?.coordinates) ||
    geometry.coordinates.length < 2
  ) {
    return emptyCollection();
  }
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry }],
  };
}

function markerElement(label: string, kind: "driver" | "stage0" | "stop" | "final" | "return") {
  const wrap = document.createElement("div");
  wrap.style.display = "flex";
  wrap.style.flexDirection = "column";
  wrap.style.alignItems = "center";
  wrap.style.pointerEvents = "none";

  const badge = document.createElement("div");
  badge.textContent = label;
  badge.style.whiteSpace = "nowrap";
  badge.style.fontSize = "11px";
  badge.style.fontWeight = "800";
  badge.style.letterSpacing = "0.01em";
  badge.style.padding = "4px 7px";
  badge.style.borderRadius = "8px";
  badge.style.border = "1px solid rgba(255,255,255,0.92)";
  badge.style.boxShadow = "0 2px 8px rgba(15,23,42,0.24)";
  badge.style.color = "white";
  badge.style.background =
    kind === "driver"
      ? "#dc2626"
      : kind === "stage0" || kind === "return"
        ? "#047857"
        : kind === "final"
          ? "#6d28d9"
          : "#d97706";

  const pin = document.createElement("div");
  pin.style.width = "13px";
  pin.style.height = "13px";
  pin.style.marginTop = "2px";
  pin.style.borderRadius = "999px";
  pin.style.border = "3px solid white";
  pin.style.boxShadow = "0 1px 5px rgba(15,23,42,0.35)";
  pin.style.background = badge.style.background;

  wrap.appendChild(badge);
  wrap.appendChild(pin);
  return wrap;
}

export default function ErrandLiveMap({
  bookingId,
  stage0,
  stops,
  finalPoint,
  errandStage,
  currentStopSequence,
}: Props) {
  const MAPBOX_TOKEN = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
    "") as string;

  const mapDivRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<any>(null);
  const mapboxRef = React.useRef<any>(null);
  const driverMarkerRef = React.useRef<any>(null);
  const stopMarkersRef = React.useRef<any[]>([]);
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const sinceRef = React.useRef("");
  const pointsRef = React.useRef<any[]>([]);
  const confirmedRef = React.useRef<any>(emptyCollection());
  const actualRef = React.useRef<any>(emptyCollection());
  const pickupRef = React.useRef<any>(emptyCollection());
  const previewRef = React.useRef<any>(emptyCollection());
  const lastPickupRouteKeyRef = React.useRef("");
  const lastPreviewRouteKeyRef = React.useRef("");

  const [tracking, setTracking] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  const finalReturnsToStage0 = samePlace(stage0, finalPoint);

  const mapPointsKey = React.useMemo(
    () =>
      JSON.stringify(
        [stage0, ...stops, finalPoint]
          .filter(Boolean)
          .map((point: any) => [
            text(point?.kind),
            finite(point?.sequence),
            text(point?.label),
            finite(point?.lat),
            finite(point?.lng),
          ])
      ),
    [stage0, stops, finalPoint]
  );

  const routeOrder = React.useMemo(() => {
    const items = ["DRIVER", "YOU / STAGE 0"];
    const sortedStops = [...stops].sort(
      (a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)
    );
    for (const stop of sortedStops) {
      items.push(`STOP ${stop.sequence || items.length - 1}`);
    }
    items.push(finalReturnsToStage0 ? "FINAL: RETURN TO YOU" : "FINAL");
    return items;
  }, [stops, finalReturnsToStage0]);

  function updateMapData() {
    const map = mapRef.current;
    if (!map) return;
    try {
      map.getSource(CONFIRMED_SOURCE)?.setData?.(confirmedRef.current);
      map.getSource(ACTUAL_SOURCE)?.setData?.(actualRef.current);
      map.getSource(PICKUP_SOURCE)?.setData?.(pickupRef.current);
      map.getSource(PREVIEW_SOURCE)?.setData?.(previewRef.current);
    } catch {}
  }

  async function refreshPickupRoute(location: any) {
    if (!MAPBOX_TOKEN || !stage0) return;
    const lat = finite(location?.lat);
    const lng = finite(location?.lng);
    if (lat == null || lng == null) return;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}>${stage0.lat.toFixed(4)},${stage0.lng.toFixed(4)}`;
    if (key === lastPickupRouteKeyRef.current) return;
    lastPickupRouteKeyRef.current = key;
    pickupRef.current = await fetchDisplayRoute(MAPBOX_TOKEN, [
      { lat, lng },
      { lat: stage0.lat, lng: stage0.lng },
    ]);
    updateMapData();
  }

  async function refreshPreviewRoute(stageRaw: unknown) {
    if (!MAPBOX_TOKEN || !stage0) return;
    if (stageIsConfirmed(stageRaw)) {
      previewRef.current = emptyCollection();
      updateMapData();
      return;
    }
    const sortedStops = [...stops].sort(
      (a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)
    );
    const points: SimpleCoord[] = [
      { lat: stage0.lat, lng: stage0.lng },
      ...sortedStops.map((p) => ({ lat: p.lat, lng: p.lng })),
    ];
    if (finalPoint) points.push({ lat: finalPoint.lat, lng: finalPoint.lng });
    const key = JSON.stringify(points.map((p) => [p.lat.toFixed(5), p.lng.toFixed(5)]));
    if (key === lastPreviewRouteKeyRef.current) return;
    lastPreviewRouteKeyRef.current = key;
    previewRef.current = await fetchDisplayRoute(MAPBOX_TOKEN, points);
    updateMapData();
  }

  async function fetchTracking(initial = false) {
    if (!bookingId) return;
    const token = getToken();
    if (!token) {
      setError("Passenger session is required for live Errand tracking.");
      return;
    }

    try {
      const since = initial ? "" : sinceRef.current;
      const url =
        `/api/passenger/errand/tracking?booking_id=${encodeURIComponent(bookingId)}` +
        (since ? `&since=${encodeURIComponent(since)}` : "");
      const response = await fetch(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const json: any = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }

      setError("");
      setTracking((previous: any) => ({
        ...(previous || {}),
        ...json,
        actual_route: {
          ...(previous?.actual_route || {}),
          ...(json?.actual_route || {}),
        },
      }));

      const incoming = Array.isArray(json?.actual_route?.points)
        ? json.actual_route.points
        : [];
      if (initial) pointsRef.current = [];
      const seen = new Set(pointsRef.current.map((point: any) => text(point?.id)));
      for (const point of incoming) {
        const id = text(point?.id);
        if (id && seen.has(id)) continue;
        pointsRef.current.push(point);
        if (id) seen.add(id);
      }
      actualRef.current = actualGeometry(pointsRef.current);
      sinceRef.current = text(json?.actual_route?.next_since) || sinceRef.current;

      const base = routeGeometryFromLegs(json?.confirmed_route?.legs || []);
      base.features.push(
        ...adjustmentGeometry(json?.confirmed_route?.adjustments || [])
      );
      confirmedRef.current = base;
      updateMapData();

      const location = json?.driver_location;
      const lat = finite(location?.lat);
      const lng = finite(location?.lng);
      if (lat != null && lng != null && mapRef.current && mapboxRef.current) {
        const MapboxGL = mapboxRef.current.default || mapboxRef.current;
        if (!driverMarkerRef.current) {
          driverMarkerRef.current = new MapboxGL.Marker({
            element: markerElement("DRIVER", "driver"),
            anchor: "bottom",
          })
            .setLngLat([lng, lat])
            .setPopup(new MapboxGL.Popup({ offset: 24 }).setText("JRide Driver - current / last known location"))
            .addTo(mapRef.current);
        } else {
          driverMarkerRef.current.setLngLat([lng, lat]);
        }
        void refreshPickupRoute(location);
      }
      void refreshPreviewRoute(json?.errand_stage || errandStage);
    } catch (err: any) {
      setError(text(err?.message) || "Could not load live Errand tracking.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    if (!bookingId) return;
    sinceRef.current = "";
    pointsRef.current = [];
    setTracking(null);
    setLoading(true);
    void fetchTracking(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void fetchTracking(false), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [bookingId]);

  React.useEffect(() => {
    void refreshPreviewRoute(tracking?.errand_stage || errandStage);
  }, [MAPBOX_TOKEN, mapPointsKey, errandStage, tracking?.errand_stage]);

  React.useEffect(() => {
    if (!MAPBOX_TOKEN || !mapDivRef.current) return;
    let cancelled = false;

    (async () => {
      try {
        if (!mapboxRef.current) mapboxRef.current = await import("mapbox-gl");
        if (cancelled || !mapDivRef.current) return;
        const MapboxGL = mapboxRef.current.default || mapboxRef.current;
        MapboxGL.accessToken = MAPBOX_TOKEN;

        const initial =
          stage0 ||
          stops[0] ||
          finalPoint ||
          ({ label: "Lagawe", lat: 16.801351, lng: 121.124289 } as Point);

        mapRef.current = new MapboxGL.Map({
          container: mapDivRef.current,
          style: "mapbox://styles/mapbox/streets-v12",
          center: [initial.lng, initial.lat],
          zoom: 13,
        });
        mapRef.current.addControl(new MapboxGL.NavigationControl(), "top-right");

        mapRef.current.on("load", () => {
          try {
            mapRef.current.addSource(PICKUP_SOURCE, {
              type: "geojson",
              data: pickupRef.current,
            });
            mapRef.current.addLayer({
              id: PICKUP_LAYER,
              type: "line",
              source: PICKUP_SOURCE,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#0f766e",
                "line-width": 5,
                "line-opacity": 0.9,
              },
            });
            mapRef.current.addSource(PREVIEW_SOURCE, {
              type: "geojson",
              data: previewRef.current,
            });
            mapRef.current.addLayer({
              id: PREVIEW_LAYER,
              type: "line",
              source: PREVIEW_SOURCE,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#94a3b8",
                "line-width": 4,
                "line-opacity": 0.85,
                "line-dasharray": [2, 1.5],
              },
            });
            mapRef.current.addSource(CONFIRMED_SOURCE, {
              type: "geojson",
              data: confirmedRef.current,
            });
            mapRef.current.addLayer({
              id: CONFIRMED_LAYER,
              type: "line",
              source: CONFIRMED_SOURCE,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#059669",
                "line-width": 6,
                "line-opacity": 0.9,
              },
            });
            mapRef.current.addSource(ACTUAL_SOURCE, {
              type: "geojson",
              data: actualRef.current,
            });
            mapRef.current.addLayer({
              id: ACTUAL_LAYER,
              type: "line",
              source: ACTUAL_SOURCE,
              layout: { "line-join": "round", "line-cap": "round" },
              paint: {
                "line-color": "#2563eb",
                "line-width": 3,
                "line-opacity": 0.9,
                "line-dasharray": [1.5, 1],
              },
            });
            updateMapData();
          } catch {}
        });

        stopMarkersRef.current.forEach((marker) => {
          try { marker.remove(); } catch {}
        });
        stopMarkersRef.current = [];

        if (stage0) {
          const stageLabel = finalReturnsToStage0
            ? "YOU / STAGE 0 + FINAL RETURN"
            : "YOU / STAGE 0";
          const marker = new MapboxGL.Marker({
            element: markerElement(stageLabel, finalReturnsToStage0 ? "return" : "stage0"),
            anchor: "bottom",
          })
            .setLngLat([stage0.lng, stage0.lat])
            .setPopup(new MapboxGL.Popup({ offset: 24 }).setText(`${stageLabel}: ${stage0.label}`))
            .addTo(mapRef.current);
          stopMarkersRef.current.push(marker);
        }

        const sortedStops = [...stops].sort(
          (a, b) => Number(a.sequence || 0) - Number(b.sequence || 0)
        );
        for (const point of sortedStops) {
          const label = `STOP ${point.sequence || ""}`.trim();
          const marker = new MapboxGL.Marker({
            element: markerElement(label, "stop"),
            anchor: "bottom",
          })
            .setLngLat([point.lng, point.lat])
            .setPopup(new MapboxGL.Popup({ offset: 24 }).setText(`${label}: ${point.label}`))
            .addTo(mapRef.current);
          stopMarkersRef.current.push(marker);
        }

        if (finalPoint && !finalReturnsToStage0) {
          const marker = new MapboxGL.Marker({
            element: markerElement("FINAL", "final"),
            anchor: "bottom",
          })
            .setLngLat([finalPoint.lng, finalPoint.lat])
            .setPopup(new MapboxGL.Popup({ offset: 24 }).setText(`FINAL: ${finalPoint.label}`))
            .addTo(mapRef.current);
          stopMarkersRef.current.push(marker);
        }

        const bounds = new MapboxGL.LngLatBounds();
        const allStatic = [stage0, ...stops, finalPoint].filter(Boolean) as Point[];
        for (const p of allStatic) bounds.extend([p.lng, p.lat]);
        if (!bounds.isEmpty()) {
          mapRef.current.fitBounds(bounds, { padding: 70, maxZoom: 15, duration: 0 });
        }
        void refreshPreviewRoute(tracking?.errand_stage || errandStage);
      } catch {
        setError("Mapbox live map failed to load.");
      }
    })();

    return () => {
      cancelled = true;
      stopMarkersRef.current.forEach((marker) => {
        try { marker.remove(); } catch {}
      });
      stopMarkersRef.current = [];
      try {
        driverMarkerRef.current?.remove?.();
        mapRef.current?.remove?.();
      } catch {}
      driverMarkerRef.current = null;
      mapRef.current = null;
    };
  }, [MAPBOX_TOKEN, bookingId, mapPointsKey]);

  const secondsSinceUpdate = finite(tracking?.driver_location?.seconds_since_update);
  const staleMinutes =
    secondsSinceUpdate == null ? null : Math.max(0, Math.floor(secondsSinceUpdate / 60));
  const confirmedKm = finite(tracking?.confirmed_route?.distance_km);
  const actualPointCount = pointsRef.current.length;
  const confirmed = stageIsConfirmed(tracking?.errand_stage || errandStage) || confirmedKm != null;

  return (
    <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-950">Live Errand map</div>
          <div className="mt-1 text-xs text-slate-500">
            Follow the labeled route in order. Each person and stop is identified on the map.
          </div>
        </div>
        <div className="text-xs text-slate-500">
          {loading ? "Loading tracking..." : `GPS points: ${actualPointCount}`}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-slate-700">
        {routeOrder.map((item, index) => (
          <React.Fragment key={`${item}-${index}`}>
            {index > 0 ? <span className="text-slate-400">-&gt;</span> : null}
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1">
              {item}
            </span>
          </React.Fragment>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-teal-100 bg-teal-50 px-3 py-2 text-teal-900">
          <span className="font-bold">Teal solid:</span> Driver -&gt; You / Stage 0
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-700">
          <span className="font-bold">Gray dashed:</span> task-route preview before confirmation
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-emerald-900">
          <span className="font-bold">Green solid:</span> confirmed Errand billing route
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-blue-900">
          <span className="font-bold">Blue dashed:</span> actual driver GPS history only
        </div>
      </div>

      {MAPBOX_TOKEN ? (
        <div ref={mapDivRef} className="mt-4 h-[460px] w-full rounded-2xl bg-slate-100" />
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Mapbox token is unavailable.
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-slate-400">Task route</div>
          <div className="mt-1 font-semibold text-slate-800">
            {confirmedKm == null
              ? "Preview only - fare not locked yet"
              : `${confirmedKm.toFixed(1)} km confirmed`}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-slate-400">Current stage</div>
          <div className="mt-1 font-semibold text-slate-800">
            {text(errandStage) || text(tracking?.errand_stage) || "--"}
            {currentStopSequence ? ` | Stop ${currentStopSequence}` : ""}
          </div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-slate-400">Driver location</div>
          <div className="mt-1 font-semibold text-slate-800">
            {secondsSinceUpdate == null
              ? "No GPS update yet"
              : secondsSinceUpdate < 60
                ? `${Math.max(0, Math.floor(secondsSinceUpdate))} sec ago`
                : `${staleMinutes} min ago`}
          </div>
        </div>
      </div>

      {!confirmed ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          The gray task route is only a preview so you can see Stage 0, Stop 1 and the final destination clearly. The green billing route appears only after the driver finishes Stage 0 review and you confirm the task.
        </div>
      ) : null}

      {secondsSinceUpdate != null && secondsSinceUpdate >= 60 ? (
        <div className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Last driver location update: {staleMinutes} minute{staleMinutes === 1 ? "" : "s"} ago. The map holds the last known marker and does not fake movement.
        </div>
      ) : null}

      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
        {text(tracking?.map_note) || "Fare is based on the confirmed route, not the driver's live path."}
      </div>

      {error ? <div className="mt-3 text-xs text-red-600">{error}</div> : null}
    </div>
  );
}
