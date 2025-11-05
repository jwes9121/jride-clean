"use client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useRef, useState } from "react";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

type Driver = {
  driver_id: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  updated_at?: string;
};

type Props = { initial?: Driver[] };

export default function LiveDriverMap({ initial = [] }: Props) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>(initial);

  // Poll API as a fallback so markers always show, even if realtime is quiet
  useEffect(() => {
    let id: any;
    const poll = async () => {
      try {
        const r = await fetch("/api/driver_locations", { cache: "no-store" });
        if (r.ok) setDrivers(await r.json());
      } catch { /* noop */ }
    };
    poll();
    id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  // Init map
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.106, 16.808], // Lagawe area
      zoom: 13,
    });
    mapRef.current = map;
  }, []);

  // Draw/update markers whenever drivers change
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    drivers.forEach((d) => {
      if (typeof d.lat !== "number" || typeof d.lng !== "number") return;

      let marker = markersRef.current.get(d.driver_id);
      if (!marker) {
        const el = document.createElement("div");
        el.className = "rounded-full border-2 border-white";
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.background = "#22c55e"; // green
        el.title = `${d.driver_id}\n${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}${
          d.speed != null ? ` • ${d.speed} km/h` : ""
        }`;

        const newMarker = new mapboxgl.Marker({ element: el })
          .setLngLat([d.lng, d.lat])
          .addTo(map);
        markersRef.current.set(d.driver_id, newMarker);
        marker = newMarker;
      } else {
        marker.setLngLat([d.lng, d.lat]);
      }
    });
  }, [drivers]);

  return (
    <div className="relative w-full h-[calc(100vh-140px)] rounded-xl overflow-hidden">
      <div ref={mapContainer} className="absolute inset-0" />
      <div className="absolute top-2 left-2 bg-white/85 px-3 py-2 rounded-lg text-sm shadow">
        <p className="font-semibold">Online Drivers: {drivers.length}</p>
      </div>
    </div>
  );
}
