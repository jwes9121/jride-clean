"use client";
import * as React from "react";

/* ---------- TYPES ---------- */
type DispatchBooking = {
  id: string;
  town: string | null;
  status: string;
  driver_id: string | null;
};

type NearbyDriver = {
  driver_id: string;
  name: string | null;
  town: string | null;
  lat: number | null;
  lng: number | null;
  updated_at: string;
};

/* ---------- HELPERS ---------- */
async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `Non-JSON response (${res.status})`);
  }
}

/* ---------- INLINE TOWN EDITOR (per row) ---------- */
function TownEditor({
  bookingId,
  value,
  onSaved,
}: {
  bookingId: string;
  value: string | null;
  onSaved: (newTown: string) => void;
}) {
  const [town, setTown] = React.useState(value ?? "");
  const [busy, setBusy] = React.useState(false);
  const disabled = !town || busy;

  async function save() {
    setBusy(true);
    try {
      const res = await fetch("/api/dispatch/bookings/update-town", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, town }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to save town");
      onSaved(town);
    } catch (e: any) {
      alert(e?.message || "Failed to save town");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex gap-2 items-center">
      <input
        className="border rounded px-2 py-1 w-36"
        placeholder="Set town"
        value={town}
        onChange={(e) => setTown(e.target.value)}
      />
      <button
        className="px-2 py-1 border rounded"
        onClick={save}
        disabled={disabled}
        title={disabled ? "Enter town" : "Save town"}
      >
        Save
      </button>
    </span>
  );
}

/* ---------- DRIVER SELECT (per row) ---------- */
function DriverSelect({
  town,
  onPick,
}: {
  town: string;
  onPick: (driverId: string) => void;
}) {
  const [drivers, setDrivers] = React.useState<NearbyDriver[]>([]);
  const [selected, setSelected] = React.useState("");

  React.useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await fetch(
          `/api/dispatch/nearby-drivers?town=${encodeURIComponent(town)}`,
          { cache: "no-store" }
        );
        const data = await safeJson(res);
        if (res.ok && Array.isArray(data.rows) && active) setDrivers(data.rows);
      } catch (err) {
        console.error("Driver load failed", err);
      }
    }
    if (town) load();
    return () => {
      active = false;
    };
  }, [town]);

  return (
    <span className="inline-flex gap-2 items-center">
      <select
        className="border rounded px-2 py-1"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">select driver</option>
        {drivers.length > 0 ? (
          drivers.map((d) => (
            <option key={d.driver_id} value={d.driver_id}>
              {d.name ? d.name : d.driver_id.slice(0, 8)} — {d.town}
            </option>
          ))
        ) : (
          <option disabled>No drivers</option>
        )}
      </select>
      <button
        className="px-3 py-1 border rounded"
        onClick={() => selected && onPick(selected)}
        disabled={!selected}
      >
        Assign
      </button>
    </span>
  );
}

/* ---------- PAGE ---------- */
export default function DispatchPage() {
  const [rows, setRows] = React.useState<DispatchBooking[]>([]);
  const [error, setError] = React.useState("");

  async function load() {
    const res = await fetch("/api/dispatch/bookings", { cache: "no-store" });
    const data = await safeJson(res);
    if (res.ok && Array.isArray(data.rows)) setRows(data.rows);
  }

  React.useEffect(() => {
    load();
  }, []);

  async function assignDriver(bookingId: string, driverId: string) {
    setError("");
    try {
      const res = await fetch("/api/dispatch/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, driver_id: driverId }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to assign");
      setRows((prev) =>
        prev.map((b) =>
          b.id === bookingId ? { ...b, driver_id: driverId, status: "assigned" } : b
        )
      );
    } catch (err: any) {
      setError(err.message);
    }
  }

  function saveTownLocally(bookingId: string, newTown: string) {
    setRows((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, town: newTown } : b))
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dispatch Panel</h1>

      {error && <p className="text-red-600">{error}</p>}

      <div className="rounded border p-4 shadow">
        <h2 className="font-semibold mb-2">Queue</h2>
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
            {rows.map((b) => (
              <tr key={b.id} className="border-b">
                <td className="py-2">{b.id.slice(0, 8)}</td>
                <td className="py-2">
                  {b.town ? (
                    b.town
                  ) : (
                    <TownEditor
                      bookingId={b.id}
                      value={b.town}
                      onSaved={(newTown) => saveTownLocally(b.id, newTown)}
                    />
                  )}
                </td>
                <td className="py-2">{b.status}</td>
                <td className="py-2">
                  {b.driver_id ? b.driver_id.slice(0, 8) : "-"}
                </td>
                <td className="py-2">
                  {b.town ? (
                    <DriverSelect
                      town={b.town}
                      onPick={(driverId) => assignDriver(b.id, driverId)}
                    />
                  ) : (
                    <span className="text-xs text-gray-500">
                      Set town to enable assignment
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
