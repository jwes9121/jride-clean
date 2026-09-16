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

function vendorKey(v: Vendor): string {
  return text(v.vendor_id || v.id);
}

function vendorLabel(v: Vendor): string {
  return text(v.vendor_name || v.display_name || vendorKey(v));
}

function townKey(value: any): string {
  return text(value).toLowerCase();
}

function readRememberedVendorId(): string {
  if (typeof window === "undefined") return "";

  try {
    return text(
      window.localStorage.getItem(LS_VENDOR_ID) ||
        window.sessionStorage.getItem(LS_VENDOR_ID) ||
        window.localStorage.getItem(LEGACY_LS_VENDOR_ID) ||
        window.sessionStorage.getItem(LEGACY_LS_VENDOR_ID) ||
        ""
    );
  } catch {
    return "";
  }
}

function persistVendorId(vendorId: string) {
  if (typeof window === "undefined") return;
  const id = text(vendorId);
  if (!id) return;

  try {
    window.localStorage.setItem(LS_VENDOR_ID, id);
    window.sessionStorage.setItem(LS_VENDOR_ID, id);
    window.localStorage.setItem(LEGACY_LS_VENDOR_ID, id);
    window.sessionStorage.setItem(LEGACY_LS_VENDOR_ID, id);
  } catch {
    // The signed HttpOnly cookie remains the authentication source of truth.
  }
}

