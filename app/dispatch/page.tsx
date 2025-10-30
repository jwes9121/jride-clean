// app/dispatch/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Driver = {
  id: string;
  name: string | null;
  town: string | null;
};

type Booking = {
  id: string;
  rider_name: string | null;
  pickup_town: string | null;
  status: string;
  assigned_driver_id: string | null;
  created_at: string;
};

type Toast = { id: string; title: string; description?: string };

function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  function push(t: Omit<Toast, "id">) {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, ...t }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 3000);
  }
  return { toasts, push };
}

export default function DispatchPage() {
  const [loading, setLoading] = useState(true);
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selectedDriverByBooking, setSelectedDriverByBooking] = useState<
    Record<string, string>
  >({});
  const { toasts, push } = useToast();

  // Load initial data (NOTE: select() with NO "*" to fix TS error)
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [d1, d2] = await Promise.all([
        supabase.from("drivers").select(), // no arguments
        supabase
          .from("bookings")
          .select()
          .order("created_at", { ascending: false }),
      ]);

      if (!d1.error && d1.data) setDrivers(d1.data as Driver[]);
      if (!d2.error && d2.data) setBookings(d2.data as Booking[]);
      setLoading(false);
    })();
  }, []);

  // Realtime: keep the list fresh when bookings update
  useEffect(() => {
    const channel = supabase
      .channel("bookings-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        (payload) => {
          setBookings((prev) => {
            const row = payload.new as Booking;
            const idx = prev.findIndex((b) => b.id === row.id);
            if (idx === -1) return [row, ...prev];
            const copy = [...prev];
            copy[idx] = row;
            return copy;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function handleAssign(bookingId: string) {
    const driverId = selectedDriverByBooking[bookingId];
    if (!driverId) {
      push({ title: "Pick a driver first" });
      return;
    }
    setAssigningId(bookingId);
    try {
      const { data, error } = await supabase.rpc("assign_driver", {
        p_booking_id: bookingId,
        p_driver_id: driverId,
      });
      if (error) throw error;

      // Optimistic UI already handled by realtime, but ensure local update:
      if (data) {
        setBookings((prev) =>
          prev.map((b) =>
            b.id === bookingId
              ? {
                  ...b,
                  assigned_driver_id: driverId,
                  status: "assigned",
                }
              : b
          )
        );
      }

      push({ title: "Assigned ✅", description: "Driver has the booking." });
    } catch (e: any) {
      push({
        title: "Assign failed",
        description: e?.message ?? "Unknown error",
      });
    } finally {
      setAssigningId(null);
    }
  }

  const driversByTown = useMemo(() => {
    const map: Record<string, Driver[]> = {};
    for (const d of drivers) {
      const key = (d.town ?? "—").toLowerCase();
      map[key] ??= [];
      map[key].push(d);
    }
    return map;
  }, [drivers]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Dispatch</h1>

      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <div className="space-y-4">
          {bookings.length === 0 ? (
            <div className="text-sm opacity-70">No bookings yet.</div>
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
                  const townKey = (b.pickup_town ?? "—").toLowerCase();
                  const pool = driversByTown[townKey] ?? drivers;
                  const selected = selectedDriverByBooking[b.id] ?? "";
                  const assigned =
                    drivers.find((d) => d.id === b.assigned_driver_id)?.name ??
                    (b.assigned_driver_id ? "Unknown" : "");

                  return (
                    <tr key={b.id} className="border-b">
                      <td className="py-2">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td>{b.rider_name ?? "—"}</td>
                      <td>{b.pickup_town ?? "—"}</td>
                      <td>
                        <span
                          className={
                            "px-2 py-1 rounded text-xs " +
                            (b.status === "assigned"
                              ? "bg-green-100"
                              : "bg-gray-100")
                          }
                        >
                          {b.status}
                        </span>
                        {assigned && (
                          <span className="ml-2 opacity-70">
                            → {assigned}
                          </span>
                        )}
                      </td>
                      <td className="flex items-center gap-2 py-2">
                        <select
                          className="border rounded px-2 py-1"
                          value={selected}
                          onChange={(e) =>
                            setSelectedDriverByBooking((prev) => ({
                              ...prev,
                              [b.id]: e.target.value,
                            }))
                          }
                        >
                          <option value="">
                            {pool === drivers
                              ? "Pick driver (any town)"
                              : `Pick driver (${b.pickup_town})`}
                          </option>
                          {pool.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name ?? d.id} {d.town ? `• ${d.town}` : ""}
                            </option>
                          ))}
                        </select>

                        <button
                          onClick={() => handleAssign(b.id)}
                          disabled={assigningId === b.id || !selected}
                          className={
                            "px-3 py-1 rounded text-sm text-white " +
                            (assigningId === b.id || !selected
                              ? "bg-gray-400"
                              : "bg-black")
                          }
                          title={
                            !selected
                              ? "Select a driver first"
                              : "Assign booking"
                          }
                        >
                          {assigningId === b.id ? "Assigning…" : "Assign"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="bg-black text-white rounded px-3 py-2 shadow"
          >
            <div className="font-semibold">{t.title}</div>
            {t.description && (
              <div className="text-xs opacity-80">{t.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
