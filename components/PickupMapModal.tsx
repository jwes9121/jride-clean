"use client";

import "mapbox-gl/dist/mapbox-gl.css";
import React, { useEffect, useRef, useState } from "react";

type LatLng = { lat: number; lng: number };

type Props = {
  open: boolean;
  initial?: LatLng;               // optional starting pin
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
};

export default function PickupMapModal({ open, initial, onClose, onSave }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);

  const [coords, setCoords] = useState<LatLng | null>(initial ?? null);

  // keep local coords in sync when modal opens or initial changes
  useEffect(() => {
    if (open) setCoords(initial ?? null);
  }, [open, initial]);

  // create/teardown the map when modal opens/closes
  useEffect(() => {
    if (!open) return;

    let disposed = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "";

      const start = coords ?? { lat: 16.8, lng: 121.12 };
      const mountEl = containerRef.current;
      if (!mountEl) return;

      const map = new mapboxgl.Map({
        container: mountEl,
        style: "mapbox://styles/mapbox/streets-v11",
        center: [start.lng, start.lat],
        zoom: 13,
      });
      mapRef.current = map;

      const marker = new mapboxgl.Marker({ draggable: true })
        .setLngLat([start.lng, start.lat])
        .addTo(map);
      markerRef.current = marker;

      const sync = () => {
        const ll = marker.getLngLat();
        setCoords({ lat: ll.lat, lng: ll.lng });
      };

      marker.on("dragend", sync);
      map.on("click", (e: any) => {
        marker.setLngLat(e.lngLat);
        sync();
      });

      map.on("remove", () => {
        marker.off("dragend", sync);
      });
    })();

    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, [open]); // open only — we move marker by clicks/drag, not by props

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60">
      <div className="w-[min(96vw,1000px)] bg-white rounded-md shadow">
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="font-semibold">Pick a location</h3>
          <button
            onClick={onClose}
            className="px-2 py-1 text-sm rounded bg-gray-100 hover:bg-gray-200"
          >
            Close
          </button>
        </div>

        <div ref={containerRef} className="h-[70vh] w-full" />

        <div className="flex items-center justify-between gap-3 p-3 border-t text-sm">
          <div>
            Lat: {coords?.lat?.toFixed(6) ?? "—"} &nbsp; Lng:{" "}
            {coords?.lng?.toFixed(6) ?? "—"}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-2 rounded bg-gray-200 hover:bg-gray-300"
            >
              Cancel
            </button>
            <button
              disabled={!coords}
              onClick={() => coords && onSave(coords.lat, coords.lng)}
              className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-50"
            >
              Use this location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
