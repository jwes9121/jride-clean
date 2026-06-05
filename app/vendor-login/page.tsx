"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type Vendor = {
  id?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  display_name?: string | null;
  town?: string | null;
  phone?: string | null;
  status?: string | null;
};

const LS_VENDOR_ID = "JRIDE_VENDOR_PORTAL_VENDOR_ID";
const LEGACY_LS_VENDOR_ID = "jride_vendor_id";

function text(value: any): string {
  return String(value ?? "").trim();
}

function maskVendorId(id: string): string {
  const clean = text(id);
  if (clean.length <= 12) return clean || "-";
  return clean.slice(0, 8) + "..." + clean.slice(-6);
}

function vendorKey(v: Vendor): string {
  return text(v.vendor_id || v.id);
}

function vendorLabel(v: Vendor): string {
  const town = text(v.town);
  const name = text(v.vendor_name || v.display_name || vendorKey(v));
  return town ? `${name} - ${town}` : name;
}

export default function VendorLoginPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendorKey, setSelectedVendorKey] = useState("");
  const [typedVendorId, setTypedVendorId] = useState("");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function setSelectedVendor(nextVendorKey: string) {
    setSelectedVendorKey(text(nextVendorKey));
    setTypedVendorId("");
    setPin("");
    setError("");
    setMessage("Enter the vendor UUID and access code issued by JRide admin.");
  }

  const selectedVendor = useMemo(() => {
    return vendors.find((v) => vendorKey(v) === text(selectedVendorKey)) || null;
  }, [vendors, selectedVendorKey]);

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/vendor-login/verify", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Failed to load vendor access list.");
      }

      const list = Array.isArray(body?.vendors) ? body.vendors : [];
      setVendors(list);
      setSelectedVendorKey("");
      setTypedVendorId("");
      setPin("");
      setMessage("Vendor access list loaded.");
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendor access list."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  async function continueToPortal() {
    const selectedKey = text(selectedVendorKey);
    const id = text(typedVendorId);
    const accessPin = text(pin);

    if (!selectedKey) {
      setError("Select your vendor name first.");
      return;
    }
    if (!id) {
      setError("Enter your vendor UUID.");
      return;
    }
    if (!accessPin) {
      setError("Enter your vendor access code.");
      return;
    }

    setVerifying(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/vendor-login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_vendor_id: selectedKey, vendor_id: id, access_pin: accessPin }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Vendor access failed.");
      }

      const verifiedVendorId = text(body?.vendor?.vendor_id || body?.vendor_id || id);
      if (!verifiedVendorId) {
        throw new Error("Vendor access failed. Missing verified vendor ID.");
      }

      if (typeof window !== "undefined") {
        localStorage.setItem(LS_VENDOR_ID, verifiedVendorId);
        sessionStorage.setItem(LS_VENDOR_ID, verifiedVendorId);
        localStorage.setItem(LEGACY_LS_VENDOR_ID, verifiedVendorId);
        sessionStorage.setItem(LEGACY_LS_VENDOR_ID, verifiedVendorId);
        window.location.assign(`/vendor-portal?vendor_id=${encodeURIComponent(verifiedVendorId)}&source=vendor-login`);
      }
    } catch (e: any) {
      setError(String(e?.message || e || "Vendor access failed."));
    } finally {
      setVerifying(false);
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
                Select your vendor name, then enter the vendor UUID and access code issued by JRide admin.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={loadVendors} disabled={loading || verifying} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          {message ? <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
          {error ? <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

          <div className="mt-5 space-y-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Known vendor</span>
              <select value={selectedVendorKey} onChange={(e) => setSelectedVendor(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                <option value="">Select vendor</option>
                {vendors.map((vendor) => {
                  const id = vendorKey(vendor);
                  return <option key={id} value={id}>{vendorLabel(vendor)}</option>;
                })}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                Selecting a vendor does not reveal the UUID. Enter the UUID provided by JRide admin.
              </span>
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Vendor UUID</span>
              <input value={typedVendorId} onChange={(e) => setTypedVendorId(e.target.value)} placeholder="Enter vendor UUID" className="w-full rounded-lg border px-3 py-2" />
            </label>

            <label className="block text-sm">
              <span className="mb-1 block font-medium">Vendor access code</span>
              <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit access code" className="w-full rounded-lg border px-3 py-2" />
              <span className="mt-1 block text-xs text-slate-500">Use the access code issued by JRide admin during onboarding.</span>
            </label>

            {selectedVendor ? (
              <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                <div className="font-semibold">Selected vendor</div>
                <div className="mt-1 text-slate-700">{text(selectedVendor.vendor_name || selectedVendor.display_name) || "Vendor"}</div>
                <div className="text-xs text-slate-500">{text(selectedVendor.town) || "Town not set"}</div>
                <div className="mt-1 text-xs text-slate-500">UUID required: ask JRide admin if missing.</div>
              </div>
            ) : null}

            <button type="button" onClick={continueToPortal} disabled={verifying} className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
              {verifying ? "Verifying..." : "Continue to vendor portal"}
            </button>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 text-sm text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-900">Device access</div>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Each device must enter the vendor UUID and access code on first login.</li>
            <li>After successful login, that device remembers the verified vendor.</li>
            <li>The same vendor can log in on multiple devices if the owner shares the UUID and access code.</li>
            <li>Access can be recovered by JRide admin from the vendor onboarding registry.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
