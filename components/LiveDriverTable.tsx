<<<<<<< HEAD

=======
"use client";
import React, { useEffect, useState } from "react";

type Row = { driver_id: string; lat: number; lng: number; updated_at: string };

export default function LiveDriverTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch("/api/driver_locations", { cache: "no-store" });
      if (!res.ok) throw new Error("bad status " + res.status);
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("[JRide] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="p-4 space-y-4">
      <div className="text-xl font-semibold">Live Trips — Driver Locations</div>
      {loading ? (
        <div>Loading...</div>
      ) : (
        <div className="overflow-auto rounded-2xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 sticky top-0">
              <tr>
                <th className="text-left p-3">Driver ID</th>
                <th className="text-left p-3">Latitude</th>
                <th className="text-left p-3">Longitude</th>
                <th className="text-left p-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.driver_id} className="border-t">
                  <td className="p-3 font-mono">{r.driver_id}</td>
                  <td className="p-3">{r.lat}</td>
                  <td className="p-3">{r.lng}</td>
                  <td className="p-3">{new Date(r.updated_at).toLocaleString()}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="p-4 text-center" colSpan={4}>
                    No data yet…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
>>>>>>> 4773cdf (Admin Live Trips: proxy endpoint + table (polling fallback))
