"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import FarmerPickupMap, { FarmerPickupPin } from "./FarmerPickupMap";

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
  pickup_motorcycle_accessible?: boolean | null;
  pickup_tricycle_accessible?: boolean | null;
  pickup_roadside_handoff_required?: boolean | null;
  pickup_driver_directions?: string | null;
  intended_products: string[];
  verification_method?: string | null;
  identity_type?: string | null;
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
  latest_audit_event?: {
    id: number;
    event_type: string;
    actor?: string | null;
    created_at: string;
    details?: Record<string, unknown>;
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
  pickup_motorcycle_accessible: boolean;
  pickup_tricycle_accessible: boolean;
  pickup_roadside_handoff_required: boolean;
  pickup_driver_directions: string;
  intended_products: string;
  verification_method: string;
  identity_type: string;
  identity_reference_last4: string;
  verification_note: string;
  pin_confirmed: boolean;
  verification_confirmed: boolean;
};

type EditFormState = {
  producer_id: string;
  farmer_name: string;
  phone: string;
  town: string;
  barangay: string;
  private_pickup_label: string;
  pickup_motorcycle_accessible: boolean;
  pickup_tricycle_accessible: boolean;
  pickup_roadside_handoff_required: boolean;
  pickup_driver_directions: string;
  change_reason: string;
  pin_confirmed: boolean;
};

type PhoneCheck = {
  checking: boolean;
  checked: boolean;
  duplicate: boolean;
  normalized_phone: string;
  message: string;
};

const EMPTY_FORM: FormState = {
  farmer_name: "",
  phone: "",
  town: "",
  barangay: "",
  private_pickup_label: "",
  pickup_motorcycle_accessible: false,
  pickup_tricycle_accessible: false,
  pickup_roadside_handoff_required: false,
  pickup_driver_directions: "",
  intended_products: "",
  verification_method: "",
  identity_type: "",
  identity_reference_last4: "",
  verification_note: "",
  pin_confirmed: false,
  verification_confirmed: false,
};

const EMPTY_PIN: FarmerPickupPin = {
  lat: null,
  lng: null,
  resolved_town: null,
  resolved_barangay: null,
  resolved_label: null,
  launch_eligible: false,
  resolving: false,
};

const EMPTY_PHONE_CHECK: PhoneCheck = {
  checking: false,
  checked: false,
  duplicate: false,
  normalized_phone: "",
  message: "",
};

function formatDate(value: unknown): string {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";
}

function titleCase(value: unknown): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}


