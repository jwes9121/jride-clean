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
  waiting_minutes?: number | null;
  waiting_fee?: number | null;
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
      localStorage.getItem(TOKEN_KEY) ||
        localStorage.getItem(PASSENGER_TOKEN_KEY) ||
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

function stageMeta(stageRaw: unknown, statusRaw: unknown) {
  const stage = clean(stageRaw).toLowerCase();
  const status = clean(statusRaw).toLowerCase();

  if (["requested", "pending", "searching"].includes(status) || stage === "matching") {
    return {
      step: "STEP 1 OF 6",
      label: "Finding your driver",
      short: "Matching",
      accent: "bg-sky-400",
      pill: "bg-sky-400/15 text-sky-200 ring-sky-300/25",
    };
  }
  if (["driver_assigned", "going_to_customer"].includes(stage) || status === "assigned") {
    return {
      step: "STEP 2 OF 6",
      label: "Driver coming to you",
      short: "Meet driver",
      accent: "bg-blue-400",
      pill: "bg-blue-400/15 text-blue-200 ring-blue-300/25",
    };
  }
  if (["stage0_review", "awaiting_customer_confirmation"].includes(stage) || status === "fare_proposed") {
    return {
      step: "STEP 3 OF 6",
      label: stage === "awaiting_customer_confirmation" || status === "fare_proposed"
        ? "Your confirmation is needed"
        : "Reviewing the task",
      short: "Review & fare",
      accent: "bg-amber-400",
      pill: "bg-amber-400/15 text-amber-200 ring-amber-300/25",
    };
  }
  if (stage === "task_confirmed") {
    return {
      step: "STEP 4 OF 6",
      label: "Task confirmed",
      short: "Ready to start",
      accent: "bg-emerald-400",
      pill: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25",
    };
  }
  if (["going_to_stop", "waiting_at_stop", "resolving_stop_issue", "going_to_customer_for_cash", "waiting_for_cash_topup", "returning_to_stop_after_cash"].includes(stage)) {
    return {
      step: "STEP 5 OF 6",
      label: stage === "waiting_at_stop" ? "Driver is at a task stop" : "Errand in progress",
      short: "Task stops",
      accent: "bg-violet-400",
      pill: "bg-violet-400/15 text-violet-200 ring-violet-300/25",
    };
  }
  if (["going_to_final", "waiting_at_final_handoff", "final_recipient_met", "unreachable_escalated"].includes(stage)) {
    const isWaiting = stage === "waiting_at_final_handoff";
    const met = stage === "final_recipient_met";
    const escalated = stage === "unreachable_escalated";
    return {
      step: "STEP 6 OF 6",
      label: escalated
        ? "Handoff needs JRide support"
        : met
          ? "Recipient met - handoff in progress"
          : isWaiting
            ? "Driver is waiting at destination"
            : "Heading to final destination",
      short: "Final handoff",
      accent: escalated ? "bg-red-400" : met ? "bg-emerald-400" : "bg-orange-400",
      pill: escalated
        ? "bg-red-400/15 text-red-200 ring-red-300/25"
        : met
          ? "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25"
          : "bg-orange-400/15 text-orange-200 ring-orange-300/25",
    };
  }

  return {
    step: "ERRAND ACTIVE",
    label: "Errand updating",
    short: "Active",
    accent: "bg-emerald-400",
    pill: "bg-emerald-400/15 text-emerald-200 ring-emerald-300/25",
  };
}

