"use client";

import * as React from "react";

const TOKEN_KEY = "jride_access_token";
const PASSENGER_TOKEN_KEY = "jride_passenger_token";
const ACTIVE_ERRAND_ID_KEY = "jride_active_errand_booking_id";
const DISMISSED_RECEIPT_KEY = "jride_errand_receipt_dismissed_id";

type CurrentBundle = {
  booking?: any;
  job?: any;
  fare?: any;
};

type Receipt = {
  booking_id?: string;
  booking_code?: string;
  completed_at?: string | null;
  starting_fare?: number | null;
  final_fare?: number | null;
  base_fare?: number | null;
  pickup_distance_fee?: number | null;
  distance_fare?: number | null;
  extra_stop_fee?: number | null;
  waiting_minutes?: number | null;
  waiting_fee?: number | null;
  elevation_surcharge?: number | null;
  heavy_load_fee?: number | null;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function numberOrZero(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown): string {
  return `PHP ${Math.round(numberOrZero(value)).toLocaleString("en-PH")}`;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return clean(
      window.localStorage.getItem(TOKEN_KEY) ||
        window.localStorage.getItem(PASSENGER_TOKEN_KEY) ||
        ""
    );
  } catch {
    return "";
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatSeconds(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function hideStaleTaskConfirmedNotice(activeStage: string, receiptVisible: boolean) {
  if (typeof document === "undefined") return;
  if (activeStage === "task_confirmed" && !receiptVisible) return;

  for (const element of Array.from(document.querySelectorAll("div"))) {
    if (clean(element.textContent) !== "Task confirmed. The driver can now start the Errand.") {
      continue;
    }
    element.hidden = true;
    element.setAttribute("aria-hidden", "true");
  }
}

export default function ErrandStickyFare() {
  const [current, setCurrent] = React.useState<CurrentBundle | null>(null);
  const [receipt, setReceipt] = React.useState<Receipt | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const pollingRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActiveIdRef = React.useRef("");

  const fetchCompletedReceipt = React.useCallback(async (bookingId: string) => {
    const id = clean(bookingId);
    if (!id || !getToken()) return;

    let dismissed = "";
    try {
      dismissed = clean(window.localStorage.getItem(DISMISSED_RECEIPT_KEY));
    } catch {}
    if (dismissed === id) return;

    try {
      const response = await fetch(
        `/api/passenger/errand/completed?booking_id=${encodeURIComponent(id)}`,
        {
          method: "GET",
          headers: authHeaders(),
          cache: "no-store",
        }
      );
      const json: any = await response.json().catch(() => ({}));
      if (response.ok && json?.ok === true && json?.receipt?.booking_id) {
        setReceipt(json.receipt as Receipt);
      }
    } catch {}
  }, []);

  const refresh = React.useCallback(async () => {
    if (!getToken()) {
      setCurrent(null);
      return;
    }

    try {
      const response = await fetch("/api/passenger/errand/current", {
        method: "GET",
        headers: authHeaders(),
        cache: "no-store",
      });
      const json: any = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok !== true) return;

      const next = json?.errand || null;
      if (next?.booking?.id) {
        const nextId = clean(next.booking.id);
        lastActiveIdRef.current = nextId;
        try {
          window.localStorage.setItem(ACTIVE_ERRAND_ID_KEY, nextId);
        } catch {}
        setCurrent(next as CurrentBundle);
        setReceipt(null);
        return;
      }

      setCurrent(null);

      let completedCandidate = lastActiveIdRef.current;
      if (!completedCandidate) {
        try {
          completedCandidate = clean(
            window.localStorage.getItem(ACTIVE_ERRAND_ID_KEY)
          );
        } catch {}
      }
      if (completedCandidate) {
        await fetchCompletedReceipt(completedCandidate);
      }
    } catch {}
  }, [fetchCompletedReceipt]);

  React.useEffect(() => {
    refresh();
    pollingRef.current = setInterval(refresh, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [refresh]);

  const booking = current?.booking || {};
  const job = current?.job || {};
  const fare = current?.fare || {};
  const stage = clean(job?.errand_stage).toLowerCase();
  const status = clean(booking?.status).toLowerCase();
  const awaitingConfirmation =
    stage === "awaiting_customer_confirmation" || status === "fare_proposed";

  React.useEffect(() => {
    hideStaleTaskConfirmedNotice(stage, !!receipt);
  }, [stage, receipt]);

  async function confirmTask() {
    const bookingId = clean(booking?.id);
    if (!bookingId || confirmBusy) return;

    setConfirmBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/passenger/errand/confirm", {
        method: "POST",
        headers: {
          ...authHeaders(),
          "content-type": "application/json",
        },
        body: JSON.stringify({ booking_id: bookingId }),
        cache: "no-store",
      });
      const json: any = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok === false) {
        throw new Error(clean(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setMessage("Task confirmed.");
      await refresh();
    } catch (error: any) {
      setMessage(clean(error?.message) || "Task confirmation failed.");
    } finally {
      setConfirmBusy(false);
    }
  }

  function dismissReceipt() {
    const id = clean(receipt?.booking_id);
    if (id) {
      try {
        window.localStorage.setItem(DISMISSED_RECEIPT_KEY, id);
        window.localStorage.removeItem(ACTIVE_ERRAND_ID_KEY);
      } catch {}
    }
    setReceipt(null);
    lastActiveIdRef.current = "";
  }

  if (receipt?.booking_id) {
    const startingFare = numberOrZero(receipt.starting_fare);
    const finalFare = numberOrZero(receipt.final_fare);
    const added = Math.max(finalFare - startingFare, 0);

    return (
      <div className="fixed inset-x-0 bottom-0 z-[120] px-3 pb-3 sm:px-4 sm:pb-4">
        <div className="mx-auto max-w-xl rounded-[24px] border border-emerald-200 bg-white p-4 shadow-[0_-12px_45px_rgba(15,23,42,0.18)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                Errand completed
              </div>
              <div className="mt-1 text-lg font-bold text-slate-950">
                {clean(receipt.booking_code) || "JRide Errand"}
              </div>
            </div>
            <button
              type="button"
              onClick={dismissReceipt}
              className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700"
            >
              Done
            </button>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <ReceiptMetric label="Starting fare" value={money(startingFare)} />
            <ReceiptMetric label="Final fare" value={money(finalFare)} strong />
            <ReceiptMetric label="Waiting" value={money(receipt.waiting_fee)} />
            <ReceiptMetric label="Added after confirmation" value={money(added)} />
          </div>

          <div className="mt-3 text-xs text-slate-500">
            Waiting time: {Math.max(0, Math.round(numberOrZero(receipt.waiting_minutes)))} min total.
            {receipt.completed_at
              ? ` Completed ${new Date(receipt.completed_at).toLocaleString("en-PH", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}.`
              : ""}
          </div>
        </div>
      </div>
    );
  }

  if (!current?.booking?.id) return null;

  const waiting = fare?.waiting || {};
  const freeRemainingSeconds = numberOrZero(waiting?.free_remaining_seconds);
  const waitingFee = numberOrZero(fare?.waiting_fee);
  const currentFare = numberOrZero(fare?.total_errand_fare);
  const startingFare = numberOrZero(job?.starting_fare_at_confirmation || currentFare);
  const waitingRunning = waiting?.running === true;
  const chargeable = numberOrZero(waiting?.chargeable_started_blocks) > 0;

  let waitingText = "No waiting charge now";
  if (waitingRunning && freeRemainingSeconds > 60) {
    waitingText = `Free waiting remaining: ${formatSeconds(freeRemainingSeconds)}`;
  } else if (waitingRunning && freeRemainingSeconds > 0) {
    waitingText = `Waiting charge starts in ${formatSeconds(freeRemainingSeconds)}`;
  } else if (waitingRunning && chargeable) {
    waitingText = `Waiting fee added: ${money(waitingFee)}`;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[110] px-3 pb-3 sm:px-4 sm:pb-4">
      <div
        className={
          "mx-auto max-w-xl rounded-[24px] border bg-white p-4 shadow-[0_-12px_45px_rgba(15,23,42,0.18)] " +
          (awaitingConfirmation ? "border-amber-300" : "border-emerald-200")
        }
      >
        {awaitingConfirmation ? (
          <>
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">
              Fare ready for confirmation
            </div>
            <div className="mt-1 flex items-end justify-between gap-3">
              <div>
                <div className="text-sm text-slate-600">Starting fare</div>
                <div className="text-2xl font-bold text-slate-950">{money(currentFare)}</div>
              </div>
              <button
                type="button"
                onClick={confirmTask}
                disabled={confirmBusy}
                className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-50"
              >
                {confirmBusy ? "Confirming..." : `Confirm ${money(currentFare)}`}
              </button>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              This is the starting fare. The final fare may increase only from applicable Errand adjustments, including waiting after the first 15 total waiting minutes. Waiting is PHP 20 per started 15-minute block after the free period.
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Current Errand fare
                </div>
                <div className="mt-1 text-xl font-bold text-slate-950">{money(currentFare)}</div>
              </div>
              <div className="text-right text-xs text-slate-600">
                <div>Starting: {money(startingFare)}</div>
                <div className={waitingRunning && freeRemainingSeconds <= 60 ? "font-semibold text-amber-700" : ""}>
                  {waitingText}
                </div>
              </div>
            </div>
          </>
        )}

        {message ? <div className="mt-2 text-xs font-medium text-slate-700">{message}</div> : null}
      </div>
    </div>
  );
}

function ReceiptMetric({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={"mt-1 " + (strong ? "text-lg font-bold text-slate-950" : "font-semibold text-slate-800")}>
        {value}
      </div>
    </div>
  );
}
