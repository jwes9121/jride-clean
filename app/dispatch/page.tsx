"use client";

import * as React from "react";

/** ---- Types ---- */
type Booking = {
  id: string;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_lat: number;
  pickup_lng: number;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  town: string;
  distance_km: number | null;
  fare: number | null;
  status: "requested" | "assigned" | "enroute" | "arrived" | "completed" | "canceled";
  driver_id: string | null;
  created_at: string;
  updated_at: string;
};

type NearbyDriver = {
  driver_id: string;
  name: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
};

/** ---- Small helper to show clear errors ---- */
async function safeJson(res: Response): Promise<any> {
  try { return await res.json(); }
  catch {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || ("Non-JSON response (status " + res.status + ")"));
  }
}

/** ---- Driver dropdown component ---- */
function DriverSelect(props: { town: string; onPick: (driver_id: string) => void }) {
  const [list, setList] = React.useState<NearbyDriver[]>([]);
  const [value, setValue] = React.useState<string>("");

  React.useEffect(function () {
    let active = true;
    async function load() {
      try {
        const res = await fetch(
          "/api/dispatch/nearby-drivers?town=" + encodeURIComponent(props.town),
          { cache: "no-store" }
        );
        const data = await safeJson(res);
        if (!res.ok) throw new Error((data && data.error) || "load failed");
        if (active) {
          const rows: NearbyDriver[] = Array.isArray(data.rows) ? data.rows : [];
          setList(rows);
        }
      } catch {
        // silent; the parent page shows errors for main actions
      }
    }
    load();
    return function () { active = false; };
  }, [props.town]);

  return (
    <span className="inline-flex gap-2 items-center">
      <select
        className="border rounded px-2 py-1"
        value={value}
        onChange={function (e) { setValue(e.target.value); }}
      >
        <option value="">select driver</option>
        {list.map(function (d) {
          const label = (d.name ? d.name + " · " : "") + d.driver_id.slice(0, 8);
          return (
            <option key={d.driver_id} value={d.driver_id}>
              {label}
            </option>
          );
        })}
      </select>
      <button
        className="px-3 py-1 border rounded"
        onClick={function () { if (value) props.onPick(value); }}
        disabled={!value}
      >
        Assign
      </button>
    </span>
  );
}

/** ---- Page ---- */
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

  async function load(): Promise<void> {
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/dispatch/bookings", { cache: "no-store" });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data && data.error) || "Failed to load");
      setRows(Array.isArray(data.rows) ? data.rows : []);
    } catch (e: any) {
      setError(e && e.message ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  async function createBooking(): Promise<void> {
    setError(null);
    try {
      const payload = {
        rider_name: riderName,
        rider_phone: riderPhone,
        town,
        pickup_lat: Number(pickupLat),
        pickup_lng: Number(pickupLng)
      };
      const res = await fetch("/api/dispatch/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data && data.error) || "Failed to create");
      setRows(function (prev) { return [data.row, ...prev]; });
      setRiderName(""); setRiderPhone(""); setTown(""); setPickupLat(""); setPickupLng("");
    } catch (e: any) {
      setError(e && e.message ? e.message : "Failed to create");
    }
  }

  async function assign(booking_id: string, driverId: string): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id, driver_id: driverId })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data && data.error) || "Assign failed");
      setRows(function (prev) {
        return prev.map(function (b) { return b.id === booking_id ? data.row : b; });
      });
    } catch (e: any) {
      setError(e && e.message ? e.message : "Assign failed");
    }
  }

  async function setStatus(booking_id: string, status: string): Promise<void> {
    setError(null);
    try {
      const res = await fetch("/api/dispatch/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id, status })
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error((data && data.error) || "Update failed");
      setRows(function (prev) {
        return prev.map(function (b) { return b.id === booking_id ? data.row : b; });
      });
    } catch (e: any) {
      setError(e && e.message ? e.message : "Update failed");
    }
  }

  React.useEffect(function () { load(); }, []);

  return (
    <div className="p-6 space-y-8">
      <h1 className="text-2xl font-semibold">Dispatch Panel</h1>

      {/* New Booking */}
      <div className="rounded-2xl border p-4 shadow space-y-3">
        <h2 className="font-medium">New Booking</h2>
        <div className="grid md:grid-cols-5 gap-3">
          <input className="border rounded px-3 py-2" placeholder="Rider name"
                 value={riderName} onChange={function (e) { setRiderName(e.target.value); }} />
          <input className="border rounded px-3 py-2" placeholder="Rider phone"
                 value={riderPhone} onChange={function (e) { setRiderPhone(e.target.value); }} />
          <input className="border rounded px-3 py-2" placeholder="Town"
                 value={town} onChange={function (e) { setTown(e.target.value); }} />
          <input className="border rounded px-3 py-2" placeholder="Pickup lat"
                 value={pickupLat} onChange={function (e) { setPickupLat(e.target.value); }} />
          <input className="border rounded px-3 py-2" placeholder="Pickup lng"
                 value={pickupLng} onChange={function (e) { setPickupLng(e.target.value); }} />
        </div>
        <button onClick={createBooking} className="px-4 py-2 rounded-xl border shadow">Create</button>
        {error ? <p className="text-red-600 mt-2">{error}</p> : null}
      </div>

      {/* Queue */}
      <div className="rounded-2xl border p-4 shadow">
        <h2 className="font-medium mb-3">Queue</h2>
        {loading ? (
          <p>Loading…</p>
        ) : rows.length === 0 ? (
          <p>No active rides.</p>
        ) : (
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
              {rows.map(function (b) {
                return (
                  <tr key={b.id} className="border-b">
                    <td className="py-2">{b.id.slice(0, 8)}</td>
                    <td className="py-2">{b.town}</td>
                    <td className="py-2">{b.status}</td>
                    <td className="py-2">{b.driver_id ? b.driver_id : "-"}</td>
                    <td className="py-2 space-x-2">
                      <DriverSelect town={b.town} onPick={function (driverId) { assign(b.id, driverId); }} />
                      <button onClick={function () { setStatus(b.id, "enroute"); }} className="px-3 py-1 border rounded">En-route</button>
                      <button onClick={function () { setStatus(b.id, "arrived"); }} className="px-3 py-1 border rounded">Arrived</button>
                      <button onClick={function () { setStatus(b.id, "completed"); }} className="px-3 py-1 border rounded">Complete</button>
                      <button onClick={function () { setStatus(b.id, "canceled"); }} className="px-3 py-1 border rounded">Cancel</button>
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
