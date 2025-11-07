"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

export default function LiveDriverMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    // Only run in the browser, with a token, and once.
    if (!containerRef.current) return;
    if (!token) {
      console.warn(
        "[LiveDriverMap] NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is not set. Map will not load."
      );
      return;
    }
    if (mapRef.current) return;

    mapboxgl.accessToken = token;

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: [0, 0],
        zoom: 2,
      });

      mapRef.current = map;
    } catch (err) {
      console.error("[LiveDriverMap] Failed to init map:", err);
    }

    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return <div ref={containerRef} className="w-full h-full" />;
}
