"use client";

import { useEffect, useState } from "react";

type Ride = {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  town?: string | null;
  created_at?: string | null;
  driver_id?: string | null;
  vehicle_type?: string | null;
};

export default function LiveSidebar() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filterTown, setFilterTown] = useState<string>("");
  const [err, setErr] = useState<string>("");

  async function loadRides() {
    setErr("");
    try {
      const res = await fetch("/api/rides/list", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || res.statusText);
      setRides(json.rows || []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load rides");
      setRides([]);
    }
  }

  useEffect(() => {
    void loadRides();
    const t = setInterval(loadRides, 5000);
    return () => clearInterval(t);
  }, []);

  async function assignNearest(r: Ride) {
    if (!r.pickup_lat || !r.pickup_lng) {
      alert("Ride has no pickup coordinates.");
      return;
    }
    setBusyId(r.id);
    try {
      const res = await fetch("/api/rides/assign-nearest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideId: r.id,
          town: r.town || filterTown || "Lagawe",
          maxAgeMinutes: 15,
        }),
      });
      const json = await res.json();

      // Always tell you what happened
      if (json.status === "assigned" && json.driver_id) {
        alert(`✅ Assigned\nDriver: ${json.driver_id}\n~${json.distance_meters ? Math.round(json.distance_meters) + " m" : ""}`);
      } else if (json.status === "no-driver") {
        alert(`⚠️ ${json.message || "No available driver"}`);
      } else if (json.status === "error") {
        alert(`❌ ${json.message || "Error assigning"}`);
      } else {
        alert(`ℹ️ ${json.message || "No change"}`);
      }

      await loadRides();
    } catch (e: any) {
      alert(e?.message ?? "Failed to assign");
    } finally {
      setBusyId(null);
    }
  }

  const shown = filterTown
    ? rides.filter(r => (r.town || "").toLowerCase() === filterTown.toLowerCase())
    : rides;

  return (
    <div className="w-full h-full p-3 space-y-3">
      <div className="flex items-center gap-2">
        <input
          placeholder="Filter by town (e.g., Lagawe)"
          className="w-full rounded-xl border px-3 py-2"
          value={filterTown}
          onChange={(e) => setFilterTown(e.target.value)}
        />
        <button className="rounded-xl border px-3 py-2" onClick={loadRides}>
          Refresh
        </button>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="space-y-2 max-h-[calc(100vh-160px)] overflow-auto pr-1">
        {shown.map((r) => (
          <div key={r.id} className="rounded-2xl border p-3 hover:shadow-sm">
            <div className="text-sm opacity-70">
              {r.created_at ? new Date(r.created_at).toLocaleString() : "—"}
            </div>
            <div className="font-semibold">
              Ride • <span className="uppercase">{r.status}</span>
            </div>
            <div className="text-sm">
              {(r.town ? `Town: ${r.town}` : "Town: (none)")} • {(r.vehicle_type || "—")}
              {r.driver_id ? ` • Driver: ${r.driver_id}` : ""}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                disabled={!!r.driver_id || busyId === r.id}
                onClick={() => assignNearest(r)}
                className={`px-3 py-2 rounded-xl text-sm border ${busyId === r.id ? "opacity-60" : ""}`}
                title={r.driver_id ? "Already assigned" : "Assign nearest driver in same town"}
              >
                {busyId === r.id ? "Assigning…" : r.driver_id ? "Assigned" : "Assign Nearest"}
              </button>
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="opacity-60 text-sm">No rides found.</div>}
      </div>
    </div>
  );
}
