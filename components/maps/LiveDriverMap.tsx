"use client";

import React, { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

type DriverPoint = {
  id: string;
  lat: number;
  lng: number;
  name?: string;
  status?: string;
};

type LiveDriverMapProps = {
  drivers: DriverPoint[];
  follow?: boolean;
  fitToDrivers?: boolean;
};

export default function LiveDriverMap({
  drivers,
  follow = false,
  fitToDrivers = true,
}: LiveDriverMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const firstFitDoneRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!mapboxgl.accessToken) {
      console.warn("Mapbox token missing: NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN");
      return;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [0, 0],
      zoom: 2,
    });

    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    map.on("load", () => {
      if (!map.getSource("drivers")) {
        map.addSource("drivers", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: [],
          },
          cluster: true,
          clusterRadius: 40,
          clusterMaxZoom: 14,
        });

        map.addLayer({
          id: "clusters",
          type: "circle",
          source: "drivers",
          filter: ["has", "point_count"],
          paint: {
            "circle-color": "#2563eb",
            "circle-radius": 18,
            "circle-opacity": 0.8,
          },
        });

        map.addLayer({
          id: "cluster-count",
          type: "symbol",
          source: "drivers",
          filter: ["has", "point_count"],
          layout: {
            "text-field": "{point_count_abbreviated}",
            "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
            "text-size": 12,
          },
          paint: {
            "text-color": "#ffffff",
          },
        });

        map.addLayer({
          id: "driver-point",
          type: "circle",
          source: "drivers",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-color": "#22c55e",
            "circle-radius": 6,
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#ffffff",
          },
        });

        // --- typed cluster click handler ---
        map.on(
          "click",
          "clusters",
          (e: mapboxgl.MapMouseEvent & mapboxgl.EventData) => {
            const features = map.queryRenderedFeatures(e.point, {
              layers: ["clusters"],
            });
            const clusterId = features[0]?.properties?.cluster_id;
            if (clusterId == null) return;

            const src = map.getSource("drivers") as mapboxgl.GeoJSONSource;
            src.getClusterExpansionZoom(clusterId, (err, zoom) => {
              if (err) return;
              map.easeTo({
                center: (features[0].geometry as any).coordinates as [
                  number,
                  number
                ],
                zoom,
              });
            });
          }
        );

        map.on(
          "click",
          "driver-point",
          (e: mapboxgl.MapMouseEvent & mapboxgl.EventData) => {
            const feature = e.features?.[0];
            if (!feature) return;
            const [lng, lat] = (feature.geometry as any).coordinates as [
              number,
              number
            ];
            const name = feature.properties?.name || "Driver";
            const status = feature.properties?.status || "";

            new mapboxgl.Popup()
              .setLngLat([lng, lat])
              .setHTML(
                `<div style="font-size:12px;"><strong>${name}</strong>${
                  status ? `<br/>${status}` : ""
                }</div>`
              )
              .addTo(map);
          }
        );

        map.on("mouseenter", "clusters", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "clusters", () => {
          map.getCanvas().style.cursor = "";
        });
        map.on("mouseenter", "driver-point", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "driver-point", () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update data + view when drivers change
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    const src = map.getSource("drivers") as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;

    const features = drivers.map((d) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [d.lng, d.lat] as [number, number],
      },
      properties: {
        id: d.id,
        name: d.name ?? d.id,
        status: d.status ?? "",
      },
    }));

    src.setData({
      type: "FeatureCollection",
      features,
    });

    if (fitToDrivers && drivers.length > 0 && !firstFitDoneRef.current) {
      const bounds = new mapboxgl.LngLatBounds();
      drivers.forEach((d) => bounds.extend([d.lng, d.lat]));
      map.fitBounds(bounds, { padding: 40, maxZoom: 14, duration: 600 });
      firstFitDoneRef.current = true;
    }

    if (follow && drivers.length === 1) {
      const d = drivers[0];
      map.easeTo({
        center: [d.lng, d.lat],
        zoom: Math.max(map.getZoom(), 12),
        duration: 500,
      });
    }
  }, [drivers, follow, fitToDrivers]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "600px",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    />
  );
}
