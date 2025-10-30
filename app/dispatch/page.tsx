"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Driver = { id: string; name: string | null; town: string | null };
type Booking = {
  id: string;
  rider_name: string | null;
  pickup_town: string | null;
  status: "pending" | "assigned" | "en_route" | "arrived" | "completed" | "cancelled" | string;
  assigned_driver_id: string | null;
  created_at: string;
};

type Toast = { id: string; title: string; description?: string };
function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = (t: Omit<Toast, "id">) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((p) => [...p, { id, ...t }]);
    setTimeout(() => setToasts((p) => p.filter((x) => x.id !== id)), 3000);
  };
  return { toasts, push };
}

export default function DispatchPage() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);

  const [townDraft, setTownDraft] = useState<Record<string, string>>({});
  const [savingTownId, setSavingTownId] = useState<string | null>(null);

  const [selectedDriverByBooking, setSelectedDriverByBooking] = useState<Record<string, string>>({});
  const [assigningId, setAssigningId] = useState<string | null>(null);

  const [overrideDriverByBooking, setOverrideDriverByBooking] = useState<Record<string, string>>({});

  const { toasts, push } = useToast();

  // Initial load
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [d1, d2] = await Promise.all([
        supabase.from("drivers").select(),
        supabase.from("bookings").select().order("created_at", { ascending: false }),
      ]);
      if (!d1.error && d1.data) setDrivers(d1.data as Driver[]);
      if (!d2.error && d2.data) setBookings(d2.data as Booking[]);
      setLoading(false);
    })();
  }, []);

  // Realtime
  useEffect(() => {
    const ch = supabase
      .channel("bookings-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, (payload) => {
        const row = payload.new as Booking;
        setBookings((prev) => {
          const i = prev.findIndex((b) => b.id === row.id);
          if (i === -1) return [row, ...prev];
          const copy = [...prev];
          copy[i] = row;
          return copy;
        });
      });
    ch.subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  // Busy drivers
  const busyDriverIds = useMemo(() => {
    const s = new Set<string>();
    for (const b of bookings) {
      if (b.assigned_driver_id && ["assigned", "en_route", "arrived"].includes(b.status)) {
        s.add(b.assigned_driver_id);
      }
    }
    return s;
  }, [bookings]);

  // Drivers by town
  const driversByTown = useMemo(() => {
    const m: Record<string, Driver[]> = {};
    for (const d of drivers) {
      const k = (d.town ?? "").trim().toLowerCase();
      (m[k] ??= []).push(d);
    }
    return m;
  }, [drivers]);

  // RPCs
  async function saveTown(bookingId: string) {
    const town = (townDraft[bookingId] ?? "").trim();
    setSavingTownId(bookingId);
    try {
      const { data, error } = await supabase.rpc("set_booking_town", {
        p_booking_id: bookingId,
        p_pickup_town: town,
      });
      if (error) throw error;
      if (data) {
        setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, pickup_town: data.pickup_town } : b)));
      }
      push({ title: "Town saved" });
    } catch (e: any) {
      push({ title: "Save failed", description: e?.message ?? "Unknown error" });
    } finally {
      setSavingTownId(null);
    }
  }

  async function handleAssign(bookingId: string) {
    const driverId = selectedDriverByBooking[bookingId];
    if (!driverId) return push({ title: "Pick a driver first" });
    setAssigningId(bookingId);
    try {
      const { data, error } = await supabase.rpc("assign_driver", {
        p_booking_id: bookingId,
        p_driver_id: driverId,
      });
      if (error) throw error;
      if (data) {
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "assigned", assigned_driver_id: driverId } : b))
        );
      }
      push({ title: "Assigned ✅" });
    } catch (e: any) {
      push({ title: "Assign failed", description: e?.message ?? "Unknown error" });
    } finally {
      setAssigningId(null);
    }
  }

  async function handleAssignOverride(bookingId: string) {
    const driverId = overrideDriverByBooking[bookingId];
    if (!driverId) return push({ title: "Pick a driver first (override)" });
    const reason = window.prompt("Override reason (required):")?.trim();
    if (!reason) return push({ title: "Override cancelled", description: "Reason required." });

    setAssigningId(bookingId);
    try {
      const { data, error } = await supabase.rpc("assign_driver_override", {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_reason: reason,
      });
      if (error) throw error;
      if (data) {
        setBookings((prev) =>
          prev.map((b) => (b.id === bookingId ? { ...b, status: "assigned", assigned_driver_id: driverId } : b))
        );
      }
      push({ title: "Assigned (override) ✅" });
    } catch (e: any) {
      push({ title: "Override failed", description: e?.message ?? "Unknown error" });
    } finally {
      setAssigningId(null);
    }
  }

  async function setStatus(bookingId: string, next: Booking["status"]) {
    try {
      const { data, error } = await supabase.rpc("update_booking_status", {
        p_booking_id: bookingId,
        p_next: next,
      });
      if (error) throw error;
      if (data) {
        setBookings((prev) => prev.map((b) => (b.id === bookingId ? { ...b, status: data.status } : b)));
      }
      push({ title: `Status: ${next}` });
    } catch (e: any) {
      push({ title: "Update failed", description: e?.message ?? "Unknown error" });
    }
  }

  // Helpers
  function canAssign(b: Booking) {
    return !!b.pickup_town && b.status === "pending";
  }
  function canUnassign(b: Booking) {
    return b.status === "assigned";
  }
  function canEnRoute(b: Booking) {
    return b.status === "assigned";
  }
  function canArrived(b: Booking) {
    return b.status === "en_route";
  }
  function canComplete(b: Booking) {
    return b.status === "arrived";
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dispatch</h1>

      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Created</th>
              <th>Rider</th>
              <th>Pickup Town</th>
              <th>Status</th>
              <th>Assign</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => {
              const townKey = (b.pickup_town ?? "").trim().toLowerCase();
              const sameTownDrivers = townKey ? (driversByTown[townKey] ?? []) : [];
              const hasTownDrivers = sameTownDrivers.length > 0;

              const selected = selectedDriverByBooking[b.id] ?? "";
              const overrideSelected = overrideDriverByBooking[b.id] ?? "";

              return (
                <tr key={b.id} className="border-b">
                  <td className="py-2">{new Date(b.created_at).toLocaleString()}</td>
                  <td>—{/* hook to show rider later */}</td>

                  {/* *** PICKUP TOWN INPUT + SAVE *** */}
                  <td className="py-2">
                    <div className="flex items-center gap-2">
                      <input
                        className="border rounded px-2 py-1 w-40"
                        placeholder="Set town"
                        value={townDraft[b.id] ?? b.pickup_town ?? ""}
                        onChange={(e) => setTownDraft((prev) => ({ ...prev, [b.id]: e.target.value }))}
                      />
                      <button
                        onClick={() => saveTown(b.id)}
                        disabled={savingTownId === b.id}
                        className={
                          "px-3 py-1 rounded text-sm text-white " +
                          (savingTownId === b.id ? "bg-gray-400" : "bg-black")
                        }
                      >
                        {savingTownId === b.id ? "Saving…" : "Save"}
                      </button>
                    </div>
                    {!b.pickup_town && <div className="text-xs opacity-60 mt-1">Set town to enable assignment</div>}
                  </td>

                  <td>
                    <span
                      className={
                        "px-2 py-1 rounded text-xs " +
                        (b.status === "assigned"
                          ? "bg-green-100"
                          : b.status === "en_route"
                          ? "bg-blue-100"
                          : b.status === "arrived"
                          ? "bg-yellow-100"
                          : b.status === "completed"
                          ? "bg-emerald-100"
                          : b.status === "cancelled"
                          ? "bg-red-100"
                          : "bg-gray-100")
                      }
                    >
                      {b.status}
                    </span>
                  </td>

                  {/* ASSIGN Area */}
                  <td className="py-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {/* strict same-town assign */}
                      <select
                        className="border rounded px-2 py-1"
                        value={selected}
                        onChange={(e) => setSelectedDriverByBooking((p) => ({ ...p, [b.id]: e.target.value }))}
                        disabled={!canAssign(b) || !hasTownDrivers}
                        title={
                          !b.pickup_town
                            ? "Set town first"
                            : !hasTownDrivers
                            ? `No drivers in ${b.pickup_town}`
                            : "Pick driver"
                        }
                      >
                        <option value="">
                          {b.pickup_town
                            ? hasTownDrivers
                              ? `Pick driver (${b.pickup_town})`
                              : `No drivers in ${b.pickup_town}`
                            : "Set town first"}
                        </option>
                        {sameTownDrivers.map((d) => {
                          const busy = busyDriverIds.has(d.id);
                          return (
                            <option key={d.id} value={d.id} disabled={busy} title={busy ? "Busy" : ""}>
                              {d.name ?? d.id}
                              {d.town ? ` • ${d.town}` : ""}
                              {busy ? " • busy" : ""}
                            </option>
                          );
                        })}
                      </select>

                      <button
                        onClick={() => handleAssign(b.id)}
                        disabled={!canAssign(b) || !selected || !hasTownDrivers || busyDriverIds.has(selected) || assigningId === b.id}
                        className={
                          "px-3 py-1 rounded text-sm text-white " +
                          (assigningId === b.id || !canAssign(b) || !selected || !hasTownDrivers || busyDriverIds.has(selected)
                            ? "bg-gray-400"
                            : "bg-black")
                        }
                      >
                        {assigningId === b.id ? "Assigning…" : "Assign"}
                      </button>

                      {/* quick progress buttons */}
                      <button
                        onClick={() => setStatus(b.id, "en_route")}
                        disabled={b.status !== "assigned"}
                        className={"px-3 py-1 rounded text-sm " + (b.status === "assigned" ? "bg-white border" : "bg-gray-100 text-gray-400")}
                      >
                        En-route
                      </button>
                      <button
                        onClick={() => setStatus(b.id, "arrived")}
                        disabled={b.status !== "en_route"}
                        className={"px-3 py-1 rounded text-sm " + (b.status === "en_route" ? "bg-white border" : "bg-gray-100 text-gray-400")}
                      >
                        Arrived
                      </button>
                      <button
                        onClick={() => setStatus(b.id, "completed")}
                        disabled={b.status !== "arrived"}
                        className={"px-3 py-1 rounded text-sm " + (b.status === "arrived" ? "bg-white border" : "bg-gray-100 text-gray-400")}
                      >
                        Complete
                      </button>
                    </div>

                    {/* admin override block */}
                    {b.pickup_town && b.status === "pending" && (
                      <div className="mt-2 p-2 border rounded bg-gray-50">
                        <div className="text-xs font-semibold mb-1">Admin override (any town)</div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <select
                            className="border rounded px-2 py-1"
                            value={overrideDriverByBooking[b.id] ?? ""}
                            onChange={(e) => setOverrideDriverByBooking((p) => ({ ...p, [b.id]: e.target.value }))}
                          >
                            <option value="">Pick any driver (override)</option>
                            {drivers.map((d) => {
                              const busy = busyDriverIds.has(d.id);
                              return (
                                <option key={d.id} value={d.id}>
                                  {d.name ?? d.id}
                                  {d.town ? ` • ${d.town}` : ""}
                                  {busy ? " • busy" : ""}
                                </option>
                              );
                            })}
                          </select>
                          <button
                            onClick={() => handleAssignOverride(b.id)}
                            disabled={!overrideDriverByBooking[b.id] || assigningId === b.id}
                            className={
                              "px-3 py-1 rounded text-sm text-white " +
                              (!overrideDriverByBooking[b.id] || assigningId === b.id ? "bg-gray-400" : "bg-black")
                            }
                            title="Requires reason; writes to audit"
                          >
                            {assigningId === b.id ? "Overriding…" : "Override assign"}
                          </button>
                        </div>
                        <div className="text-[11px] opacity-70 mt-1">
                          Only admins can override. Reason required; audited.
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2">
        {toasts.map((t) => (
          <div key={t.id} className="bg-black text-white rounded px-3 py-2 shadow">
            <div className="font-semibold">{t.title}</div>
            {t.description && <div className="text-xs opacity-80">{t.description}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
