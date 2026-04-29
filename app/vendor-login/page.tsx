"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type Vendor = {
  id?: string | null;
  email?: string | null;
  display_name?: string | null;
  created_at?: string | null;
};

const LS_VENDOR_ID = "JRIDE_VENDOR_PORTAL_VENDOR_ID";

function text(value: any): string {
  return String(value ?? "").trim();
}

function maskVendorId(id: string): string {
  const clean = text(id);
  if (clean.length <= 12) return clean || "-";
  return clean.slice(0, 8) + "..." + clean.slice(-6);
}

export default function VendorLoginPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedVendor = useMemo(() => {
    return vendors.find((v) => text(v.id) === text(vendorId)) || null;
  }, [vendors, vendorId]);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/vendors", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Failed to load vendor list.");
      }
      const list = Array.isArray(body?.vendors) ? body.vendors : [];
      setVendors(list);
      const saved = typeof window !== "undefined" ? localStorage.getItem(LS_VENDOR_ID) : "";
      if (saved) setVendorId(saved);
      else if (list.length > 0) setVendorId(text(list[0]?.id));
      setMessage("Vendor access list loaded.");
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendor list."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  function continueToPortal() {
    const id = text(vendorId);
    if (!id) {
      setError("Select or enter a vendor ID first.");
      return;
    }

    // This is a safe onboarding bridge only. It stores the selected vendor id in
    // localStorage so the existing Vendor Portal opens to that vendor. It does
    // not change backend auth, ride dispatch, fare, wallet, or lifecycle routes.
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_VENDOR_ID, id);
      window.location.href = "/vendor-portal";
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-4">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">JRide Takeout</div>
              <h1 className="text-2xl font-bold">Vendor Login</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                Vendor access bridge for onboarding. This page only selects the vendor portal context and does not call ride dispatch, fare proposal, wallet payout, or trip lifecycle routes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/vendor-portal" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Vendor portal</a>
              <button type="button" onClick={loadVendors} disabled={loading} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          {message ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
          {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Known vendor</span>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                <option value="">Select vendor</option>
                {vendors.map((vendor) => {
                  const id = text(vendor.id);
                  const label = text(vendor.display_name) || text(vendor.email) || maskVendorId(id);
                  return <option key={id} value={id}>{label}</option>;
                })}
              </select>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Vendor ID</span>
              <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="Paste vendor UUID" className="w-full rounded-lg border px-3 py-2" />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">PIN</span>
              <input value={pin} onChange={(e) => setPin(e.target.value)} inputMode="numeric" placeholder="Temporary onboarding PIN" className="w-full rounded-lg border px-3 py-2" />
              <span className="mt-1 block text-xs text-slate-500">PIN capture is UI-only in this bridge. Backend credential enforcement should be added after vendor records have official login fields.</span>
            </label>

            {selectedVendor ? (
              <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                <div className="font-semibold">Selected vendor</div>
                <div className="mt-1 text-slate-700">{text(selectedVendor.display_name) || "Vendor"}</div>
                <div className="text-xs text-slate-500">{text(selectedVendor.email) || "No email"}</div>
                <div className="mt-1 break-all text-xs text-slate-500">{text(selectedVendor.id)}</div>
              </div>
            ) : null}

            <button type="button" onClick={continueToPortal} className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800">
              Continue to vendor portal
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 text-sm text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-900">Safety scope</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Touches only the vendor login page.</li>
            <li>Uses the existing vendor list API for vendor selection.</li>
            <li>Stores only the selected vendor ID in browser localStorage.</li>
            <li>Does not call dispatch, assign, status, fare proposal, ride lifecycle, or payout routes.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
