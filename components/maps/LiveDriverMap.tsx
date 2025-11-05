"use client";
import mapboxgl, { Map, Marker, LngLatLike } from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase-browser";
import type { LiveDriver } from "@/types/driver";
import LiveDriverSidebar from "@/components/panels/LiveDriverSidebar";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!;

type Props = {
  initial?: LiveDriver[];
  center?: LngLatLike;
  zoom?: number;
};

function colorFromId(id: string) {
  // Stable pastel from id: hash to HSL
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 70% 45%)`;
}

export default function LiveDriverMap({
  initial = [],
  center = [121.1015, 16.8042],
  zoom = 12,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());

  const [drivers, setDrivers] = useState<Record<string, LiveDriver>>(() =>
    Object.fromEntries(initial.map((d) => [d.driver_id, d]))
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState<boolean>(true); // default ON

  const selected = selectedId ? drivers[selectedId] : null;

  const bounds = useMemo(() => {
    const b = new mapboxgl.LngLatBounds();
    Object.values(drivers).forEach((d) => b.extend([d.lng, d.lat]));
    return b;
  }, [drivers]);

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom,
    });
    mapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }));
    map.on("load", () => {
      Object.values(drivers).forEach(upsertMarker);
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("driver_locations")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "driver_locations" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const id = (payload.old as any).driver_id as string;
            removeMarker(id);
            setDrivers((prev) => {
              const copy = { ...prev };
              delete copy[id];
              return copy;
            });
            return;
          }
          const row = (payload.new || payload.old) as LiveDriver;
          setDrivers((prev) => ({ ...prev, [row.driver_id]: row }));
          upsertMarker(row);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const removeMarker = useCallback((id: string) => {
    const m = markersRef.current.get(id);
    if (m) {
      m.remove();
      markersRef.current.delete(id);
    }
  }, []);

  const upsertMarker = useCallback((d: LiveDriver) => {
    const map = mapRef.current;
    if (!map) return;

    let marker = markersRef.current.get(d.driver_id);
    const color = colorFromId(d.driver_id);

    if (!marker) {
      const el = document.createElement("div");
      el.className = "rounded-full shadow-md";
      el.style.width = "14px";
      el.style.height = "14px";
      el.style.background = color;
      el.style.border = "2px solid white";

      // click -> select + follow
      el.addEventListener("click", () => {
        setSelectedId((prev) => (prev === d.driver_id ? null : d.driver_id));
        setFollow(true);
      });

      marker = new mapboxgl.Marker({ element: el, rotationAlignment: "map" })
        .setLngLat([d.lng, d.lat])
        .setPopup(
          new mapboxgl.Popup({ closeButton: false, offset: 12 }).setHTML(
            `<div style="font-size:12px;line-height:1.2">
               <strong>${(d.name?.trim() || d.driver_id).slice(0, 12)}</strong><br/>
               ${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}<br/>
               ${d.speed ? d.speed.toFixed(1) + " km/h" : ""}
             </div>`
          )
        )
        .addTo(map);
      markersRef.current.set(d.driver_id, marker);
    } else {
      marker.setLngLat([d.lng, d.lat]);
      // update color each time in case palette rule changes
      const el = marker.getElement() as HTMLDivElement;
      el.style.background = color;
    }

    if (typeof d.heading === "number") marker.setRotation(d.heading);

    // If following this driver, keep camera on them
    if (follow && selectedId === d.driver_id) {
      map.easeTo({ center: [d.lng, d.lat], duration: 400, zoom: Math.max(map.getZoom(), 14) });
    }
  }, [follow, selectedId]);

  // When selected driver changes, nudge camera
  useEffect(() => {
    if (!selected) return;
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: [selected.lng, selected.lat], duration: 400, zoom: Math.max(map.getZoom(), 14) });
  }, [selected?.driver_id]);

  return (
    <div className="w-full h-full relative">
      <div className="grid gap-4 md:grid-cols-[1fr_360px] xl:grid-cols-[1fr_420px]">
        <div className="relative">
          <div ref={containerRef} className="w-full h-[70vh] rounded-2xl overflow-hidden" />
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => {
                const map = mapRef.current;
                if (!map) return;
                if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 40, maxZoom: 15 });
              }}
              className="px-3 py-1 bg-white/90 rounded-xl shadow hover:bg-white text-sm"
            >
              Fit to drivers
            </button>
            <label className="flex items-center gap-2 px-3 py-1 bg-white/90 rounded-xl shadow text-sm cursor-pointer">
              <input
                type="checkbox"
                className="accent-blue-600"
                checked={follow}
                onChange={(e) => setFollow(e.target.checked)}
              />
              Follow mode
            </label>
            <button
              onClick={() => setSelectedId(null)}
              className="px-3 py-1 bg-white/90 rounded-xl shadow hover:bg-white text-sm"
            >
              Clear selection
            </button>
          </div>
        </div>

        <LiveDriverSidebar
          drivers={drivers}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            if (id) setFollow(true);
          }}
        />
      </div>
    </div>
  );
}
