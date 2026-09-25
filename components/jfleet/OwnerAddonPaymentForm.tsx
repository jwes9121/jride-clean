"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  addonPaymentFields,
  addonPaymentScopeKey,
  type AddonPaymentScope,
} from "@/lib/jfleet/ownerAddonPayment";
import {
  confirmAddonPaymentSlot,
  prepareAddonPaymentSlot,
  readAddonPaymentSlot,
  type AddonPaymentSlot,
} from "@/lib/jfleet/ownerAddonPaymentStore";
import { philippinesTime } from "@/lib/jfleet/routeReview";

type Props = {
  scope: AddonPaymentScope;
  amount: number;
  canRecord: boolean;
  onSaved: () => Promise<void>;
};

const blank = {
  payment_channel: "",
  payment_reference: "",
  notes: "",
};

function money(value: number): string {
  return (
    "PHP " +
    value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export default function OwnerAddonPaymentForm({
  scope,
  amount,
  canRecord,
  onSaved,
}: Props) {
  const [slot, setSlot] = useState<AddonPaymentSlot | null>(null);
  const [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const guard = useRef(false);
  const scopeKey = addonPaymentScopeKey(scope);

  const query = useCallback(
    () =>
      new URLSearchParams({
        owner_user_id: scope.owner_user_id,
        partner_id: scope.partner_id,
        booking_id: scope.booking_id,
        addon_id: scope.addon_id,
      }),
    [scopeKey]
  );

  const recover = useCallback(async () => {
    try {
      const local = await readAddonPaymentSlot(scope, amount);
      setSlot(local);

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch(
          "/api/jfleet/owner/addons/confirm-payment?" + query(),
          {
            method: "GET",
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
          }
        );
        const body = await response.json().catch(() => ({}));
        if (response.ok && body?.ok === true && body?.found === true) {
          const confirmed = await confirmAddonPaymentSlot(
            scope,
            amount,
            local.generation,
            body.receipt
          );
          setSlot(confirmed);
          setNotice(
            local.phase === "pending" &&
              local.request?.idempotency_key !== body.receipt?.idempotency_key
              ? "This add-on was already paid from another device or request. The authoritative receipt was recovered; do not enter it again."
              : "Confirmed add-on payment receipt recovered."
          );
        }
      } finally {
        window.clearTimeout(timer);
      }
    } catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError") {
        return;
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not recover the saved add-on payment."
      );
    }
  }, [scopeKey, amount, query]);

  useEffect(() => {
    void recover();
    const onFocus = () => {
      if (!guard.current) void recover();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [recover]);

  async function run(checkOnly = false) {
    if (!slot || guard.current) return;

    guard.current = true;
    setBusy(true);
    setError("");
    setNotice("");

    try {
      let current = await readAddonPaymentSlot(scope, amount);
      if (current.generation !== slot.generation) {
        setSlot(current);
        throw new Error(
          "Another tab changed this add-on payment. Review the recovered state."
        );
      }

      if (current.phase === "draft") {
        if (checkOnly || !canRecord) {
          throw new Error(
            "This additional charge is not open for a new payment confirmation."
          );
        }
        current = await prepareAddonPaymentSlot(
          scope,
          amount,
          slot.generation,
          addonPaymentFields({ ...draft, amount })
        );
      }

      setSlot(current);

      if (current.phase === "confirmed") {
        setNotice(
          "This additional charge already has a confirmed payment. It was not submitted again."
        );
        return;
      }

      const request = current.request;
      if (!request) {
        throw new Error(
          "Saved add-on payment request is missing. No payment was sent."
        );
      }

      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 20000);
      let response: Response;
      let body: any;
      try {
        response = await fetch(
          "/api/jfleet/owner/addons/confirm-payment" +
            (checkOnly ? "?" + query() : ""),
          {
            method: checkOnly ? "GET" : "POST",
            credentials: "include",
            cache: "no-store",
            signal: controller.signal,
            ...(checkOnly
              ? {}
              : {
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(request),
                }),
          }
        );
        body = await response.json().catch(() => ({}));
      } finally {
        window.clearTimeout(timer);
      }

      if (!response.ok || body?.ok !== true) {
        throw new Error(
          body?.message ||
            "The additional-charge payment result is unknown. Retry or check the saved request; do not create another entry."
        );
      }

      if (checkOnly && body.found === false) {
        setNotice(
          "No add-on payment receipt is visible yet. Keep this saved request and retry it; do not create a replacement."
        );
        return;
      }

      const confirmed = await confirmAddonPaymentSlot(
        scope,
        amount,
        current.generation,
        body.receipt
      );
      setSlot(confirmed);
      setNotice(
        body?.reconciled
          ? "An existing payment for this add-on was found and recovered. No second payment was recorded."
          : "Additional charge recorded once. The receipt is saved."
      );

      try {
        await onSaved();
      } catch {
        setNotice(
          "Additional charge is recorded. Refresh booking totals separately; do not resubmit the payment."
        );
      }
    } catch (failure) {
      setError(
        failure instanceof Error && failure.name !== "AbortError"
          ? failure.message
          : "Response timed out. The result is unknown; retry or check this saved add-on payment."
      );
      await recover();
    } finally {
      guard.current = false;
      setBusy(false);
    }
  }

  const locked = busy || !slot || slot.phase !== "draft" || !canRecord;
  const shown = slot?.request
    ? {
        payment_channel: slot.request.payment_channel,
        payment_reference: slot.request.payment_reference,
        notes: slot.request.notes,
      }
    : draft;

  return (
    <div
      className="mt-3 rounded-lg border border-violet-200 bg-white p-3 min-w-0"
      data-testid={"addon-payment-form-" + scope.addon_id}
    >
      <h5 className="font-bold">Confirm additional fee received</h5>
      <p className="mt-1 text-sm">
        Amount: <strong>{money(amount)}</strong>
      </p>
      <p className="mt-1 text-xs text-slate-600">
        This payment is permanently bound to this exact side trip.
      </p>

      {error ? (
        <p role="alert" className="mt-2 text-sm text-red-800 break-words">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="mt-2 text-sm text-emerald-900">
          {notice}
        </p>
      ) : null}

      {!slot ? (
        <button
          type="button"
          className="mt-3 rounded-lg border px-3 py-2"
          onClick={() => void recover()}
        >
          Recover add-on payment
        </button>
      ) : (
        <>
          {slot.request ? (
            <p className="mt-3 text-xs break-all">
              Saved request: <strong>{slot.request.idempotency_key}</strong>
            </p>
          ) : null}

          {slot.phase === "pending" ? (
            <p className="mt-2 rounded-lg bg-amber-100 p-2 text-sm">
              Result not yet verified. Details are locked. Do not re-enter this
              side-trip payment on another device.
            </p>
          ) : null}

          {slot.phase === "confirmed" && slot.receipt ? (
            <p className="mt-2 rounded-lg bg-emerald-100 p-2 text-sm break-words">
              Confirmed receipt: {slot.receipt.payment_id}
              <br />
              {philippinesTime(slot.receipt.confirmed_at)}
            </p>
          ) : null}

          <fieldset
            disabled={locked}
            className="mt-3 grid gap-2 disabled:opacity-75 sm:grid-cols-2"
          >
            <label className="text-sm">
              Payment channel
              <input
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
                value={shown.payment_channel}
                maxLength={80}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    payment_channel: event.target.value,
                  })
                }
              />
            </label>
            <label className="text-sm">
              Payment reference
              <input
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
                value={shown.payment_reference}
                maxLength={180}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    payment_reference: event.target.value,
                  })
                }
              />
            </label>
            <label className="text-sm sm:col-span-2">
              Notes
              <input
                className="mt-1 w-full rounded-lg border bg-white px-3 py-2"
                value={shown.notes}
                maxLength={1000}
                onChange={(event) =>
                  setDraft({ ...draft, notes: event.target.value })
                }
              />
            </label>
          </fieldset>

          <div className="mt-3 flex flex-wrap gap-2">
            {slot.phase === "draft" && canRecord ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void run()}
                className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50"
              >
                {busy ? "Saving..." : "Confirm Additional Fee Paid"}
              </button>
            ) : null}

            {slot.phase === "pending" ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run()}
                  className="rounded-lg bg-amber-900 px-4 py-2 font-bold text-white disabled:opacity-50"
                >
                  Retry saved add-on payment
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(true)}
                  className="rounded-lg border px-4 py-2 disabled:opacity-50"
                >
                  Check add-on payment
                </button>
              </>
            ) : null}
          </div>

          {!canRecord && slot.phase === "draft" ? (
            <p className="mt-2 text-sm">
              No new payment confirmation is available for this additional
              charge.
            </p>
          ) : null}
        </>
      )}

      <p className="mt-3 text-xs text-slate-500">
        JRide also checks the server by add-on ID, so an existing payment from
        another device can be recovered instead of duplicated.
      </p>
    </div>
  );
}