export default function VendorLoginPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedTown, setSelectedTown] = useState("");
  const [selectedVendorKey, setSelectedVendorKey] = useState("");
  const [pin, setPin] = useState("");
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [verifying, setVerifying] = useState(false);
  const [message, setMessage] = useState("Checking saved vendor session...");
  const [error, setError] = useState("");

  const towns = useMemo(() => {
    const byKey = new Map<string, string>();

    for (const vendor of vendors) {
      const label = text(vendor.town);
      const key = townKey(label);

      if (key && !byKey.has(key)) {
        byKey.set(key, label);
      }
    }

    return Array.from(byKey.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label }));
  }, [vendors]);

  const vendorsForTown = useMemo(() => {
    const selectedTownKey = townKey(selectedTown);

    if (!selectedTownKey) {
      return [];
    }

    return vendors
      .filter((vendor) => townKey(vendor.town) === selectedTownKey)
      .sort((a, b) => vendorLabel(a).localeCompare(vendorLabel(b)));
  }, [vendors, selectedTown]);

  const selectedVendor = useMemo(() => {
    return vendors.find((vendor) => vendorKey(vendor) === text(selectedVendorKey)) || null;
  }, [vendors, selectedVendorKey]);

  function handleTownChange(nextTown: string) {
    setSelectedTown(text(nextTown));
    setSelectedVendorKey("");
    setPin("");
    setError("");
    setMessage(nextTown ? "Now select your vendor name." : "");
  }

  function handleVendorChange(nextVendorKey: string) {
    setSelectedVendorKey(text(nextVendorKey));
    setPin("");
    setError("");
    setMessage(
      text(nextVendorKey)
        ? "Enter your 6-digit vendor access code. No UUID is required."
        : "Select your vendor name."
    );
  }

  const loadVendors = useCallback(async () => {
    setLoading(true);
    setError("");
    setMessage("Checking saved vendor session...");

    try {
      const res = await fetch("/api/vendor-login/verify", {
        cache: "no-store",
        credentials: "same-origin",
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Failed to check vendor access.");
      }

      if (body?.authenticated === true) {
        const verifiedVendorId = text(body?.vendor?.vendor_id || body?.vendor_id);

        if (!verifiedVendorId) {
          throw new Error("Saved vendor session is missing its vendor ID.");
        }

        persistVendorId(verifiedVendorId);
        window.location.replace(
          `/vendor-portal?vendor_id=${encodeURIComponent(verifiedVendorId)}&source=vendor-session`
        );
        return;
      }

      const list = Array.isArray(body?.vendors) ? body.vendors : [];
      setVendors(list);
      setPin("");

      const rememberedVendorId = readRememberedVendorId();
      const rememberedVendor = list.find(
        (vendor: Vendor) => vendorKey(vendor) === rememberedVendorId
      );

      if (rememberedVendor) {
        setSelectedTown(text(rememberedVendor.town));
        setSelectedVendorKey(vendorKey(rememberedVendor));
        setMessage(
          "Your saved vendor was found, but the secure session needs renewal. Enter the 6-digit access code once."
        );
      } else {
        setSelectedTown("");
        setSelectedVendorKey("");
        setMessage("Select your town and vendor name, then enter the 6-digit access code.");
      }
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to check vendor access."));
      setMessage("");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadVendors();
  }, [loadVendors]);

  async function continueToPortal() {
    const selectedKey = text(selectedVendorKey);
    const accessPin = text(pin);

    if (!selectedTown) {
      setError("Select your town first.");
      return;
    }

    if (!selectedKey) {
      setError("Select your vendor name.");
      return;
    }

    if (!/^\d{6}$/.test(accessPin)) {
      setError("Enter your 6-digit vendor access code.");
      return;
    }

    setVerifying(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/vendor-login/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          selected_vendor_id: selectedKey,
          access_pin: accessPin,
          keep_signed_in: keepSignedIn,
        }),
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Vendor access failed.");
      }

      const verifiedVendorId = text(
        body?.vendor?.vendor_id || body?.vendor_id || selectedKey
      );

      if (!verifiedVendorId) {
        throw new Error("Vendor access failed. Missing verified vendor ID.");
      }

      persistVendorId(verifiedVendorId);
      window.location.replace(
        `/vendor-portal?vendor_id=${encodeURIComponent(verifiedVendorId)}&source=vendor-login`
      );
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
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">
                JRide Takeout
              </div>

              <h1 className="text-2xl font-bold">Vendor Login</h1>

              <p className="mt-1 max-w-2xl text-sm text-slate-600">
                A valid saved vendor session opens the portal automatically. If the secure session needs renewal, select your vendor and enter only the 6-digit access code.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadVendors}
                disabled={loading || verifying}
                className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {loading ? "Checking..." : "Refresh"}
              </button>
            </div>
          </div>

          {message ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {message}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}

          {!loading ? (
            <div className="mt-5 space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Town</span>

                <select
                  value={selectedTown}
                  onChange={(e) => handleTownChange(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 disabled:bg-slate-100"
                  disabled={verifying}
                >
                  <option value="">Select town</option>

                  {towns.map((town) => (
                    <option key={town.key} value={town.label}>
                      {town.label}
                    </option>
                  ))}
                </select>
              </label>

              {selectedTown ? (
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Vendor name</span>

                  <select
                    value={selectedVendorKey}
                    onChange={(e) => handleVendorChange(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 disabled:bg-slate-100"
                    disabled={verifying}
                  >
                    <option value="">Select vendor</option>

                    {vendorsForTown.map((vendor) => {
                      const id = vendorKey(vendor);

                      return (
                        <option key={id} value={id}>
                          {vendorLabel(vendor)}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : null}

              {selectedVendorKey ? (
                <>
                  <label className="block text-sm">
                    <span className="mb-1 block font-medium">Vendor access code</span>

                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6-digit access code"
                      className="w-full rounded-lg border px-3 py-2"
                    />

                    <span className="mt-1 block text-xs text-slate-500">
                      Use the access code issued by JRide admin. You no longer need to type the vendor UUID.
                    </span>
                  </label>

                  <label className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
                    <input
                      type="checkbox"
                      checked={keepSignedIn}
                      onChange={(e) => setKeepSignedIn(e.target.checked)}
                      disabled={verifying}
                      className="mt-1 h-4 w-4 shrink-0"
                    />
                    <span>
                      <span className="block font-semibold">
                        Keep me signed in on this device for up to 30 days
                      </span>
                      <span className="mt-1 block text-xs text-emerald-800">
                        Recommended for the store phone. Your PIN is used only to authenticate and is not saved on this device.
                      </span>
                    </span>
                  </label>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    <strong>Important:</strong> Keep your 6-digit vendor PIN in a safe place. A saved sign-in lasts up to 30 days and may need to be renewed afterward, after Sign Out, after clearing app data, or on another phone. JRide never saves your PIN on this device.
                    {!keepSignedIn ? (
                      <div className="mt-2 text-xs text-amber-800">
                        The 30-day sign-in is off. This login is not stored as a persistent 30-day session and its secure server session expires within 12 hours.
                      </div>
                    ) : null}
                  </div>

                  {selectedVendor ? (
                    <div className="rounded-xl border bg-slate-50 p-3 text-sm">
                      <div className="font-semibold">Selected vendor</div>
                      <div className="mt-1 text-slate-700">{vendorLabel(selectedVendor)}</div>
                      <div className="text-xs text-slate-500">
                        {text(selectedVendor.town) || "Town not set"}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}

              <button
                type="button"
                onClick={continueToPortal}
                disabled={verifying || !selectedVendorKey || pin.length !== 6}
                className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
              >
                {verifying ? "Verifying..." : "Continue to vendor portal"}
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border bg-white p-5 text-sm text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-900">Device access</div>

          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>A valid saved secure session opens the vendor portal automatically.</li>
            <li>Keep me signed in is enabled by default for the store phone and lasts up to 30 days.</li>
            <li>If the secure session expires or is cleared, choose the vendor and enter the 6-digit access code again.</li>
            <li>The long vendor UUID is no longer required on the login screen.</li>
            <li>JRide never stores the 6-digit PIN in local or session storage.</li>
            <li>Explicit Sign Out still clears access on that device.</li>
            <li>JRide can still disable vendor access from the onboarding registry.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