export default function ErrandPassengerActiveBarV2() {
  const [current, setCurrent] = React.useState<CurrentBundle | null>(null);
  const [receipt, setReceipt] = React.useState<Receipt | null>(null);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const lastActiveIdRef = React.useRef("");

  const fetchCompletedReceipt = React.useCallback(async (bookingId: string) => {
    const id = clean(bookingId);
    if (!id || !getToken()) return;

    let dismissed = "";
    try {
      dismissed = clean(localStorage.getItem(DISMISSED_RECEIPT_KEY));
    } catch {}
    if (dismissed === id) return;

    try {
      const response = await fetch(
        `/api/passenger/errand/completed?booking_id=${encodeURIComponent(id)}`,
        { method: "GET", headers: authHeaders(), cache: "no-store" }
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
          localStorage.setItem(ACTIVE_ERRAND_ID_KEY, nextId);
        } catch {}
        setCurrent(next as CurrentBundle);
        setReceipt(null);
        return;
      }

      setCurrent(null);
      let completedCandidate = lastActiveIdRef.current;
      if (!completedCandidate) {
        try {
          completedCandidate = clean(localStorage.getItem(ACTIVE_ERRAND_ID_KEY));
        } catch {}
      }
      if (completedCandidate) await fetchCompletedReceipt(completedCandidate);
    } catch {}
  }, [fetchCompletedReceipt]);

  React.useEffect(() => {
    refresh();
    const id = setInterval(refresh, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const booking = current?.booking || {};
  const job = current?.job || {};
  const fare = current?.fare || {};
  const stage = clean(job?.errand_stage).toLowerCase();
  const status = clean(booking?.status).toLowerCase();
  const awaitingConfirmation =
    stage === "awaiting_customer_confirmation" || status === "fare_proposed";

  React.useEffect(() => {
    if (stage !== "task_confirmed") setMessage("");
  }, [stage]);

  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const main = document.querySelector("main") as HTMLElement | null;
    if (!main) return;
    const oldPadding = main.style.paddingBottom;
    if (current?.booking?.id || receipt?.booking_id) {
      main.style.paddingBottom = "190px";
    }
    return () => {
      main.style.paddingBottom = oldPadding;
    };
  }, [current?.booking?.id, receipt?.booking_id]);

  async function confirmTask() {
    const bookingId = clean(booking?.id);
    if (!bookingId || confirmBusy) return;

    setConfirmBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/passenger/errand/confirm", {
        method: "POST",
        headers: { ...authHeaders(), "content-type": "application/json" },
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
        localStorage.setItem(DISMISSED_RECEIPT_KEY, id);
        localStorage.removeItem(ACTIVE_ERRAND_ID_KEY);
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
        <div className="mx-auto max-w-xl overflow-hidden rounded-[28px] border border-emerald-300/40 bg-slate-950 text-white shadow-[0_-16px_55px_rgba(15,23,42,0.32)]">
          <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400" />
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">Errand completed</div>
                <div className="mt-1 text-lg font-bold">{clean(receipt.booking_code) || "JRide Errand"}</div>
              </div>
              <button type="button" onClick={dismissReceipt} className="rounded-xl bg-white/10 px-3 py-2 text-xs font-bold ring-1 ring-white/15">
                Done
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <ReceiptMetric label="Starting fare" value={money(startingFare)} />
              <ReceiptMetric label="Final fare" value={money(finalFare)} strong />
              <ReceiptMetric label="Waiting added" value={money(receipt.waiting_fee)} />
              <ReceiptMetric label="Added after confirmation" value={money(added)} />
            </div>
            <div className="mt-3 text-xs text-slate-300">
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
  const meta = stageMeta(stage, status);

  let waitingText = stage === "final_recipient_met"
    ? "Waiting stopped - handoff in progress"
    : "No waiting charge now";
  if (waitingRunning && freeRemainingSeconds > 60) {
    waitingText = `Free waiting remaining: ${formatSeconds(freeRemainingSeconds)}`;
  } else if (waitingRunning && freeRemainingSeconds > 0) {
    waitingText = `Waiting charge starts in ${formatSeconds(freeRemainingSeconds)}`;
  } else if (waitingRunning && chargeable) {
    waitingText = `Waiting fee added: ${money(waitingFee)}`;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[110] px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto max-w-xl overflow-hidden rounded-[28px] border border-white/10 bg-slate-950 text-white shadow-[0_-16px_55px_rgba(15,23,42,0.34)]">
        <div className={`h-1.5 ${meta.accent}`} />
        <div className="p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] ring-1 ${meta.pill}`}>
                {meta.step}
              </div>
              <div className="mt-2 text-base font-bold leading-tight">{meta.label}</div>
              <div className="mt-1 text-xs text-slate-400">{meta.short} | {clean(booking?.booking_code)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Current fare</div>
              <div className="mt-0.5 text-2xl font-black tracking-tight">{money(currentFare)}</div>
              {!awaitingConfirmation ? (
                <div className="mt-1 text-[11px] text-slate-400">Started at {money(startingFare)}</div>
              ) : null}
            </div>
          </div>

          {awaitingConfirmation ? (
            <div className="mt-4 rounded-2xl bg-amber-400/10 p-3 ring-1 ring-amber-300/25">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-amber-200">Fare ready</div>
                  <div className="mt-1 text-xs leading-5 text-slate-300">
                    This is the starting fare. Waiting can add PHP 20 per started 15-minute block after the first 15 total waiting minutes.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={confirmTask}
                  disabled={confirmBusy}
                  className="shrink-0 rounded-2xl bg-emerald-400 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/20 disabled:opacity-50"
                >
                  {confirmBusy ? "Confirming..." : `Confirm ${money(currentFare)}`}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
              <div className="text-xs font-semibold text-slate-300">{waitingText}</div>
              {waitingFee > 0 ? (
                <div className="rounded-full bg-amber-400/15 px-2.5 py-1 text-[11px] font-bold text-amber-200 ring-1 ring-amber-300/20">
                  Waiting {money(waitingFee)}
                </div>
              ) : (
                <div className="rounded-full bg-emerald-400/10 px-2.5 py-1 text-[11px] font-bold text-emerald-200 ring-1 ring-emerald-300/15">
                  No waiting fee
                </div>
              )}
            </div>
          )}

          {message && stage === "task_confirmed" ? (
            <div className="mt-2 text-xs font-semibold text-emerald-200">{message}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ReceiptMetric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/5 p-3 ring-1 ring-white/10">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className={"mt-1 " + (strong ? "text-lg font-black text-white" : "font-bold text-slate-100")}>{value}</div>
    </div>
  );
}
