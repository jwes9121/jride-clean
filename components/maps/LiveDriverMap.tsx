"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

export type DriverPoint = {
  id: string;
  lat: number;
  lng: number;
  label?: string;
  status?: string;
};

type LiveDriverMapProps = {
  drivers: DriverPoint[];
};

const DEFAULT_CENTER: [number, number] = [121.066, 16.801];
const DEFAULT_ZOOM = 11;

const LiveDriverMap: React.FC<LiveDriverMapProps> = ({ drivers }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  // Init map once
  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
    if (!token) {
      console.warn("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is missing");
      return;
    }

    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      // Source for driver points (clustered)
      map.addSource("drivers", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 40,
      });

      // Cluster circles
      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "drivers",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#2563eb",
          "circle-radius": 18,
          "circle-opacity": 0.9,
        },
      });

      // Cluster count labels
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "drivers",
        filter: ["has", "point_count"],
        layout: {
          "text-field": "{point_count_abbreviated}",
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
        },
      });

      // Individual driver points
      map.addLayer({
        id: "driver-point",
        type: "circle",
        source: "drivers",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#22c55e",
          "circle-radius": 6,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      // Zoom into clusters on click (no EventData type)
      map.on(
        "click",
        "clusters",
        (e: mapboxgl.MapMouseEvent) => {
          const features = map.queryRenderedFeatures(e.point, {
            layers: ["clusters"],
          });
          const clusterId = features[0]?.properties?.cluster_id;
          const src = map.getSource("drivers") as mapboxgl.GeoJSONSource;
          if (!clusterId || !src) return;

          src.getClusterExpansionZoom(clusterId, (err, zoom) => {
            if (err || zoom === undefined) return;
            const center = (features[0].geometry as any)
              .coordinates as [number, number];
            map.easeTo({ center, zoom });
          });
        }
      );

      // Show popup for individual driver points
      map.on("click", "driver-point", (e: mapboxgl.MapMouseEvent) => {
        const feature = e.features && e.features[0];
        if (!feature) return;

        const [lng, lat] = (feature.geometry as any)
          .coordinates as [number, number];

        const label =
          (feature.properties && feature.properties.label) || "Driver";

        new mapboxgl.Popup()
          .setLngLat([lng, lat])
          .setHTML(`<div>${label}</div>`)
          .addTo(map);
      });

      map.on("mouseenter", "clusters", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "clusters", () => {
        map.getCanvas().style.cursor = "";
      });
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update markers when drivers change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const src = map.getSource("drivers") as mapboxgl.GeoJSONSource;
    if (!src) return;

    const features = drivers
      .filter(
        (d) =>
          typeof d.lat === "number" &&
          !Number.isNaN(d.lat) &&
          typeof d.lng === "number" &&
          !Number.isNaN(d.lng)
      )
      .map((d) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [d.lng, d.lat],
        },
        properties: {
          id: d.id,
          label: d.label ?? d.id,
          status: d.status ?? "",
        },
      }));

    src.setData({
      type: "FeatureCollection",
      features,
    });
  }, [drivers]);

  return (
    <div className="w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};

export default LiveDriverMap;
