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

export default function LiveDriverMap({
  center = [121.06, 16.8],
  zoom = 13,
  geofences = [],
}: Props) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const supabase = createClientComponentClient();

  // Init map once and add sources/layers + initial load of drivers
  useEffect(() => {
    if (mapRef.current) return;

    const m = new mapboxgl.Map({
      container: "live-map",
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom,
    });
    mapRef.current = m;

    m.on("load", () => {
      // ---- Driver source + layer
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
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
          },
        });
      }

      // ---- Geofences (fill + outline)
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

      // ---- Initial load of driver pins (so they show immediately)
      fetch("/api/driver-locations")
        .then((r) => r.json())
        .then((geojson) => {
          const src = m.getSource("drivers") as mapboxgl.GeoJSONSource | undefined;
          if (src && geojson) src.setData(geojson);
        })
        .catch(() => {});
    });

    // optional: destroy map on unmount to avoid leaks (no async cleanup)
    return () => {
      try {
        m.remove();
      } catch {}
      mapRef.current = null;
    };
  }, [center, zoom, geofences]);

  // Realtime refresh of driver pins (fetch-all on change; simple & robust)
  useEffect(() => {
    let channel: RealtimeChannel | null = null;

    const subscribe = () => {
      channel = supabase
        .channel("driver_locations_realtime")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "driver_locations" },
          () => {
            const m = mapRef.current;
            if (!m) return;
            const src = m.getSource("drivers") as mapboxgl.GeoJSONSource | undefined;
            if (!src) return;
            fetch("/api/driver-locations")
              .then((r) => r.json())
              .then((geojson) => src.setData(geojson))
              .catch(() => {});
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
