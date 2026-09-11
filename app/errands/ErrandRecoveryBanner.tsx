"use client";

import * as React from "react";

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function token(): string {
  if (typeof window === "undefined") return "";
  try {
    return text(
      localStorage.getItem("jride_access_token") ||
        localStorage.getItem("jride_passenger_token")
    );
  } catch {
    return "";
  }
}

function money(value: unknown): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `PHP ${Math.round(parsed)}` : "--";
}

export default function ErrandRecoveryBanner() {
  const [state, setState] = React.useState<any>(null);

  React.useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      const auth = token();
      if (!auth) return;
      try {
        const response = await fetch("/api/passenger/errand/current", {
          method: "GET",
          headers: { Authorization: `Bearer ${auth}` },
          cache: "no-store",
        });
        const json: any = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false || disposed) return;
        const errand = json?.errand || null;
        const job = errand?.job || {};
        const stage = text(job?.errand_stage).toLowerCase();
        if (
          ![
            "unreachable_escalated",
            "returning_after_unreachable",
            "waiting_at_unreachable_return",
          ].includes(stage)
        ) {
          setState(null);
          return;
        }
        setState({
          stage,
          targetKind: text(job?.escalation_return_target_kind).toLowerCase(),
          targetLabel: text(job?.escalation_return_target_label),
          returnKm: Number(job?.escalation_return_distance_km),
          fare: Number(errand?.fare?.total_errand_fare ?? errand?.booking?.total_errand_fare),
        });
      } catch {}
    };

    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, []);

  if (!state) return null;

  const returningToCustomer = state.targetKind === "customer";
  const targetTerm = returningToCustomer ? "customer" : "source";

  return (
    <div className="bg-[#071113] px-4 pt-3">
      <div className="mx-auto max-w-5xl rounded-2xl border border-[#806A3D] bg-[#392A15] px-4 py-3 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#FDE68A]">
          Errand Recovery
        </div>
        {state.stage === "unreachable_escalated" ? (
          <>
            <div className="mt-1 font-bold text-[#FDE68A]">Handoff escalated to JRide</div>
            <div className="mt-1 text-sm text-[#FDE68A]">
              The driver's waiting clock is stopped while dispatch decides where the item must be returned.
            </div>
          </>
        ) : state.stage === "returning_after_unreachable" ? (
          <>
            <div className="mt-1 font-bold text-[#FDE68A]">
              Driver returning item to {targetTerm}
            </div>
            <div className="mt-1 text-sm text-[#FDE68A]">
              {state.targetLabel ? `Return location: ${state.targetLabel}. ` : ""}
              Waiting is paused while travelling.
              {Number.isFinite(state.returnKm) ? ` Added routed distance: ${state.returnKm.toFixed(1)} km.` : ""}
              {Number.isFinite(state.fare) ? ` Current service fare: ${money(state.fare)}.` : ""}
            </div>
          </>
        ) : (
          <>
            <div className="mt-1 font-bold text-[#FDE68A]">
              Driver at the approved return location
            </div>
            <div className="mt-1 text-sm text-[#FDE68A]">
              The shared Errand waiting timer has resumed until custody of the item is returned.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
