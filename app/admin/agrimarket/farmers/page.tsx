"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AccessEvent = {
  event_type: string;
  actor?: string | null;
  reason?: string | null;
  created_at: string;
};

type Application = {
  id: string;
  application_code: string;
  applicant_name: string;
  phone: string;
  town: string;
  barangay?: string | null;
  private_pickup_label: string;
  private_pickup_lat: number;
  private_pickup_lng: number;
  intended_products: string[];
  identity_type?: string | null;
  identity_reference_last4?: string | null;
  applicant_note?: string | null;
  status: string;
  review_note?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  approved_producer_id?: string | null;
  farmer_access_code?: string | null;
  producer_status?: string | null;
  accepting_orders?: boolean | null;
  credential_status?: string | null;
  credential_failed_attempts?: number;
  credential_locked_until?: string | null;
  credential_last_used_at?: string | null;
  last_access_event?: AccessEvent | null;
  created_at: string;
};

type OneTimeCredential = { access_code: string; temporary_pin: string };
type AccessAction = "reset_pin" | "revoke_access" | "suspend_farmer" | "reactivate_farmer";

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-";
}

function accessActionLabel(action: AccessAction): string {
  if (action === "reset_pin") return "Reset PIN";
  if (action === "revoke_access") return "Revoke Access";
  if (action === "suspend_farmer") return "Suspend Farmer";
  return "Reactivate Farmer";
}

