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

export default function LiveDriverMap({ initial = [] as Driver[] }) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>(initial);

  // --- Load from API (polling fallback) ---
  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch("/api/driver_locations", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          setDrivers(data);
        }
      } catch (e) {
        console.error("polling failed", e);
      }
    }
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  // --- Initialize map ---
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.106, 16.808],
      zoom: 13,
    });
    mapRef.current = map;
  }, []);

  // --- Draw markers ---
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    drivers.forEach((d) => {
      if (!d.lat || !d.lng) return;

      // Reuse marker if exists
      let marker = markersRef.current.get(d.driver_id);
      if (!marker) {
        const el = document.createElement("div");
        el.className = "rounded-full bg-green-500 border-2 border-white";
        el.style.width = "14px";
        el.style.height = "14px";
        el.title = `${d.driver_id}\nSpeed: ${d.speed ?? "?"} km/h`;

        marker = new mapboxgl.Marker({ element: el })
          .setLngLat([d.lng, d.lat])
          .addTo(map);
        markersRef.current.set(d.driver_id, marker);
      } else {
        marker.setLngLat([d.lng, d.lat]);
      }
    });
  }, [drivers]);

  return (
    <div className="relative w-full h-[calc(100vh-140px)] rounded-xl overflow-hidden">
      <div ref={mapContainer} className="absolute inset-0" />
      <div className="absolute top-2 left-2 bg-white/80 px-3 py-2 rounded-lg text-sm shadow">
        <p className="font-semibold">Online Drivers: {drivers.length}</p>
      </div>
    </div>
  );
}
