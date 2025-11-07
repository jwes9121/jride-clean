"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

if (!token) {
  console.warn(
    "[LiveDriverMap] NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is not set. Map will not load."
  );
}

mapboxgl.accessToken = token || "";

export default function LiveDriverMap() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!token) return;
    if (mapRef.current) return;

    try {
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: [0, 0],
        zoom: 2,
      });

      mapRef.current = map;

      map.on("load", () => {
        console.log("[LiveDriverMap] Map loaded");
      });
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
