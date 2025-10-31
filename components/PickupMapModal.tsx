"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from 'mapbox-gl/dist/mapbox-gl-csp';
import MapboxWorker from 'mapbox-gl/dist/mapbox-gl-csp-worker';
import 'mapbox-gl/dist/mapbox-gl.css';
mapboxgl.workerClass = MapboxWorker as unknown as typeof Worker;

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (coords: { lat: number; lng: number } | null) => void;
};

export default function PickupMapModal({ isOpen, onClose, onSave }: Props) {
  useEffect(() => {
    // lock scroll behind modal if you want
    if (isOpen) document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  return (
    <div
      className={`fixed inset-0 z-50 ${isOpen ? "" : "hidden"}`}
      aria-hidden={!isOpen}
    >
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[900px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold">Set Pickup Location</h2>
          <button onClick={onClose} className="text-sm hover:underline">Close</button>
        </div>

        <div className="p-4">
          {/* Map container MUST have an explicit height */}
          <div className="w-full h-[480px] rounded-lg overflow-hidden border">
            {isOpen && (
              <MapboxMap
                center={[121.1157, 16.8042]}
                zoom={13}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-4 py-3 border-t">
          <button onClick={onClose} className="px-3 py-1.5 rounded border">Cancel</button>
          <button
            onClick={() => onSave(null)}
            className="px-3 py-1.5 rounded bg-black text-white"
          >
            Save pickup
          </button>
        </div>
      </div>
    </div>
  );
}
