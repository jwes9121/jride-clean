"use client";
import { useState } from "react";

export type LatLng = { lat: number; lng: number };

type Props = {
  initial?: LatLng;
  onClose: () => void;
  onSave: (lat: number, lng: number) => void;
};

export default function PickupMapModal({ initial, onClose, onSave }: Props) {
  const [lat, setLat] = useState<number>(initial?.lat ?? 16.999);
  const [lng, setLng] = useState<number>(initial?.lng ?? 121.1);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-medium">Pick a location</h2>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm hover:bg-gray-100" aria-label="Close">✕</button>
        </div>
        <div className="mb-4 rounded-lg border p-3">
          <p className="mb-2 text-sm text-gray-600">(Map placeholder) Hook to Mapbox later.)</p>
          <div className="flex gap-3">
            <label className="flex-1 text-sm">Lat
              <input className="mt-1 w-full rounded-md border px-2 py-1" type="number" step="0.000001"
                     value={Number.isFinite(lat)?lat:0}
                     onChange={(e)=>{ const v=parseFloat(e.target.value); setLat(Number.isFinite(v)?v:0); }} />
            </label>
            <label className="flex-1 text-sm">Lng
              <input className="mt-1 w-full rounded-md border px-2 py-1" type="number" step="0.000001"
                     value={Number.isFinite(lng)?lng:0}
                     onChange={(e)=>{ const v=parseFloat(e.target.value); setLng(Number.isFinite(v)?v:0); }} />
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg border px-3 py-2 hover:bg-gray-50">Cancel</button>
          <button onClick={()=>onSave(lat,lng)} className="rounded-lg bg-black px-3 py-2 text-white hover:opacity-90">Save</button>
        </div>
      </div>
    </div>
  );
}