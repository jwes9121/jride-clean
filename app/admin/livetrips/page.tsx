"use client";
import { useEffect, useState } from "react";

type Ride = {
  id: string;
  pickup_lat: number;
  pickup_lng: number;
  town: string;
  status: string;
  driver_id: string | null;
};

async function fetchRides(): Promise<Ride[]> {
  const res = await fetch("/api/rides/list", { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || json.status !== "ok") throw new Error(json.body || json.message || "Load failed");
  return json.data as Ride[];
}

export default function Page() {
  const [loading, setLoading] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setError(null);
      const data = await fetchRides();
      setRides(data || []);
    } catch (e: any) {
      setError(e.message || "Failed to load rides");
    }
  };

  useEffect(() => { load(); }, []);

  async function handleAssignNearest(ride: Ride) {
    setLoading(true);
    try {
      const res = await fetch("/api/rides/assign-nearest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ride_id: ride.id,
          pickup_lat: ride.pickup_lat,
          pickup_lng: ride.pickup_lng,
          town: ride.town,
        }),
      });
      const result = await res.json();
      if (result.status === "ok") { alert(`Driver assigned: ${result.driver_id}`); await load(); }
      else if (result.status === "no_driver") { alert("No available driver nearby."); }
      else { alert(`Error: ${result.message || result.status}`); }
    } finally { setLoading(false); }
  }

  return (
    <div style={{ padding: 20 }}>
      <h1 style={{ fontWeight: 700, fontSize: 22 }}>Admin / Live Trips</h1>
      <button onClick={load} disabled={loading} style={{ margin: "12px 0" }}>Refresh</button>
      {error && <div style={{ color: "red" }}>{error}</div>}
      <table cellPadding={8} style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th>Ride ID</th><th>Town</th><th>Pickup</th><th>Status</th><th>Driver</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rides.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid #ddd" }}>
              <td>{r.id}</td>
              <td>{r.town}</td>
              <td>{r.pickup_lat?.toFixed(5)}, {r.pickup_lng?.toFixed(5)}</td>
              <td>{r.status}</td>
              <td>{r.driver_id || "-"}</td>
              <td>
                <button disabled={loading || r.status === "assigned"} onClick={() => handleAssignNearest(r)}>
                  Assign Nearest
                </button>
              </td>
            </tr>
          ))}
          {rides.length === 0 && <tr><td colSpan={6}>No rides found.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
