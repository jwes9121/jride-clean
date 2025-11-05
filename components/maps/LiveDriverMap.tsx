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
  updated_at?: string | null;
};

type Props = { initial?: Driver[] };

function secsSince(iso?: string | null) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 1000;
}
function freshnessColor(iso?: string | null) {
  const s = secsSince(iso);
  if (s <= 60) return "#22c55e";     // green  <= 1m
  if (s <= 300) return "#eab308";    // yellow <= 5m
  return "#9ca3af";                  // gray   > 5m
}
function timeAgo(iso?: string | null) {
  const s = Math.floor(secsSince(iso));
  if (s === Infinity) return "unknown";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export default function LiveDriverMap({ initial = [] }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  const [drivers, setDrivers] = useState<Driver[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);

  // Poll API so markers keep updating even without realtime
  useEffect(() => {
    let id: ReturnType<typeof setInterval>;
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

  // Init map
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [121.106, 16.808],
      zoom: 13,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
    mapRef.current = map;
  }, []);

  // Upsert markers & optionally follow selected
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    drivers.forEach((d) => {
      if (typeof d.lat !== "number" || typeof d.lng !== "number") return;

      let marker = markersRef.current.get(d.driver_id);
      const color = freshnessColor(d.updated_at);

      if (!marker) {
        const el = document.createElement("div");
        el.className = "rounded-full border-2 border-white shadow";
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.background = color;

        el.addEventListener("click", () => {
          setSelectedId((prev) => (prev === d.driver_id ? null : d.driver_id));
          setFollow(true);
          new mapboxgl.Popup({ closeButton: true, offset: 12 })
            .setLngLat([d.lng, d.lat])
            .setHTML(
              `<div style="font-size:12px;line-height:1.2">
                 <strong>${d.driver_id.slice(0, 12)}</strong><br/>
                 ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}<br/>
                 ${d.speed != null ? d.speed + " km/h • " : ""}${timeAgo(d.updated_at)}
               </div>`
            )
            .addTo(map);
        });

        const newMarker = new mapboxgl.Marker({ element: el, rotationAlignment: "map" })
          .setLngLat([d.lng, d.lat])
          .addTo(map);

        markersRef.current.set(d.driver_id, newMarker);
        marker = newMarker;
      } else {
        marker.setLngLat([d.lng, d.lat]);
        (marker.getElement() as HTMLDivElement).style.background = color;
      }

      if (typeof d.heading === "number") marker.setRotation(d.heading);

      if (follow && selectedId === d.driver_id) {
        map.easeTo({ center: [d.lng, d.lat], duration: 450, zoom: Math.max(map.getZoom(), 14) });
      }
    });
  }, [drivers, follow, selectedId]);

  // Fit to all drivers
  function fitToDrivers() {
    const map = mapRef.current;
    if (!map || drivers.length === 0) return;
    const b = new mapboxgl.LngLatBounds();
    drivers.forEach((d) => b.extend([d.lng, d.lat]));
    map.fitBounds(b, { padding: 40, maxZoom: 15 });
  }

  return (
    <div className="relative w-full">
      <div className="flex gap-2 mb-2">
        <button onClick={fitToDrivers} className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm">Fit to drivers</button>
        <label className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm cursor-pointer flex items-center gap-2">
          <input type="checkbox" className="accent-blue-600" checked={follow} onChange={(e)=>setFollow(e.target.checked)} />
          Follow mode
        </label>
        <button onClick={()=>setSelectedId(null)} className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm">Clear selection</button>
        <span className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm">Online Drivers: {drivers.length}</span>
      </div>

      <div
        ref={containerRef}
        className="w-full rounded-xl overflow-hidden"
        style={{ height: "70vh", minHeight: 420 }}
      />
    </div>
  );
}
