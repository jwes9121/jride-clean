"use client";

import { useEffect, useRef } from "react";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

export default function LiveDriverMap() {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = mapContainerRef.current;

    if (!container) {
      console.error("[LiveDriverMap] No container element found.");
      return;
    }

    if (!MAPBOX_TOKEN) {
      console.error(
        "[LiveDriverMap] Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN. Map will not load."
      );
      return;
    }

    let map: any;

    async function init() {
      try {
        console.log("[LiveDriverMap] Initializing Mapbox map…");

        const mapboxglModule = await import("mapbox-gl");
        const mapboxgl = mapboxglModule.default ?? mapboxglModule;

        mapboxgl.accessToken = MAPBOX_TOKEN;

        map = new mapboxgl.Map({
          container,
          style: "mapbox://styles/mapbox/streets-v11",
          center: [121.1, 16.8], // Ifugao-ish; adjust anytime
          zoom: 11
        });

        map.on("load", () => {
          console.log("[LiveDriverMap] Map loaded successfully.");
        });

        map.on("error", (event: any) => {
          console.error("[LiveDriverMap] Map error:", event?.error || event);
        });
      } catch (error) {
        console.error("[LiveDriverMap] Failed to initialize:", error);
      }
    }

    init();

    return () => {
      if (map) {
        console.log("[LiveDriverMap] Cleaning up map instance.");
        map.remove();
      }
    };
  }, []);

  return (
    <div className="w-full h-[70vh]">
      <div
        ref={mapContainerRef}
        className="w-full h-full"
      />
    </div>
  );
}
