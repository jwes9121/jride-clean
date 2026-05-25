"use client";

import React, { useEffect, useState } from "react";

export type DispatchActionTrip = {
  id: string;
  booking_code: string | null;
  status: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  passenger_name: string | null;
  town: string | null;
  is_emergency: boolean | null;
};

type DispatchActionPanelProps = {
  selectedTrip: DispatchActionTrip | null;
  dispatcherName?: string | null;
  onActionCompleted?: () => void;
};

type ApiResult = {
  ok: boolean;
  message: string;
};

async function postDispatchAction(body: any): Promise<ApiResult> {
  try {
    const res = await fetch("/api/admin/livetrips/dispatch-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
      return {
        ok: false,
        message: (json && (json.error as string)) || "Dispatch action failed.",
      };
    }

    return {
      ok: true,
      message:
        (json && (json.message as string)) ||
        "Dispatch action completed successfully.",
    };
  } catch (err) {
    console.error("Dispatch action fetch error:", err);
    return { ok: false, message: "Network error calling dispatch API." };
  }
}

async function postTripStatus(bookingCode: string, status: string): Promise<ApiResult> {
  try {
    const res = await fetch("/api/dispatch/status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingCode, status, source: "dispatch-panel", override: true }),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: (json && (json.message as string)) || "Status update failed." };
    }
    return { ok: true, message: (json && (json.message as string)) || "Status updated." };
  } catch (err) {
    console.error("Status update fetch error:", err);
    return { ok: false, message: "Network error updating status." };
  }
}

