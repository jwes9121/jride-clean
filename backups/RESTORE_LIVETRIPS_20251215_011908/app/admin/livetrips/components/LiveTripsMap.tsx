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

function pickLatLng(t: any): { lat: number; lng: number } | null {
  // Supports both shapes:
  // 1) t.pickup.lat/lng
  // 2) t.pickup_lat / t.pickup_lng
  const p = t?.pickup;
  const lat = Number(p?.lat ?? t?.pickup_lat ?? t?.from_lat ?? t?.pickupLatitude);
  const lng = Number(p?.lng ?? t?.pickup_lng ?? t?.from_lng ?? t?.pickupLongitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

export function LiveTripsMap({ trips, selectedTripId, stuckTripIds }: Props) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [mapReady, setMapReady] = useState(false);
  const [mapErr, setMapErr] = useState<string | null>(null);

  const safeTrips = useMemo(() => (Array.isArray(trips) ? trips : []), [trips]);

  // Init map ONCE
  useEffect(() => {
    if (mapRef.current) return;

    const el = mapContainerRef.current;
    if (!el) return;

    // If token missing, show it immediately (this is THE #1 “white map” cause)
    if (!mapboxgl.accessToken || mapboxgl.accessToken.length < 20) {
      setMapErr("Mapbox token is missing/invalid (NEXT_PUBLIC_MAPBOX_TOKEN). Map cannot load.");
      return;
    }

    setMapErr(null);

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

      // Fix “half rendered” canvas by forcing resizes across first paint/idle
      requestAnimationFrame(() => {
        try { map.resize(); } catch {}
      });
      setTimeout(() => { try { map.resize(); } catch {} }, 50);
      setTimeout(() => { try { map.resize(); } catch {} }, 250);

      // One more when idle (style/tiles settled)
      const onIdleOnce = () => {
        try { map.resize(); } catch {}
        map.off("idle", onIdleOnce);
      };
      map.on("idle", onIdleOnce);
    };

    const onError = (e: any) => {
      // Mapbox emits a lot of errors; surface only meaningful ones
      const msg =
        e?.error?.message ||
        e?.error?.status ||
        e?.error?.url ||
        e?.message ||
        "Unknown Mapbox error";
      // Common: style request blocked / token scope / CSP
      setMapErr(String(msg));
    };

    map.on("load", onLoad);
    map.on("error", onError);

    return () => {
      map.off("load", onLoad);
      map.off("error", onError);
      try { map.remove(); } catch {}
      mapRef.current = null;

      // Remove markers
      for (const mk of markersRef.current.values()) {
        try { mk.remove(); } catch {}
      }
      markersRef.current.clear();
    };
  }, []);

  // Keep canvas synced with container size changes
  useEffect(() => {
    const el = mapContainerRef.current;
    const map = mapRef.current;
    if (!el || !map) return;

    const ro = new ResizeObserver(() => {
      try { map.resize(); } catch {}
    });

    ro.observe(el);

    const onWin = () => { try { map.resize(); } catch {} };
    window.addEventListener("resize", onWin);

    return () => {
      try { ro.disconnect(); } catch {}
      window.removeEventListener("resize", onWin);
    };
  }, [mapReady]);

  // Upsert markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const keep = new Set<string>();

    for (const t of safeTrips) {
      const id = String(t?.id || t?.booking_code || t?.bookingCode || "");
      if (!id) continue;

      const ll = pickLatLng(t);
      if (!ll) continue;

      keep.add(id);

      const zone = normTown(t?.zone ?? t?.town ?? t?.municipality);
      const isSelected = !!selectedTripId && String(selectedTripId) === id;
      const isStuck = !!stuckTripIds?.has(id);

      const existing = markersRef.current.get(id);
      if (existing) {
        existing.setLngLat([ll.lng, ll.lat]);
        applyMarkerStyle(existing.getElement() as HTMLElement, zone, isSelected, isStuck);
      } else {
        const markerEl = document.createElement("div");
        applyMarkerStyle(markerEl, zone, isSelected, isStuck);

        const mk = new mapboxgl.Marker({ element: markerEl })
          .setLngLat([ll.lng, ll.lat])
          .addTo(map);

        markersRef.current.set(id, mk);
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
      {/* ERROR OVERLAY (so we stop guessing) */}
      {mapErr ? (
        <div className="absolute z-50 top-2 left-2 right-2 bg-white/95 border border-red-300 text-red-700 text-xs p-2 rounded">
          <div className="font-semibold">Map error:</div>
          <div className="break-words">{mapErr}</div>
          <div className="mt-1 opacity-70">
            If this mentions token/style/CSP, open DevTools → Network and click the red “outdoors-v12” request.
          </div>
        </div>
      ) : null}

      <div ref={mapContainerRef} className="absolute inset-0" />
    </div>
  );
}