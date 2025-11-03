"use client";

import React, { useEffect, useState } from "react";
import PickupMapModal from "@/components/PickupMapModal";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseAnon);

type Ride = {
  id: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  status: string | null;
  created_at: string | null;
};

export default function DispatchPage() {
  const [mapOpen, setMapOpen] = useState(false);
  const [pickup, setPickup] = useState<{ lat?: number; lng?: number }>({});
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const hasCoords = typeof pickup.lat === "number" && typeof pickup.lng === "number";

  async function loadRides() {
    setLoading(true);
    const { data } = await supabase
      .from("rides")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setRides((data as Ride[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    loadRides();
  }, []);

  const handleOpenMap = () => setMapOpen(true);
  const handleCloseMap = () => setMapOpen(false);
  const handleSaveFromMap = (lat: number, lng: number) => {
    setPickup({ lat, lng });
    setMapOpen(false);
  };

  async function saveNewRide() {
    if (!hasCoords) return;
    setSaving(true);
    const { error } = await supabase.from("rides").insert({
      pickup_lat: pickup.lat!,
      pickup_lng: pickup.lng!,
      status: "queued",
    });
    setSaving(false);
    if (error) {
      alert("Save failed: " + error.message);
      return;
    }
    // reload list and clear fields
    await loadRides();
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dispatch</h1>

      {/* Pick-up + buttons */}
      <div className="rounded-xl border p-4 space-y-3">
        <div className="text-sm text-gray-700">Pickup coordinates</div>
        <div className="flex flex-wrap items-center gap-3">
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

          <button
            onClick={saveNewRide}
            disabled={!hasCoords || saving}
            className="rounded-md px-4 py-2 text-sm font-medium bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save new ride"}
          </button>
        </div>
        <div className="text-xs text-gray-500">
          Tip: click <b>Pick on map</b>, drag the pin, then press <b>Use this location</b>.
        </div>
      </div>

      {/* Recent rides */}
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
                <li key={r.id} className="text-sm flex justify-between items-center border rounded-md p-2">
                  <div className="flex flex-col">
                    <span className="font-mono text-xs">{r.id}</span>
                    <span className="text-gray-500 text-xs">
                      {r.pickup_lat?.toFixed(6)}, {r.pickup_lng?.toFixed(6)}
                    </span>
                  </div>
                  <span className="text-gray-700">{r.status ?? "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Map Modal */}
      <PickupMapModal
        open={mapOpen}
        initial={pickup.lat && pickup.lng ? { lat: pickup.lat, lng: pickup.lng } : undefined}
        onClose={handleCloseMap}
        onSave={handleSaveFromMap}
      />
    </div>
  );
}
