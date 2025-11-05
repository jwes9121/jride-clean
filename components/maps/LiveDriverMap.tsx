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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  const [drivers, setDrivers] = useState<Driver[]>(initial);

  // Poll API so markers always render even without realtime
  useEffect(() => {
    let id: any;
    const poll = async () => {
      try {
        const r = await fetch("/api/driver_locations", { cache: "no-store" });
        if (r.ok) setDrivers(await r.json());
      } catch {}
    };
    poll();
    id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  // Initialize the map (ensure the container has height)
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.106, 16.808], // Lagawe
      zoom: 13,
    });
    mapRef.current = map;
  }, []);

  // Draw/update markers and fit to bounds
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Upsert markers
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

    // Fit to all drivers when we have at least one
    if (drivers.length > 0) {
      const b = new mapboxgl.LngLatBounds();
      drivers.forEach((d) => b.extend([d.lng, d.lat]));
      // guard: only fit when bounds are valid
      if ((b as any)._ne && (b as any)._sw) {
        map.fitBounds(b, { padding: 40, maxZoom: 15 });
      }
    }
  }, [drivers]);

  return (
    <div className="p-0">
      <div className="mb-2 inline-block bg-white/85 px-3 py-1 rounded-lg text-sm shadow">
        <span className="font-semibold">Online Drivers: {drivers.length}</span>
      </div>
      {/* Height guards so the map is always visible */}
      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden"
        style={{ height: "70vh", minHeight: 420 }}
      />
    </div>
  );
}
