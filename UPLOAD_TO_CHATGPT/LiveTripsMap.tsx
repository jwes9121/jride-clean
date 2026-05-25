"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

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

function applyMarkerStyle(el: HTMLElement, zone: string, isSelected: boolean, isStuck: boolean) {
  const color = TOWN_COLORS[zone] || TOWN_COLORS.Unknown;
  const size = isSelected ? 18 : 14;

  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
  el.style.borderRadius = "9999px";
  el.style.background = color;
  el.style.boxShadow = "0 2px 6px rgba(0,0,0,.25)";
  el.style.cursor = "pointer";
  el.style.border = isStuck ? "3px solid #ff3b30" : "2px solid white";
}

export function LiveTripsMap({ trips, selectedTripId, stuckTripIds }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [mapReady, setMapReady] = useState(false);

  const safeTrips = useMemo(() => (Array.isArray(trips) ? trips : []), [trips]);

  // Init map once
  useEffect(() => {
    if (mapRef.current) return;
    const el = mapContainerRef.current;
    if (!el) return;

    const map = new mapboxgl.Map({
      container: el,
      style: "mapbox://styles/mapbox/outdoors-v12",
      center: [121.07, 16.86],
      zoom: 10.5,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    const onLoad = () => {
      setMapReady(true);
      // Force a few resizes after first paint to avoid “half rendered” canvas
      requestAnimationFrame(() => map.resize());
      setTimeout(() => map.resize(), 50);
      setTimeout(() => map.resize(), 250);
    };

    map.on("load", onLoad);

    return () => {
      map.off("load", onLoad);
      try { map.remove(); } catch {}
      mapRef.current = null;
      markersRef.current.clear();
    };
  }, []);

  // ResizeObserver: keep map canvas synced with container size changes
  useEffect(() => {
    const el = mapContainerRef.current;
    const map = mapRef.current;
    if (!el || !map) return;

    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch {}
    });

    ro.observe(el);

    const onWin = () => {
      try { map.resize(); } catch {}
    };
    window.addEventListener("resize", onWin);

    return () => {
      try { ro.disconnect(); } catch {}
      window.removeEventListener("resize", onWin);
    };
  }, [mapReady]);

  // Upsert markers safely
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
      const isSelected = !!selectedTripId && String(selectedTripId) === id;
      const isStuck = !!stuckTripIds?.has(id);

      const existing = markersRef.current.get(id);
      if (existing) {
        existing.setLngLat([lng, lat]);
        applyMarkerStyle(existing.getElement() as HTMLElement, zone, isSelected, isStuck);
      } else {
        const markerEl = document.createElement("div");
        applyMarkerStyle(markerEl, zone, isSelected, isStuck);

        const m = new mapboxgl.Marker({ element: markerEl })
          .setLngLat([lng, lat])
          .addTo(map);

        markersRef.current.set(id, m);
      }
    }

    for (const [id, mk] of markersRef.current.entries()) {
      if (!keep.has(id)) {
        try { mk.remove(); } catch {}
        markersRef.current.delete(id);
      }
    }
  }, [safeTrips, selectedTripId, stuckTripIds, mapReady]);

  return (
    <div className="h-full w-full min-h-[55vh] md:min-h-0 relative">
      <div ref={mapContainerRef} className="absolute inset-0" />
    </div>
  );
}