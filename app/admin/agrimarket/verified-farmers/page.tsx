"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type VerifiedFarmer = {
  application_id: string;
  application_code: string;
  onboarding_source: string;
  farmer_name: string;
  phone: string;
  phone_normalized: string;
  town: string;
  barangay?: string | null;
  private_pickup_label: string;
  private_pickup_lat: number;
  private_pickup_lng: number;
  intended_products: string[];
  verification_method?: string | null;
  identity_reference_last4?: string | null;
  verification_note?: string | null;
  provisioned_by?: string | null;
  provisioned_at?: string | null;
  producer_id?: string | null;
  producer_status?: string | null;
  accepting_orders?: boolean | null;
  access_code?: string | null;
  credential_status?: string | null;
  credential_last_used_at?: string | null;
  audit_event?: {
    id: number;
    event_type: string;
    actor?: string | null;
    created_at: string;
    onboarding_source?: string | null;
    pin_visible_once?: boolean;
    pin_stored_as_hash?: boolean;
  } | null;
  created_at: string;
};

type OneTimeCredential = {
  access_code: string;
  temporary_pin: string;
  farmer_login_url: string;
  farmer_name: string;
  application_code: string;
};

type FormState = {
  farmer_name: string;
  phone: string;
  town: string;
  barangay: string;
  private_pickup_label: string;
  private_pickup_lat: string;
  private_pickup_lng: string;
  intended_products: string;
  verification_method: string;
  identity_reference_last4: string;
  verification_note: string;
  verification_confirmed: boolean;
};

const EMPTY_FORM: FormState = {
  farmer_name: "",
  phone: "",
  town: "",
  barangay: "",
  private_pickup_label: "",
  private_pickup_lat: "",
  private_pickup_lng: "",
  intended_products: "",
  verification_method: "",
  identity_reference_last4: "",
  verification_note: "",
  verification_confirmed: false,
};

