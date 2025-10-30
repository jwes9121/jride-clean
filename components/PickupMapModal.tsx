"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
  initial?: { lat: number; lng: number } | null;
};

export default function PickupMapModal({ open, onClose, onSave, initial }: Props) {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(initial ?? null);

  useEffect(() => {
    if (!open) return;

    const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      console.warn("NEXT_PUBLIC_MAPBOX_TOKEN is not set");
      return;
    }
    mapboxgl.accessToken = token;

    const start =
      initial ??
      // Ifugao rough center fallback
      { lat: 16.803, lng: 121.104 };

    const map = new mapboxgl.Map({
      container: mapDiv.current as HTMLDivElement,
      style: "mapbox://styles/mapbox/streets-v12",
      center: [start.lng, start.lat],
      zoom: 14,
    });
    mapRef.current = map;

    const mk = new mapboxgl.Marker({ draggable: true })
      .setLngLat([start.lng, start.lat])
      .addTo(map);
    markerRef.current = mk;

    setCoords({ lat: start.lat, lng: start.lng });

    mk.on("dragend", () => {
      const ll = mk.getLngLat();
      setCoords({ lat: ll.lat, lng: ll.lng });
    });

    map.on("click", (e) => {
      mk.setLngLat(e.lngLat);
      setCoords({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    });

    return () => {
      mk.remove();
      map.remove();
      markerRef.current = null;
      mapRef.current = null;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white w-[90vw] max-w-[900px] rounded-xl overflow-hidden shadow-lg">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="font-semibold">Set Pickup Location</div>
          <button className="text-sm underline" onClick={onClose}>Close</button>
        </div>
        <div className="h-[60vh]" ref={mapDiv} />
        <div className="px-4 py-3 border-t flex items-center justify-between">
          <div className="text-xs opacity-70">
            {coords ? `Lat: ${coords.lat.toFixed(6)}  Lng: ${coords.lng.toFixed(6)}` : "Click map to set point"}
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 border rounded" onClick={onClose}>Cancel</button>
            <button
              className={"px-3 py-1 rounded text-white " + (coords ? "bg-black" : "bg-gray-400")}
              disabled={!coords}
              onClick={() => coords && onSave(coords.lat, coords.lng)}
            >
              Save pickup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
