"use client";
import React, { useEffect, useMemo, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { DriverLocation } from "@/types";
import { townColor } from "../realtime/townColors";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type Props = { drivers: DriverLocation[] };

function asFC(drivers: DriverLocation[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: drivers
      .filter((d) => typeof d.lng === "number" && typeof d.lat === "number")
      .map((d) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [d.lng as number, d.lat as number] },
        properties: { id: d.id, name: d.name, town: d.town ?? "", status: d.status, color: townColor(d.town ?? undefined) },
      })),
  } as GeoJSON.FeatureCollection;
}

export default function LiveDriverMap({ drivers }: Props) {
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const data = useMemo(() => asFC(drivers), [drivers]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.066, 16.801],
      zoom: 11,
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");
    mapRef.current = map;

    map.on("load", () => {
      if (!map.getSource("drivers")) {
        map.addSource("drivers", { type: "geojson", data, cluster: true, clusterMaxZoom: 14, clusterRadius: 40 });

        map.addLayer({ id: "clusters", type: "circle", source: "drivers", filter: ["has","point_count"],
          paint: { "circle-color": "#374151", "circle-radius": ["step", ["get","point_count"], 14, 10, 18, 25, 24], "circle-opacity": 0.85 } });

        map.addLayer({ id: "cluster-count", type: "symbol", source: "drivers", filter: ["has","point_count"],
          layout: { "text-field": ["get","point_count_abbreviated"], "text-size": 12 }, paint: { "text-color": "#fff" } });

        map.addLayer({ id: "drivers-unclustered", type: "circle", source: "drivers", filter: ["!",["has","point_count"]],
          paint: {
            "circle-color": ["get","color"], "circle-radius": 6,
            "circle-stroke-color": ["match", ["get","status"], "online","#22c55e","busy","#f59e0b","#9ca3af"],
            "circle-stroke-width": 2, "circle-opacity": 0.95
          } });

        map.on("click","clusters",(e)=>{
          const features = map.queryRenderedFeatures(e.point,{ layers:["clusters"] });
          const clusterId = features[0]?.properties?.cluster_id;
          const src = map.getSource("drivers") as mapboxgl.GeoJSONSource;
          if (!src || clusterId == null) return;
          (src as any).getClusterExpansionZoom(clusterId,(err:any,zoom:number)=>{
            if (err) return;
            map.easeTo({ center: (features[0].geometry as any).coordinates, zoom });
          });
        });

        map.on("click","drivers-unclustered",(e)=>{
          const f = e.features?.[0]; if (!f) return;
          const [lng, lat] = (f.geometry as any).coordinates;
          const { name, town, status, id } = f.properties as any;
          new mapboxgl.Popup({ offset: 10 })
            .setLngLat([lng, lat])
            .setHTML(`<div style="font:12px system-ui"><div style="font-weight:600">${name}</div><div>${town||"—"} · ${status}</div><div style="color:#6b7280">id: ${id}</div></div>`)
            .addTo(map);
        });

        map.on("mouseenter","drivers-unclustered",()=> (map.getCanvas().style.cursor="pointer"));
        map.on("mouseleave","drivers-unclustered",()=> (map.getCanvas().style.cursor=""));
      }
    });

    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const src = map.getSource("drivers") as mapboxgl.GeoJSONSource;
    if (src) src.setData(data as any);
    else map.once("load", ()=> (map.getSource("drivers") as mapboxgl.GeoJSONSource)?.setData(data as any));
  }, [data]);

  return <div ref={containerRef} className="w-full h-full rounded-2xl overflow-hidden" />;
}
