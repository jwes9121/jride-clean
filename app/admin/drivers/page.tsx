'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState } from "react";
import supabase from "@/lib/supabaseClient";

type Driver = { id: string; name: string | null; town: string | null; online: boolean };

export default function DriversAdminPage() {
  const [rows, setRows] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.from("drivers").select();
    if (error) setErr(error.message);
    setRows((data ?? []) as Driver[]);
    setLoading(false);
  }
  useEffect(()=>{ load(); }, []);

  async function toggle(d: Driver) {
    const { data, error } = await supabase.rpc("set_driver_online", { p_driver_id: d.id, p_online: !d.online });
    if (error) { setErr(error.message); return; }
    setRows(prev => prev.map(x => x.id === d.id ? { ...x, online: !d.online } : x));
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin Ã‚Â· Drivers</h1>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left border-b"><th className="py-2">Name</th><th>Town</th><th>Status</th><th></th></tr>
        </thead>
        <tbody>
          {rows.map(d=>(
            <tr key={d.id} className="border-b">
              <td className="py-2">{d.name ?? d.id.slice(0,8)}</td>
              <td>{d.town ?? "Ã¢â‚¬â€"}</td>
              <td>{d.online ? "Online" : "Offline"}</td>
              <td>
                <button onClick={()=>toggle(d)} className={"px-3 py-1 rounded text-sm text-white " + (d.online?"bg-red-600":"bg-green-600")}>
                  {d.online ? "Set Offline" : "Set Online"}
                </button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={4} className="py-6 text-center opacity-60">No drivers</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

