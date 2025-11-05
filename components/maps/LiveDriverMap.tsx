"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type * as GeoJSON from "geojson";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

export type Geofence = {
  name: string;
  geojson: GeoJSON.FeatureCollection<GeoJSON.Geometry>;
  fillColor?: string;
};

type Props = {
  center?: [number, number];
  zoom?: number;
  geofences?: Geofence[];
};

async function fetchDriversFC(): Promise<GeoJSON.FeatureCollection | null> {
  // Your server shows an underscore route working; try that first
  const urls = ["/api/driver_locations", "/api/driver-locations"];
  for (const u of urls) {
    try {
      const r = await fetch(u, { cache: "no-store" });
      if (r.ok) return (await r.json()) as GeoJSON.FeatureCollection;
    } catch {}
  }
  return null;
}

export default function LiveDriverMap({
  center = [121.06, 16.8],
  zoom = 13,
  geofences = [],
}: Props) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const supabase = createClientComponentClient();
  const didFitRef = useRef(false);

  // Init map once
  useEffect(() => {
    if (mapRef.current) return;

    const m = new mapboxgl.Map({
      container: "live-map",
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom,
    });
    mapRef.current = m;

    m.on("load", async () => {
      // --- Geofences first (so drivers can sit above them)
      geofences.forEach((f, idx) => {
        const srcId = `geofence-${idx}`;
        if (!m.getSource(srcId)) {
          m.addSource(srcId, { type: "geojson", data: f.geojson });
        }
        if (!m.getLayer(`${srcId}-fill`)) {
          m.addLayer({
            id: `${srcId}-fill`,
            type: "fill",
            source: srcId,
            paint: {
              "fill-opacity": 0.15,
            },
          });
        }
        if (!m.getLayer(`${srcId}-line`)) {
          m.addLayer({
            id: `${srcId}-line`,
            type: "line",
            source: srcId,
            paint: { "line-width": 2 },
          });
        }
      });

      // --- Drivers source + layer
      if (!m.getSource("drivers")) {
        m.addSource("drivers", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (!m.getLayer("drivers-circle")) {
        m.addLayer({
          id: "drivers-circle",
          type: "circle",
          source: "drivers",
          paint: {
            "circle-radius": 6,
            "circle-color": "#2563eb",     // visible blue
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      // Make sure drivers are on top of everything else
      try {
        m.moveLayer("drivers-circle");
      } catch {
        /* ignore if already top */
      }

      // Initial load so pins show immediately
      const fc = await fetchDriversFC();
      if (fc) {
        const src = m.getSource("drivers") as mapboxgl.GeoJSONSource | undefined;
        if (src) src.setData(fc);

        // Optional: fit to pins once (helps when pins are off-screen)
        if (!didFitRef.current && Array.isArray(fc.features) && fc.features.length > 0) {
          const bounds = new mapboxgl.LngLatBounds();
          fc.features.forEach((f: any) => {
            if (f?.geometry?.type === "Point" && Array.isArray(f.geometry.coordinates)) {
              bounds.extend(f.geometry.coordinates as [number, number]);
            }
          });
          if (!bounds.isEmpty()) {
            m.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
            didFitRef.current = true;
          }
        }
      }
    });

    // Clean up map on unmount (no async cleanup)
    return () => {
      try {
        m.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [center, zoom, geofences]);

  // Realtime refresh (fetch-all on any change)
  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    const subscribe = () => {
      channel = supabase
        .channel("driver_locations_realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "driver_locations" },
          async () => {
            const m = mapRef.current;
            if (!m) return;
            const src = m.getSource("drivers") as mapboxgl.GeoJSONSource | undefined;
            if (!src) return;

            const fc = await fetchDriversFC();
            if (fc) src.setData(fc);
          }
        )
        .subscribe();
    };

    subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  }, [supabase]);

  return <div id="live-map" className="w-full h-full rounded-2xl border" />;
}
