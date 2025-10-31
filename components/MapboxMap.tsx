"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl/dist/mapbox-gl-csp";
import MapboxWorker from "mapbox-gl/dist/mapbox-gl-csp-worker";
import "mapbox-gl/dist/mapbox-gl.css";

(mapboxgl as any).workerClass = MapboxWorker as unknown as typeof Worker;

type MapboxMapProps = {
  /** [lng, lat] */
  center?: [number, number];
  zoom?: number;
  className?: string;
  styleUrl?: string;
  markers?: { id: string; lng: number; lat: number }[];
  /** Receive lng/lat when the map is clicked */
  onClickLngLat?: (lng: number, lat: number) => void;
};

export default function MapboxMap({
  center = [121.1157, 16.8042],
  zoom = 13,
  className = "w-full h-full",
  styleUrl = "mapbox://styles/mapbox/streets-v12",
  markers = [],
  onClickLngLat,
}: MapboxMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    const token =
      process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ??
      process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.error("Missing NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN or NEXT_PUBLIC_MAPBOX_TOKEN");
      return;
    }
    (mapboxgl as any).accessToken = token;

    if (!mapContainerRef.current || mapRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: styleUrl,
      center,
      zoom,
      attributionControl: true,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

    markers.forEach((m) => {
      new mapboxgl.Marker().setLngLat([m.lng, m.lat]).addTo(map);
    });

    if (onClickLngLat) {
      map.on(
        "click",
        (e: mapboxgl.MapMouseEvent & mapboxgl.EventData) => {
          const { lng, lat } = e.lngLat.wrap();
          onClickLngLat(lng, lat);
        }
      );
    }

    // Ensure paint when first mounted in modal
    setTimeout(() => map.resize(), 100);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [
    center[0],
    center[1],
    zoom,
    styleUrl,
    markers.map((m) => m.id).join(","),
    !!onClickLngLat,
  ]);

  return <div ref={mapContainerRef} className={className} />;
}
