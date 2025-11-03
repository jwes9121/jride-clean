"use client";

import React, { useEffect, useState } from "react";
import PickupMapModal from "@/components/PickupMapModal";
import { createClient } from "@supabase/supabase-js";

// ------- Supabase client (no auth needed for read) -------
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnon);

type Ride = {
  id: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  // add whatever fields you render in your UI:
  status?: string | null;
  created_at?: string | null;
};

export default function DispatchPage() {
  // --- [A] Modal + coords state (ADD THESE) ---
  const [mapOpen, setMapOpen] = useState(false);
  const [pickup, setPickup] = useState<{ lat?: number; lng?: number }>({});

  // Demo: your existing rides (optional)
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Optional: load rides list
    (async () => {
      setLoading(true);
      // columns string "*" is valid for Supabase v2
      const { data, error } = await supabase.from("rides").select("*").limit(20).order("created_at", { ascending: false });
      if (!error && data) setRides(data as Ride[]);
      setLoading(false);
    })();
  }, []);

  // --- [B] Handlers for modal save/close (ADD THESE) ---
  const handleOpenMap = () => setMapOpen(true);
  const handleCloseMap = () => setMapOpen(false);
  const handleSaveFromMap = (lat: number, lng: number) => {
    setPickup({ lat, lng });
    setMapOpen(false);
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dispatch</h1>

      {/* --- [C] Pick-up field + open modal button (ADD THIS BLOCK) --- */}
      <div className="rounded-xl border p-4 space-y-3">
        <div className="text-sm text-gray-700">Pickup coordinates</div>
        <div className="flex items-center gap-3">
          <input
            className="w-[180px] rounded-md border px-3 py-2 text-sm"
            placeholder="Latitude"
            value={pickup.lat ?? ""}
            onChange={(e) => setPickup((p) => ({ ...p, lat: Number(e.target.value) }))}
          />
          <input
            className="w-[180px] rounded-md border px-3 py-2 text-sm"
            placeholder="Longitude"
            value={pickup.lng ?? ""}
            onChange={(e) => setPickup((p) => ({ ...p, lng: Number(e.target.value) }))}
          />
          <button
            onClick={handleOpenMap}
            className="rounded-md px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
          >
            Pick on map
          </button>
        </div>
        <div className="text-xs text-gray-500">
          Tip: click <b>Pick on map</b>, drag the pin, then press <b>Use this location</b>.
        </div>
      </div>

      {/* --- Optional: your rides list (keep/remove as needed) --- */}
      <div className="rounded-xl border">
        <div className="p-3 border-b text-sm font-medium">Recent rides</div>
        <div className="p-3">
          {loading ? (
            <div className="text-sm text-gray-600">Loading…</div>
          ) : rides.length === 0 ? (
            <div className="text-sm text-gray-600">No rides found.</div>
          ) : (
            <ul className="space-y-2">
              {rides.map((r) => (
                <li key={r.id} className="text-sm flex justify-between border rounded-md p-2">
                  <span>{r.id}</span>
                  <span className="text-gray-500">{r.status ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* --- [D] The actual modal (ADD THIS) --- */}
      <PickupMapModal
        open={mapOpen}
        initial={
          pickup.lat && pickup.lng
            ? { lat: pickup.lat, lng: pickup.lng }
            : undefined
        }
        onClose={handleCloseMap}
        onSave={handleSaveFromMap}
      />
    </div>
  );
}
