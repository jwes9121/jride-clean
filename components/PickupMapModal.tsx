import "mapbox-gl/dist/mapbox-gl.css";
"use client";

import React, { useEffect, useRef, useState } from "react";

// IMPORTANT: dynamic import to avoid SSR issues with mapbox-gl
// We also lazy-load the CSS in effect to avoid Next SSR complaints.
type LatLng = { lat: number; lng: number };

type Props = {
  open: boolean;
  initial?: LatLng;              // optional starting pin
  onSave: (lat: number, lng: number) => void;
  onClose: () => void;
};

export default function PickupMapModal({ open, initial, onSave, onClose }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const markerRef = useRef<any>(null);
  const mapRef = useRef<any>(null);
  const [pending, setPending] = useState<boolean>(false);
  const [coord, setCoord] = useState<LatLng | null>(initial ?? null);

  useEffect(() => {
    if (!open) return;

    let cleanup = () => {};
    (async () => {
      setPending(true);
      // Lazy load mapbox & css only when modal opens
      const mapboxgl = (await import("mapbox-gl")).default;

      // Token from NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN
      const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
      if (!token) {
        console.warn("NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN not set");
      }
      mapboxgl.accessToken = token || "";

      if (!containerRef.current) return;

      const start = initial ?? { lat: 16.8, lng: 121.1 }; // Ifugao-ish fallback
      const map = new mapboxgl.Map({
        container: containerRef.current,
        style: "mapbox://styles/mapbox/streets-v12",
        center: [start.lng, start.lat],
        zoom: 13,
      });
      mapRef.current = map;

      // Add zoom controls
      map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "top-right");

      // Drop marker
      const marker = new mapboxgl.Marker({ draggable: true })
        .setLngLat([start.lng, start.lat])
        .addTo(map);
      markerRef.current = marker;

      const updateFromMarker = () => {
        const ll = marker.getLngLat();
        setCoord({ lat: ll.lat, lng: ll.lng });
      };
      marker.on("dragend", updateFromMarker);

      // click to move marker
      map.on("click", (e: any) => {
        const { lng, lat } = e.lngLat;
        marker.setLngLat([lng, lat]);
        setCoord({ lat, lng });
      });

      setCoord(start);
      setPending(false);

      cleanup = () => {
        try { marker.remove(); } catch {}
        try { map.remove(); } catch {}
        markerRef.current = null;
        mapRef.current = null;
      };
    })();

    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      {/* Panel */}
      <div className="relative z-[1001] w-[90vw] max-w-[900px] rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">Pick a location</h2>
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200"
          >
            Close
          </button>
        </div>

        <div className="h-[65vh]">
          <div ref={containerRef} className="h-full w-full" />
        </div>

        <div className="flex items-center justify-between p-4 border-t">
          <div className="text-sm text-gray-600">
            {coord ? (
              <>Lat: <b>{coord.lat.toFixed(6)}</b> &nbsp; Lng: <b>{coord.lng.toFixed(6)}</b></>
            ) : (
              <>Click on the map to drop a pin</>
            )}
          </div>
          <button
            disabled={pending || !coord}
            onClick={() => coord && onSave(coord.lat, coord.lng)}
            className="rounded-md px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Use this location
          </button>
        </div>
      </div>
    </div>
  );
}

