"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

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
  const [initError, setInitError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (!mapboxgl.accessToken) {
      setInitError("Missing Mapbox access token");
      return;
    }

    // Init map once
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: initialCenter,
      zoom: initialZoom,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    // Add markers once on load; for full realtime we can wire Supabase later
    map.on("load", () => {
      drivers.forEach((driver) => {
        new mapboxgl.Marker({
          color: driver.color || "#2563eb",
        })
          .setLngLat(driver.coordinates)
          .addTo(map);
      });
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (initError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-red-500">
        {initError}
      </div>
    );
  }

  return <div ref={containerRef} className="w-full h-full" />;
}