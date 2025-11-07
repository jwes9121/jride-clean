"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";
console.log("[MapboxMap] Build-time token present:", token ? "YES" : "NO");

type DriverFeature = {
  id: string | number;
  coordinates: [number, number]; // [lng, lat]
  color?: string;
};

type Props = {
  drivers?: DriverFeature[];
  initialCenter?: [number, number];
  initialZoom?: number;
};

export default function MapboxMap({
  drivers = [],
  initialCenter = [121.1036, 16.8003],
  initialZoom = 11,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[MapboxMap] useEffect start");

    if (!containerRef.current) {
      console.log("[MapboxMap] containerRef is null");
      return;
    }

    if (!token) {
      console.error("[MapboxMap] Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      setError("Missing Mapbox access token (NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN).");
      return;
    }

    (mapboxgl as any).accessToken = token;

    if (!mapboxgl.supported()) {
      console.error("[MapboxMap] Mapbox GL not supported");
      setError("Mapbox GL is not supported in this browser.");
      return;
    }

    try {
      console.log("[MapboxMap] Creating map...");
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: initialCenter,
        zoom: initialZoom,
      });

      mapRef.current = map;

      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        console.log("[MapboxMap] Map loaded, adding", drivers.length, "drivers");
        drivers.forEach((driver) => {
          new mapboxgl.Marker({
            color: driver.color || "#2563eb",
          })
            .setLngLat(driver.coordinates)
            .addTo(map);
        });
      });
    } catch (e: any) {
      console.error("[MapboxMap] Error initializing Mapbox:", e);
      setError("Failed to initialize Mapbox map. See console for details.");
    }

    return () => {
      if (mapRef.current) {
        console.log("[MapboxMap] Cleaning up map");
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center w-full h-full text-sm text-red-600">
        {error}
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full bg-gray-100" />;
}