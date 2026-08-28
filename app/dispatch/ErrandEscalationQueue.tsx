"use client";

import * as React from "react";

type EscalatedErrand = {
  booking_id: string;
  booking_code: string;
  booking_status: string;
  errand_stage: string;
  passenger_name?: string | null;
  town?: string | null;
  is_pabili?: boolean;
  final_destination_mode?: string | null;
  final_label?: string | null;
  total_errand_fare?: number | null;
  distance_fare?: number | null;
  waiting_fee?: number | null;
  unreachable_escalated_at?: string | null;
  resolution_type?: string | null;
  resolution_status?: string | null;
  return_target_kind?: string | null;
  return_target_label?: string | null;
  return_distance_km?: number | null;
  recommended_resolution?: string | null;
  recommended_label?: string | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function money(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `PHP ${Math.round(parsed)}` : "--";
}

function km(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)} km` : "--";
}

function timeLabel(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  return new Date(parsed).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ErrandEscalationQueue() {
  const [rows, setRows] = React.useState<EscalatedErrand[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [busyId, setBusyId] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const refresh = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/dispatch/errand-resolution", {
        method: "GET",
        cache: "no-store",
      });
      const json: any = await response.json().catch(() => ({}));
      if (response.status === 403) {
        setRows([]);
        setError("");
        return;
      }
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setRows(Array.isArray(json?.rows) ? json.rows : []);
      setError("");
    } catch (err: any) {
      setError(text(err?.message) || "Could not load escalated Errands.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let disposed = false;
    void refresh(false);
    const timer = setInterval(() => {
      if (!disposed) void refresh(true);
    }, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [refresh]);

  async function startReturn(row: EscalatedErrand) {
    const resolution = text(row.recommended_resolution);
    if (!resolution || resolution === "custody_required") return;

    const label =
      resolution === "return_to_customer"
        ? "RETURN ITEM TO CUSTOMER"
        : "RETURN ITEM TO SOURCE";

    const confirmed = window.confirm(
      `${label}?\n\nErrand: ${row.booking_code}\n\n` +
        "The driver will receive a new return route. The added routed-road distance will be added to the Errand fare. No extra task-stop fee will be added. Waiting stays stopped while the driver travels."
    );
    if (!confirmed) return;

    setBusyId(row.booking_id);
    setNotice("");
    try {
      const response = await fetch("/api/dispatch/errand-resolution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: row.booking_id,
          action: "start_return",
          resolution_type: resolution,
        }),
        cache: "no-store",
      });
      const json: any = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      const target = text(json?.target_label);
      const added = Number(json?.additional_route_distance_km);
      setNotice(
        `${label} sent to driver${target ? ` - ${target}` : ""}` +
          (Number.isFinite(added) ? ` - added route ${added.toFixed(1)} km` : "")
      );
      await refresh(true);
    } catch (err: any) {
      setNotice(`Failed: ${text(err?.message) || "Could not start return."}`);
    } finally {
      setBusyId("");
    }
  }

  if (!loading && !error && rows.length === 0) return null;

  return (
    <div className="px-4 pt-4">
      <div className="mx-auto max-w-[1500px] rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">
              Escalated Errand Recovery
            </div>
            <div className="mt-1 text-sm text-amber-950">
              The driver waiting clock is stopped. Dispatch must choose the custody return before the Errand can close.
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refresh(false)}
            className="rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 hover:bg-amber-100"
          >
            Refresh
          </button>
        </div>

        {notice ? (
          <div className="mt-3 rounded-xl border border-amber-300 bg-white px-3 py-2 text-sm font-medium text-amber-950">
            {notice}
          </div>
        ) : null}

        {error ? (
          <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="mt-3 text-sm text-amber-900">Loading escalated Errands...</div>
        ) : null}

        <div className="mt-3 grid gap-3">
          {rows.map((row) => {
            const stage = text(row.errand_stage);
            const awaitingDecision = stage === "unreachable_escalated";
            const custodyRequired = text(row.recommended_resolution) === "custody_required";
            const actionLabel =
              text(row.recommended_label) ||
              (text(row.recommended_resolution) === "return_to_customer"
                ? "RETURN ITEM TO CUSTOMER"
                : "RETURN ITEM TO SOURCE");

            return (
              <div key={row.booking_id} className="rounded-2xl border border-amber-200 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Errand No.
                    </div>
                    <div className="select-all break-all font-mono text-base font-black text-slate-950">
                      {row.booking_code || row.booking_id}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-700">
                      <span><b>Passenger:</b> {row.passenger_name || "--"}</span>
                      <span><b>Town:</b> {row.town || "--"}</span>
                      <span><b>Fare:</b> {money(row.total_errand_fare)}</span>
                      <span><b>Waiting:</b> {money(row.waiting_fee)}</span>
                      {row.unreachable_escalated_at ? (
                        <span><b>Escalated:</b> {timeLabel(row.unreachable_escalated_at)}</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 lg:w-[420px]">
                    {awaitingDecision ? (
                      custodyRequired ? (
                        <>
                          <div className="font-bold text-red-800">JRIDE CUSTODY REQUIRED</div>
                          <div className="mt-1 text-xs text-slate-600">
                            Pabili goods are not automatically returned to the merchant. Keep the driver waiting clock stopped and arrange custody or redelivery.
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-xs uppercase tracking-wide text-slate-500">Recommended recovery</div>
                          <div className="mt-1 font-bold text-slate-950">{actionLabel}</div>
                          <button
                            type="button"
                            disabled={busyId === row.booking_id}
                            onClick={() => void startReturn(row)}
                            className="mt-3 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:cursor-wait disabled:opacity-60"
                          >
                            {busyId === row.booking_id ? "Sending return route..." : actionLabel}
                          </button>
                        </>
                      )
                    ) : (
                      <>
                        <div className="text-xs uppercase tracking-wide text-slate-500">Recovery in progress</div>
                        <div className="mt-1 font-bold text-emerald-800">
                          {row.resolution_type === "return_to_customer"
                            ? "RETURN ITEM TO CUSTOMER"
                            : "RETURN ITEM TO SOURCE"}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          Target: {row.return_target_label || "--"}
                        </div>
                        <div className="mt-1 text-sm text-slate-700">
                          Added route: {km(row.return_distance_km)}
                        </div>
                        <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {row.resolution_status === "waiting_at_target"
                            ? "Driver at return location"
                            : "Driver returning item"}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