export function DispatchActionPanel(props: DispatchActionPanelProps) {
  const { selectedTrip, dispatcherName, onActionCompleted } = props;

  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const [localStatus, setLocalStatus] = useState<string>(String(selectedTrip?.status || ""));
  useEffect(() => {
    setLocalStatus(String(selectedTrip?.status || ""));
  }, [selectedTrip?.id]);

  const [localEmergency, setLocalEmergency] = useState<boolean>(
    !!selectedTrip?.is_emergency
  );

  if (!selectedTrip || !selectedTrip.id) {
    return (
      <div className="mt-2 rounded-xl border border-slate-800 bg-slate-950/80 p-3 text-[11px] text-slate-500">
        No active trip selected.
      </div>
    );
  }

  const resetMessages = () => {
    setStatusText(null);
    setErrorText(null);
  };

  const tripLabel =
    selectedTrip.booking_code || selectedTrip.id.slice(0, 8) + "...";
  const driverName = selectedTrip.driver_name || "Unknown driver";
  const passengerName = selectedTrip.passenger_name || "Unknown passenger";
  const town = selectedTrip.town || "Unknown";
  const bookingCode = selectedTrip.booking_code || "";

  const isEmergency = localEmergency;

  const handleCall = () => {
    if (!selectedTrip.driver_phone) return;
    try {
      const tel = `tel:${selectedTrip.driver_phone}`;
      window.location.href = tel;
    } catch (e) {
      console.error("Call failed:", e);
    }
  };

  const handleNudge = async () => {
    if (!selectedTrip.driver_id || !selectedTrip.id) return;
    resetMessages();
    setLoadingAction("nudge");

    const result = await postDispatchAction({
      action: "nudge",
      tripId: selectedTrip.id,
      driverId: selectedTrip.driver_id,
      note: `Nudge sent by ${
        dispatcherName || "dispatcher"
      } from LiveTrips map.`,
    });

    setLoadingAction(null);

    if (!result.ok) {
      setErrorText(result.message);
      return;
    }

    setLocalStatus(nextStatus);
    setStatusText(result.message);
    onActionCompleted?.();
  };

  const handleReassign = async () => {
    if (!selectedTrip.driver_id || !selectedTrip.id) return;
    resetMessages();
    setLoadingAction("reassign");

    const toDriverId = prompt("Enter NEW driver UUID to reassign to:");
    if (!toDriverId) {
      setLoadingAction(null);
      return;
    }

    const result = await postDispatchAction({
      action: "reassign",
      tripId: selectedTrip.id,
      fromDriverId: selectedTrip.driver_id,
      toDriverId,
      note: `Reassign requested by ${
        dispatcherName || "dispatcher"
      } from LiveTrips map.`,
    });

    setLoadingAction(null);

    if (!result.ok) {
      setErrorText(result.message);
      return;
    }

    setLocalStatus(nextStatus);
    setStatusText(result.message);
    onActionCompleted?.();
  };

  const handleEmergency = async () => {
    if (!selectedTrip.id) return;
    resetMessages();
    setLoadingAction("emergency");

    const next = !localEmergency;
    const result = await postDispatchAction({
      action: "emergency",
      tripId: selectedTrip.id,
      isEmergency: next,
      note: `Emergency ${
        next ? "enabled" : "cleared"
      } by ${dispatcherName || "dispatcher"} from LiveTrips map.`,
    });

    setLoadingAction(null);

    if (!result.ok) {
      setErrorText(result.message);
      return;
    }

    setLocalEmergency(next);
    setLocalStatus(nextStatus);
    setStatusText(result.message);
    onActionCompleted?.();
  };

  const baseBtn =
    "flex flex-col items-center justify-center rounded-xl px-2 py-2 text-[10px] font-medium border transition";
  const disabledClasses =
    "border-slate-700 bg-slate-900/60 text-slate-500 cursor-not-allowed";
  const enabledClasses =
    "border-slate-600 bg-slate-900/90 text-slate-100 hover:bg-slate-800 hover:border-slate-400";

  const isLoading = (k: string) => loadingAction === k;

  const canNudge = !!selectedTrip.driver_id;
  const canReassign = !!selectedTrip.driver_id;
  const canEmergency = true;

  const handleStatus = async (nextStatus: string) => {
    if (!selectedTrip?.booking_code) return;
    resetMessages();
    setLoadingAction(`status:${nextStatus}`);

    const result = await postTripStatus(selectedTrip.booking_code, nextStatus);
    setLoadingAction(null);

    if (!result.ok) {
      setErrorText(result.message);
      return;
    }

    setLocalStatus(nextStatus);
    setStatusText(result.message);
    onActionCompleted?.();
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-3 text-[11px] text-slate-100 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wide text-slate-400">
            Dispatch actions
          </span>
          <span className="font-semibold leading-tight">Trip {tripLabel}</span>
          <span className="text-[10px] text-slate-400">
            Passenger: {passengerName} · {town}
          </span>
        </div>

        <span className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[10px]">
          {localStatus || "unknown"}
        </span>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {/* Call */}
        <button
          type="button"
          onClick={handleCall}
          disabled={!selectedTrip.driver_phone}
          className={[
            baseBtn,
            selectedTrip.driver_phone ? enabledClasses : disabledClasses,
          ].join(" ")}
        >
          <span className="text-lg leading-none">📞</span>
          <span>Call</span>
          <span className="text-[9px] text-slate-400">
            {selectedTrip.driver_phone ? "driver" : "no number"}
          </span>
        </button>

        {/* Nudge */}
        <button
          type="button"
          onClick={handleNudge}
          disabled={!canNudge || isLoading("nudge")}
          className={[
            baseBtn,
            !canNudge ? disabledClasses : enabledClasses,
          ].join(" ")}
        >
          <span className="text-lg leading-none">👉</span>
          <span>Nudge</span>
          <span className="text-[9px] text-slate-400">
            {isLoading("nudge") ? "sending..." : "slow / stuck"}
          </span>
        </button>

        {/* Reassign */}
        <button
          type="button"
          onClick={handleReassign}
          disabled={!canReassign || isLoading("reassign")}
          className={[
            baseBtn,
            !canReassign ? disabledClasses : enabledClasses,
          ].join(" ")}
        >
          <span className="text-lg leading-none">🔁</span>
          <span>Reassign</span>
          <span className="text-[9px] text-slate-400">change driver</span>
        </button>

        {/* Emergency */}
        <button
          type="button"
          onClick={handleEmergency}
          disabled={!canEmergency || isLoading("emergency")}
          className={[
            baseBtn,
            !canEmergency
              ? disabledClasses
              : isEmergency
              ? "border-red-500 bg-red-700/90 text-white hover:bg-red-600"
              : enabledClasses,
          ].join(" ")}
        >
          <span className="text-lg leading-none">🚨</span>
          <span>{isEmergency ? "Clear" : "Emergency"}</span>
          <span className="text-[9px] text-slate-400">priority alerts</span>
        </button>

        {/* Trip status */}
        <div className="col-span-4 grid grid-cols-3 gap-1.5 mt-2 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={() => handleStatus("on_the_way")}
            disabled={localStatus !== "assigned" || isLoading(`status:on_the_way`)}
            className={[
              baseBtn,
              localStatus !== "assigned" ? disabledClasses : enabledClasses,
            ].join(" ")}
          >
            <span className="text-lg leading-none">🚗</span>
            <span>On the way</span>
          </button>

          <button
            type="button"
            onClick={() => handleStatus("on_trip")}
            disabled={localStatus !== "on_the_way" || isLoading(`status:on_trip`)}
            className={[
              baseBtn,
              localStatus !== "on_the_way" ? disabledClasses : enabledClasses,
            ].join(" ")}
          >
            <span className="text-lg leading-none">▶️</span>
            <span>Start trip</span>
          </button>

          <button
            type="button"
            onClick={() => handleStatus("completed")}
            disabled={localStatus !== "on_trip" || isLoading(`status:completed`)}
            className={[
              baseBtn,
              localStatus !== "on_trip" ? disabledClasses : enabledClasses,
            ].join(" ")}
          >
            <span className="text-lg leading-none">🏁</span>
            <span>Drop off</span>
          </button>
        </div>
      </div>

      {(statusText || errorText) && (
        <div className="mt-1 text-[10px]">
          {statusText && <div className="text-emerald-400">{statusText}</div>}
          {errorText && <div className="text-red-400">{errorText}</div>}
        </div>
      )}

      <div className="mt-1 flex flex-col gap-0.5 text-[10px] text-slate-400">
        <span>Driver: {driverName}</span>
        {dispatcherName && <span>Dispatcher: {dispatcherName}</span>}
      </div>
    </div>
  );
}

export default DispatchActionPanel;

