"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
// Your project exposes a Supabase client at "@/lib/supabaseClient"
import supabase from "@/lib/supabaseClient";

// Minimal local types so this file compiles independently
type Driver = { id: string; name?: string | null; town?: string | null; online?: boolean | null };
type Booking = { id: string; created_at?: string | null; status?: string | null };
type TownRow = { id?: string; name?: string | null };

const EnvGuard: React.FC = () => {
  const missing =
    !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (missing) {
    return (
      <div className="my-3 p-3 rounded border border-yellow-300 bg-yellow-50 text-yellow-800">
        Supabase env not set. Configure
        {" "}
        <code>NEXT_PUBLIC_SUPABASE_URL</code>
        {" "}
        and
        {" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>
        {" "}
        in Vercel (and in your local <code>.env.local</code>) so Dispatch can load data.
      </div>
    );
  }
  return null;
};

export default function Dispatch() {
  const [loading, setLoading] = useState(true);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [towns, setTowns] = useState<TownRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // If env is missing, don’t spin forever—show page chrome and stop.
      if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
        setLoading(false);
        return;
      }
      try {
        // Load drivers & bookings; towns is optional
        const d1 = await supabase.from("drivers").select("*").limit(100);
        const d2 = await supabase
          .from("bookings")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(100);
        // Optional towns table—ignore errors if it doesn’t exist
        const d3 = await supabase.from("towns").select("*").limit(200);

        if (!cancelled) {
          if (!d1.error && d1.data) setDrivers(d1.data as Driver[]);
          if (!d2.error && d2.data) setBookings(d2.data as Booking[]);
          if (d3 && !d3.error && d3.data) setTowns(d3.data as TownRow[]);
          const err = d1.error?.message || d2.error?.message || d3?.error?.message || null;
          setErrorMsg(err);
          setLoading(false);
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(String(err?.message ?? err));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dispatch</h1>
        <nav className="text-sm underline text-blue-700 flex gap-3">
          <Link href="/">Home</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/admin/livetrips">Live Trips</Link>
        </nav>
      </div>

      <EnvGuard />

      {errorMsg && (
        <div className="p-3 rounded border border-red-300 bg-red-50 text-red-800">
          {errorMsg}
        </div>
      )}

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <section className="col-span-1 rounded-lg border p-3">
            <h2 className="font-medium mb-2">Drivers ({drivers.length})</h2>
            <div className="max-h-[420px] overflow-auto text-sm">
              {drivers.length === 0 ? (
                <div className="opacity-60">No drivers.</div>
              ) : (
                <ul className="space-y-1">
                  {drivers.map((d) => (
                    <li key={d.id} className="flex items-center justify-between">
                      <span>
                        {d.name ?? d.id.slice(0, 8)}
                        {d.town ? <span className="opacity-60"> — {d.town}</span> : null}
                      </span>
                      <span
                        className={
                          "text-xs px-2 py-0.5 rounded " +
                          (d.online ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600")
                        }
                      >
                        {d.online ? "online" : "offline"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="col-span-2 rounded-lg border p-3">
            <h2 className="font-medium mb-2">Recent bookings ({bookings.length})</h2>
            <div className="max-h-[420px] overflow-auto text-sm">
              {bookings.length === 0 ? (
                <div className="opacity-60">No bookings.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="py-1 pr-2">ID</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bookings.map((b) => (
                      <tr key={b.id} className="border-b last:border-0">
                        <td className="py-1 pr-2 font-mono text-xs">{b.id}</td>
                        <td className="py-1 pr-2">{b.status ?? "-"}</td>
                        <td className="py-1 pr-2">
                          {b.created_at ? new Date(b.created_at).toLocaleString() : "-"}
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
    </div>
  );
}
