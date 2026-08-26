"use client";

import { useEffect, useMemo, useState } from "react";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function fmt(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "-";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

export default function VendorCompliancePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAllReviews, setShowAllReviews] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch("/api/admin/vendor-compliance", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) throw new Error(j?.message || j?.error || "Failed to load vendor compliance.");
      setData(j);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function act(action: string, payload: Record<string, any> = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/admin/vendor-compliance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, actor: "JRide admin", ...payload }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok !== true) throw new Error(j?.message || j?.error || "Action failed.");
      setMessage("Saved successfully.");
      await load();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  const reviews = useMemo(() => {
    const all = data?.reviews || [];
    return showAllReviews ? all : all.filter((row: any) => row.status === "pending");
  }, [data, showAllReviews]);

  const activeSanctions = (data?.sanctions || []).filter((row: any) => row.status === "active" && new Date(row.ends_at).getTime() > Date.now());

  return (
    <main className="min-h-screen bg-slate-100 p-3 sm:p-6">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-700">JRide Admin</div>
              <h1 className="mt-1 text-2xl font-black text-slate-950">Vendor compliance reviews</h1>
              <p className="mt-1 max-w-4xl text-sm text-slate-600">
                The system detects repeated vendor timeouts and consecutive offline days, but an admin must approve any public warning or 7-day suspension. Holidays and approved closures can be excluded from the offline-day count.
              </p>
            </div>
            <button type="button" onClick={() => void load()} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white">Refresh</button>
          </div>

          {data?.policy ? (
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-5">
              <div className="rounded-xl border bg-slate-50 p-3 text-xs"><div className="text-slate-500">Offline review</div><div className="mt-1 font-black">3 consecutive non-exempt days</div></div>
              <div className="rounded-xl border bg-slate-50 p-3 text-xs"><div className="text-slate-500">Response warning review</div><div className="mt-1 font-black">2 consecutive expired orders</div></div>
              <div className="rounded-xl border bg-slate-50 p-3 text-xs"><div className="text-slate-500">Suspension review</div><div className="mt-1 font-black">3 consecutive expired orders</div></div>
              <div className="rounded-xl border bg-slate-50 p-3 text-xs"><div className="text-slate-500">Public warning</div><div className="mt-1 font-black">7 days after approval</div></div>
              <div className="rounded-xl border bg-slate-50 p-3 text-xs"><div className="text-slate-500">Suspension</div><div className="mt-1 font-black">7 days after approval</div></div>
            </div>
          ) : null}
        </section>

        {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm font-semibold text-rose-800">{error}</div> : null}
        {message ? <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{message}</div> : null}
        {loading ? <div className="rounded-xl border bg-white p-5 text-sm">Loading...</div> : null}

        {!loading ? (
          <>
            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div><h2 className="text-lg font-black">Pending compliance cases</h2><p className="text-xs text-slate-500">Review the evidence before applying any sanction.</p></div>
                <label className="flex items-center gap-2 text-xs font-bold"><input type="checkbox" checked={showAllReviews} onChange={(e) => setShowAllReviews(e.target.checked)} /> Show reviewed cases</label>
              </div>

              <div className="mt-3 space-y-2">
                {reviews.length === 0 ? <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">No compliance cases match this view.</div> : null}
                {reviews.map((review: any) => (
                  <div key={review.id} className="rounded-xl border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="font-black text-slate-950">{review.vendor_name}</div>
                        <div className="mt-1 text-xs text-slate-500">{review.town || "-"} | {review.review_type} | created {fmt(review.created_at)}</div>
                        <div className="mt-2 text-sm font-semibold text-slate-800">{review.reason}</div>
                        <pre className="mt-2 max-w-3xl overflow-auto rounded-lg bg-slate-950 p-2 text-[10px] text-slate-200">{JSON.stringify(review.evidence || {}, null, 2)}</pre>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {review.status === "pending" && review.review_type === "response_warning" ? (
                          <button disabled={busy} onClick={() => void act("approve_warning", { review_id: review.id })} className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Publish 7-day response warning</button>
                        ) : null}
                        {review.status === "pending" && ["suspension_timeout", "suspension_offline"].includes(review.review_type) ? (
                          <button disabled={busy} onClick={() => void act("suspend_7_days", { review_id: review.id })} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Suspend 7 days</button>
                        ) : null}
                        {review.status === "pending" ? (
                          <button disabled={busy} onClick={() => void act("dismiss_review", { review_id: review.id })} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50">Dismiss</button>
                        ) : <span className="rounded-full border px-3 py-1 text-xs font-bold uppercase">{review.status}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black">Holiday / excused closure dates</h2>
              <p className="mt-1 text-xs text-slate-500">Leave Vendor ID blank to exempt every participating vendor for that date. Use a Vendor ID for a store-specific approved closure.</p>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[180px_1fr_1fr_auto]">
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="rounded-lg border px-3 py-2 text-sm" />
                <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="Vendor UUID (optional)" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Holiday / approved closure reason" className="rounded-lg border px-3 py-2 text-sm" />
                <button disabled={busy || !date || !reason.trim()} onClick={() => void act("add_exemption", { exemption_date: date, vendor_id: vendorId || null, reason })} className="rounded-lg bg-slate-950 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Add exemption</button>
              </div>
              <div className="mt-3 space-y-1">
                {(data?.exemptions || []).map((row: any) => (
                  <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs">
                    <div><b>{row.exemption_date}</b> - {row.reason} {row.vendor_id ? `(${row.vendor_name})` : "(All vendors)"}</div>
                    <button disabled={busy} onClick={() => void act("remove_exemption", { id: row.id })} className="rounded border px-2 py-1 font-bold">Remove</button>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4 shadow-sm">
              <h2 className="text-lg font-black">Active sanctions</h2>
              <div className="mt-3 space-y-2">
                {activeSanctions.length === 0 ? <div className="rounded-xl border bg-slate-50 p-4 text-sm text-slate-500">No active vendor sanctions.</div> : null}
                {activeSanctions.map((row: any) => (
                  <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm">
                    <div><div className="font-black">{row.vendor_name}</div><div className="text-xs text-slate-500">{row.sanction_type} | {fmt(row.starts_at)} to {fmt(row.ends_at)}</div><div className="mt-1">{row.reason}</div></div>
                    <button disabled={busy} onClick={() => void act("revoke_sanction", { sanction_id: row.id, note: "Revoked by JRide admin" })} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-800 disabled:opacity-50">Revoke</button>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
