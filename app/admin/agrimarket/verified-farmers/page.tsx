"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

const IFUGAO_TOWNS = [
  "Aguinaldo",
  "Alfonso Lista",
  "Asipulo",
  "Banaue",
  "Hingyon",
  "Hungduan",
  "Kiangan",
  "Lagawe",
  "Lamut",
  "Mayoyao",
  "Tinoc",
];

type VerifiedFarmer = {
  producer_id: string;
  contact_name: string;
  contact_phone: string;
  town: string;
  barangay?: string | null;
  private_pickup_label: string;
  private_pickup_lat: number;
  private_pickup_lng: number;
  producer_status: string;
  accepting_orders: boolean;
  access_code?: string | null;
  credential_status?: string | null;
  credential_failed_attempts?: number;
  credential_locked_until?: string | null;
  credential_last_used_at?: string | null;
  provisioned_by?: string | null;
  verification_note?: string | null;
  provisioned_at: string;
  intended_products: string[];
  identity_type?: string | null;
  identity_reference_last4?: string | null;
};

type OneTimeCredential = {
  farmer_name: string;
  access_code: string;
  temporary_pin: string;
};

type FarmerForm = {
  contact_name: string;
  contact_phone: string;
  town: string;
  barangay: string;
  pickup_label: string;
  pickup_lat: string;
  pickup_lng: string;
  intended_products: string;
  identity_type: string;
  identity_reference_last4: string;
  verification_note: string;
};

const EMPTY_FORM: FarmerForm = {
  contact_name: "",
  contact_phone: "",
  town: "Lagawe",
  barangay: "",
  pickup_label: "",
  pickup_lat: "",
  pickup_lng: "",
  intended_products: "",
  identity_type: "",
  identity_reference_last4: "",
  verification_note: "",
};

