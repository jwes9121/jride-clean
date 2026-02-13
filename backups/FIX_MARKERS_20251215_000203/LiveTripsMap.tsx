"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { LiveTrip } from "./ProblemTripAlertSounds";

// IMPORTANT: You MUST have NEXT_PUBLIC_MAPBOX_TOKEN set in .env.local
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = {
  trips: any[];
  selectedTripId: string | null;
  stuckTripIds?: Set<string>;
};

const TOWN_COLORS: Record<string, string> = {
  Lagawe: "#800000",
  Kiangan: "#90EE90",
  Lamut: "#FFF9C4",
  Banaue: "#FFD54F",
  Hingyon: "#2196F3",
  Unknown: "#9E9E9E",
};

function normTown(z?: any) {
  const s = String(z || "Unknown").trim();
  if (!s) return "Unknown";
  const key = Object.keys(TOWN_COLORS).find((k) => k.toLowerCase() === s.toLowerCase());
  return key || s;
}

export function LiveTripsMap({ trips, selectedTripId, stuckTripIds }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  const safeTrips = useMemo(() => Array.isArray(trips) ? trips : [], [trips]);

  useEffect(() => {
    if (mapRef.current) return;
    if (!mapContainerRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [121.07, 16.86],
      zoom: 10.5,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    const onLoad = () => setMapReady(true);
    map.on("load", onLoad);

    return () => {
      map.off("load", onLoad);
      try { map.remove(); } catch {}
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // Draw markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const keep = new Set<string>();

    for (const t of safeTrips) {
      const id = String(t?.id || t?.booking_code || "");
      if (!id) continue;

      const pickup = t?.pickup;
      const lat = Number(pickup?.lat);
      const lng = Number(pickup?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      keep.add(id);

      const zone = normTown(t?.zone);
      const color = TOWN_COLORS[zone] || TOWN_COLORS.Unknown;
      const isSelected = selectedTripId && String(selectedTripId) === id;
      const isStuck = stuckTripIds?.has(id);

      const el = document.createElement("div");
      el.style.width = isSelected ? "18px" : "14px";
      el.style.height = isSelected ? "18px" : "14px";
      el.style.borderRadius = "9999px";
      el.style.background = color;
      el.style.border = isStuck ? "3px solid #ff3b30" : "2px solid white";
      el.style.boxShadow = "0 2px 6px rgba(0,0,0,.25)";

      const existing = markersRef.current.get(id);
      if (existing) {
        existing.setLngLat([lng, lat]);
        const node = existing.getElement();
        node.replaceWith(el);
        existing.setElement(el);
      } else {
        const m = new mapboxgl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(map);

        markersRef.current.set(id, m);
      }
    }

    // Remove stale markers
    for (const [id, mk] of markersRef.current.entries()) {
      if (!keep.has(id)) {
        try { mk.remove(); } catch {}
        markersRef.current.delete(id);
      }
    }
  }, [safeTrips, selectedTripId, mapReady, stuckTripIds]);

  return (
    <div className="h-full w-full min-h-[55vh] md:min-h-0 relative">
      <div ref={mapContainerRef} className="h-full w-full" />
    </div>
  );
}