"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

type Trip = any;

type Props = {
  trips: Trip[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>;
};

function getTripKey(t: any): string {
  return String(t?.id ?? t?.booking_code ?? "");
}

function getTripPoint(t: any): [number, number] | null {
  const lng = t?.driver_lng ?? t?.pickup_lng;
  const lat = t?.driver_lat ?? t?.pickup_lat;
  if (typeof lng !== "number" || typeof lat !== "number") return null;
  return [lng, lat];
}

export function LiveTripsMap({ trips, selectedTripId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // used to re-run effects once map style is loaded
  const [styleTick, setStyleTick] = useState(0);

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  // -----------------------------
  // INIT MAP (ONCE)
  // -----------------------------
  useEffect(() => {
    if (!token) return;
    if (mapRef.current) return;
    if (!containerRef.current) return;

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [121.219, 16.835], // Ifugao default
      zoom: 10,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    // When style loads, trigger marker render
    const onLoad = () => {
      setStyleTick((x) => x + 1);
      // Also resize after load to avoid blank map in flex layouts
      requestAnimationFrame(() => map.resize());
      setTimeout(() => map.resize(), 50);
      setTimeout(() => map.resize(), 250);
    };

    map.on("load", onLoad);

    // Safety: if style reloads (hot reload), rerender markers
    const onStyle = () => setStyleTick((x) => x + 1);
    map.on("style.load", onStyle);

    // Initial resize
    requestAnimationFrame(() => map.resize());

    return () => {
      map.off("load", onLoad);
      map.off("style.load", onStyle);
      map.remove();
      mapRef.current = null;
    };
  }, [token]);

  // -----------------------------
  // DRAW / UPDATE MARKERS (as circle layers)
  // -----------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // If style not ready, wait for it then rerun (styleTick will change)
    if (!map.isStyleLoaded()) return;

    const style = map.getStyle();
    if (!style || !style.layers) return;

    // Remove old trip-* layers & sources
    const layerIds = style.layers.map((l) => l.id);
    for (const id of layerIds) {
      if (!id.startsWith("trip-")) continue;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }

    // Add current trips
    for (const t of trips) {
      const key = getTripKey(t);
      if (!key) continue;

      const pt = getTripPoint(t);
      if (!pt) continue;

      const srcId = `trip-${key}`;

      map.addSource(srcId, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: { type: "Point", coordinates: pt },
          properties: {},
        },
      });

      const isSelected = selectedTripId && String(selectedTripId) === String(key);

      map.addLayer({
        id: srcId,
        type: "circle",
        source: srcId,
        paint: {
          "circle-radius": isSelected ? 8 : 6,
          "circle-color": isSelected ? "#ef4444" : "#22c55e",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
  }, [trips, selectedTripId, styleTick]);

  // -----------------------------
  // AUTO-CENTER ON SELECTED TRIP
  // -----------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!map.isStyleLoaded()) return;
    if (!selectedTripId) return;

    const found = trips.find((t) => String(getTripKey(t)) === String(selectedTripId));
    if (!found) return;

    const pt = getTripPoint(found);
    if (!pt) return;

    map.flyTo({ center: pt, zoom: 15, essential: true });
  }, [selectedTripId, trips, styleTick]);

  // If token missing, show explicit error instead of white screen
  if (!token) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-white text-xs text-red-600 border">
        Missing NEXT_PUBLIC_MAPBOX_TOKEN
      </div>
    );
  }

  return (
    <div className="h-full w-full min-h-[55vh] md:min-h-0 relative">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
