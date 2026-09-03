"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

const LS_VENDOR_ID = "JRIDE_VENDOR_PORTAL_VENDOR_ID";
const LEGACY_LS_VENDOR_ID = "jride_vendor_id";
const JRIDE_SUPPORT_EMAIL = "info@jride.net";

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
  const code = clean(value).toUpperCase();
  if (code === "REPEATED_ORDER_TIMEOUTS") {
    return "3 accumulated unanswered or expired Takeout orders";
  }
  if (code === "REPEATED_UNEXCUSED_OFFLINE_DAYS") {
    return "3 consecutive operating days without manually opening the store";
  }
  if (!code) return "Vendor compliance violation";
  return code
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function readPortalVendorId(): string {
  if (typeof window === "undefined") return "";

  let queryVendorId = "";
  try {
    const params = new URLSearchParams(window.location.search);
    queryVendorId = clean(
      params.get("vendor_id") || params.get("vendorId") || ""
    );
  } catch {
    queryVendorId = "";
  }

  try {
    return clean(
      window.sessionStorage.getItem(LS_VENDOR_ID) ||
        window.localStorage.getItem(LS_VENDOR_ID) ||
        window.sessionStorage.getItem(LEGACY_LS_VENDOR_ID) ||
        window.localStorage.getItem(LEGACY_LS_VENDOR_ID) ||
        queryVendorId
    );
  } catch {
    return queryVendorId;
  }
}

function supportHref(status: any, suspension: any): string {
  const vendorName = clean(status?.vendor_name) || "JRide vendor";
  const vendorId = clean(status?.vendor_id) || "Not available";
  const reference = clean(suspension?.reference) || "Not available";
  const subject = `Vendor suspension question or dispute - ${reference}`;
  const body = [
    "Hello JRide,",
    "",
    "I would like to submit a question or valid dispute about this vendor suspension.",
    "",
    `Vendor: ${vendorName}`,
    `Vendor ID: ${vendorId}`,
    `Suspension reference: ${reference}`,
    `Suspension ends: ${fmt(suspension?.ends_at)}`,
    `Reason shown: ${clean(suspension?.message) || "Not available"}`,
    "",
    "Recorded activity I believe is incorrect:",
    "",
    "Order code, date, approved closure, or supporting evidence:",
    "",
  ].join("\n");

  return `mailto:${JRIDE_SUPPORT_EMAIL}?subject=${encodeURIComponent(
    subject
  )}&body=${encodeURIComponent(body)}`;
}