function formatDate(value: unknown): string {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
    : "-";
}

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function VerifiedFarmersAdminPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [farmers, setFarmers] = useState<VerifiedFarmer[]>([]);
  const [staffRole, setStaffRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);

  async function loadFarmers() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/admin/verified-farmers", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setFarmers([]);
      setStaffRole("");
      setError(payload?.message || payload?.error || "Unable to load staff-verified farmers.");
    } else {
      setFarmers(Array.isArray(payload?.farmers) ? payload.farmers : []);
      setStaffRole(String(payload?.staff_role || ""));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadFarmers();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setMessage("");
    setCredential(null);

    const response = await fetch("/api/agrimarket/admin/verified-farmers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        farmer_name: form.farmer_name,
        phone: form.phone,
        town: form.town,
        barangay: form.barangay || null,
        private_pickup_label: form.private_pickup_label,
        private_pickup_lat: form.private_pickup_lat,
        private_pickup_lng: form.private_pickup_lng,
        intended_products: form.intended_products,
        verification_method: form.verification_method,
        identity_reference_last4: form.identity_reference_last4 || null,
        verification_note: form.verification_note,
        verification_confirmed: form.verification_confirmed,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to create the verified farmer account.");
    } else {
      const oneTime = payload?.credential;
      setCredential({
        access_code: String(oneTime?.access_code || ""),
        temporary_pin: String(oneTime?.temporary_pin || ""),
        farmer_login_url: String(oneTime?.farmer_login_url || "/agrimarket/farmer"),
        farmer_name: form.farmer_name.trim(),
        application_code: String(payload?.result?.application_code || ""),
      });
      setMessage("Verified farmer created. Copy the Access Code and one-time PIN before leaving or refreshing this page.");
      setForm(EMPTY_FORM);
      await loadFarmers();
    }

    setSubmitting(false);
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setError("Copy failed. Select and copy the value manually.");
    }
  }

  function openMap(farmer: VerifiedFarmer) {
    window.open(
      `https://maps.google.com/?q=${encodeURIComponent(`${farmer.private_pickup_lat},${farmer.private_pickup_lng}`)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Admin</p>
            <h1 className="text-3xl font-bold">Add verified farmer</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Create Agrimarket access only after JRide has verified the farmer, mobile number, and private pickup pin offline.
              This does not open public farmer applications.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/control-center" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Control Center</Link>
            <button type="button" onClick={() => void loadFarmers()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button>
          </div>
        </div>

        {staffRole ? <p className="mt-3 text-xs text-slate-500">Authorized role: {staffRole}</p> : null}
        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        {credential ? (
          <section className="mt-5 rounded-3xl border-2 border-emerald-500 bg-emerald-50 p-5">
            <p className="text-xs font-bold uppercase tracking-widest text-emerald-800">One-time credential response</p>
            <h2 className="mt-1 text-2xl font-bold text-emerald-950">Copy before leaving this page</h2>
            <p className="mt-2 text-sm text-emerald-900">
              The PIN is stored only as a one-way hash. It cannot be retrieved after this response. Do not place the PIN in a QR code.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => void copy(credential.access_code)} className="rounded-2xl bg-white p-4 text-left shadow-sm">
                <span className="text-xs uppercase text-slate-500">Access Code</span>
                <strong className="mt-1 block text-xl">{credential.access_code}</strong>
                <span className="mt-1 block text-xs text-emerald-700">Tap to copy</span>
              </button>
              <button type="button" onClick={() => void copy(credential.temporary_pin)} className="rounded-2xl bg-white p-4 text-left shadow-sm">
                <span className="text-xs uppercase text-slate-500">Temporary 6-digit PIN</span>
                <strong className="mt-1 block text-xl">{credential.temporary_pin}</strong>
                <span className="mt-1 block text-xs text-emerald-700">Tap to copy</span>
              </button>
            </div>
            <div className="mt-4 rounded-2xl bg-white p-4 text-sm">
              <p><strong>Farmer:</strong> {credential.farmer_name}</p>
              <p className="mt-1"><strong>Audit code:</strong> {credential.application_code}</p>
              <p className="mt-1"><strong>Login:</strong> <Link href={credential.farmer_login_url} className="font-semibold text-emerald-700 underline">{credential.farmer_login_url}</Link></p>
            </div>
          </section>
        ) : null}

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <form onSubmit={submit} className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold sm:col-span-2">
                Farmer full name
                <input required value={form.farmer_name} onChange={(e) => update("farmer_name", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={120} autoComplete="name" />
              </label>

              <label className="text-sm font-semibold">
                Philippine mobile number
                <input required value={form.phone} onChange={(e) => update("phone", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="09XXXXXXXXX" inputMode="tel" maxLength={30} autoComplete="tel" />
              </label>

              <label className="text-sm font-semibold">
                Municipality
                <select required value={form.town} onChange={(e) => update("town", e.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-3">
                  <option value="">Select town</option>
                  <option value="Lagawe">Lagawe</option>
                  <option value="Hingyon">Hingyon</option>
                  <option value="Kiangan">Kiangan</option>
                  <option value="Banaue">Banaue</option>
                  <option value="Lamut">Lamut</option>
                </select>
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Barangay
                <input value={form.barangay} onChange={(e) => update("barangay", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={100} />
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Private pickup description
                <input required value={form.private_pickup_label} onChange={(e) => update("private_pickup_label", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="Farm/home description and landmark for the assigned driver" maxLength={180} />
                <span className="mt-1 block text-xs font-normal text-blue-700">Private. Never shown to customers.</span>
              </label>

              <label className="text-sm font-semibold">
                Exact pickup latitude
                <input required type="number" step="any" min="-90" max="90" value={form.private_pickup_lat} onChange={(e) => update("private_pickup_lat", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="16.800000" />
              </label>

              <label className="text-sm font-semibold">
                Exact pickup longitude
                <input required type="number" step="any" min="-180" max="180" value={form.private_pickup_lng} onChange={(e) => update("private_pickup_lng", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="121.100000" />
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Intended products
                <input required value={form.intended_products} onChange={(e) => update("intended_products", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="Native chicken, eggs, vegetables" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Separate products with commas. Maximum 20.</span>
              </label>

              <label className="text-sm font-semibold">
                Verification method or ID type
                <input required value={form.verification_method} onChange={(e) => update("verification_method", e.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="Personal verification, barangay certification, farmer ID" maxLength={80} />
              </label>

              <label className="text-sm font-semibold">
                Identity reference last 2 to 4 characters
                <input value={form.identity_reference_last4} onChange={(e) => update("identity_reference_last4", e.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={4} placeholder="Optional" />
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Verification note
                <textarea required value={form.verification_note} onChange={(e) => update("verification_note", e.target.value)} className="mt-1 min-h-28 w-full rounded-xl border px-3 py-3" maxLength={1000} placeholder="State who verified the farmer, what was checked, and how the private pickup pin was confirmed." />
              </label>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <input required type="checkbox" checked={form.verification_confirmed} onChange={(e) => update("verification_confirmed", e.target.checked)} className="mt-1 h-4 w-4" />
              <span>I confirm that JRide verified this farmer, mobile number, identity reference where applicable, and exact private pickup pin before account creation.</span>
            </label>

            <button disabled={submitting || staffRole !== "admin"} className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
              {submitting ? "Creating farmer access..." : "Create verified farmer access"}
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">Administrator only. No public application is created or opened for submission.</p>
          </form>

          <aside className="h-fit rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">Provisioning rules</h2>
            <ol className="mt-3 space-y-3 text-sm text-slate-700">
              <li><strong>1.</strong> Verify the real farmer and private pickup pin offline.</li>
              <li><strong>2.</strong> Create one farmer account only; duplicate mobile numbers are blocked.</li>
              <li><strong>3.</strong> Give the farmer the Access Code and temporary PIN directly.</li>
              <li><strong>4.</strong> Never place the PIN in a QR code or public message.</li>
              <li><strong>5.</strong> Use Applications and access to reset, suspend, reactivate, or revoke later.</li>
            </ol>
            <Link href="/admin/agrimarket/farmers" className="mt-5 inline-flex rounded-xl border px-4 py-2 text-sm font-semibold">Open access management</Link>
          </aside>
        </div>

        <section className="mt-6 rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">Staff-verified farmers</h2>
              <p className="mt-1 text-sm text-slate-600">Every row is linked to an approved application-format record and a staff audit event.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{farmers.length} record(s)</span>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-500">Loading verified farmers...</p> : null}
          {!loading && !farmers.length ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No staff-verified farmers yet.</p> : null}

          <div className="mt-4 space-y-3">
            {farmers.map((farmer) => (
              <article key={farmer.application_id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{farmer.application_code}</p>
                    <h3 className="mt-1 text-lg font-bold">{farmer.farmer_name}</h3>
                    <p className="text-sm text-slate-600">{farmer.phone} - {farmer.barangay ? `${farmer.barangay}, ` : ""}{farmer.town}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500">
                    <p>{titleCase(farmer.producer_status || "unknown")} farmer</p>
                    <p>{titleCase(farmer.credential_status || "unknown")} credential</p>
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Access Code</span><strong className="mt-1 block">{farmer.access_code || "-"}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Products</span><strong className="mt-1 block text-sm">{farmer.intended_products.join(", ") || "-"}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Provisioned by</span><strong className="mt-1 block text-sm">{farmer.provisioned_by || "-"}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Provisioned at</span><strong className="mt-1 block text-sm">{formatDate(farmer.provisioned_at)}</strong></div>
                </div>

                <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
                  <strong>Private pickup:</strong> {farmer.private_pickup_label}
                  <button type="button" onClick={() => openMap(farmer)} className="ml-2 font-semibold underline">Open map</button>
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  Verification: {farmer.verification_method || "-"}{farmer.identity_reference_last4 ? ` - reference ending ${farmer.identity_reference_last4}` : ""}.
                  Audit event: {farmer.audit_event ? `${farmer.audit_event.event_type} by ${farmer.audit_event.actor || "staff"} at ${formatDate(farmer.audit_event.created_at)}` : "missing"}.
                  Last farmer login: {farmer.credential_last_used_at ? formatDate(farmer.credential_last_used_at) : "Never"}.
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
