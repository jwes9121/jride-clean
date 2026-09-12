"use client";

import { useEffect, useState } from "react";

type Device = { id: string; driver_id: string; device_id: string; status: string; client_version: string; created_at: string; review_note: string | null; driver: { full_name: string; callsign: string; municipality: string; vehicle_type: string } | null };

export default function DriverDevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState("pending");

  async function refresh() {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/agrimarket/admin/driver-devices", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Administrator sign-in is required to review driver phones.");
      setDevices(data.devices || []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Phone requests are unavailable. Please refresh."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  async function review(device: Device, decision: "approve" | "revoke") {
    setBusy(device.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/agrimarket/admin/driver-devices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: device.id, decision, note: notes[device.id] || "", device_confirmed: confirmed[device.id] === true }) });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.message || "Phone access could not be updated.");
      setMessage(decision === "approve" ? "Phone approved. The driver can continue with the saved UUID." : "AgriMarket access for this phone is revoked.");
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection interrupted. Refresh the request before repeating the action."); }
    finally { setBusy(""); }
  }

  const visible = devices.filter(device => filter === "all" || device.status === filter);
  return <main className="mx-auto max-w-5xl px-4 py-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold">Driver phone access</h1><p className="mt-2 max-w-2xl text-sm text-slate-600">Drivers use their existing UUID. Approve their phone once; no driver email or password is needed.</p></div><button disabled={loading} onClick={() => void refresh()} className="rounded-xl border px-4 py-3">{loading ? "Refreshing..." : "Refresh"}</button></div>
    <p className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">Only admins can approve or revoke phone access. Match the phone request code and verify the driver before approval. Regular driver accounts allow one approved phone; approving a replacement revokes the previous phone's AgriMarket access. The shared Test Driver account can keep multiple approved test phones.</p>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-red-900">{error}</p>}
    {message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-900">{message}</p>}
    <div className="my-5 flex flex-wrap gap-2" aria-label="Filter phone requests">{["pending", "approved", "revoked", "all"].map(value => <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-full border px-4 py-2 capitalize ${filter === value ? "bg-emerald-900 text-white" : "bg-white"}`}>{value}</button>)}</div>
    {!loading && !visible.length && <p className="rounded-2xl border bg-white p-8 text-center text-slate-600">No {filter === "all" ? "phone" : filter} requests.</p>}
    <div className="grid gap-4">{visible.map(device => {
      const expired = device.status === "pending" && Date.parse(device.created_at) < Date.now() - 86400000;
      const code = device.id.slice(-8).toUpperCase();
      const noteReady = (notes[device.id] || "").trim().length >= 5;
      return <article key={device.id} className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-lg font-bold">{device.driver?.full_name || "Driver"}</h2><p className="text-sm text-slate-600">{[device.driver?.callsign, device.driver?.municipality, device.driver?.vehicle_type].filter(Boolean).join(" | ")}</p></div><span className="h-fit rounded-full bg-slate-100 px-3 py-1 text-sm capitalize">{expired ? "Expired" : device.status}</span></div>
        <p className="mt-4 text-sm">Phone request code: <strong className="font-mono text-lg tracking-wider">{code}</strong></p><p className="mt-2 break-all text-xs text-slate-500">Driver UUID: {device.driver_id}</p><p className="mt-1 text-xs text-slate-500">Phone {device.device_id.slice(-6).toUpperCase()} | App {device.client_version || "unknown"} | Requested {new Date(device.created_at).toLocaleString()}</p>
        {device.driver_id === "00000000-0000-4000-8000-000000000001" && <p className="mt-3 text-sm font-semibold text-emerald-800">Shared Test Driver: approving this phone keeps the other approved test phones active.</p>}
        {device.review_note && <p className="mt-3 text-sm">Last review: {device.review_note}</p>}
        {device.status !== "revoked" && <>
          <label className="mt-4 block text-sm font-semibold">Review note for {code}<textarea maxLength={500} value={notes[device.id] || ""} onChange={event => setNotes(current => ({ ...current, [device.id]: event.target.value }))} className="mt-2 min-h-20 w-full rounded-xl border p-3 font-normal" placeholder="Record how you verified the driver and this phone, or why access is being removed." /></label>
          {device.status === "pending" && !expired && <label className="mt-3 flex items-start gap-3 text-sm"><input type="checkbox" checked={confirmed[device.id] === true} onChange={event => setConfirmed(current => ({ ...current, [device.id]: event.target.checked }))} className="mt-1" /><span>I verified this driver and matched phone request code {code}.</span></label>}
          {expired && <p className="mt-3 text-sm text-amber-900">Ask the driver to request phone approval again. Requests expire after 24 hours.</p>}
          <div className="mt-4 flex flex-wrap gap-3">{device.status === "pending" && !expired && <button disabled={!!busy || !noteReady || !confirmed[device.id]} onClick={() => void review(device, "approve")} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white disabled:opacity-40">Approve phone</button>}<button disabled={!!busy || !noteReady} onClick={() => void review(device, "revoke")} className="rounded-xl border border-red-200 px-4 py-3 text-red-800 disabled:opacity-40">Revoke access</button></div>
        </>}
      </article>;
    })}</div>
  </main>;
}