function isAutomaticSuspension(suspension: any): boolean {
  const type = clean(suspension?.sanction_type);
  const code = clean(suspension?.violation_code).toUpperCase();
  return (
    suspension?.automated === true ||
    suspension?.enforcement_source === "system_automatic" ||
    type === "automatic_7_days" ||
    type === "automatic_30_days" ||
    code === "REPEATED_ORDER_TIMEOUTS" ||
    code === "REPEATED_UNEXCUSED_OFFLINE_DAYS"
  );
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
      const vendorId = readPortalVendorId();
      const query = vendorId
        ? `?vendor_id=${encodeURIComponent(vendorId)}`
        : "";
      const response = await fetch(`/api/vendor/compliance-state${query}`, {
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
          result?.message ||
            result?.error ||
            "Compliance status could not be loaded."
        );
      }

      setStatus(result);
      setLoadError("");
      if (result?.suspension?.acknowledgement_required === true) {
        setDetailsOpen(true);
      } else if (result?.suspended !== true) {
        setDetailsOpen(false);
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
    const acknowledgementToken = clean(
      status?.suspension?.acknowledgement_token
    );
    if (!sanctionId || acknowledging) return;

    setAcknowledging(true);
    setLoadError("");

    try {
      const response = await fetch(
        "/api/vendor/compliance-state/acknowledge",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sanction_id: sanctionId,
            acknowledgement_token: acknowledgementToken || undefined,
          }),
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
  const automated = isAutomaticSuspension(suspension);
  const repeatOffense = suspension?.repeat_offense === true;
  const acknowledgementRequired =
    suspension?.acknowledgement_required === true;
  const showDetails = suspended && (acknowledgementRequired || detailsOpen);
  const contactHref = supportHref(status, suspension);

  return (
    <>
      {suspended ? (
        <div className="fixed left-3 right-3 top-3 z-[240] rounded-2xl border border-rose-300 bg-rose-700 p-4 text-white shadow-2xl">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.16em] text-rose-100">
                {automated
                  ? "Store automatically suspended by JRide"
                  : "Store suspended by JRide"}
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
              {automated
                ? "JRide automated compliance suspension"
                : "JRide vendor suspension notice"}
            </div>
            <h2
              id="vendor-suspension-title"
              className="mt-1 text-2xl font-black"
            >
              New Takeout orders are temporarily disabled
            </h2>

            {automated ? (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-950">
                JRide&apos;s vendor compliance system automatically applied this
                suspension after recorded activity reached the rule shown
                below. The action comes from the system&apos;s recorded activity
                and fixed compliance rules, not from an employee or individual.
                Manual review is opened only after a valid dispute is submitted.
              </div>
            ) : (
              <p className="mt-3 text-sm leading-6 text-slate-700">
                JRide applied this suspension after a compliance review. You can
                still access the vendor portal, order history, and existing
                records, but you cannot reopen the store or receive new Takeout
                orders while the suspension is active.
              </p>
            )}

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
                  {clean(suspension.starts_at)
                    ? fmt(suspension.starts_at)
                    : "Active now"}
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

            <details className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm text-slate-700">
              <summary className="cursor-pointer font-black text-slate-950">
                Automatic suspension rules
              </summary>
              <div className="mt-3 space-y-4 text-xs leading-5">
                <div>
                  <div className="font-black text-slate-900">
                    3 accumulated unanswered or expired Takeout orders
                  </div>
                  <p className="mt-1">
                    The system counts every Takeout order that expires because
                    the vendor did not accept or decline it within the required
                    response time. The count is accumulated. Answering a later
                    order does not remove earlier unanswered orders.
                  </p>
                </div>
                <div>
                  <div className="font-black text-slate-900">
                    3 consecutive operating days without manually opening the
                    store
                  </div>
                  <p className="mt-1">
                    Opening the JRide app or browser does not open the store.
                    The vendor must select Open for Orders Today in the Vendor
                    Portal each operating day. Until this is done, the store
                    remains closed and does not receive new orders. An approved
                    closure or valid system exception breaks the unexcused-day
                    count.
                  </p>
                </div>
                <div>
                  <div className="font-black text-slate-900">
                    First and repeat suspension
                  </div>
                  <p className="mt-1">
                    The first reached threshold automatically suspends new-order
                    access for 7 days. Reaching the same offense threshold again
                    after a prior valid automatic suspension automatically
                    suspends new-order access for 30 days.
                  </p>
                </div>
              </div>
            </details>

            <div className="mt-3 rounded-2xl border bg-slate-50 p-4 text-xs leading-5 text-slate-600">
              Pending orders that were not yet accepted are cancelled. Orders
              accepted before the suspension can still be completed. When the
              suspension ends or is revoked, the store remains closed until the
              vendor manually opens it again.
            </div>

            {repeatOffense ? (
              <div className="mt-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 text-xs leading-5 text-rose-950">
                <div className="font-black">30-day repeat suspension</div>
                <div className="mt-1">
                  The system found that the same offense threshold was reached
                  again after a prior valid automatic suspension.
                </div>
              </div>
            ) : automated ? (
              <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs leading-5 text-amber-950">
                <div className="font-black">Repeat-offense consequence</div>
                <div className="mt-1">
                  Reaching the same offense threshold again after this valid
                  automatic suspension will automatically suspend new-order
                  access for 30 days.
                </div>
              </div>
            ) : null}

            <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-xs leading-5 text-blue-950">
              <div className="font-black">Questions or valid disputes</div>
              <div className="mt-1">
                Manual review is opened only when the vendor submits a valid
                dispute through JRide and identifies the recorded activity that
                is incorrect. Include the order code, date, approved closure, or
                supporting evidence. Filing a dispute does not pause or remove
                the suspension unless JRide confirms that the system record or
                sanction is incorrect.
              </div>
            </div>

            {acknowledgementRequired ? (
              <div className="mt-3 rounded-2xl border border-slate-300 bg-white p-4 text-xs leading-5 text-slate-700">
                <div className="font-black text-slate-950">
                  Acknowledgment
                </div>
                <div className="mt-1">
                  Selecting I acknowledge this notice only confirms that the
                  notice was received and read. It does not mean the vendor
                  agrees with the finding or gives up the right to dispute it.
                  The suspension remains active whether or not it is
                  acknowledged. Until acknowledgment is recorded, this full
                  notice appears whenever the Vendor Portal is opened.
                </div>
              </div>
            ) : null}

            {loadError ? (
              <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                {loadError}
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <a
                href={contactHref}
                className="rounded-xl border border-blue-300 bg-white px-5 py-3 text-center text-sm font-black text-blue-800"
              >
                Question or dispute this suspension
              </a>

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
