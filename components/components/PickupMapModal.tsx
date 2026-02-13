'use client';

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

// Mapbox CSP worker (NO workerClass). Works with mapbox-gl v2 on Next.js
try {
  (mapboxgl as any).workerUrl = new URL(
    "mapbox-gl/dist/mapbox-gl-csp-worker.js",
    import.meta.url
  ).toString();
} catch {
  // SSR/older bundlers: silently ignore
}

// Token must be set via NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

type Props = {
  initialLat?: number;
  initialLng?: number;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
};

export default function PickupMapModal({
  initialLat = 16.8165,
  initialLng = 121.1005,
  onClose,
  onSave,
}: Props) {
  const mapDiv = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);

  const [lat, setLat] = useState(initialLat);
  const [lng, setLng] = useState(initialLng);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!mapDiv.current || mapRef.current) return;

    try {
      const map = new mapboxgl.Map({
        container: mapDiv.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [initialLng, initialLat],
        zoom: 14,
        attributionControl: true,
        cooperativeGestures: true,
      });
      mapRef.current = map;

      map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

      const marker = new mapboxgl.Marker({ draggable: true })
        .setLngLat([initialLng, initialLat])
        .addTo(map);
      markerRef.current = marker;

      const onDragEnd = () => {
        const p = marker.getLngLat();
        setLng(p.lng);
        setLat(p.lat);
      };
      marker.on("dragend", onDragEnd);

      const onClick = (e: mapboxgl.MapMouseEvent) => {
        const p = e.lngLat;
        marker.setLngLat(p);
        setLng(p.lng);
        setLat(p.lat);
      };
      map.on("click", onClick);

      return () => {
        map.off("click", onClick);
        marker.remove();
        map.remove();
        markerRef.current = null;
        mapRef.current = null;
      };
    } catch (e: any) {
      setErr(e?.message ?? "Map init error");
    }
  }, [initialLat, initialLng]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[96vw] max-w-[980px] rounded-lg bg-white shadow-lg">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-lg font-semibold">Set Pickup Location</h2>
          <button className="rounded px-2 py-1 text-sm hover:bg-gray-100" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="p-3">
          {err ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-red-600">
              Map failed to load: {err}
            </div>
          ) : (
            <div ref={mapDiv} style={{ width: "100%", height: "60vh", borderRadius: 8, overflow: "hidden" }} />
          )}
          <div className="mt-3 text-sm text-gray-600">
            Lat <span className="font-mono">{lat.toFixed(6)}</span>{" "}
            Lng <span className="font-mono">{lng.toFixed(6)}</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <button className="rounded px-3 py-2 text-sm hover:bg-gray-100" onClick={onClose}>
            Cancel
          </button>
          <button
            className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => onSave(lat, lng)}
          >
            Save pickup
          </button>
        </div>
      </div>
    </div>
  );
}