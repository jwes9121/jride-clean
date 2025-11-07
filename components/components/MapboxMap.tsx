"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

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
  initialCenter = [121.1036, 16.8003], // Ifugao-ish default
  initialZoom = 11,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!token) {
      console.error("Mapbox token missing. Set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN.");
      setError("Missing Mapbox access token (NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN).");
      return;
    }

    (mapboxgl as any).accessToken = token;

    if (!mapboxgl.supported()) {
      console.error("Mapbox GL not supported in this browser.");
      setError("Mapbox GL is not supported in this browser.");
      return;
    }

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: initialCenter,
        zoom: initialZoom,
      });

      mapRef.current = map;

      map.addControl(new mapboxgl.NavigationControl(), "top-right");

      map.on("load", () => {
        // Simple markers from provided drivers (if any)
        drivers.forEach((driver) => {
          new mapboxgl.Marker({
            color: driver.color || "#2563eb",
          })
            .setLngLat(driver.coordinates)
            .addTo(map);
        });
      });
    } catch (e: any) {
      console.error("Error initializing Mapbox map:", e);
      setError("Failed to initialize Mapbox map. Check console for details.");
    }

    return () => {
      if (mapRef.current) {
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

  return <div ref={containerRef} className="w-full h-full" />;
}