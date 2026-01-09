"use client";

import * as React from "react";

type Booking = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_lat: number; pickup_lng: number;
  dropoff_lat: number | null; dropoff_lng: number | null;
  town: string;
  distance_km: number | null;
  fare: number | null;
  status: "requested"|"assigned"|"enroute"|"arrived"|"completed"|"canceled";
  driver_id: string | null;
  created_at: string; updated_at: string;
};

export default function DispatchPage(): JSX.Element {
  const [rows, setRows] = React.useState<Booking[]>([]);
  const [loading, setLoading] = React.useState<boolean>(true);
  const [error, setError] = React.useState<string | null>(null);

  // create form
  const [riderName, setRiderName] = React.useState<string>("");
  const [riderPhone, setRiderPhone] = React.useState<string>("");
  const [town, setTown] = React.useState<string>("");
  const [pickupLat, setPickupLat] = React.useState<string>("");
  const [pickupLng, setPickupLng] = React.useState<string>("");

  const [assignDriverId, setAssignDriverId] = React.useState<string>("");

  async function load() {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/dispatch/bookings", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Failed to load");
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: any) { setError(e?.message || "Failed to load"); }
    finally { setLoading(false); }
  }

  async function createBooking() {
    setError(null);
    try {
      const payload = {
        rider_name: riderName,
        rider_phone: riderPhone,
        town,
        pickup_lat: Number(pickupLat),
        pickup_lng: Number(pickupLng),
      };
      const res = await fetch("/api/dispatch/bookings", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Failed to create");
      setRows((prev) => [data.row, ...prev]);
      setRiderName(""); setRiderPhone(""); setTown(""); setPickupLat(""); setPickupLng("");
    } catch (e: any) { setError(e?.message || "Failed to create"); }
  }

  async function assign(booking_id: string) {
    if (!assignDriverId) return;
    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id, driver_id: assignDriverId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Assign failed");
      setRows((prev) => prev.map((b) => (b.id === booking_id ? data.row : b)));
      setAssignDriverId("");
    } catch (e: any) { setError(e?.message || "Assign failed"); }
  }

  async function setStatus(booking_id: string, status: string) {
    try {
      const res = await fetch("/api/dispatch/status", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id, status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data && data.error) || "Update failed");
      setRows((prev) => prev.map((b) => (b.id === booking_id ? data.row : b)));
    } catch (e: any) { setError(e?.message || "Update failed"); }
  }

  React.useEffect(function(){ load(); }, []);

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Dispatch Panel</h1>

      <div className="rounded-2xl border p-4 shadow space-y-3">
        <h2 className="font-medium">New Booking</h2>
        <div className="grid md:grid-cols-5 gap-3">
          <input className="border rounded px-3 py-2" placeholder="Rider name" value={riderName} onChange={(e)=>setRiderName(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Rider phone" value={riderPhone} onChange={(e)=>setRiderPhone(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Town" value={town} onChange={(e)=>setTown(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Pickup lat" value={pickupLat} onChange={(e)=>setPickupLat(e.target.value)} />
          <input className="border rounded px-3 py-2" placeholder="Pickup lng" value={pickupLng} onChange={(e)=>setPickupLng(e.target.value)} />
        </div>
        <button onClick={createBooking} className="px-4 py-2 rounded-xl border shadow">Create</button>
        {error ? <p className="text-red-600">{error}</p> : null}
      </div>

      <div className="rounded-2xl border p-4 shadow">
        <h2 className="font-medium mb-3">Queue</h2>
        {loading ? <p>Loading…</p> : rows.length === 0 ? <p>No active rides.</p> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2">ID</th>
                <th className="py-2">Town</th>
                <th className="py-2">Status</th>
                <th className="py-2">Driver</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(function(b){
                return (
                  <tr key={b.id} className="border-b">
                    <td className="py-2">{b.id.slice(0,8)}</td>
                    <td className="py-2">{b.town}</td>
                    <td className="py-2">{b.status}</td>
                    <td className="py-2">{b.driver_id ? b.driver_id : "-"}</td>
                    <td className="py-2 space-x-2">
                      <input className="border rounded px-2 py-1 w-44"
                        placeholder="driver_id"
                        value={assignDriverId}
                        onChange={(e)=>setAssignDriverId(e.target.value)}
                      />
                      <button onClick={()=>assign(b.id)} className="px-3 py-1 border rounded">Assign</button>
                      <button onClick={()=>setStatus(b.id,"enroute")} className="px-3 py-1 border rounded">En-route</button>
                      <button onClick={()=>setStatus(b.id,"arrived")} className="px-3 py-1 border rounded">Arrived</button>
                      <button onClick={()=>setStatus(b.id,"completed")} className="px-3 py-1 border rounded">Complete</button>
                      <button onClick={()=>setStatus(b.id,"canceled")} className="px-3 py-1 border rounded">Cancel</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
