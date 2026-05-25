"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LiveTrip } from "./ProblemTripAlertSounds";
import { DispatchActionPanel } from "./DispatchActionPanel";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

function ensureStyleLoaded(map: mapboxgl.Map, cb: () => void) {
  if (map.isStyleLoaded()) cb();
  else map.once("style.load", cb);
}

export interface LiveTripsMapProps {
  trips: LiveTrip[];
  selectedTripId: string | null;
  stuckTripIds?: Set<string>;
}

export function LiveTripsMap({ trips, selectedTripId, stuckTripIds }: LiveTripsMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Record<string, mapboxgl.Marker>>({});
  const [mapReady, setMapReady] = useState(false);
  const [selectedTrip, setSelectedTrip] = useState<LiveTrip | null>(null);

  const tripsById = useMemo(() => {
    const m: Record<string, LiveTrip> = {};
    for (const t of trips || []) {
      const id = String((t as any).id ?? (t as any).booking_id ?? (t as any).booking_code ?? "");
      if (id) m[id] = t;
    }
    return m;
  }, [trips]);

  useEffect(() => {
    const id = selectedTripId ? String(selectedTripId) : "";
    setSelectedTrip(id && tripsById[id] ? tripsById[id] : null);
  }, [selectedTripId, tripsById]);

  // INIT MAP (once)
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.0, 16.8],
      zoom: 11,
    });

    mapRef.current = map;

    map.on("load", () => {
      setMapReady(true);
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // MARKERS + ROUTES UPDATE
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // ---- your existing marker/route logic continues ----
    // This restore includes ONLY the critical style-load guard below in addSource/addLayer.

    // Example: if your code uses routeId and `data` GeoJSON, keep same logic
    // but ensure style loaded before addSource/addLayer.

    // NOTE: This block is a safe wrapper around your existing addSource usage.
    // It will not crash when style is still loading.
    async function upsertRoute(routeId: string, data: any) {
      if (!map) return;

      const existing = map.getSource(routeId) as mapboxgl.GeoJSONSource | undefined;
      if (existing) {
        existing.setData(data);
        return;
      }

      ensureStyleLoaded(map, () => {
        const existing2 = map.getSource(routeId) as mapboxgl.GeoJSONSource | undefined;
        if (existing2) {
          existing2.setData(data);
          return;
        }

        map.addSource(routeId, {
          type: "geojson",
          data,
        });

        if (!map.getLayer(routeId)) {
          map.addLayer({
            id: routeId,
            type: "line",
            source: routeId,
            paint: {
              "line-color": "#16a34a",
              "line-width": 5,
            },
          });
        }
      });
    }

    // ===== IMPORTANT =====
    // Your original file has much more code (markers, icons, routes, follow, etc).
    // If you had custom route/marker rendering, paste it below or tell me the EXACT
    // repo file currently present and I will patch it WITHOUT deleting anything.
    //
    // For now, we at least restore the map container so your map renders again.

  }, [mapReady, trips, selectedTripId, stuckTripIds]);

  return (
    <div className="relative h-full w-full">
      <div ref={mapContainerRef} className="h-full w-full" />
      {selectedTrip ? (
        <div className="absolute bottom-3 left-3 right-3 z-20">
          <DispatchActionPanel trip={selectedTrip as any} />
        </div>
      ) : null}
    </div>
  );
}