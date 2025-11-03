"use client";

import { useState, useCallback } from "react";
import PickupMapModal, { type LatLng } from "@/components/PickupMapModal";

export default function DispatchPage() {
  const [showPickupModal, setShowPickupModal] = useState(false);
  const [pickup, setPickup] = useState<LatLng | null>(null);

  const openPickup  = useCallback(() => setShowPickupModal(true), []);
  const closePickup = useCallback(() => setShowPickupModal(false), []);
  const handleSavePickup = useCallback((lat:number, lng:number) => {
    setPickup({ lat, lng });
    setShowPickupModal(false);
  }, []);

  return (
    <>
      <div className="p-4 space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Dispatch</h1>
          <nav className="text-sm underline text-blue-700 flex gap-3">
            <a href="/admin/livetrips">Live Trips</a>
            <a href="/dispatch">Dispatch</a>
          </nav>
        </header>

        <div className="flex items-center gap-3">
          <button onClick={openPickup} className="rounded-lg border px-3 py-2 hover:bg-gray-50">
            Select Pickup on Map
          </button>
          {pickup && (
            <span className="text-sm text-gray-600">
              Pickup: {pickup.lat.toFixed(5)}, {pickup.lng.toFixed(5)}
            </span>
          )}
        </div>
      </div>

      {showPickupModal && (
        <PickupMapModal
          initial={pickup ?? undefined}
          onClose={closePickup}
          onSave={handleSavePickup}
        />
      )}
    </>
  );
}