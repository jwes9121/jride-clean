"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import React, { useEffect, useRef } from "react";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

type Props = {
  trips: any[];
  selectedTripId: string | null;
  stuckTripIds: Set<string>;
};

export function LiveTripsMap({ trips, selectedTripId }: Props) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // -----------------------------
  // INIT MAP (ONCE)
  // -----------------------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [121.219, 16.835], // Ifugao default
      zoom: 10,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // -----------------------------
  // UPDATE MARKERS + ROUTES
  // -----------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Cleanup old layers/sources
    const toRemove: string[] = [];
    map.getStyle().layers?.forEach((l) => {
      if (l.id.startsWith("trip-")) toRemove.push(l.id);
    });
    toRemove.forEach((id) => {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    });

    for (const t of trips) {
      const id = String(t.id ?? t.booking_code ?? "");
      if (!id) continue;

      const lng = t.driver_lng ?? t.pickup_lng;
      const lat = t.driver_lat ?? t.pickup_lat;
      if (typeof lng !== "number" || typeof lat !== "number") continue;

      map.addSource(`trip-${id}`, {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
        },
      });

      map.addLayer({
        id: `trip-${id}`,
        type: "circle",
        source: `trip-${id}`,
        paint: {
          "circle-radius": id === selectedTripId ? 8 : 6,
          "circle-color": id === selectedTripId ? "#ef4444" : "#22c55e",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });
    }
  }, [trips, selectedTripId]);

  // -----------------------------
  // AUTO-CENTER ON SELECTED TRIP
  // -----------------------------
  useEffect(() => {
    if (!selectedTripId) return;
    const map = mapRef.current;
    if (!map) return;

    const t = trips.find(
      (x) =>
        String(x.id ?? x.booking_code ?? "") === String(selectedTripId)
    );
    if (!t) return;

    const lng = t.driver_lng ?? t.pickup_lng;
    const lat = t.driver_lat ?? t.pickup_lat;
    if (typeof lng !== "number" || typeof lat !== "number") return;

    map.flyTo({
      center: [lng, lat],
      zoom: 15,
      essential: true,
    });
  }, [selectedTripId, trips]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="absolute inset-0" />
    </div>
  );
}
