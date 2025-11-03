"use client";

import React, { useEffect, useState } from "react";
import PickupMapModal from "@/components/PickupMapModal";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Ride = {
  id: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  notes: string | null;
  status: string | null;
  driver_id: string | null;
  created_at: string | null;
};

type Nearest = {
  driver_id: string;
  name: string;
  town: string;
  lat: number;
  lng: number;
  distance_km: number;
  updated_at: string;
  distance_km: number;
} | null;

export default function DispatchPageComponent() {
  // coords
  const [pickup, setPickup] = useState<{ lat?: number; lng?: number }>({});
  const [dropoff, setDropoff] = useState<{ lat?: number; lng?: number }>({});
  const hasPickup = typeof pickup.lat === "number" && typeof pickup.lng === "number";
  const hasDropoff = typeof dropoff.lat === "number" && typeof dropoff.lng === "number";

  // modal
  const [modal, setModal] = useState<"pickup" | "dropoff" | null>(null);

  // passenger
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  // nearest
  const [town, setTown] = useState("Lagawe");
  const [radiusKm, setRadiusKm] = useState(10);
  const [freshMin, setFreshMin] = useState(15);
  const [nearest, setNearest] = useState<Nearest>(null);
  const [finding, setFinding] = useState(false);

  // list
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // load recent rides
  useEffect(() => { (async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("rides").select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error) setRides((data as Ride[]) ?? []);
    setLoading(false);
  })(); }, []);

  function handleSaveFromMap(lat: number, lng: number) {
    if (modal === "pickup") setPickup({ lat, lng });
    if (modal === "dropoff") setDropoff({ lat, lng });
    setModal(null);
    setNearest(null); // reset nearest when coords change
  }

  async function findNearest() {
    if (!hasPickup) return alert("Pick pickup first.");
    setFinding(true);
    const { data, error } = await supabase.rpc("select_nearest_driver", {
      p_pickup_lat: pickup.lat!,
      p_pickup_lng: pickup.lng!,
      p_town: town,
      p_max_radius_km: radiusKm,
      p_fresh_minutes: freshMin,
    });
    setFinding(false);
    if (error) return alert("RPC error: " + error.message);
    setNearest((data?.[0] as Nearest) ?? null);
  }

  async function saveRide(assignNearest: boolean) {
    if (!hasPickup) return alert("Pickup is required.");
    setSaving(true);
    const { error } = await supabase.from("rides").insert({
      pickup_lat: pickup.lat!,
      pickup_lng: pickup.lng!,
      dropoff_lat: hasDropoff ? dropoff.lat! : null,
      dropoff_lng: hasDropoff ? dropoff.lng! : null,
      passenger_name: name || null,
      passenger_phone: phone || null,
      notes: notes || null,
      status: "pending",
      driver_id: assignNearest ? nearest?.driver_id ?? null : null,
    });
    setSaving(false);
    if (error) return alert("Save failed: " + error.message);

    // refresh
    const { data } = await supabase
      .from("rides").select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    setRides((data as Ride[]) ?? []);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Dispatch</h1>

      {/* FORM */}
      <div className="rounded-xl border p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Pickup */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Pickup</div>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                className="w-[180px] rounded-md border px-3 py-2 text-sm"
                placeholder="Lat"
                value={pickup.lat ?? ""}
                onChange={(e) => setPickup((p) => ({ ...p, lat: Number(e.target.value) }))}
              />
              <input
                className="w-[180px] rounded-md border px-3 py-2 text-sm"
                placeholder="Lng"
                value={pickup.lng ?? ""}
                onChange={(e) => setPickup((p) => ({ ...p, lng: Number(e.target.value) }))}
              />
              <button onClick={() => setModal("pickup")} className="rounded-md px-4 py-2 text-sm bg-blue-600 text-white">
                Pick on map
              </button>
            </div>
            <div className="text-xs text-gray-500">Choose pickup on the map, then “Use this location”.</div>
          </div>

          {/* Dropoff */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Drop-off (optional)</div>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                className="w-[180px] rounded-md border px-3 py-2 text-sm"
                placeholder="Lat"
                value={dropoff.lat ?? ""}
                onChange={(e) => setDropoff((p) => ({ ...p, lat: Number(e.target.value) }))}
              />
              <input
                className="w-[180px] rounded-md border px-3 py-2 text-sm"
                placeholder="Lng"
                value={dropoff.lng ?? ""}
                onChange={(e) => setDropoff((p) => ({ ...p, lng: Number(e.target.value) }))}
              />
              <button onClick={() => setModal("dropoff")} className="rounded-md px-4 py-2 text-sm bg-blue-600 text-white">
                Pick on map
              </button>
            </div>
          </div>

          {/* Passenger */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Passenger</div>
            <div className="flex flex-wrap gap-3 items-center">
              <input
                className="w-[220px] rounded-md border px-3 py-2 text-sm"
                placeholder="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className="w-[180px] rounded-md border px-3 py-2 text-sm"
                placeholder="Phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value))}
            />
          </div>

          {/* Nearest driver */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Nearest driver (same town)</div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Town</span>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  placeholder="e.g. Lagawe"
                  value={town}
                  onChange={(e) => setTown(e.target.value)}
                />
              </label>

              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Radius (km)</span>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  type="number" min={0.5} max={50} step={0.5}
                  placeholder="Search distance in km"
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                />
              </label>

              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Freshness (min)</span>
                <input
                  className="w-full rounded-md border px-3 py-2 text-sm"
                  type="number" min={1} max={120} step={1}
                  placeholder="Driver last update window"
                  value={freshMin}
                  onChange={(e) => setFreshMin(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-2">
              <button
                onClick={findNearest}
                disabled={!hasPickup || finding}
                className="rounded-md px-4 py-2 text-sm font-medium bg-indigo-600 text-white disabled:opacity-50"
              >
                {finding ? "Finding…" : "Find nearest"}
              </button>
              <span className="text-xs text-gray-500">
                Freshness = minutes since driver last location update. Radius = search distance from pickup.
              </span>
            </div>

            {nearest ? (
              <div className="mt-3 text-sm rounded-md border p-3 bg-gray-50">
                <div><b>{nearest.name}</b> ({nearest.town})</div>
                <div>Dist: {nearest.distance_km.toFixed(2)} km • Updated: {new Date(nearest.updated_at).toLocaleTimeString()}</div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-gray-500">No driver selected.</div>
            )}
          </div>
        </div>

        {/* Save actions */}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => saveRide(false)}
            disabled={!hasPickup || saving}
            className="rounded-md px-4 py-2 text-sm bg-green-600 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save new ride"}
          </button>
          <button
            onClick={() => saveRide(true)}
            disabled={!hasPickup || !nearest || saving}
            className="rounded-md px-4 py-2 text-sm bg-emerald-700 text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & assign nearest"}
          </button>
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
                      P: {r.pickup_lat?.toFixed(5)},{r.pickup_lng?.toFixed(5)} •
                      D: {r.dropoff_lat?.toFixed(5) ?? "-"}, {r.dropoff_lng?.toFixed(5) ?? "-"}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="text-gray-700">{r.status ?? "—"}</div>
                    <div className="text-xs text-gray-500">{r.driver_id ?? "unassigned"}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Map modal */}
      <PickupMapModal
        open={modal !== null}
        initial={
          modal === "pickup"
            ? (hasPickup ? { lat: pickup.lat!, lng: pickup.lng! } : undefined)
            : (hasDropoff ? { lat: dropoff.lat!, lng: dropoff.lng! } : undefined)
        }
        onClose={() => setModal(null)}
        onSave={handleSaveFromMap}
      />
    </div>
  );
}
