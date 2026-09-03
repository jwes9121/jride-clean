"use client";

import { useMemo, useState } from "react";
import {
  clean,
  newRequestId,
  VIOLATION_OPTIONS,
  vendorName,
} from "./shared";
import type { ManualSuspendPayload } from "./shared";

type Props = {
  vendors: any[];
  activeSuspendedVendorIds: Set<string>;
  busy: boolean;
  canManage: boolean;
  onSuspend: (payload: ManualSuspendPayload, vendorLabel: string) => Promise<boolean>;
};

export default function ManualVendorSuspensionPanel({
  vendors,
  activeSuspendedVendorIds,
  busy,
  canManage,
  onSuspend,
}: Props) {
  const [vendorId, setVendorId] = useState("");
  const [violationCode, setViolationCode] = useState("");
  const [vendorMessage, setVendorMessage] = useState("");
  const [internalNote, setInternalNote] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [confirmed, setConfirmed] = useState(false);

  const selectedVendor = useMemo(
    () => vendors.find((vendor) => clean(vendor?.id) === vendorId),
    [vendorId, vendors]
  );

  const vendorMessageLength = vendorMessage.trim().length;
  const internalNoteLength = internalNote.trim().length;
  const selectedVendorSuspended =
    vendorId.length > 0 && activeSuspendedVendorIds.has(vendorId);
  const missingRequirements: string[] = [];

  if (!selectedVendor) missingRequirements.push("Select a vendor.");
  if (selectedVendorSuspended) {
    missingRequirements.push("The selected vendor is already suspended.");
  }
  if (!violationCode) {
    missingRequirements.push("Select a violation category.");
  }
  if (vendorMessageLength < 10) {
    missingRequirements.push(
      `Vendor message needs at least 10 characters (${vendorMessageLength}/10).`
    );
  }
  if (internalNoteLength < 5) {
    missingRequirements.push(
      `Internal admin note needs at least 5 characters (${internalNoteLength}/5).`
    );
  }
  if (!confirmed) {
    missingRequirements.push("Confirm the verification checkbox.");
  }

  const ready = canManage && missingRequirements.length === 0;

  function chooseViolation(code: string) {
    const option = VIOLATION_OPTIONS.find((item) => item.code === code);
    setViolationCode(code);
    setVendorMessage(option?.defaultMessage || "");
    setConfirmed(false);
  }

  async function submit() {
    if (!selectedVendor || !ready) return;
    const label = vendorName(selectedVendor);
    const approved = window.confirm(
      `Suspend ${label} for ${durationDays} day(s)? New orders will be blocked and pending unaccepted orders will be cancelled.`
    );
    if (!approved) return;

    const saved = await onSuspend(
      {
        vendor_id: vendorId,
        violation_code: violationCode,
        vendor_message: vendorMessage,
        internal_note: internalNote,
        duration_days: Number(durationDays),
        request_id: newRequestId(),
      },
      label
    );

    if (saved) {
      setVendorId("");
      setViolationCode("");
      setVendorMessage("");
      setInternalNote("");
      setDurationDays("7");
      setConfirmed(false);
    }
  }

  return (
    <section className="rounded-2xl border border-rose-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-950">
            Manual vendor suspension
          </h2>
          <p className="mt-1 max-w-4xl text-xs leading-5 text-slate-500">
            The vendor can still sign in and read the violation notice. New
            orders are blocked, pending unaccepted orders are cancelled, and
            already accepted orders may be completed. Expiry or revocation does
            not reopen the store automatically.
          </p>
        </div>
        <span className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-black text-rose-800">
          Admin only
        </span>
      </div>

      {!canManage ? (
        <div className="mt-4 rounded-xl border bg-slate-50 p-4 text-sm text-slate-600">
          You have read-only access. Only an authenticated admin can suspend or
          revoke a vendor.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <label className="text-xs font-bold text-slate-700">
            Vendor
            <select
              value={vendorId}
              onChange={(event) => {
                setVendorId(event.target.value);
                setConfirmed(false);
              }}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal"
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor) => {
                const id = clean(vendor?.id);
                const suspended = activeSuspendedVendorIds.has(id);
                return (
                  <option key={id} value={id} disabled={suspended}>
                    {vendorName(vendor)} - {clean(vendor?.town) || "No town"}
                    {suspended ? " - already suspended" : ""}
                  </option>
                );
              })}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Violation category
            <select
              value={violationCode}
              onChange={(event) => chooseViolation(event.target.value)}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal"
            >
              <option value="">Select violation</option>
              {VIOLATION_OPTIONS.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-xs font-bold text-slate-700 lg:col-span-2">
            Message shown to the vendor
            <textarea
              value={vendorMessage}
              onChange={(event) => {
                setVendorMessage(event.target.value);
                setConfirmed(false);
              }}
              rows={3}
              maxLength={1000}
              placeholder="State the confirmed violation in clear, factual language."
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal"
            />
            <span
              className={`mt-1 block text-[11px] font-normal ${
                vendorMessageLength > 0 && vendorMessageLength < 10
                  ? "text-rose-700"
                  : "text-slate-500"
              }`}
            >
              This exact explanation appears in the vendor portal. Minimum 10
              characters. Do not include customer names, phone numbers, or
              private evidence.
            </span>
          </label>

          <label className="text-xs font-bold text-slate-700 lg:col-span-2">
            Internal admin note
            <textarea
              value={internalNote}
              onChange={(event) => {
                setInternalNote(event.target.value);
                setConfirmed(false);
              }}
              rows={3}
              maxLength={2000}
              placeholder="Record the evidence reviewed, related booking codes, and decision basis."
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal"
            />
            <span
              className={`mt-1 block text-[11px] font-normal ${
                internalNoteLength > 0 && internalNoteLength < 5
                  ? "text-rose-700"
                  : "text-slate-500"
              }`}
            >
              Admin-only record. Minimum 5 characters. Current: {internalNoteLength}.
              This is never returned to the vendor or passenger.
            </span>
          </label>

          <label className="text-xs font-bold text-slate-700">
            Suspension duration
            <select
              value={durationDays}
              onChange={(event) => {
                setDurationDays(event.target.value);
                setConfirmed(false);
              }}
              className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-normal"
            >
              {[1, 3, 7, 14, 30].map((days) => (
                <option key={days} value={String(days)}>
                  {days} day{days === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-xl border bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            <div className="font-black text-slate-900">Enforcement scope</div>
            New Takeout orders only. The vendor remains logged in so the
            violation notice and records remain accessible.
          </div>

          <label className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-950 lg:col-span-2">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5"
            />
            <span>
              I verified the selected vendor, reviewed the evidence, and confirm
              that the vendor-facing explanation is factual and does not expose
              private customer information.
            </span>
          </label>

          <div className="flex flex-wrap items-end justify-between gap-3 lg:col-span-2">
            <div className="max-w-3xl text-xs text-slate-500">
              <div>
                Selected: {selectedVendor ? vendorName(selectedVendor) : "None"}
              </div>
              {!ready && missingRequirements.length > 0 ? (
                <div className="mt-1 font-semibold text-rose-700" role="status">
                  Cannot suspend yet: {missingRequirements.join(" ")}
                </div>
              ) : (
                <div className="mt-1 font-semibold text-emerald-700">
                  All suspension requirements are complete.
                </div>
              )}
            </div>
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => void submit()}
              title={
                ready
                  ? "Suspend the selected vendor"
                  : missingRequirements.join(" ")
              }
              className="rounded-xl bg-rose-700 px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? "Suspending..." : "Suspend vendor"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