function formatDate(value: unknown): string {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila" })
    : "-";
}

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function VerifiedFarmersAdminPage() {
  const [farmers, setFarmers] = useState<VerifiedFarmer[]>([]);
  const [staffRole, setStaffRole] = useState("");
  const [form, setForm] = useState<FarmerForm>(EMPTY_FORM);
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadFarmers() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/admin/verified-farmers", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load staff-verified farmers.");
    } else {
      setFarmers(Array.isArray(payload?.farmers) ? payload.farmers : []);
      setStaffRole(String(payload?.staff_role || ""));
    }
    setLoading(false);
  }

  useEffect(() => { void loadFarmers(); }, []);

  function updateField(field: keyof FarmerForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (staffRole !== "admin") return;

    setBusy("create");
    setError("");
    setMessage("");
    setCredential(null);

    const response = await fetch("/api/agrimarket/admin/verified-farmers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        ...form,
        pickup_lat: Number.parseFloat(form.pickup_lat),
        pickup_lng: Number.parseFloat(form.pickup_lng),
        intended_products: form.intended_products
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to create the verified farmer account.");
    } else {
      setCredential({
        farmer_name: payload?.farmer?.contact_name || form.contact_name,
        access_code: payload.credential.access_code,
        temporary_pin: payload.credential.temporary_pin,
      });
      setMessage("Verified farmer account created. Copy the Access Code and temporary PIN now.");
      setForm(EMPTY_FORM);
      await loadFarmers();
    }
    setBusy("");
  }

  async function manageAccess(farmer: VerifiedFarmer, action: "reset_pin" | "revoke_access" | "suspend_farmer" | "reactivate_farmer") {
    if (staffRole !== "admin") return;

    let reason: string | null = null;
    if (action === "reset_pin") {
      if (!window.confirm(`Generate a new PIN for ${farmer.contact_name}? The old PIN will stop working immediately.`)) return;
    }
    if (action === "suspend_farmer" || action === "revoke_access") {
      reason = window.prompt(`Enter the reason to ${action === "suspend_farmer" ? "suspend" : "revoke access for"} ${farmer.contact_name}:`);
      if (reason === null) return;
      if (!reason.trim()) {
        setError("A reason is required for suspension or revocation.");
        return;
      }
    }

    setBusy(`${action}:${farmer.producer_id}`);
    setError("");
    setMessage("");
    setCredential(null);

    const response = await fetch("/api/agrimarket/admin/farmer-access", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        producer_id: farmer.producer_id,
        action,
        reason: reason?.trim() || null,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update farmer access.");
    } else {
      if (payload?.credential?.access_code && payload?.credential?.temporary_pin) {
        setCredential({
          farmer_name: farmer.contact_name,
          access_code: payload.credential.access_code,
          temporary_pin: payload.credential.temporary_pin,
        });
      }
      setMessage(`${titleCase(action)} completed for ${farmer.contact_name}.`);
      await loadFarmers();
    }
    setBusy("");
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage("Copied to clipboard.");
    } catch {
      setError("Copy failed. Select and copy the value manually.");
    }
  }

  function openMap(farmer: VerifiedFarmer) {
    const query = encodeURIComponent(`${farmer.private_pickup_lat},${farmer.private_pickup_lng}`);
    window.open(`https://maps.google.com/?q=${query}`, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Admin</p>
            <h1 className="text-3xl font-bold">Add verified farmer</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Use this only after JRide has verified the farmer offline. This does not open public applications and does not change the marketplace flags.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/agrimarket/farmers" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Applications and access</Link>
            <Link href="/admin/control-center" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Control Center</Link>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        {credential ? (
          <section className="mt-5 rounded-3xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950">
            <p className="text-xs font-bold uppercase tracking-widest">One-time credential</p>
            <h2 className="mt-1 text-xl font-bold">{credential.farmer_name}</h2>
            <p className="mt-2 text-sm">The PIN is shown only in this response and is not stored as plaintext. Copy both values before leaving or refreshing this page.</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white p-4">
                <p className="text-xs uppercase text-slate-500">Access Code</p>
                <p className="mt-1 font-mono text-xl font-bold">{credential.access_code}</p>
                <button type="button" onClick={() => copy(credential.access_code)} className="mt-3 rounded-xl border px-3 py-2 text-sm font-semibold">Copy Access Code</button>
              </div>
              <div className="rounded-2xl bg-white p-4">
                <p className="text-xs uppercase text-slate-500">Temporary 6-digit PIN</p>
                <p className="mt-1 font-mono text-xl font-bold">{credential.temporary_pin}</p>
                <button type="button" onClick={() => copy(credential.temporary_pin)} className="mt-3 rounded-xl border px-3 py-2 text-sm font-semibold">Copy PIN</button>
              </div>
            </div>
            <p className="mt-4 text-sm"><strong>Farmer login:</strong> app.jride.net/agrimarket/farmer</p>
            <Link href="/agrimarket/farmer" className="mt-3 inline-flex rounded-xl bg-amber-900 px-4 py-2 font-bold text-white">Open Farmer Login</Link>
          </section>
        ) : null}

        {staffRole === "dispatcher" ? (
          <div className="mt-5 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
            Dispatchers may view staff-verified farmer records. Only an administrator may create credentials or change farmer access.
          </div>
        ) : null}

        {staffRole === "admin" ? (
          <form onSubmit={submit} className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Verified farmer details</h2>
                <p className="mt-1 text-sm text-slate-600">All pickup information is private and must never be shown to customers.</p>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">Admin only</span>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="text-sm font-semibold">Farmer full name
                <input required value={form.contact_name} onChange={(event) => updateField("contact_name", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold">Contact number
                <input required inputMode="tel" value={form.contact_phone} onChange={(event) => updateField("contact_phone", event.target.value)} placeholder="09171234567" className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold">Town
                <select required value={form.town} onChange={(event) => updateField("town", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-3">
                  {IFUGAO_TOWNS.map((town) => <option key={town} value={town}>{town}</option>)}
                </select>
              </label>
              <label className="text-sm font-semibold">Barangay
                <input value={form.barangay} onChange={(event) => updateField("barangay", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold md:col-span-2">Private pickup description
                <input required value={form.pickup_label} onChange={(event) => updateField("pickup_label", event.target.value)} placeholder="House, farm, landmark, or pickup instructions" className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold">Pickup latitude
                <input required inputMode="decimal" value={form.pickup_lat} onChange={(event) => updateField("pickup_lat", event.target.value)} placeholder="16.800000" className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold">Pickup longitude
                <input required inputMode="decimal" value={form.pickup_lng} onChange={(event) => updateField("pickup_lng", event.target.value)} placeholder="121.120000" className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold md:col-span-2">Intended products
                <input value={form.intended_products} onChange={(event) => updateField("intended_products", event.target.value)} placeholder="Native chicken, vegetables, eggs" className="mt-1 w-full rounded-xl border px-3 py-3" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Separate products with commas. This is audit information only; it does not create listings.</span>
              </label>
              <label className="text-sm font-semibold">Identity evidence type
                <input value={form.identity_type} onChange={(event) => updateField("identity_type", event.target.value)} placeholder="Government ID, barangay certification, in-person verification" className="mt-1 w-full rounded-xl border px-3 py-3" />
              </label>
              <label className="text-sm font-semibold">Identity reference last 2-4 characters
                <input maxLength={4} value={form.identity_reference_last4} onChange={(event) => updateField("identity_reference_last4", event.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border px-3 py-3 uppercase" />
              </label>
              <label className="text-sm font-semibold md:col-span-2">Verification note
                <textarea required value={form.verification_note} onChange={(event) => updateField("verification_note", event.target.value)} placeholder="State how JRide verified this farmer and who confirmed the private pickup location." className="mt-1 min-h-28 w-full rounded-xl border px-3 py-3" />
              </label>
            </div>

            <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
              Creating this account generates a random AGF Access Code and random 6-digit PIN. Only the bcrypt PIN hash is stored. One audit event records the administrator, farmer, verification note, and provisioning time.
            </div>

            <button disabled={busy === "create"} className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
              {busy === "create" ? "Creating farmer login..." : "Create farmer login"}
            </button>
          </form>
        ) : null}

        <section className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">Staff-verified farmers</h2>
              <p className="mt-1 text-sm text-slate-600">This list contains farmers created through this controlled staff-only path.</p>
            </div>
            <button type="button" onClick={() => loadFarmers()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button>
          </div>

          <div className="mt-4 space-y-4">
            {loading ? <div className="rounded-2xl border bg-white p-6">Loading verified farmers...</div> : null}
            {!loading && farmers.length === 0 ? <div className="rounded-2xl border bg-white p-6 text-sm text-slate-500">No staff-verified farmers have been provisioned.</div> : null}
            {farmers.map((farmer) => {
              const actionBusy = busy.endsWith(farmer.producer_id);
              return (
                <article key={farmer.producer_id} className="rounded-3xl border bg-white p-5 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{farmer.access_code || "No Access Code"}</p>
                      <h3 className="mt-1 text-xl font-bold">{farmer.contact_name}</h3>
                      <p className="text-sm text-slate-600">{farmer.contact_phone} - {farmer.barangay ? `${farmer.barangay}, ` : ""}{farmer.town}</p>
                    </div>
                    <div className="flex flex-wrap gap-2 text-xs font-semibold">
                      <span className="rounded-full bg-slate-100 px-3 py-1">Farmer: {titleCase(farmer.producer_status)}</span>
                      <span className="rounded-full bg-slate-100 px-3 py-1">Credential: {titleCase(farmer.credential_status)}</span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-2xl bg-blue-50 p-4 text-sm text-blue-950">
                      <p className="text-xs font-semibold uppercase text-blue-700">Private pickup</p>
                      <p className="mt-1 font-semibold">{farmer.private_pickup_label}</p>
                      <p className="mt-1 text-xs">{Number(farmer.private_pickup_lat).toFixed(6)}, {Number(farmer.private_pickup_lng).toFixed(6)}</p>
                      <button type="button" onClick={() => openMap(farmer)} className="mt-3 rounded-xl bg-blue-800 px-3 py-2 text-xs font-bold text-white">Open map</button>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                      <p className="text-xs font-semibold uppercase text-slate-500">Provisioning audit</p>
                      <p className="mt-1">{formatDate(farmer.provisioned_at)}</p>
                      <p className="mt-1 text-xs text-slate-600">By {farmer.provisioned_by || "unknown staff"}</p>
                      <p className="mt-2 text-xs text-slate-600">{farmer.verification_note || "No verification note returned."}</p>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm">
                      <p className="text-xs font-semibold uppercase text-slate-500">Farmer activity</p>
                      <p className="mt-1">Orders: {farmer.accepting_orders ? "accepting" : "blocked"}</p>
                      <p className="mt-1">Last login: {farmer.credential_last_used_at ? formatDate(farmer.credential_last_used_at) : "Never"}</p>
                      <p className="mt-1 text-xs text-slate-500">Failed attempts: {farmer.credential_failed_attempts || 0}</p>
                    </div>
                  </div>

                  <div className="mt-3 rounded-2xl bg-slate-50 p-4 text-sm">
                    <p><strong>Intended products:</strong> {farmer.intended_products.join(", ") || "Not recorded"}</p>
                    <p className="mt-1"><strong>Identity evidence:</strong> {farmer.identity_type || "Not recorded"}{farmer.identity_reference_last4 ? ` - last ${farmer.identity_reference_last4}` : ""}</p>
                  </div>

                  {staffRole === "admin" ? (
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button disabled={actionBusy} type="button" onClick={() => manageAccess(farmer, "reset_pin")} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">Reset PIN</button>
                      {farmer.producer_status === "active" ? (
                        <button disabled={actionBusy} type="button" onClick={() => manageAccess(farmer, "suspend_farmer")} className="rounded-xl border border-amber-500 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 disabled:opacity-50">Suspend</button>
                      ) : (
                        <button disabled={actionBusy || farmer.credential_status !== "active"} type="button" onClick={() => manageAccess(farmer, "reactivate_farmer")} className="rounded-xl border border-emerald-600 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900 disabled:opacity-50">Reactivate</button>
                      )}
                      <button disabled={actionBusy || farmer.credential_status === "revoked"} type="button" onClick={() => manageAccess(farmer, "revoke_access")} className="rounded-xl border border-red-500 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-50">Revoke access</button>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
