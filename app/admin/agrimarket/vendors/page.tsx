"use client";
import { useEffect, useState } from "react";
type Vendor = { id: string; vendor_name: string | null; contact_name: string; town: string; status: string; accepting_orders: boolean };
export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true); setError("");
    try { const response = await fetch("/api/agrimarket/admin/vendors", { cache: "no-store" }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.message || "Admin access is required."); setVendors(data.vendors); }
    catch (reason) { setVendors([]); setError(reason instanceof Error ? reason.message : "Vendor names could not be loaded."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  return <main className="mx-auto max-w-5xl px-4 py-7"><div className="flex flex-wrap items-center justify-between gap-4"><h1 className="text-2xl font-bold">Private vendor names</h1><button disabled={loading} onClick={() => void refresh()} className="rounded-xl border bg-white px-4 py-3">{loading ? "Loading…" : "Refresh"}</button></div><p className="my-4 text-sm text-slate-600">These names are hidden from passengers. A vendor’s name and pickup details are shared with the driver assigned to that vendor’s order.</p>{error && <p role="alert" className="mb-4 rounded-xl bg-red-50 p-4 text-red-800">{error}</p>}<div className="grid gap-4 sm:grid-cols-2">{vendors.map(vendor => <article key={vendor.id} className="rounded-2xl border bg-white p-5"><h2 className="break-words text-lg font-bold">{vendor.vendor_name || "Vendor name not set"}</h2><p className="mt-2 text-sm">Contact: {vendor.contact_name}</p><p className="mt-1 text-sm text-slate-600">{vendor.town} · {vendor.status} · {vendor.accepting_orders ? "Accepting orders" : "Orders paused"}</p></article>)}</div>{!loading && !error && !vendors.length && <p>No vendors yet.</p>}</main>;
}