export default function AgrimarketFarmerAdminPage() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [staffRole, setStaffRole] = useState("");
  const [filter, setFilter] = useState("open");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [accessReasons, setAccessReasons] = useState<Record<string, string>>({});
  const [credential, setCredential] = useState<Record<string, OneTimeCredential>>({});

  async function loadApplications() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/admin/farmer-applications", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load farmer applications.");
    } else {
      setApplications(Array.isArray(payload?.applications) ? payload.applications : []);
      setStaffRole(String(payload?.staff_role || ""));
    }
    setLoading(false);
  }

  useEffect(() => { void loadApplications(); }, []);

  const visible = useMemo(() => {
    if (filter === "all") return applications;
    if (filter === "open") return applications.filter((row) => ["submitted", "under_review"].includes(row.status));
    return applications.filter((row) => row.status === filter);
  }, [applications, filter]);

  async function review(app: Application, decision: "under_review" | "approve" | "reject") {
    if (staffRole !== "admin") return;
    setBusy(`review:${app.id}`);
    setError("");
    setMessage("");
    const response = await fetch("/api/agrimarket/admin/farmer-applications", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ application_id: app.id, decision, review_note: notes[app.id] || null }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to review the farmer application.");
    } else {
      if (payload?.credential?.access_code && payload?.credential?.temporary_pin) {
        setCredential((current) => ({
          ...current,
          [app.id]: {
            access_code: payload.credential.access_code,
            temporary_pin: payload.credential.temporary_pin,
          },
        }));
      }
      setMessage(decision === "approve" ? "Farmer approved. Copy the one-time PIN before leaving this page." : "Farmer application updated.");
      await loadApplications();
    }
    setBusy("");
  }

  async function manageAccess(app: Application, action: AccessAction) {
    if (staffRole !== "admin" || !app.approved_producer_id) return;
    const reason = String(accessReasons[app.id] || "").trim();
    if ((action === "revoke_access" || action === "suspend_farmer") && !reason) {
      setError("Enter an access-control reason before suspending or revoking this farmer.");
      return;
    }

    if (action === "revoke_access") {
      const confirmed = window.confirm("Revoke this farmer's Agrimarket credential and suspend new orders? Existing active orders will not be deleted.");
      if (!confirmed) return;
    }
    if (action === "reset_pin") {
      const confirmed = window.confirm("Generate a new 6-digit farmer PIN? The old PIN will stop working immediately.");
      if (!confirmed) return;
    }

    setBusy(`access:${app.id}:${action}`);
    setError("");
    setMessage("");

    const response = await fetch("/api/agrimarket/admin/farmer-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        producer_id: app.approved_producer_id,
        action,
        reason: reason || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update farmer access.");
    } else {
      if (payload?.credential?.access_code && payload?.credential?.temporary_pin) {
        setCredential((current) => ({
          ...current,
          [app.id]: {
            access_code: payload.credential.access_code,
            temporary_pin: payload.credential.temporary_pin,
          },
        }));
      }
      setAccessReasons((current) => ({ ...current, [app.id]: "" }));
      const activeOrders = Number(payload?.result?.active_order_count || 0);
      setMessage(`${accessActionLabel(action)} completed.${activeOrders > 0 ? ` ${activeOrders} active order(s) remain and must be completed or resolved separately.` : ""}`);
      await loadApplications();
    }
    setBusy("");
  }

  function openMap(app: Application) {
    window.open(`https://maps.google.com/?q=${encodeURIComponent(`${app.private_pickup_lat},${app.private_pickup_lng}`)}`, "_blank", "noopener,noreferrer");
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); } catch {}
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Admin</p>
            <h1 className="text-3xl font-bold">Agrimarket farmers</h1>
            <p className="mt-2 text-sm text-slate-600">Review applications, protect private pickup information, and manage approved farmer access.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/admin/control-center" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Control Center</Link>
            <button onClick={() => loadApplications()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            {["open", "submitted", "under_review", "approved", "rejected", "all"].map((value) => (
              <button key={value} onClick={() => setFilter(value)} className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === value ? "bg-slate-900 text-white" : "bg-slate-100"}`}>{titleCase(value)}</button>
            ))}
            <span className="ml-auto text-xs text-slate-500">Signed in as: {staffRole || "checking"}</span>
          </div>
        </div>

        {staffRole === "dispatcher" ? (
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Dispatchers may review farmer information and access status. Only an administrator can approve, reset, suspend, reactivate, or revoke access.</div>
        ) : null}
        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <section className="mt-5 space-y-4">
          {loading ? <div className="rounded-2xl border bg-white p-8 text-center">Loading applications...</div> : null}
          {!loading && visible.length === 0 ? <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">No applications in this view.</div> : null}
          {visible.map((app) => {
            const oneTime = credential[app.id];
            const final = ["approved", "rejected", "withdrawn"].includes(app.status);
            const accessBusy = busy.startsWith(`access:${app.id}:`);
            const producerActive = app.producer_status === "active";
            const credentialActive = app.credential_status === "active";
            return (
              <article key={app.id} className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{app.application_code}</p>
                    <h2 className="mt-1 text-xl font-bold">{app.applicant_name}</h2>
                    <p className="text-sm text-slate-600">{app.phone} - {app.barangay ? `${app.barangay}, ` : ""}{app.town}</p>
                  </div>
                  <div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-semibold">{titleCase(app.status)}</div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <p className="text-xs font-semibold uppercase text-slate-500">Products</p>
                    <p className="mt-1 font-semibold">{app.intended_products.join(", ") || "-"}</p>
                    <p className="mt-3 text-xs font-semibold uppercase text-slate-500">Identity reference</p>
                    <p className="mt-1 text-sm">{app.identity_type || "Not supplied"}{app.identity_reference_last4 ? ` - last ${app.identity_reference_last4}` : ""}</p>
                    {app.applicant_note ? <><p className="mt-3 text-xs font-semibold uppercase text-slate-500">Applicant note</p><p className="mt-1 text-sm">{app.applicant_note}</p></> : null}
                  </div>
                  <div className="rounded-2xl bg-blue-50 p-4">
                    <p className="text-xs font-semibold uppercase text-blue-700">Private pickup location</p>
                    <p className="mt-1 font-semibold text-blue-950">{app.private_pickup_label}</p>
                    <p className="mt-1 text-xs text-blue-900">{app.private_pickup_lat.toFixed(6)}, {app.private_pickup_lng.toFixed(6)}</p>
                    <button onClick={() => openMap(app)} className="mt-3 rounded-xl bg-blue-800 px-4 py-2 text-sm font-semibold text-white">Open map</button>
                    <p className="mt-3 text-xs text-blue-900">Never expose this exact location to customers.</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Joining</p><strong className="text-emerald-900">FREE</strong></div>
                  <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Listing</p><strong className="text-emerald-900">FREE</strong></div>
                  <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Product deduction</p><strong className="text-emerald-900">0%</strong></div>
                </div>

                {app.status === "approved" && app.approved_producer_id ? (
                  <div className="mt-4 rounded-2xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-bold">Farmer access & operations</p>
                        <p className="mt-1 text-xs text-slate-500">Access controls never create a farmer wallet and never change the 0% launch policy.</p>
                      </div>
                      {app.farmer_access_code ? <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{app.farmer_access_code}</span> : null}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Producer status</p><strong>{titleCase(app.producer_status || "unknown")}</strong><p className="mt-1 text-xs text-slate-500">Orders: {app.accepting_orders ? "accepting" : "blocked"}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Credential</p><strong>{titleCase(app.credential_status || "unknown")}</strong><p className="mt-1 text-xs text-slate-500">Failed attempts: {app.credential_failed_attempts || 0}</p></div>
                      <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Last farmer sign-in</p><strong className="text-sm">{app.credential_last_used_at ? formatDate(app.credential_last_used_at) : "Never"}</strong><p className="mt-1 text-xs text-slate-500">{app.credential_locked_until ? `Locked until ${formatDate(app.credential_locked_until)}` : "Not locked"}</p></div>
                    </div>

                    {app.last_access_event ? (
                      <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                        <strong>Latest access event: {titleCase(app.last_access_event.event_type)}</strong>
                        <p className="mt-1 text-xs">{formatDate(app.last_access_event.created_at)}{app.last_access_event.actor ? ` by ${app.last_access_event.actor}` : ""}{app.last_access_event.reason ? ` - ${app.last_access_event.reason}` : ""}</p>
                      </div>
                    ) : null}

                    {staffRole === "admin" ? (
                      <div className="mt-4">
                        <label className="text-sm font-semibold">Access-control reason<textarea value={accessReasons[app.id] || ""} onChange={(e) => setAccessReasons((current) => ({ ...current, [app.id]: e.target.value }))} className="mt-2 min-h-20 w-full rounded-xl border px-3 py-3" placeholder="Required for suspension or revocation. Optional for PIN reset/reactivation." /></label>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button disabled={accessBusy} onClick={() => manageAccess(app, "reset_pin")} className="rounded-xl border border-blue-300 bg-blue-50 px-4 py-2 font-semibold text-blue-900">Reset PIN</button>
                          {producerActive ? (
                            <button disabled={accessBusy} onClick={() => manageAccess(app, "suspend_farmer")} className="rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white">Suspend Farmer</button>
                          ) : (
                            <button disabled={accessBusy || !credentialActive} onClick={() => manageAccess(app, "reactivate_farmer")} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white disabled:bg-slate-400">Reactivate Farmer</button>
                          )}
                          {app.credential_status !== "revoked" ? (
                            <button disabled={accessBusy} onClick={() => manageAccess(app, "revoke_access")} className="rounded-xl bg-red-700 px-4 py-2 font-semibold text-white">Revoke Access</button>
                          ) : null}
                        </div>
                        {app.credential_status === "revoked" ? <p className="mt-2 text-xs text-red-700">Access is revoked. Reset the PIN first to create a new active credential, then reactivate the farmer separately.</p> : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {oneTime ? (
                  <div className="mt-4 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4">
                    <p className="font-bold text-emerald-950">New farmer PIN - copy now</p>
                    <p className="mt-1 text-sm text-emerald-900">This PIN is shown only in this response and cannot be retrieved later.</p>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <button onClick={() => copy(oneTime.access_code)} className="rounded-xl bg-white p-3 text-left"><span className="text-xs text-slate-500">Access code</span><strong className="block text-lg">{oneTime.access_code}</strong></button>
                      <button onClick={() => copy(oneTime.temporary_pin)} className="rounded-xl bg-white p-3 text-left"><span className="text-xs text-slate-500">6-digit PIN</span><strong className="block text-lg">{oneTime.temporary_pin}</strong></button>
                    </div>
                  </div>
                ) : null}

                {!final && staffRole === "admin" ? (
                  <div className="mt-4 rounded-2xl border p-4">
                    <label className="text-sm font-semibold">Review note<textarea value={notes[app.id] || ""} onChange={(e) => setNotes((current) => ({ ...current, [app.id]: e.target.value }))} className="mt-2 min-h-20 w-full rounded-xl border px-3 py-3" placeholder="Required for rejection; optional for approval." /></label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button disabled={busy === `review:${app.id}`} onClick={() => review(app, "under_review")} className="rounded-xl border px-4 py-2 font-semibold">Mark under review</button>
                      <button disabled={busy === `review:${app.id}`} onClick={() => review(app, "approve")} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white">Approve farmer</button>
                      <button disabled={busy === `review:${app.id}`} onClick={() => review(app, "reject")} className="rounded-xl bg-red-700 px-4 py-2 font-semibold text-white">Reject</button>
                    </div>
                  </div>
                ) : null}

                <p className="mt-4 text-xs text-slate-500">Submitted {formatDate(app.created_at)}{app.reviewed_at ? ` - Reviewed ${formatDate(app.reviewed_at)} by ${app.reviewed_by || "staff"}` : ""}</p>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
