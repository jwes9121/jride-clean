"use client";

import React from "react";
import Link from "next/link";
import PickupMapModal from "@/components/PickupMapModal";
import supabase from "@/lib/supabaseClient";

type Driver = { id: string; name?: string | null; town?: string | null; online?: boolean | null };
type Booking = { id: string; created_at?: string | null; status?: string | null; pickup_lat?: number | null; pickup_lng?: number | null };
type LatLng = { lat: number; lng: number };

export default function Dispatch() {
  const [drivers, setDrivers] = React.useState<Driver[]>([]);
  const [bookings, setBookings] = React.useState<Booking[]>([]);
  const [openMapFor, setOpenMapFor] = React.useState<string | null>(null);
  const [initialPos, setInitialPos] = React.useState<LatLng | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d1 = await supabase.from("drivers").select("*").limit(100);
        const d2 = await supabase.from("bookings").select("*").order("created_at", { ascending: false }).limit(100);
        if (active) {
          if (d1.data) setDrivers(d1.data as Driver[]);
          if (d2.data) setBookings(d2.data as Booking[]);
          setErr(d1.error?.message || d2.error?.message || null);
          setLoading(false);
        }
      } catch (e: any) {
        if (active) setErr(String(e?.message ?? e));
      }
    })();
    return () => { active = false };
  }, []);

  const openPickup = (b: Booking) => {
    setOpenMapFor(b.id);
    setInitialPos(b.pickup_lat && b.pickup_lng ? { lat: b.pickup_lat, lng: b.pickup_lng } : null);
  };

  const savePickup = async (pos: LatLng | null) => {
    if (!openMapFor || !pos) return;
    const id = openMapFor;
    setOpenMapFor(null);
    const { error } = await supabase
      .from("bookings")
      .update({ pickup_lat: pos.lat, pickup_lng: pos.lng })
      .eq("id", id);
    if (error) {
      alert("Failed to save pickup: " + error.message);
    } else {
      setBookings((prev) =>
        prev.map((b) => (b.id === id ? { ...b, pickup_lat: pos.lat, pickup_lng: pos.lng } : b))
      );
    }
  };

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dispatch</h1>
        <nav className="text-sm underline text-blue-700 flex gap-3">
          <Link href="/">Home</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/admin/livetrips">Live Trips</Link>
        </nav>
      </header>

      {err && <div className="p-2 rounded border border-red-300 bg-red-50 text-red-700 text-sm">{err}</div>}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <section className="rounded-lg border p-3">
            <h2 className="font-medium mb-2">Drivers ({drivers.length})</h2>
            <div className="text-sm max-h-[420px] overflow-auto">
              {drivers.length === 0 ? (
                <div className="opacity-60">No drivers.</div>
              ) : (
                <ul className="space-y-1">
                  {drivers.map((d) => (
                    <li key={d.id} className="flex items-center justify-between">
                      <span>{d.name ?? d.id.slice(0, 8)} {d.town ? <span className="opacity-60">— {d.town}</span> : null}</span>
                      <span className={"text-xs px-2 py-0.5 rounded " + (d.online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")}>
                        {d.online ? "online" : "offline"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="lg:col-span-2 rounded-lg border p-3">
            <h2 className="font-medium mb-2">Recent bookings ({bookings.length})</h2>
            <div className="text-sm max-h-[480px] overflow-auto">
              {bookings.length === 0 ? (
                <div className="opacity-60">No bookings.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-1 pr-2">ID</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Created</th>
                      <th className="py-1 pr-2">Pickup</th>
                      <th className="py-1 pr-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-b last:border-0 align-top">
                        <td className="py-1 pr-2 font-mono text-xs">{b.id}</td>
                        <td className="py-1 pr-2">{b.status ?? "-"}</td>
                        <td className="py-1 pr-2">{b.created_at ? new Date(b.created_at).toLocaleString() : "-"}</td>
                        <td className="py-1 pr-2">
                          {b.pickup_lat && b.pickup_lng
                            ? <span className="font-mono text-xs">{b.pickup_lat.toFixed(5)}, {b.pickup_lng.toFixed(5)}</span>
                            : <span className="opacity-60">not set</span>}
                        </td>
                        <td className="py-1 pr-2">
                          <button
                            className="px-2 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                            onClick={() => openPickup(b)}
                          >
                            Set pickup on map
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      <PickupMapModal
        isOpen={openMapFor !== null}
        initial={initialPos}
        onClose={() => setOpenMapFor(null)}
        onSave={savePickup}
      />
    </div>
  );
}
