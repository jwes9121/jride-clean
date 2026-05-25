"use client";

import React, { useMemo, useState } from "react";

type Props = {
  trip?: any;
  onAfterAction?: () => void;
};

const JRIDE_LIVETRIPS_EVT = "JRIDE_LIVETRIPS_EVT";

function normStatus(s?: any) {
  return String(s || "").trim().toLowerCase();
}

function emitLiveTripsEvt(detail: any) {
  try {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(JRIDE_LIVETRIPS_EVT, { detail }));
  } catch {
    // ignore
  }
}

async function postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j && (j.error || j.message)) || "REQUEST_FAILED");
  return j;
}

export default function TripLifecycleActions({ trip, onAfterAction }: Props) {
  const bookingCode = String(trip?.booking_code || "");
  const status = normStatus(trip?.status);

  const [lastAction, setLastAction] = useState<string>("");

  const canMarkOnTheWay = useMemo(() => status === "assigned", [status]);
  const canStartTrip = useMemo(() => status === "on_the_way", [status]);
  const canComplete = useMemo(() => status === "on_trip", [status]);

  async function updateStatus(nextStatus: string) {
    if (!bookingCode) return;
    try {
      setLastAction(`Updating to ${nextStatus}...`);
      await postJson("/api/dispatch/status", { bookingCode, status: nextStatus });
      setLastAction(`Status set to ${nextStatus}`);
      emitLiveTripsEvt({ bookingCode, status: nextStatus });
      onAfterAction?.();
    } catch (e: any) {
      setLastAction(`Update FAILED: ${e?.message ?? "unknown error"}`);
    }
  }

  if (!trip) {
    return (
      <div className="rounded border p-3">
        <div className="font-semibold mb-1">Trip actions</div>
        <div className="text-sm text-gray-600">Select a trip to see actions.</div>
      </div>
    );
  }

  return (
    <div className="rounded border p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">Trip actions</div>
          <div className="text-xs text-gray-600">
            Code: <span className="font-mono">{bookingCode || "—"}</span>
          </div>
          <div className="text-xs text-gray-600">
            Status: <span className="font-mono">{status || "—"}</span>
          </div>
        </div>
        <div className="text-xs text-gray-600 text-right">
          {lastAction ? <div>{lastAction}</div> : <div>&nbsp;</div>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          disabled={!bookingCode || !canMarkOnTheWay}
          onClick={() => updateStatus("on_the_way")}
          title={!canMarkOnTheWay ? "Allowed only when status=assigned" : "Mark on_the_way"}
        >
          On the way
        </button>

        <button
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          disabled={!bookingCode || !canStartTrip}
          onClick={() => updateStatus("on_trip")}
          title={!canStartTrip ? "Allowed only when status=on_the_way" : "Start trip"}
        >
          Start trip
        </button>

        <button
          className="rounded border px-2 py-1 text-xs hover:bg-gray-50 disabled:opacity-50"
          disabled={!bookingCode || !canComplete}
          onClick={() => updateStatus("completed")}
          title={!canComplete ? "Allowed only when status=on_trip" : "Complete trip"}
        >
          Drop off
        </button>
      </div>
    </div>
  );
}
