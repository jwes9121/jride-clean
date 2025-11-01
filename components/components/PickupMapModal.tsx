"use client";

import React from "react";
import MapboxMap from "./MapboxMap";

type LatLng = { lat: number; lng: number };

type Props = {
  isOpen: boolean;
  initial?: LatLng;
  onClose: () => void;
  onSave: (pos: LatLng | null) => Promise<void> | void;
};

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean; msg?: string }> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, msg: error?.message || String(error) };
  }
  componentDidCatch(error: any, info: any) {
    console.error("[PickupMapModal] crashed:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-red-700 bg-red-50 rounded">
          Map component crashed: {this.state.msg ?? "unknown error"}
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PickupMapModal({ isOpen, initial, onClose, onSave }: Props) {
  const [picked, setPicked] = React.useState<LatLng | null>(initial ?? null);
  React.useEffect(() => setPicked(initial ?? null), [initial]);

  if (!isOpen) return null;
  const center = picked ?? initial ?? { lat: 16.8042, lng: 121.1157 }; // Ifugao approx.

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
      <div className="w-[92vw] max-w-3xl bg-white rounded-xl shadow-xl">
        <div className="flex items-center justify-between p-3 border-b">
          <div className="font-medium">Set Pickup Location</div>
          <button onClick={onClose} className="px-2 py-1 rounded hover:bg-gray-100">Close</button>
        </div>

        <div className="p-3">
          <ErrorBoundary>
            <MapboxMap
              center={center}
              zoom={14}
              markers={picked ? [{ ...picked, color: "#16a34a" }] : []}
              onClickLatLng={(pos) => setPicked(pos)}
              height={420}
            />
          </ErrorBoundary>
          <div className="mt-2 text-xs text-gray-500">
            {picked ? `Lat ${picked.lat.toFixed(6)} Lng ${picked.lng.toFixed(6)}` : "Click on map to choose a point"}
          </div>
        </div>

        <div className="p-3 flex items-center justify-end gap-2 border-t">
          <button onClick={onClose} className="px-3 py-1.5 rounded bg-gray-100 hover:bg-gray-200">Cancel</button>
          <button
            onClick={() => onSave(picked)}
            className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700"
          >
            Save pickup
          </button>
        </div>
      </div>
    </div>
  );
}