function farmerAccessSummary(farmer: VerifiedFarmer): string {
  const options = [
    farmer.pickup_motorcycle_accessible ? "motorcycle" : "",
    farmer.pickup_tricycle_accessible ? "tricycle" : "",
    farmer.pickup_roadside_handoff_required ? "roadside handoff" : "",
  ].filter(Boolean);
  return options.length ? options.join(", ") : "not recorded";
}

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export default function VerifiedFarmersAdminPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pin, setPin] = useState<FarmerPickupPin>(EMPTY_PIN);
  const [farmers, setFarmers] = useState<VerifiedFarmer[]>([]);
  const [staffRole, setStaffRole] = useState("");
  const [staffActor, setStaffActor] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [credential, setCredential] = useState<OneTimeCredential | null>(null);
  const [phoneCheck, setPhoneCheck] = useState<PhoneCheck>(EMPTY_PHONE_CHECK);
  const [readinessNotes, setReadinessNotes] = useState<Record<string, string>>({});
  const [readinessBusy, setReadinessBusy] = useState("");
  const [editForm, setEditForm] = useState<EditFormState | null>(null);
  const [editPin, setEditPin] = useState<FarmerPickupPin>(EMPTY_PIN);
  const [editBusy, setEditBusy] = useState(false);

  async function loadFarmers() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/admin/verified-farmers", {
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setFarmers([]);
      setStaffRole("");
      setStaffActor("");
      setError(payload?.message || payload?.error || "Unable to load staff-verified farmers.");
    } else {
      setFarmers(Array.isArray(payload?.farmers) ? payload.farmers : []);
      setStaffRole(String(payload?.staff_role || ""));
      setStaffActor(String(payload?.staff_actor || ""));
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadFarmers();
  }, []);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePhone(value: string) {
    update("phone", value);
    setPhoneCheck(EMPTY_PHONE_CHECK);
  }

  function updateTown(value: string) {
    setForm((current) => ({ ...current, town: value, pin_confirmed: false }));
  }

  function updatePin(value: FarmerPickupPin) {
    setPin(value);
    setForm((current) => ({
      ...current,
      town: current.town || (value.launch_eligible ? value.resolved_town || "" : ""),
      barangay: current.barangay || value.resolved_barangay || "",
      pin_confirmed: false,
    }));
  }

  async function checkPhone() {
    const normalized = normalizePhone(form.phone);
    if (!normalized) {
      setPhoneCheck({
        checking: false,
        checked: true,
        duplicate: false,
        normalized_phone: "",
        message: "Enter a valid Philippine mobile number before continuing.",
      });
      return;
    }

    setPhoneCheck({
      checking: true,
      checked: false,
      duplicate: false,
      normalized_phone: normalized,
      message: "Checking existing farmer records...",
    });

    try {
      const response = await fetch(
        `/api/agrimarket/admin/verified-farmers?phone=${encodeURIComponent(form.phone)}`,
        { cache: "no-store" }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setPhoneCheck({
          checking: false,
          checked: false,
          duplicate: false,
          normalized_phone: normalized,
          message: payload?.message || payload?.error || "Duplicate check failed.",
        });
        return;
      }

      const duplicate = payload?.duplicate === true;
      const application = Array.isArray(payload?.applications) ? payload.applications[0] : null;
      const producer = Array.isArray(payload?.producers) ? payload.producers[0] : null;
      setPhoneCheck({
        checking: false,
        checked: true,
        duplicate,
        normalized_phone: String(payload?.normalized_phone || normalized),
        message: duplicate
          ? `Existing farmer record found: ${application?.applicant_name || producer?.contact_name || "farmer"}${application?.town || producer?.town ? ` - ${application?.town || producer?.town}` : ""}. Open the existing record instead of creating another account.`
          : "No existing open or approved farmer record was found for this number.",
      });
    } catch {
      setPhoneCheck({
        checking: false,
        checked: false,
        duplicate: false,
        normalized_phone: normalized,
        message: "Duplicate check is unavailable. Account creation remains blocked until it succeeds.",
      });
    }
  }

  const missingRequirements = useMemo(() => {
    const missing: string[] = [];
    if (form.farmer_name.trim().length < 2) missing.push("farmer full name");
    if (!normalizePhone(form.phone)) missing.push("valid Philippine mobile number");
    if (!phoneCheck.checked || phoneCheck.normalized_phone !== normalizePhone(form.phone)) {
      missing.push("successful duplicate-number check");
    }
    if (phoneCheck.duplicate) missing.push("a mobile number without an existing farmer record");
    if (!form.town) missing.push("municipality");
    if (pin.lat == null || pin.lng == null) missing.push("pickup pin on the map");
    if (pin.resolving) missing.push("completed map verification");
    if (!pin.launch_eligible || !pin.resolved_town) missing.push("pin inside a launch municipality");
    if (pin.resolved_town && form.town !== pin.resolved_town) missing.push("selected municipality matching the map pin");
    if (!form.pin_confirmed) missing.push("explicit pickup-pin confirmation");
    if (form.private_pickup_label.trim().length < 2) missing.push("recognizable pickup description");
    if (
      !form.pickup_motorcycle_accessible &&
      !form.pickup_tricycle_accessible &&
      !form.pickup_roadside_handoff_required
    ) {
      missing.push("driver-access option");
    }
    if (form.pickup_driver_directions.trim().length < 5) missing.push("private driver directions");
    if (!form.intended_products.trim()) missing.push("intended products");
    if (!form.verification_method) missing.push("verification method");
    if (form.identity_reference_last4.trim() && !form.identity_type) missing.push("identity document type");
    if (form.verification_note.trim().length < 5) missing.push("verification note");
    if (!form.verification_confirmed) missing.push("staff verification confirmation");
    return missing;
  }, [form, phoneCheck, pin]);

  const formReady =
    staffRole === "admin" &&
    !submitting &&
    !phoneCheck.checking &&
    missingRequirements.length === 0;

  const editMissingRequirements = useMemo(() => {
    if (!editForm) return [] as string[];
    const missing: string[] = [];
    if (editForm.farmer_name.trim().length < 2) missing.push("farmer full name");
    if (!normalizePhone(editForm.phone)) missing.push("valid Philippine mobile number");
    if (!editForm.town) missing.push("municipality");
    if (editPin.lat == null || editPin.lng == null) missing.push("corrected pickup pin");
    if (editPin.resolving) missing.push("completed map verification");
    if (!editPin.launch_eligible || !editPin.resolved_town) missing.push("pin inside a launch municipality");
    if (editPin.resolved_town && editForm.town !== editPin.resolved_town) missing.push("municipality matching the map pin");
    if (!editForm.pin_confirmed) missing.push("corrected pickup-pin confirmation");
    if (editForm.private_pickup_label.trim().length < 2) missing.push("pickup description");
    if (!editForm.pickup_motorcycle_accessible && !editForm.pickup_tricycle_accessible && !editForm.pickup_roadside_handoff_required) missing.push("driver-access option");
    if (editForm.pickup_driver_directions.trim().length < 5) missing.push("private driver directions");
    if (editForm.change_reason.trim().length < 5) missing.push("audit reason");
    return missing;
  }, [editForm, editPin]);

  const editReady = Boolean(editForm) && !editBusy && editMissingRequirements.length === 0;

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!formReady) {
      setError(`Complete these requirements first: ${missingRequirements.join(", ")}.`);
      return;
    }
    setReviewOpen(true);
  }

  async function createFarmer() {
    if (!formReady || pin.lat == null || pin.lng == null) return;
    setSubmitting(true);
    setError("");
    setMessage("");
    setCredential(null);

    const response = await fetch("/api/agrimarket/admin/verified-farmers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "create",
        farmer_name: form.farmer_name,
        phone: form.phone,
        town: form.town,
        barangay: form.barangay || pin.resolved_barangay || null,
        private_pickup_label: form.private_pickup_label,
        private_pickup_lat: pin.lat,
        private_pickup_lng: pin.lng,
        pickup_motorcycle_accessible: form.pickup_motorcycle_accessible,
        pickup_tricycle_accessible: form.pickup_tricycle_accessible,
        pickup_roadside_handoff_required: form.pickup_roadside_handoff_required,
        pickup_driver_directions: form.pickup_driver_directions,
        intended_products: form.intended_products,
        verification_method: form.verification_method,
        identity_type: form.identity_type || null,
        identity_reference_last4: form.identity_reference_last4 || null,
        verification_note: form.verification_note,
        pin_confirmed: form.pin_confirmed,
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
      setMessage("Verified farmer access created in setup mode. Orders remain blocked until the farmer has an active product and an administrator marks the account ready.");
      setForm(EMPTY_FORM);
      setPin(EMPTY_PIN);
      setPhoneCheck(EMPTY_PHONE_CHECK);
      setReviewOpen(false);
      await loadFarmers();
    }

    setSubmitting(false);
  }

  async function setReadiness(farmer: VerifiedFarmer, ready: boolean) {
    if (!farmer.producer_id) return;
    const note = String(readinessNotes[farmer.producer_id] || "").trim();
    if (note.length < 5) {
      setError("Enter a readiness note of at least 5 characters before changing order availability.");
      return;
    }

    setReadinessBusy(farmer.producer_id);
    setError("");
    setMessage("");
    const response = await fetch("/api/agrimarket/admin/verified-farmers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "set_readiness",
        producer_id: farmer.producer_id,
        ready,
        note,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update farmer readiness.");
    } else {
      setReadinessNotes((current) => ({ ...current, [farmer.producer_id as string]: "" }));
      setMessage(ready ? "Farmer marked ready for orders." : "New orders paused for this farmer.");
      await loadFarmers();
    }
    setReadinessBusy("");
  }

  function startProfileEdit(farmer: VerifiedFarmer) {
    if (!farmer.producer_id) {
      setError("This farmer record is missing its producer ID and cannot be edited.");
      return;
    }
    setError("");
    setMessage("");
    setEditForm({
      producer_id: farmer.producer_id,
      farmer_name: farmer.farmer_name,
      phone: farmer.phone,
      town: farmer.town,
      barangay: farmer.barangay || "",
      private_pickup_label: farmer.private_pickup_label,
      pickup_motorcycle_accessible: farmer.pickup_motorcycle_accessible === true,
      pickup_tricycle_accessible: farmer.pickup_tricycle_accessible === true,
      pickup_roadside_handoff_required: farmer.pickup_roadside_handoff_required === true,
      pickup_driver_directions: farmer.pickup_driver_directions || "",
      change_reason: "",
      pin_confirmed: false,
    });
    setEditPin({
      lat: Number.isFinite(Number(farmer.private_pickup_lat)) ? Number(farmer.private_pickup_lat) : null,
      lng: Number.isFinite(Number(farmer.private_pickup_lng)) ? Number(farmer.private_pickup_lng) : null,
      resolved_town: farmer.town || null,
      resolved_barangay: farmer.barangay || null,
      resolved_label: farmer.private_pickup_label || null,
      launch_eligible: Boolean(farmer.town),
      resolving: false,
    });
  }

  function updateEdit<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setEditForm((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateEditTown(value: string) {
    setEditForm((current) => (current ? { ...current, town: value, pin_confirmed: false } : current));
  }

  function updateEditPin(value: FarmerPickupPin) {
    setEditPin(value);
    setEditForm((current) =>
      current
        ? {
            ...current,
            town: current.town || (value.launch_eligible ? value.resolved_town || "" : ""),
            barangay: current.barangay || value.resolved_barangay || "",
            pin_confirmed: false,
          }
        : current
    );
  }

  async function saveProfileEdit() {
    if (!editForm || !editReady || editPin.lat == null || editPin.lng == null) return;
    setEditBusy(true);
    setError("");
    setMessage("");

    const response = await fetch("/api/agrimarket/admin/verified-farmers", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        action: "update_profile",
        producer_id: editForm.producer_id,
        farmer_name: editForm.farmer_name,
        phone: editForm.phone,
        town: editForm.town,
        barangay: editForm.barangay || editPin.resolved_barangay || null,
        private_pickup_label: editForm.private_pickup_label,
        private_pickup_lat: editPin.lat,
        private_pickup_lng: editPin.lng,
        pickup_motorcycle_accessible: editForm.pickup_motorcycle_accessible,
        pickup_tricycle_accessible: editForm.pickup_tricycle_accessible,
        pickup_roadside_handoff_required: editForm.pickup_roadside_handoff_required,
        pickup_driver_directions: editForm.pickup_driver_directions,
        change_reason: editForm.change_reason,
        pin_confirmed: editForm.pin_confirmed,
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to save the audited farmer correction.");
    } else {
      const ordersPaused = payload?.result?.orders_paused === true;
      setMessage(
        ordersPaused
          ? "Farmer information updated and new orders were paused because the pickup location or access changed. Reapprove readiness after checking the correction."
          : "Farmer information updated and the correction was added to the audit history."
      );
      setEditForm(null);
      setEditPin(EMPTY_PIN);
      await loadFarmers();
    }
    setEditBusy(false);
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
    <main className="min-h-screen bg-slate-50 px-3 pb-10 pt-10 text-slate-900 sm:px-5 sm:pt-12">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Admin</p>
            <h1 className="text-3xl font-bold">Add verified farmer</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Pin the exact private pickup point, verify the municipality, review all details, then issue one-time farmer credentials. A new account starts in setup mode and cannot receive orders yet.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/control-center" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Control Center</Link>
            <button type="button" onClick={() => void loadFarmers()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border bg-white p-4 text-sm">
          <p><strong>Creating as:</strong> {staffActor || "Checking administrator session..."}</p>
          <p className="mt-1 text-xs text-slate-500">Authorized role: {staffRole || "checking"}. Dispatchers cannot provision farmer accounts.</p>
        </div>

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
              <p className="mt-2 font-semibold text-amber-800">Orders are blocked until product setup is complete and an administrator marks the farmer ready.</p>
            </div>
          </section>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]">
          <form onSubmit={review} className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold sm:col-span-2">
                Farmer full name
                <input required value={form.farmer_name} onChange={(event) => update("farmer_name", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={120} autoComplete="name" />
              </label>

              <label className="text-sm font-semibold">
                Philippine mobile number
                <input required value={form.phone} onChange={(event) => updatePhone(event.target.value)} onBlur={() => void checkPhone()} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="09XXXXXXXXX" inputMode="tel" maxLength={30} autoComplete="tel" />
              </label>

              <div className="self-end">
                <button type="button" onClick={() => void checkPhone()} disabled={phoneCheck.checking || !form.phone.trim()} className="w-full rounded-xl border px-4 py-3 text-sm font-semibold disabled:text-slate-400">
                  {phoneCheck.checking ? "Checking..." : "Check existing farmer"}
                </button>
              </div>

              {phoneCheck.message ? (
                <div className={`rounded-xl p-3 text-sm sm:col-span-2 ${phoneCheck.duplicate ? "bg-red-50 text-red-800" : phoneCheck.checked ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>
                  {phoneCheck.message}
                </div>
              ) : null}

              <label className="text-sm font-semibold">
                Municipality
                <select required value={form.town} onChange={(event) => updateTown(event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-3">
                  <option value="">Select town</option>
                  <option value="Lagawe">Lagawe</option>
                  <option value="Hingyon">Hingyon</option>
                  <option value="Kiangan">Kiangan</option>
                  <option value="Banaue">Banaue</option>
                  <option value="Lamut">Lamut</option>
                </select>
              </label>

              <label className="text-sm font-semibold">
                Barangay
                <input value={form.barangay} onChange={(event) => update("barangay", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={100} placeholder="Filled from the pin when available" />
              </label>

              <FarmerPickupMap selectedTown={form.town} value={pin} onChange={updatePin} />

              <label className={`flex items-start gap-3 rounded-2xl border p-4 text-sm sm:col-span-2 ${pin.resolved_town === form.town && pin.launch_eligible ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                <input
                  type="checkbox"
                  disabled={pin.resolving || !pin.launch_eligible || !pin.resolved_town || pin.resolved_town !== form.town}
                  checked={form.pin_confirmed}
                  onChange={(event) => update("pin_confirmed", event.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>I checked the map and confirm this is the exact private pickup point and its resolved municipality matches the selected farmer municipality.</span>
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Private pickup description or nearest landmark
                <textarea required value={form.private_pickup_label} onChange={(event) => update("private_pickup_label", event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border px-3 py-3" placeholder="Farm/home description and landmark recognizable to the assigned driver" maxLength={180} />
                <span className="mt-1 block text-xs font-normal text-blue-700">Private. Never shown to customers.</span>
              </label>

              <fieldset className="rounded-2xl border p-4 sm:col-span-2">
                <legend className="px-2 text-sm font-bold">Road and vehicle access</legend>
                <p className="text-xs text-slate-500">Select every true option. Do not guess; verify the actual road and turnaround space.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                    <input type="checkbox" checked={form.pickup_motorcycle_accessible} onChange={(event) => update("pickup_motorcycle_accessible", event.target.checked)} className="mt-1" />
                    <span>Motorcycle can reach the pinned point</span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                    <input type="checkbox" checked={form.pickup_tricycle_accessible} onChange={(event) => update("pickup_tricycle_accessible", event.target.checked)} className="mt-1" />
                    <span>Tricycle can reach and safely stop</span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                    <input type="checkbox" checked={form.pickup_roadside_handoff_required} onChange={(event) => update("pickup_roadside_handoff_required", event.target.checked)} className="mt-1" />
                    <span>Roadside meeting or handoff is required</span>
                  </label>
                </div>
              </fieldset>

              <label className="text-sm font-semibold sm:col-span-2">
                Private driver directions and road limitations
                <textarea required value={form.pickup_driver_directions} onChange={(event) => update("pickup_driver_directions", event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border px-3 py-3" maxLength={1000} placeholder="Describe the road, landmark, turn, steep or narrow section, bridge, gate, and roadside meeting point if needed." />
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Intended products
                <input required value={form.intended_products} onChange={(event) => update("intended_products", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="Native chicken, eggs, vegetables" />
                <span className="mt-1 block text-xs font-normal text-slate-500">Separate products with commas. Maximum 20. Detailed listings are created later in the farmer portal.</span>
              </label>

              <label className="text-sm font-semibold">
                Verification method
                <select required value={form.verification_method} onChange={(event) => update("verification_method", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-3">
                  <option value="">Select method</option>
                  <option value="Personal verification">Personal verification</option>
                  <option value="Barangay endorsement">Barangay endorsement</option>
                  <option value="Farmer organization endorsement">Farmer organization endorsement</option>
                  <option value="Existing JRide member verification">Existing JRide member verification</option>
                  <option value="Other documented verification">Other documented verification</option>
                </select>
              </label>

              <label className="text-sm font-semibold">
                Identity document type, optional
                <select value={form.identity_type} onChange={(event) => update("identity_type", event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-3">
                  <option value="">No document recorded</option>
                  <option value="National ID">National ID</option>
                  <option value="Driver's license">Driver's license</option>
                  <option value="Barangay ID or certification">Barangay ID or certification</option>
                  <option value="Farmer ID">Farmer ID</option>
                  <option value="Other identity document">Other identity document</option>
                </select>
              </label>

              {form.identity_type ? (
                <label className="text-sm font-semibold sm:col-span-2">
                  Identity reference last 2 to 4 characters
                  <input value={form.identity_reference_last4} onChange={(event) => update("identity_reference_last4", event.target.value.toUpperCase())} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={4} placeholder="Never enter the full ID number" />
                </label>
              ) : null}

              <label className="text-sm font-semibold sm:col-span-2">
                Verification note
                <textarea required value={form.verification_note} onChange={(event) => update("verification_note", event.target.value)} className="mt-1 min-h-28 w-full rounded-xl border px-3 py-3" maxLength={1000} placeholder="State who verified the farmer, what was checked, and how the exact private pickup pin and road access were confirmed." />
              </label>
            </div>

            <label className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
              <input required type="checkbox" checked={form.verification_confirmed} onChange={(event) => update("verification_confirmed", event.target.checked)} className="mt-1 h-4 w-4" />
              <span>I confirm that JRide verified this farmer, mobile number, identity reference where applicable, exact private pickup pin, and road access before account creation.</span>
            </label>

            {missingRequirements.length ? (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                <strong>Still required:</strong> {missingRequirements.join(", ")}.
              </div>
            ) : (
              <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">All required checks are complete. Review the record before creating access.</div>
            )}

            <button disabled={!formReady} className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
              Review farmer details
            </button>
            <p className="mt-2 text-center text-xs text-slate-500">No account is created until you approve the final review screen.</p>
          </form>

          <aside className="h-fit rounded-3xl border bg-white p-5 shadow-sm xl:sticky xl:top-5">
            <h2 className="text-lg font-bold">Provisioning rules</h2>
            <ol className="mt-3 space-y-3 text-sm text-slate-700">
              <li><strong>1.</strong> Check the mobile number for an existing account.</li>
              <li><strong>2.</strong> Pin the road-accessible pickup point and wait for town verification.</li>
              <li><strong>3.</strong> Record real vehicle access and private driver directions.</li>
              <li><strong>4.</strong> Review the complete record before creating access.</li>
              <li><strong>5.</strong> Give the Access Code and PIN directly to the farmer.</li>
              <li><strong>6.</strong> Keep orders blocked until product setup is reviewed.</li>
            </ol>
            <Link href="/admin/agrimarket/farmers" className="mt-5 inline-flex rounded-xl border px-4 py-2 text-sm font-semibold">Open access management</Link>
          </aside>
        </div>

        <section className="mt-6 rounded-3xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-xl font-bold">Staff-verified farmers</h2>
              <p className="mt-1 text-sm text-slate-600">New farmers stay in setup mode until they have an active product and an administrator approves order readiness.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{farmers.length} record(s)</span>
          </div>

          {loading ? <p className="mt-4 text-sm text-slate-500">Loading verified farmers...</p> : null}
          {!loading && !farmers.length ? <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No staff-verified farmers yet.</p> : null}

          <div className="mt-4 space-y-4">
            {farmers.map((farmer) => (
              <article key={farmer.application_id} className="rounded-2xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{farmer.application_code}</p>
                    <h3 className="mt-1 text-lg font-bold">{farmer.farmer_name}</h3>
                    <p className="text-sm text-slate-600">{farmer.phone} - {farmer.barangay ? `${farmer.barangay}, ` : ""}{farmer.town}</p>
                  </div>
                  <div className={`rounded-full px-3 py-1 text-xs font-bold ${farmer.accepting_orders ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>
                    {farmer.accepting_orders ? "Ready for orders" : "Setup mode - orders blocked"}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Access Code</span><strong className="mt-1 block">{farmer.access_code || "-"}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Products planned</span><strong className="mt-1 block text-sm">{farmer.intended_products.join(", ") || "-"}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Provisioned by</span><strong className="mt-1 block text-sm">{farmer.provisioned_by || "-"}</strong></div>
                  <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Provisioned at</span><strong className="mt-1 block text-sm">{formatDate(farmer.provisioned_at)}</strong></div>
                </div>

                <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
                  <strong>Private pickup:</strong> {farmer.private_pickup_label}
                  <button type="button" onClick={() => openMap(farmer)} className="ml-2 font-semibold underline">Open map</button>
                  <button type="button" onClick={() => startProfileEdit(farmer)} className="ml-3 font-semibold underline">Edit farmer and pickup</button>
                  {farmer.pickup_driver_directions ? <p className="mt-2 text-xs">Driver directions: {farmer.pickup_driver_directions}</p> : null}
                  <p className="mt-2 text-xs">
                    Access: {farmerAccessSummary(farmer)}
                  </p>
                </div>

                <div className="mt-3 rounded-xl border p-3">
                  <label className="text-xs font-semibold text-slate-600">
                    Readiness audit note
                    <input value={farmer.producer_id ? readinessNotes[farmer.producer_id] || "" : ""} onChange={(event) => farmer.producer_id && setReadinessNotes((current) => ({ ...current, [farmer.producer_id as string]: event.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" maxLength={500} placeholder={farmer.accepting_orders ? "Why are new orders being paused?" : "Confirm product, stock, pickup pin, and farmer training checks"} />
                  </label>
                  <button
                    type="button"
                    disabled={!farmer.producer_id || readinessBusy === farmer.producer_id}
                    onClick={() => void setReadiness(farmer, !farmer.accepting_orders)}
                    className={`mt-2 rounded-xl px-4 py-2 text-sm font-bold text-white disabled:bg-slate-400 ${farmer.accepting_orders ? "bg-amber-700" : "bg-emerald-700"}`}
                  >
                    {readinessBusy === farmer.producer_id
                      ? "Updating..."
                      : farmer.accepting_orders
                        ? "Pause new orders"
                        : "Mark ready for orders"}
                  </button>
                  {!farmer.accepting_orders ? <p className="mt-2 text-xs text-slate-500">The database will reject readiness until at least one active product has available quantity.</p> : null}
                </div>

                <p className="mt-3 text-xs text-slate-500">
                  Verification: {farmer.verification_method || "-"}{farmer.identity_type ? `; document: ${farmer.identity_type}` : ""}{farmer.identity_reference_last4 ? ` ending ${farmer.identity_reference_last4}` : ""}.
                  Latest audit event: {farmer.latest_audit_event ? `${titleCase(farmer.latest_audit_event.event_type)} by ${farmer.latest_audit_event.actor || "staff"} at ${formatDate(farmer.latest_audit_event.created_at)}` : "missing"}.
                  Last farmer login: {farmer.credential_last_used_at ? formatDate(farmer.credential_last_used_at) : "Never"}.
                </p>
              </article>
            ))}
          </div>
        </section>
      </div>

      {reviewOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">Final review</p>
                <h2 className="mt-1 text-2xl font-bold">Create this farmer account?</h2>
                <p className="mt-1 text-sm text-slate-600">This creates a permanent producer record and one-time credential. Orders remain blocked.</p>
              </div>
              <button type="button" onClick={() => setReviewOpen(false)} className="rounded-xl border px-3 py-2 text-sm font-semibold">Close</button>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Farmer</span><strong className="mt-1 block">{form.farmer_name}</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Mobile</span><strong className="mt-1 block">{form.phone}</strong><span className="text-xs text-slate-500">{phoneCheck.normalized_phone}</span></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Municipality / barangay</span><strong className="mt-1 block">{form.barangay ? `${form.barangay}, ` : ""}{form.town}</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Map verification</span><strong className="mt-1 block">{pin.resolved_town === form.town ? "Town match verified" : "Mismatch"}</strong><span className="font-mono text-xs">{pin.lat?.toFixed(6)}, {pin.lng?.toFixed(6)}</span></div>
              <div className="rounded-xl bg-blue-50 p-3 sm:col-span-2"><span className="text-xs text-blue-700">Private pickup</span><strong className="mt-1 block text-blue-950">{form.private_pickup_label}</strong><p className="mt-1 text-xs text-blue-900">{form.pickup_driver_directions}</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Road access</span><strong className="mt-1 block text-sm">{[form.pickup_motorcycle_accessible ? "Motorcycle" : "", form.pickup_tricycle_accessible ? "Tricycle" : "", form.pickup_roadside_handoff_required ? "Roadside handoff" : ""].filter(Boolean).join(", ")}</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Intended products</span><strong className="mt-1 block text-sm">{form.intended_products}</strong></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Verification</span><strong className="mt-1 block text-sm">{form.verification_method}</strong><span className="text-xs text-slate-500">{form.identity_type || "No identity document recorded"}</span></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-xs text-slate-500">Creating as</span><strong className="mt-1 block text-sm">{staffActor}</strong></div>
            </div>

            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">
              <strong>Safety state after creation:</strong> the farmer can receive credentials, but `accepting_orders` remains false until product setup and admin readiness approval are complete.
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setReviewOpen(false)} disabled={submitting} className="rounded-xl border px-5 py-3 font-bold">Go back and edit</button>
              <button type="button" onClick={() => void createFarmer()} disabled={submitting || !formReady} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
                {submitting ? "Creating farmer access..." : "Confirm and create access"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {editForm ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
          <section className="max-h-[94vh] w-full max-w-4xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-3xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-blue-700">Audited correction</p>
                <h2 className="mt-1 text-2xl font-bold">Edit farmer and private pickup</h2>
                <p className="mt-1 text-sm text-slate-600">Every change is recorded. A pickup-location or road-access change automatically pauses new orders.</p>
              </div>
              <button type="button" onClick={() => !editBusy && setEditForm(null)} disabled={editBusy} className="rounded-xl border px-3 py-2 text-sm font-semibold">Close</button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold sm:col-span-2">
                Farmer full name
                <input required value={editForm.farmer_name} onChange={(event) => updateEdit("farmer_name", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={120} />
              </label>
              <label className="text-sm font-semibold">
                Philippine mobile number
                <input required value={editForm.phone} onChange={(event) => updateEdit("phone", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" inputMode="tel" maxLength={30} />
              </label>
              <label className="text-sm font-semibold">
                Municipality
                <select required value={editForm.town} onChange={(event) => updateEditTown(event.target.value)} className="mt-1 w-full rounded-xl border bg-white px-3 py-3">
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
                <input value={editForm.barangay} onChange={(event) => updateEdit("barangay", event.target.value)} className="mt-1 w-full rounded-xl border px-3 py-3" maxLength={100} />
              </label>

              <FarmerPickupMap selectedTown={editForm.town} value={editPin} onChange={updateEditPin} />

              <label className={`flex items-start gap-3 rounded-2xl border p-4 text-sm sm:col-span-2 ${editPin.resolved_town === editForm.town && editPin.launch_eligible ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                <input
                  type="checkbox"
                  disabled={editPin.resolving || !editPin.launch_eligible || !editPin.resolved_town || editPin.resolved_town !== editForm.town}
                  checked={editForm.pin_confirmed}
                  onChange={(event) => updateEdit("pin_confirmed", event.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>I checked the corrected map pin and confirm that it is the exact private pickup point and matches the selected municipality.</span>
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Private pickup description or nearest landmark
                <textarea required value={editForm.private_pickup_label} onChange={(event) => updateEdit("private_pickup_label", event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border px-3 py-3" maxLength={180} />
              </label>

              <fieldset className="rounded-2xl border p-4 sm:col-span-2">
                <legend className="px-2 text-sm font-bold">Road and vehicle access</legend>
                <div className="mt-2 grid gap-3 sm:grid-cols-3">
                  <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                    <input type="checkbox" checked={editForm.pickup_motorcycle_accessible} onChange={(event) => updateEdit("pickup_motorcycle_accessible", event.target.checked)} className="mt-1" />
                    <span>Motorcycle can reach the pin</span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-sm">
                    <input type="checkbox" checked={editForm.pickup_tricycle_accessible} onChange={(event) => updateEdit("pickup_tricycle_accessible", event.target.checked)} className="mt-1" />
                    <span>Tricycle can reach and stop safely</span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                    <input type="checkbox" checked={editForm.pickup_roadside_handoff_required} onChange={(event) => updateEdit("pickup_roadside_handoff_required", event.target.checked)} className="mt-1" />
                    <span>Roadside handoff is required</span>
                  </label>
                </div>
              </fieldset>

              <label className="text-sm font-semibold sm:col-span-2">
                Private driver directions and road limitations
                <textarea required value={editForm.pickup_driver_directions} onChange={(event) => updateEdit("pickup_driver_directions", event.target.value)} className="mt-1 min-h-24 w-full rounded-xl border px-3 py-3" maxLength={1000} />
              </label>

              <label className="text-sm font-semibold sm:col-span-2">
                Reason for correction
                <textarea required value={editForm.change_reason} onChange={(event) => updateEdit("change_reason", event.target.value)} className="mt-1 min-h-20 w-full rounded-xl border px-3 py-3" maxLength={500} placeholder="Explain what changed, who verified it, and why the stored record must be corrected." />
              </label>
            </div>

            {editMissingRequirements.length ? (
              <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700"><strong>Still required:</strong> {editMissingRequirements.join(", ")}.</div>
            ) : (
              <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">Correction is ready to save with an audit event.</div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={() => setEditForm(null)} disabled={editBusy} className="rounded-xl border px-5 py-3 font-bold">Cancel</button>
              <button type="button" onClick={() => void saveProfileEdit()} disabled={!editReady} className="rounded-xl bg-blue-800 px-5 py-3 font-bold text-white disabled:bg-slate-400">
                {editBusy ? "Saving audited correction..." : "Save audited correction"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

    </main>
  );
}
