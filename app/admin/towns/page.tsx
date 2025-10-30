"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Town = { name: string; color: string };

export default function TownsAdminPage() {
  const [rows, setRows] = useState<Town[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#888888");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    const { data, error } = await supabase.rpc("list_dispatch_towns");
    if (error) setErr(error.message);
    setRows((data ?? []) as Town[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function upsert() {
    setLoading(true);
    setErr(null);
    const { error } = await supabase.rpc("upsert_town", { p_name: name, p_color: color });
    if (error) setErr(error.message);
    setName("");
    await load();
    setLoading(false);
  }

  async function del(n: string) {
    if (!confirm(`Delete town "${n}" ?`)) return;
    setLoading(true);
    setErr(null);
    const { error } = await supabase.rpc("delete_town", { p_name: n });
    if (error) setErr(error.message);
    await load();
    setLoading(false);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin · Towns</h1>

      <div className="flex gap-2 items-end">
        <label className="text-sm">
          <div>Name</div>
          <input className="border rounded px-2 py-1" value={name} onChange={(e)=>setName(e.target.value)} placeholder="Lagawe" />
        </label>
        <label className="text-sm">
          <div>Color</div>
          <input className="border rounded px-2 py-1" value={color} onChange={(e)=>setColor(e.target.value)} placeholder="maroon / #800000" />
        </label>
        <button onClick={upsert} disabled={!name || !color || loading} className={"px-3 py-1 rounded text-sm text-white " + (loading?"bg-gray-400":"bg-black")}>
          {loading ? "Saving…" : "Save"}
        </button>
      </div>

      {err && <div className="text-red-600 text-sm">{err}</div>}

      <table className="w-full text-sm">
        <thead><tr className="text-left border-b"><th className="py-2">Town</th><th>Color</th><th></th></tr></thead>
        <tbody>
          {rows.map(r=>(
            <tr key={r.name} className="border-b">
              <td className="py-2">{r.name}</td>
              <td><span className="inline-block w-4 h-4 rounded mr-2 align-middle" style={{background:r.color}}/> {r.color}</td>
              <td>
                <button onClick={()=>del(r.name)} className="px-2 py-1 text-sm border rounded bg-white">Delete</button>
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={3} className="py-6 text-center opacity-60">No towns</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
