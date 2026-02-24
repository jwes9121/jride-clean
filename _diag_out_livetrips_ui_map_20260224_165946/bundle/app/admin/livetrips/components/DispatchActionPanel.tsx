"use client";

import React, { useEffect, useState } from "react";

type Props = {
  bookingCode?: string | null;
  selectedTrip?: any | null;

  // Passed by DriverDetailsModal (optional)
  dispatcherName?: string;

  assignedDriverId?: string | null;
  canAssign?: boolean;

  // Optional to avoid breaking callers that don't wire manual assign here
  onAssign?: (driverId: string) => Promise<void>;

  onNudge?: () => Promise<void>;
  onEmergency?: () => Promise<void>;
};

export default function DispatchActionPanel({
  bookingCode,
  selectedTrip,
  dispatcherName,
  assignedDriverId,
  canAssign = true,
  onAssign,
  onNudge,
  onEmergency,
}: Props) {
  const [msg, setMsg] = useState<string>("");
  const [audit, setAudit] = useState<any[]>([]);

  // ===== Fetch dispatch audit history =====
  useEffect(() => {
    if (!bookingCode) {
      setAudit([]);
      return;
    }

    // Using your actual route path that is compiling: /api/admin/audit
    fetch(`/api/admin/audit?bookingCode=${bookingCode}`)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setAudit(j.data || []);
        else setAudit([]);
      })
      .catch(() => setAudit([]));
  }, [bookingCode]);

  if (!selectedTrip) {
    return (
      <div className="p-3 text-xs text-slate-500">
        Select a trip to see dispatch actions.
      </div>
    );
  }

  const assignDisabled = !canAssign || !!assignedDriverId || !onAssign;

  return (
    <div className="space-y-2 p-3 text-xs">
      {/* ===== Status ===== */}
      {msg && (
        <div className="rounded border border-slate-200 bg-slate-50 p-2 text-slate-700">
          {msg}
        </div>
      )}

      {/* ===== Dispatch actions ===== */}
      <div className="rounded border p-2">
        <div className="mb-1 font-semibold text-slate-600">Dispatch actions</div>

        <div className="flex flex-wrap gap-2">
          <button
            disabled={assignDisabled}
            onClick={() => {
              setMsg("");
              // This panel doesn't pick drivers; suggestions/parent handle actual assignment.
              // We keep it for compatibility + future wiring.
              if (!onAssign) {
                setMsg("Assign is not wired in this panel (use suggestions).");
              }
            }}
            className="rounded bg-slate-200 px-2 py-1 text-slate-700 disabled:opacity-40"
            title={
              dispatcherName
                ? `Dispatcher: ${dispatcherName}`
                : !onAssign
                ? "Assign not wired here"
                : undefined
            }
          >
            Assign via suggestions
          </button>

          {onNudge && (
            <button
              onClick={async () => {
                try {
                  setMsg("");
                  await onNudge();
                } catch (e: any) {
                  setMsg(e?.message || "Nudge failed");
                }
              }}
              className="rounded bg-slate-200 px-2 py-1 text-slate-700"
            >
              Nudge
            </button>
          )}

          {onEmergency && (
            <button
              onClick={async () => {
                try {
                  setMsg("");
                  await onEmergency();
                } catch (e: any) {
                  setMsg(e?.message || "Emergency failed");
                }
              }}
              className="rounded bg-rose-600 px-2 py-1 text-white"
            >
              Emergency
            </button>
          )}
        </div>
      </div>

      {/* ===== Dispatch audit history ===== */}
      {audit.length > 0 && (
        <div className="rounded border bg-slate-50 p-2">
          <div className="mb-1 font-semibold text-slate-600">
            Recent dispatch activity
          </div>

          <div className="space-y-1">
            {audit.map((a, i) => (
              <div key={i} className="flex justify-between">
                <span className={a.ok ? "text-emerald-600" : "text-rose-600"}>
                  {a.ok ? "OK" : a.code}
                </span>
                <span className="opacity-70">{a.actor || "unknown"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
