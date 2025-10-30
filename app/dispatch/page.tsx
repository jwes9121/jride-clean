"use client";
import * as React from "react";

/* ---------- TYPES ---------- */
type DispatchBooking = {
  id: string;
  town: string | null;
  status: "pending" | "assigned" | "en-route" | "arrived" | "complete" | "accepted" | string;
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
function toastSetter(setter: any, msg: { type: "ok" | "err"; text: string }) {
  setter(msg);
  setTimeout(() => setter(null), 2500);
}
function Badge({
  color = "gray",
  children,
}: {
  color?: "green" | "amber" | "blue" | "gray" | "red";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    green: "bg-green-100 text-green-800 border-green-200",
    amber: "bg-amber-100 text-amber-800 border-amber-200",
    blue: "bg-blue-100 text-blue-800 border-blue-200",
    gray: "bg-gray-100 text-gray-800 border-gray-200",
    red: "bg-red-100 text-red-800 border-red-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs ${map[color]}`}>
      {children}
    </span>
  );
}

/* ---------- TOWN EDITOR ---------- */
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
      <button className="px-2 py-1 border rounded" onClick={save} disabled={!town || busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </span>
  );
}

/* ---------- DRIVER SELECT ---------- */
function DriverSelect({
  town,
  disabled,
  onPick,
}: {
  town: string;
  disabled?: boolean;
  onPick: (driverId: string, driverLabel: string) => void;
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

  const selectedLabel =
    selected && drivers.find((d) => d.driver_id === selected)
      ? (drivers.find((d) => d.driver_id === selected)!.name ?? selected.slice(0, 8))
      : "";

  return (
    <span className="inline-flex gap-2 items-center">
      <select
        className="border rounded px-2 py-1"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        disabled={disabled}
      >
        <option value="">{disabled ? "assigned" : "select driver"}</option>
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
        onClick={() => selected && onPick(selected, selectedLabel)}
        disabled={!selected || disabled}
      >
        Assign
      </button>
    </span>
  );
}

/* ---------- PAGE ---------- */
export default function DispatchPage() {
  const [rows, setRows] = React.useState<DispatchBooking[]>([]);
  const [toast, setToast] = React.useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/dispatch/bookings", { cache: "no-store" });
    const data = await safeJson(res);
    if (res.ok && Array.isArray(data.rows)) setRows(data.rows);
  }

  React.useEffect(() => {
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  function setTownLocal(bookingId: string, town: string) {
    setRows((prev) => prev.map((b) => (b.id === bookingId ? { ...b, town } : b)));
  }

  async function assignDriver(bookingId: string, driverId: string, driverLabel: string) {
    setBusyId(bookingId);
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
      toastSetter(setToast, { type: "ok", text: `Assigned ✓ (${driverLabel || driverId.slice(0, 8)})` });
    } catch (e: any) {
      toastSetter(setToast, { type: "err", text: e?.message || "Failed to assign" });
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(bookingId: string, next: DispatchBooking["status"]) {
    setBusyId(bookingId);
    try {
      const res = await fetch("/api/dispatch/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, status: next }),
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      setRows((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status: next } : b)));
      toastSetter(setToast, { type: "ok", text: `Status → ${next}` });
    } catch (e: any) {
      toastSetter(setToast, { type: "err", text: e?.message || "Update failed" });
    } finally {
      setBusyId(null);
    }
  }

  function StatusBadge({ s }: { s: DispatchBooking["status"] }) {
    if (s === "assigned") return <Badge color="green">assigned ✓</Badge>;
    if (s === "en-route") return <Badge color="blue">en-route</Badge>;
    if (s === "arrived") return <Badge color="blue">arrived</Badge>;
    if (s === "complete") return <Badge color="green">complete ✓</Badge>;
    if (s === "pending") return <Badge color="amber">pending</Badge>;
    return <Badge color="gray">{s}</Badge>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dispatch Panel</h1>

      {toast && (
        <div
          className={`px-3 py-2 rounded border text-sm ${
            toast.type === "ok"
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-red-50 border-red-200 text-red-800"
          }`}
        >
          {toast.text}
        </div>
      )}

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
            {rows.map((b) => {
              const assigned = b.status === "assigned" || !!b.driver_id;
              const canEnroute = assigned && b.status !== "en-route" && b.status !== "arrived" && b.status !== "complete";
              const canArrived = (b.status === "en-route" || b.status === "assigned") && b.status !== "arrived" && b.status !== "complete";
              const canComplete = b.status !== "complete" && (b.status === "arrived" || b.status === "en-route" || b.status === "assigned");

              return (
                <tr key={b.id} className="border-b">
                  <td className="py-2">{b.id.slice(0, 8)}</td>
                  <td className="py-2">
                    {b.town ? (
                      b.town
                    ) : (
                      <TownEditor bookingId={b.id} value={b.town} onSaved={(t) => setTownLocal(b.id, t)} />
                    )}
                  </td>
                  <td className="py-2">
                    <StatusBadge s={b.status} />
                  </td>
                  <td className="py-2">{b.driver_id ? b.driver_id.slice(0, 8) : "-"}</td>
                  <td className="py-2">
                    {b.town ? (
                      <div className="flex items-center gap-2">
                        <DriverSelect
                          town={b.town}
                          disabled={assigned || busyId === b.id}
                          onPick={(driverId, label) => assignDriver(b.id, driverId, label)}
                        />
                        <button
                          className="px-3 py-1 border rounded disabled:opacity-50"
                          disabled={!canEnroute || busyId === b.id}
                          onClick={() => setStatus(b.id, "en-route")}
                          title="Mark as en-route"
                        >
                          En-route
                        </button>
                        <button
                          className="px-3 py-1 border rounded disabled:opacity-50"
                          disabled={!canArrived || busyId === b.id}
                          onClick={() => setStatus(b.id, "arrived")}
                          title="Mark as arrived"
                        >
                          Arrived
                        </button>
                        <button
                          className="px-3 py-1 border rounded disabled:opacity-50"
                          disabled={!canComplete || busyId === b.id}
                          onClick={() => setStatus(b.id, "complete")}
                          title="Mark as complete"
                        >
                          Complete
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs text-gray-500">Set town to enable assignment</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
