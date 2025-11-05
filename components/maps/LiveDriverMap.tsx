"use client";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser"; // browser client (anon) for realtime

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

type Driver = {
  driver_id: string;
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  updated_at?: string | null;
  name?: string | null;
  town?: string | null;
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
  if (s <= 60) return "#22c55e";
  if (s <= 300) return "#eab308";
  return "#9ca3af";
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
  const didFitRef = useRef(false);

  const [drivers, setDrivers] = useState<Record<string, Driver>>(() =>
    Object.fromEntries(initial.map((d) => [d.driver_id, d]))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [hideStale, setHideStale] = useState(true);

  // Poll (safety net)
  useEffect(() => {
    const poll = async () => {
      try {
        const r = await fetch("/api/driver_locations", { cache: "no-store" });
        if (r.ok) {
          const arr: Driver[] = await r.json();
          setDrivers(Object.fromEntries(arr.map((d) => [d.driver_id, d])));
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 60000);
    return () => clearInterval(id);
  }, []);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel("driver_locations_realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as any).driver_id as string;
            markersRef.current.get(id)?.remove();
            markersRef.current.delete(id);
            setDrivers((prev) => {
              const c = { ...prev };
              delete c[id];
              return c;
            });
            return;
          }
          const row = (payload.new || payload.old) as Driver;
          setDrivers((prev) => ({ ...prev, [row.driver_id]: row }));
        }
      )
      .subscribe();

    // IMPORTANT: cleanup must NOT return a Promise
    return () => { supabase.removeChannel(channel); };
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

  // Visible list (apply stale filter)
  const visibleList = useMemo(() => {
    const items = Object.values(drivers);
    const filtered = hideStale
      ? items.filter((d) => secsSince(d.updated_at) <= 600)
      : items;
    return filtered.sort(
      (a, b) => (Date.parse(b.updated_at || "0") - Date.parse(a.updated_at || "0"))
    );
  }, [drivers, hideStale]);

  // Upsert markers, follow, auto-fit once
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    visibleList.forEach((d) => {
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
                 <strong>${(d.name || d.driver_id).toString().slice(0, 16)}</strong><br/>
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

      const mm = markersRef.current.get(d.driver_id);
      if (mm && typeof d.heading === "number") {
        mm.setRotation(d.heading);
      }

      if (follow && selectedId === d.driver_id) {
        map.easeTo({
          center: [d.lng, d.lat],
          duration: 450,
          zoom: Math.max(map.getZoom(), 14),
        });
      }
    });

    if (!didFitRef.current && visibleList.length > 0) {
      const b = new mapboxgl.LngLatBounds();
      visibleList.forEach((x) => b.extend([x.lng, x.lat]));
      map.fitBounds(b, { padding: 40, maxZoom: 15 });
      didFitRef.current = true;
    }
  }, [visibleList, follow, selectedId]);

  function fitToDrivers() {
    const map = mapRef.current;
    if (!map || visibleList.length === 0) return;
    const b = new mapboxgl.LngLatBounds();
    visibleList.forEach((d) => b.extend([d.lng, d.lat]));
    map.fitBounds(b, { padding: 40, maxZoom: 15 });
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-2 mb-2">
        <button onClick={fitToDrivers} className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm">Fit to drivers</button>
        <label className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm cursor-pointer flex items-center gap-2">
          <input type="checkbox" className="accent-blue-600" checked={follow} onChange={(e)=>setFollow(e.target.checked)} />
          Follow mode
        </label>
        <button onClick={()=>setSelectedId(null)} className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm">Clear selection</button>
        <label className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm cursor-pointer flex items-center gap-2">
          <input type="checkbox" className="accent-blue-600" checked={hideStale} onChange={(e)=>setHideStale(e.target.checked)} />
          Hide stale &gt; 10m
        </label>
        <span className="px-3 py-1 bg-white/90 rounded-xl shadow text-sm">Online Drivers: {visibleList.length}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div
          ref={containerRef}
          className="w-full rounded-xl overflow-hidden"
          style={{ height: "70vh", minHeight: 420 }}
        />
        <div className="bg-white/90 rounded-xl shadow p-3 h-[70vh] overflow-auto">
          <div className="text-sm font-semibold mb-2">Online Drivers</div>
          {visibleList.length === 0 ? (
            <div className="text-sm text-gray-500">No drivers yet.</div>
          ) : (
            <ul className="space-y-2">
              {visibleList.map((d) => {
                const color = freshnessColor(d.updated_at);
                const isSel = selectedId === d.driver_id;
                return (
                  <li key={d.driver_id}>
                    <button
                      onClick={() => {
                        setSelectedId(d.driver_id);
                        setFollow(true);
                        const map = mapRef.current;
                        if (map) map.easeTo({ center: [d.lng, d.lat], duration: 400, zoom: Math.max(map.getZoom(), 14) });
                      }}
                      className={`w-full flex items-center gap-3 px-2 py-2 rounded-lg text-left hover:bg-gray-50 ${isSel ? "ring-2 ring-blue-400" : ""}`}
                    >
                      <span className="inline-block w-3 h-3 rounded-full border" style={{ background: color }} />
                      <div className="flex-1">
                        <div className="text-sm font-medium leading-5">{(d.name || d.driver_id).toString().slice(0, 18)}</div>
                        <div className="text-xs text-gray-600 leading-4">
                          {d.speed != null ? `${d.speed} km/h` : "—"} · {timeAgo(d.updated_at)}
                        </div>
                      </div>
                      <div className="text-[10px] text-gray-500">{d.lat.toFixed(3)}, {d.lng.toFixed(3)}</div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
