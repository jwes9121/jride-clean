"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function fmt(value: unknown): string {
  const raw = clean(value);
  if (!raw) return "-";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return raw;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "long",
    day: "2-digit",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function violationLabel(value: unknown): string {
  const code = clean(value);
  if (!code) return "Vendor compliance violation";
  return code
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export default function VendorComplianceNotice() {
  const pathname = usePathname();
  const isVendorPortal = pathname.startsWith("/vendor-portal");
  const [status, setStatus] = useState<any>(null);
  const [loadError, setLoadError] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [acknowledging, setAcknowledging] = useState(false);

  const load = useCallback(async () => {
    if (!isVendorPortal) return;
    try {
      const response = await fetch("/api/vendor/compliance-state", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        if (response.status === 401) {
          setStatus(null);
          setLoadError("");
          return;
        }
        throw new Error(
          result?.message || result?.error || "Compliance status could not be loaded."
        );
      }
      setStatus(result);
      setLoadError("");
      if (result?.suspension?.acknowledgement_required === true) {
        setDetailsOpen(true);
      }
    } catch (error: any) {
      setLoadError(String(error?.message || error));
    }
  }, [isVendorPortal]);

  useEffect(() => {
    if (!isVendorPortal) {
      setStatus(null);
      setLoadError("");
      setDetailsOpen(false);
      return;
    }

    void load();
    const poll = window.setInterval(() => void load(), 30000);
    return () => window.clearInterval(poll);
  }, [isVendorPortal, load]);

  async function acknowledge() {
    const sanctionId = clean(status?.suspension?.sanction_id);
    if (!sanctionId || acknowledging) return;

    setAcknowledging(true);
    setLoadError("");
    try {
      const response = await fetch(
        "/api/vendor/compliance-state/acknowledge",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sanction_id: sanctionId }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        throw new Error(
          result?.message ||
            result?.error ||
            "The suspension notice could not be acknowledged."
        );
      }
      await load();
      setDetailsOpen(false);
    } catch (error: any) {
      setLoadError(String(error?.message || error));
    } finally {
      setAcknowledging(false);
    }
  }

  if (!isVendorPortal) return null;

  if (loadError && !status) {
    return (
      <div className="fixed left-3 right-3 top-3 z-[260] rounded-2xl border border-rose-300 bg-rose-50 p-4 text-sm font-semibold text-rose-900 shadow-xl">
        Vendor compliance status could not be verified: {loadError}
        <button
          type="button"
          onClick={() => void load()}
          className="ml-3 rounded-lg border border-rose-300 bg-white px-3 py-1 text-xs font-black"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!status) return null;

  const suspension = status?.suspension || null;
  const suspended = status?.suspended === true && Boolean(suspension);
  const acknowledgementRequired =
    suspension?.acknowledgement_required === true;
  const showDetails = suspended && (acknowledgementRequired || detailsOpen);

  return (
    <>
      {suspended ? (
        <div className="fixed left-3 right-3 top-3 z-[240] rounded-2xl border border-rose-300 bg-rose-700 p-4 text-white shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-100">
                Store suspended by JRide
              </div>
              <div className="mt-1 text-sm font-bold">
                New Takeout orders are disabled until {fmt(suspension.ends_at)}.
              </div>
              <div className="mt-1 text-xs leading-5 text-rose-50">
                Reason: {clean(suspension.message)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDetailsOpen(true)}
              className="rounded-xl border border-white/60 bg-white px-3 py-2 text-xs font-black text-rose-800"
            >
              View full notice
            </button>
          </div>
        </div>
      ) : status?.public_response_warning_active ? (
        <div className="fixed right-3 top-3 z-[220] w-[min(24rem,calc(100vw-1.5rem))] rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-xl">
          <div className="text-xs font-black uppercase tracking-wide">
            JRide response notice
          </div>
          <div className="mt-1 text-sm font-bold">
            A response warning is visible on your store listing.
          </div>
          <div className="mt-1 text-xs leading-5">
            {clean(status?.public_response_warning?.message) ||
              "Repeated expired Takeout orders"}
          </div>
          <div className="mt-1 text-[11px] text-amber-800">
            Notice ends: {fmt(status?.public_response_warning?.ends_at)}
          </div>
        </div>
      ) : null}

      {showDetails ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="vendor-suspension-title"
        >
          <section className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-3xl border border-rose-300 bg-white p-5 text-slate-950 shadow-2xl sm:p-6">
            <div className="text-xs font-black uppercase tracking-[0.18em] text-rose-700">
              JRide vendor suspension notice
            </div>
            <h2
              id="vendor-suspension-title"
              className="mt-1 text-2xl font-black"
            >
              New Takeout orders are temporarily disabled
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              JRide administration reviewed and applied this suspension. You can
              still access the vendor portal, order history, and existing
              records, but you cannot reopen the store or receive new Takeout
              orders while the suspension is active.
            </p>

            <div className="mt-4 space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm">
              <div>
                <div className="text-xs font-black uppercase tracking-wide text-rose-700">
                  Violation
                </div>
                <div className="mt-1 font-bold text-rose-950">
                  {violationLabel(suspension.violation_code)}
                </div>
                <div className="mt-1 leading-6 text-rose-900">
                  {clean(suspension.message)}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2 border-t border-rose-200 pt-3 text-xs sm:grid-cols-2">
                <div>
                  <span className="font-black">Starts:</span>{" "}
                  {fmt(suspension.starts_at)}
                </div>
                <div>
                  <span className="font-black">Ends:</span>{" "}
                  {fmt(suspension.ends_at)}
                </div>
                <div>
                  <span className="font-black">Reference:</span>{" "}
                  {clean(suspension.reference) || "-"}
                </div>
                <div>
                  <span className="font-black">Scope:</span> New orders only
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              Pending orders that were not yet accepted are cancelled. Orders
              accepted before the suspension may still be completed. When the
              suspension ends or is revoked, the store remains closed until you
              manually open it again.
            </div>

            {loadError ? (
              <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {loadError}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-md text-xs leading-5 text-slate-500">
                To question or correct this action, contact JRide administration
                and provide the suspension reference shown above.
              </p>
              {acknowledgementRequired ? (
                <button
                  type="button"
                  disabled={acknowledging || !clean(suspension.sanction_id)}
                  onClick={() => void acknowledge()}
                  className="rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white disabled:opacity-50"
                >
                  {acknowledging
                    ? "Recording acknowledgment..."
                    : "I acknowledge this notice"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setDetailsOpen(false)}
                  className="rounded-xl bg-slate-950 px-5 py-3 text-sm font-black text-white"
                >
                  Close notice
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
