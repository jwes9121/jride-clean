"use client";

import * as React from "react";

const TOKEN_KEY = "jride_access_token";
const CONFIRMED_SOURCE = "errand_confirmed_route";
const ACTUAL_SOURCE = "errand_actual_route";
const CONFIRMED_LAYER = "errand_confirmed_route_line";
const ACTUAL_LAYER = "errand_actual_route_line";

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
    .filter(Boolean);

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

  const [tracking, setTracking] = React.useState<any>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

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

  function updateMapData() {
    const map = mapRef.current;
    if (!map) return;
    try {
      const confirmed = map.getSource(CONFIRMED_SOURCE);
      if (confirmed?.setData) confirmed.setData(confirmedRef.current);
      const actual = map.getSource(ACTUAL_SOURCE);
      if (actual?.setData) actual.setData(actualRef.current);
    } catch {}
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
          driverMarkerRef.current = new MapboxGL.Marker({ color: "#dc2626" })
            .setLngLat([lng, lat])
            .addTo(mapRef.current);
        } else {
          driverMarkerRef.current.setLngLat([lng, lat]);
        }
      }
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
    fetchTracking(true);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => fetchTracking(false), 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [bookingId]);

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
                "line-width": 5,
                "line-opacity": 0.75,
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
                "line-width": 4,
                "line-opacity": 0.9,
                "line-dasharray": [1.5, 1],
              },
            });
            updateMapData();
          } catch {}
        });

        stopMarkersRef.current.forEach((marker) => {
          try {
            marker.remove();
          } catch {}
        });
        stopMarkersRef.current = [];

        const allPoints = [stage0, ...stops, finalPoint].filter(Boolean) as Point[];
        for (const point of allPoints) {
          const marker = new MapboxGL.Marker({
            color:
              point.kind === "stage0"
                ? "#059669"
                : point.kind === "final"
                  ? "#7c3aed"
                  : "#f59e0b",
          })
            .setLngLat([point.lng, point.lat])
            .setPopup(
              new MapboxGL.Popup({ offset: 16 }).setText(
                point.kind === "stop" && point.sequence
                  ? `Stop ${point.sequence}: ${point.label}`
                  : point.label
              )
            )
            .addTo(mapRef.current);
          stopMarkersRef.current.push(marker);
        }
      } catch {
        setError("Mapbox live map failed to load.");
      }
    })();

    return () => {
      cancelled = true;
      stopMarkersRef.current.forEach((marker) => {
        try {
          marker.remove();
        } catch {}
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

  return (
    <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-950">Live Errand map</div>
          <div className="mt-1 text-xs text-slate-500">
            Green = confirmed billing route. Blue dashed = actual driver GPS path.
          </div>
        </div>
        <div className="text-xs text-slate-500">
          {loading ? "Loading tracking..." : `GPS points: ${actualPointCount}`}
        </div>
      </div>

      {MAPBOX_TOKEN ? (
        <div ref={mapDivRef} className="mt-4 h-[420px] w-full rounded-2xl bg-slate-100" />
      ) : (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Mapbox token is unavailable.
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-slate-400">Confirmed route</div>
          <div className="mt-1 font-semibold text-slate-800">
            {confirmedKm == null ? "Waiting for Stage 0 confirmation" : `${confirmedKm.toFixed(1)} km`}
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
