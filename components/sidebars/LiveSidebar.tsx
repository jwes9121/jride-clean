"use client";
import { useEffect, useState } from "react";
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

type Ride = {
  id: string;
  status: string;
  pickup_lat: number;
  pickup_lng: number;
  town?: string | null;
  rider_name?: string | null;
  created_at?: string;
  driver_id?: string | null;
};

export default function LiveSidebar() {
  const supabase = createClientComponentClient();
  const [rides, setRides] = useState<Ride[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filterTown, setFilterTown] = useState<string>("");

  async function loadRides() {
    const { data, error } = await supabase
      .from("rides")
      .select("id,status,pickup_lat,pickup_lng,town,rider_name,created_at,driver_id")
      .order("created_at", { ascending: false })
      .limit(50);

    if (!error && data) setRides(data as any);
  }

  useEffect(() => {
    loadRides();
    const ch = supabase
      .channel("rides_sidebar")
      .on("postgres_changes", { event: "*", schema: "public", table: "rides" }, () => loadRides())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  async function assignNearest(r: Ride) {
    if (!r.pickup_lat || !r.pickup_lng) return;
    setBusyId(r.id);
    try {
      const res = await fetch("/api/rides/assign-nearest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rideId: r.id,
          pickup: { lat: r.pickup_lat, lng: r.pickup_lng },
          town: r.town || filterTown || "Lagawe",
          maxAgeMinutes: 10,
        }),
      });
      const json = await res.json();
      if (json?.status === "assigned") {
        await loadRides();
      } else {
        alert(json?.message || json?.error || "No driver found.");
      }
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
        <button
          className="rounded-xl border px-3 py-2"
          onClick={loadRides}
          title="Refresh"
        >
          Refresh
        </button>
      </div>

      <div className="space-y-2 max-h-[calc(100vh-160px)] overflow-auto pr-1">
        {shown.map((r) => (
          <div key={r.id} className="rounded-2xl border p-3 hover:shadow-sm">
            <div className="text-sm opacity-70">{new Date(r.created_at || "").toLocaleString()}</div>
            <div className="font-semibold">
              {r.rider_name || "Rider"} — <span className="uppercase">{r.status}</span>
            </div>
            <div className="text-sm">
              {r.town ? `Town: ${r.town}` : "Town: (none)"}
              {r.driver_id ? ` • Driver: ${r.driver_id}` : ""}
            </div>
            <div className="mt-2 flex gap-2">
              <button
                disabled={!!r.driver_id || busyId === r.id}
                onClick={() => assignNearest(r)}
                className={`px-3 py-2 rounded-xl text-sm border ${busyId===r.id ? "opacity-60" : ""}`}
                title={r.driver_id ? "Already assigned" : "Assign nearest driver in same town"}
              >
                {busyId === r.id ? "Assigning…" : (r.driver_id ? "Assigned" : "Assign Nearest")}
              </button>
            </div>
          </div>
        ))}
        {shown.length === 0 && <div className="opacity-60 text-sm">No rides found.</div>}
      </div>
    </div>
  );
}
