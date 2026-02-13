"use client";

import React, { useEffect, useMemo, useState } from "react";
import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

// Accept any props so callers don't break on extra attributes
type Props = Record<string, any>;

type DriverRow = {
  driver_id: string;
  name?: string | null;
  phone?: string | null;
  status?: string | null;
  lat?: number | null;
  lng?: number | null;
  updated_at?: string | null;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ""
);

export default function DispatcherControlPanel(_props: Props) {
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // One effect: load initial data + subscribe to realtime
  useEffect(() => {
    let ch: RealtimeChannel | null = null;
    let isMounted = true;

    const run = async () => {
      try {
        // initial load
        const { data, error } = await supabase
          .from("driver_profiles")
          .select(
            "driver_id,name,phone,status,lat,lng,updated_at"
          );

        if (!error && Array.isArray(data) && isMounted) {
          // coerce to our shape
          setDrivers(
            data.map((d: any) => ({
              driver_id: String(d.driver_id ?? ""),
              name: d.name ?? null,
              phone: d.phone ?? null,
              status: d.status ?? null,
              lat: d.lat ?? null,
              lng: d.lng ?? null,
              updated_at: d.updated_at ?? null,
            }))
          );
        }

        // subscribe
        ch = supabase
          .channel("driver_profiles_changes")
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "driver_profiles" },
            (payload: any) => {
              if (!isMounted) return;
              const row: any = payload.new ?? payload.old ?? {};
              const id = String(row.driver_id ?? "");
              setDrivers((prev) => {
                const idx = prev.findIndex((p) => p.driver_id === id);
                const merged: DriverRow = {
                  driver_id: id,
                  name: row.name ?? prev[idx]?.name ?? null,
                  phone: row.phone ?? prev[idx]?.phone ?? null,
                  status: row.status ?? prev[idx]?.status ?? null,
                  lat: row.lat ?? prev[idx]?.lat ?? null,
                  lng: row.lng ?? prev[idx]?.lng ?? null,
                  updated_at: row.updated_at ?? prev[idx]?.updated_at ?? null,
                };
                if (idx === -1) return [merged, ...prev];
                const copy = prev.slice();
                copy[idx] = merged;
                return copy;
              });
            }
          )
          .subscribe((status) => {
            // optional: handle "SUBSCRIBED" etc
          });
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    void run(); // fire-and-forget; effect body stays sync

    // --- CRITICAL: cleanup must be sync (no async/await, no returned Promise)
    return () => {
      isMounted = false;
      try {
        if (ch) {
          // Prefer removeChannel if available (Supabase v2)
          // Fallback to unsubscribe() without awaiting
          if ("unsubscribe" in ch && typeof ch.unsubscribe === "function") {
            void ch.unsubscribe();
          }
          // If your client exposes removeChannel, it is sync to call:
          // @ts-ignore " not all clients expose it on the same object
          if (typeof (supabase as any).removeChannel === "function") {
            // @ts-ignore
            (supabase as any).removeChannel(ch);
          }
        }
      } catch {
        // best effort cleanup
      }
    };
  }, []); // no async cleanup here

  const activeCount = useMemo(
    () => drivers.filter((d) => d.status === "active").length,
    [drivers]
  );

  return (
    <div className="p-4 border rounded-xl bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Dispatcher Control Panel</h2>
        <div className="text-sm text-gray-600">
          {loading ? "Loading" : `${drivers.length} drivers (${activeCount} active)`}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {drivers.slice(0, 8).map((d) => (
          <div key={d.driver_id} className="border rounded-lg p-3">
            <div className="font-medium">{d.name || `Driver ${d.driver_id}`}</div>
            <div className="text-xs text-gray-500">{d.phone || ""}</div>
            <div className="mt-1 text-sm">
              Status:{" "}
              <span className={d.status === "active" ? "text-green-600" : "text-gray-700"}>
                {d.status || "unknown"}
              </span>
            </div>
            <div className="text-xs text-gray-500">
              {d.lat != null && d.lng != null ? `(${d.lat}, ${d.lng})` : "No location"}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}



