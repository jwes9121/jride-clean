"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type Trip = any;

export interface LiveTripsMapProps {
  trips: Trip[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>;
}

function tripKey(t: any): string {
  return String(t?.id ?? t?.booking_code ?? "");
}

function num(x: any): number | null {
  return typeof x === "number" && Number.isFinite(x) ? x : null;
}

function getDriverPoint(t: any): [number, number] | null {
  const lng = num(t?.driver_lng ?? t?.driver_longitude ?? t?.lng);
  const lat = num(t?.driver_lat ?? t?.driver_latitude ?? t?.lat);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

function getPickupPoint(t: any): [number, number] | null {
  const lng = num(t?.pickup_lng ?? t?.from_lng ?? t?.pickup_longitude);
  const lat = num(t?.pickup_lat ?? t?.from_lat ?? t?.pickup_latitude);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

function getDropoffPoint(t: any): [number, number] | null {
  const lng = num(t?.dropoff_lng ?? t?.to_lng ?? t?.dropoff_longitude);
  const lat = num(t?.dropoff_lat ?? t?.to_lat ?? t?.dropoff_latitude);
  if (lng === null || lat === null) return null;
  return [lng, lat];
}

export function LiveTripsMap({ trips, selectedTripId }: LiveTripsMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  const [readyTick, setReadyTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  const tripsById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const t of trips || []) {
      const k = tripKey(t);
      if (k) m[k] = t;
    }
    return m;
  }, [trips]);

  const selectedTrip = selectedTripId ? tripsById[String(selectedTripId)] : null;

  // ---------- INIT MAP (once) ----------
  useEffect(() => {
    if (!token) return;
    if (!containerRef.current) return;
    if (mapRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [121.219, 16.835], // Ifugao default
      zoom: 10,
    });

    mapRef.current = map;

    const bump = () => setReadyTick((x) => x + 1);

    map.on("load", () => {
      // Resize to avoid “white map” in flex layouts / hot reload
      requestAnimationFrame(() => map.resize());
      setTimeout(() => map.resize(), 50);
      setTimeout(() => map.resize(), 250);
      bump();
    });

    map.on("style.load", () => {
      // Style reload wipes layers/sources, so we re-render
      bump();
    });

    map.on("error", (e: any) => {
      const msg =
        e?.error?.message ||
        e?.error?.status ||
        e?.error?.url ||
        "Mapbox error (check Network: outdoors-v12 request)";
      setErr(String(msg));
    });

    // Also resize on window resize
    const onWinResize = () => map.resize();
    window.addEventListener("resize", onWinResize);

    return () => {
      window.removeEventListener("resize", onWinResize);
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // ---------- RENDER LAYERS / SOURCES ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // style not ready yet -> wait until style.load bumps readyTick
    if (!map.isStyleLoaded()) return;

    // Remove our old layers/sources safely
    const style = map.getStyle();
    const layers = style?.layers ?? [];
    for (const l of layers) {
      if (l.id.startsWith("jride-")) {
        if (map.getLayer(l.id)) map.removeLayer(l.id);
      }
    }

    // sources: remove known ids if present
    const sourcesToRemove = [
      "jride-trips-src",
      "jride-selected-src",
      "jride-selected-line-src",
    ];
    for (const s of sourcesToRemove) {
      if (map.getSource(s)) map.removeSource(s);
    }

    // 1) All trip markers (driver point if available else pickup)
    const features: any[] = [];
    for (const t of trips || []) {
      const id = tripKey(t);
      if (!id) continue;
      const pt = getDriverPoint(t) ?? getPickupPoint(t);
      if (!pt) continue;

      features.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: pt },
        properties: {
          id,
          selected: selectedTripId && String(selectedTripId) === String(id) ? 1 : 0,
        },
      });
    }

    map.addSource("jride-trips-src", {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });

    map.addLayer({
      id: "jride-trips-layer",
      type: "circle",
      source: "jride-trips-src",
      paint: {
        "circle-radius": ["case", ["==", ["get", "selected"], 1], 8, 6],
        "circle-color": ["case", ["==", ["get", "selected"], 1], "#ef4444", "#22c55e"],
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });

    // 2) Selected trip pickup/dropoff + line (simple straight line for now)
    if (selectedTrip) {
      const p1 = getPickupPoint(selectedTrip);
      const p2 = getDropoffPoint(selectedTrip);
      const selFeatures: any[] = [];

      if (p1) {
        selFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: p1 },
          properties: { kind: "pickup" },
        });
      }
      if (p2) {
        selFeatures.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: p2 },
          properties: { kind: "dropoff" },
        });
      }

      map.addSource("jride-selected-src", {
        type: "geojson",
        data: { type: "FeatureCollection", features: selFeatures },
      });

      map.addLayer({
        id: "jride-selected-points",
        type: "circle",
        source: "jride-selected-src",
        paint: {
          "circle-radius": 7,
          "circle-color": ["case", ["==", ["get", "kind"], "pickup"], "#3b82f6", "#f59e0b"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      if (p1 && p2) {
        map.addSource("jride-selected-line-src", {
          type: "geojson",
          data: {
            type: "Feature",
            geometry: { type: "LineString", coordinates: [p1, p2] },
            properties: {},
          },
        });

        map.addLayer({
          id: "jride-selected-line",
          type: "line",
          source: "jride-selected-line-src",
          paint: {
            "line-color": "#16a34a",
            "line-width": 4,
          },
        });
      }
    }
  }, [readyTick, trips, selectedTripId, selectedTrip]);

  // ---------- AUTO CENTER ON SELECTED ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;
    if (!selectedTrip) return;

    const pt = getDriverPoint(selectedTrip) ?? getPickupPoint(selectedTrip);
    if (!pt) return;

    map.flyTo({ center: pt, zoom: 14, essential: true });
  }, [readyTick, selectedTrip]);

  if (!token) {
    return (
      <div className="h-[60vh] md:h-full w-full flex items-center justify-center bg-white text-xs text-red-600 border">
        Missing NEXT_PUBLIC_MAPBOX_TOKEN (map cannot load)
      </div>
    );
  }

  return (
    <div className="relative w-full h-[60vh] md:h-full min-h-[420px]">
      <div ref={containerRef} className="absolute inset-0" />
      {err ? (
        <div className="absolute z-50 top-2 left-2 right-2 bg-white/95 border border-red-300 text-red-700 text-xs p-2 rounded">
          Map error: {err}
        </div>
      ) : null}
    </div>
  );
}
