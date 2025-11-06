"use client";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

type Ride = {
  id: string; status: string; pickup_lat: number; pickup_lng: number;
  town?: string|null; driver_id?: string|null; created_at?: string|null;
};

export default function DriverDashboard() {
  const sb = supabaseBrowser;

  // Put your test driver UUID here (from drivers table)
  const [driverId, setDriverId] = useState<string>("7d45e50c-3d76-4aa6-ac22-abb4538859ca");

  const [assigned, setAssigned] = useState<Ride | null>(null);
  const [watchId, setWatchId] = useState<number | null>(null);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    if (!driverId) return;

    async function loadAssigned() {
      const { data } = await sb
        .from("rides")
        .select("*")
        .eq("driver_id", driverId)
        .in("status", ["assigned","in_progress"])
        .order("created_at", { ascending: false })
        .limit(1);
      setAssigned(data?.[0] || null);
    }
    loadAssigned();

    const ch = sb.channel("driver_rides_" + driverId)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "rides", filter: `driver_id=eq.${driverId}` },
        (p) => {
          const r = p.new as Ride;
          if (["assigned","in_progress"].includes(r.status)) setAssigned(r);
          if (r.status === "completed" && assigned && r.id === assigned.id) setAssigned(null);
        })
      .subscribe();

    return () => { sb.removeChannel(ch); };
  }, [driverId, sb]); // keep simple

  async function startSharing() {
    if (!driverId) return alert("Set driver UUID first.");
    const id = navigator.geolocation.watchPosition(
      async (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lng = Number(pos.coords.longitude.toFixed(6));
        await fetch("/api/driver/heartbeat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ driver_id: driverId, lat, lng, is_available: available }),
        });
      },
      (err) => alert(err.message),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
    setWatchId(id);
  }
  function stopSharing() {
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    setWatchId(null);
  }

  async function setStatus(status: "in_progress"|"completed") {
    if (!assigned) return;
    const res = await fetch("/api/rides/status", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rideId: assigned.id, status }),
    });
    const js = await res.json();
    if (!res.ok) return alert(js?.error || "Failed");
    alert(`Ride ${status.replace("_"," ").toUpperCase()}`);
  }

  return (
    <div className="p-6 max-w-xl space-y-4">
      <h1 className="text-xl font-semibold">JRide • Driver</h1>

      <div className="space-y-2 border rounded-2xl p-3">
        <label className="text-sm">Driver UUID</label>
        <input className="border rounded px-3 py-2 w-full" value={driverId}
               onChange={(e)=>setDriverId(e.target.value)} />
        <div className="flex items-center gap-3">
          <button className="border rounded px-3 py-2" onClick={startSharing} disabled={watchId !== null}>Start shift</button>
          <button className="border rounded px-3 py-2" onClick={stopSharing} disabled={watchId === null}>Stop shift</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={available} onChange={(e)=>setAvailable(e.target.checked)} />
            Available
          </label>
        </div>
        <div className="text-xs opacity-60">Sends GPS → `/api/driver/heartbeat` → live on map.</div>
      </div>

      <div className="space-y-2 border rounded-2xl p-3">
        <div className="font-medium">Current Ride</div>
        {assigned ? (
          <div className="text-sm space-y-2">
            <div>ID: {assigned.id}</div>
            <div>Status: <b>{assigned.status}</b></div>
            <div>Pickup: {assigned.pickup_lat?.toFixed(5)}, {assigned.pickup_lng?.toFixed(5)}</div>
            <div className="flex gap-2">
              <button className="border rounded px-3 py-2" onClick={() => setStatus("in_progress")}
                      disabled={assigned.status !== "assigned"}>Start</button>
              <button className="border rounded px-3 py-2" onClick={() => setStatus("completed")}
                      disabled={assigned.status !== "in_progress"}>Complete</button>
            </div>
          </div>
        ) : (
          <div className="text-sm opacity-70">No assigned ride.</div>
        )}
      </div>
    </div>
  );
}
