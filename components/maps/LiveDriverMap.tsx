"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

export type DriverLocation = {
  id: string;
  lat: number | null;
  lng: number | null;
  name?: string | null;
  status?: string | null;
};

type LiveDriverMapProps = {
  drivers: DriverLocation[];
};

export default function LiveDriverMap({ drivers }: LiveDriverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!mapboxgl.accessToken) {
      console.warn("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      return;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.066, 16.801],
      zoom: 11
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      if (!map.getSource("drivers")) {
        map.addSource("drivers", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: []
          }
        });

        map.addLayer({
          id: "driver-point",
          type: "circle",
          source: "drivers",
          paint: {
            "circle-color": "#22c55e",
            "circle-radius": 6,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff"
          }
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers whenever drivers change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const src = map.getSource("drivers") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    const features = drivers
      .filter(
        (d) =>
          typeof d.lat === "number" &&
          typeof d.lng === "number"
      )
      .map((d) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [d.lng as number, d.lat as number]
        },
        properties: {
          id: d.id,
          name: d.name ?? d.id,
          status: d.status ?? ""
        }
      }));

    src.setData({
      type: "FeatureCollection",
      features
    });
  }, [drivers]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "600px",
        borderRadius: "12px",
        overflow: "hidden"
      }}
    />
  );
}
