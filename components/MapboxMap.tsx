"use client";

import React, { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

// ✅ CSP-safe bundle + worker: use default export only
import mapboxgl from "mapbox-gl/dist/mapbox-gl-csp";
import MapboxWorker from "mapbox-gl/dist/mapbox-gl-csp-worker";

// Assign worker for CSP builds (harmless if already set)
try {
  (mapboxgl as any).workerClass = MapboxWorker;
  // Some envs also look at .worker
  (mapboxgl as any).worker = MapboxWorker as any;
} catch {}

type LatLng = { lat: number; lng: number };
type MarkerDef = LatLng & { id?: string; color?: string };

type Props = {
  center: LatLng;
  zoom?: number;
  markers?: MarkerDef[];
  onClickLatLng?: (pos: LatLng) => void;
  className?: string;
  height?: number | string;
};

export default function MapboxMap({
  center,
  zoom = 13,
  markers = [],
  onClickLatLng,
  className = "",
  height = 420,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!containerRef.current) return;

    const token =
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
      process.env.NEXT_PUBLIC_MAPBOX ||
      "";

    if (!token) {
      setInitError("Mapbox token missing. Set NEXT_PUBLIC_MAPBOX_TOKEN.");
      return;
    }

    try {
      (mapboxgl as any).accessToken = token;
    } catch (e: any) {
      console.error("[Mapbox] Failed to set accessToken", e);
      setInitError("Failed to set Mapbox access token.");
      return;
    }

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [center.lng, center.lat],
        zoom,
      });
      mapRef.current = map;

      // Controls
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

      // Manage markers
      const currentMarkers: mapboxgl.Marker[] = [];
      const addMarkers = () => {
        // clear previous
        while (currentMarkers.length) {
          try { currentMarkers.pop()?.remove(); } catch {}
        }
        // add new
        markers.forEach((m) => {
          const marker = new mapboxgl.Marker({ color: m.color || "#2563eb" })
            .setLngLat([m.lng, m.lat])
            .addTo(map);
          currentMarkers.push(marker);
        });
      };

      const clickHandler = (e: mapboxgl.MapMouseEvent & mapboxgl.EventData) => {
        if (onClickLatLng) {
          const { lng, lat } = e.lngLat.wrap();
          onClickLatLng({ lng, lat });
        }
      };

      map.on("load", addMarkers);
      map.on("styledata", addMarkers);
      if (onClickLatLng) map.on("click", clickHandler);

      return () => {
        try {
          if (onClickLatLng) map.off("click", clickHandler);
          map.remove();
        } catch {}
      };
    } catch (e: any) {
      console.error("[Mapbox] init error:", e);
      setInitError(e?.message || String(e));
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, zoom, JSON.stringify(markers), !!onClickLatLng]);

  if (initError) {
    return (
      <div
        className={`w-full rounded-lg overflow-hidden border ${className}`}
        style={{ height: typeof height === "number" ? `${height}px` : height }}
      >
        <div className="h-full w-full flex items-center justify-center text-sm text-red-700 bg-red-50">
          Map failed to load: {initError}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`w-full rounded-lg overflow-hidden border ${className}`}
      style={{ height: typeof height === "number" ? `${height}px` : height }}
    />
  );
}


