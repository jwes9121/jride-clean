"use client";

import { useState } from "react";
import MapboxMap from "@/components/MapboxMap";

export type LatLng = { lat: number; lng: number };

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (pos: LatLng | null) => void;
  initial?: LatLng | undefined;
};

export default function PickupMapModal({ isOpen, onClose, onSave, initial }: Props) {
  const [picked, setPicked] = useState<LatLng | null>(initial ?? null);

  const save = () => {
    onSave(picked);
    onClose();
  };

  return (
    <div className={`fixed inset-0 z-50 ${isOpen ? "" : "hidden"}`} aria-hidden={!isOpen}>
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[900px] max-w-[95vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-lg font-semibold">Set Pickup Location</h2>
          <button onClick={onClose} className="text-sm hover:underline">Close</button>
        </div>

        <div className="p-4">
          <div className="w-full h-[480px] rounded-lg overflow-hidden border">
            {isOpen && (
              <MapboxMap
                center={
                  picked ? [picked.lng, picked.lat] : [121.1157, 16.8042]
                }
                zoom={13}
                onClickLngLat={(lng, lat) => setPicked({ lat, lng })}
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 border-t text-sm">
          <div className="opacity-70">
            {picked ? (
              <span>Lat: {picked.lat.toFixed(6)} &nbsp;Lng: {picked.lng.toFixed(6)}</span>
            ) : (
              <span>Click on the map to pick a location</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-3 py-1.5 rounded border">Cancel</button>
            <button
              onClick={save}
              className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-50"
              disabled={!picked}
            >
              Save pickup
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
