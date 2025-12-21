"use client";

import React, { useMemo, useState } from "react";

type SelectedTrip = {
  id: string;
  booking_code?: string | null;
  status?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  passenger_name?: string | null;
  town?: string | null;
  is_emergency?: boolean;
};

type Props = {
  selectedTrip: SelectedTrip | null;
  dispatcherName?: string;
};

async function postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j && (j.error || j.message)) || "REQUEST_FAILED";
    throw new Error(msg);
  }
  return j;
}

export default function DispatchActionPanel({ selectedTrip }: Props) {
  const [busy, setBusy] = useState<string>(""); // "", "call", "nudge", "reassign", "emergency"
  const [msg, setMsg] = useState<string>("");

  const bookingCode = useMemo(() => {
    const c = selectedTrip?.booking_code ? String(selectedTrip.booking_code) : "";
    return c.trim();
  }, [selectedTrip]);

  

  const bookingId = useMemo(() => {
    const id = selectedTrip?.id ? String(selectedTrip.id) : "";
    return id.trim();
  }, [selectedTrip]);const phone = useMemo(() => {
    const p = selectedTrip?.driver_phone ? String(selectedTrip.driver_phone) : "";
    return p.trim();
  }, [selectedTrip]);

  const disabledAll = !selectedTrip || (!(bookingId || bookingCode)) || !!busy;

  const btn =
    "border border-slate-600 bg-slate-900/90 text-slate-100 hover:bg-slate-800 hover:border-slate-400 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg px-3 py-2 text-[12px]";

  async function doCall() {
    setMsg("");
    if (!phone) {
      setMsg("No driver phone on this trip.");
      return;
    }
    setBusy("call");
    try {
      window.open(`tel:${phone}`, "_self");
      setMsg("Opening dialerâ€¦");
    } finally {
      setBusy("");
    }
  }

  async function doNudge() {
    setMsg("");
    if (!bookingCode) return;
    setBusy("nudge");
    try {
      await postJson("/api/dispatch/nudge", { bookingId, bookingCode });
      setMsg("Nudge sent (server acknowledged).");
    } catch (e: any) {
      setMsg(`Nudge failed: ${e?.message || "UNKNOWN_ERROR"}`);
    } finally {
      setBusy("");
    }
  }

  async function doEmergency() {
    setMsg("");
    if (!bookingCode) return;
    setBusy("emergency");
    try {
      await postJson("/api/dispatch/emergency", { bookingId, bookingCode });
      setMsg("Emergency sent (server acknowledged).");
    } catch (e: any) {
      setMsg(`Emergency failed: ${e?.message || "UNKNOWN_ERROR"}`);
    } finally {
      setBusy("");
    }
  }

  function doReassign() {
    setMsg("");
    setBusy("reassign");
    try {
      // No DB assumptions here. Just help the dispatcher get to the manual assign block.
      const el =
        document.querySelector('[data-jride="assign-manual"]') ||
        document.querySelector("select") ||
        document.querySelector("button");
      if (el && "scrollIntoView" in el) {
        // @ts-ignore
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      setMsg("Scroll to Assign driver (manual) on the left to reassign.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/90 p-3 text-[11px] text-slate-100 space-y-2">
      <div className="text-[10px] tracking-wide text-slate-300">DISPATCH ACTIONS</div>

      <div className="grid grid-cols-2 gap-2">
        <button className={btn} onClick={doCall} disabled={disabledAll}>
          {busy === "call" ? "Callingâ€¦" : "Call"}
        </button>
        <button className={btn} onClick={doNudge} disabled={disabledAll}>
          {busy === "nudge" ? "Sendingâ€¦" : "Nudge"}
        </button>
        <button className={btn} onClick={doReassign} disabled={disabledAll}>
          Reassign
        </button>
        <button className={btn} onClick={doEmergency} disabled={disabledAll}>
          {busy === "emergency" ? "Sendingâ€¦" : "Emergency"}
        </button>
      </div>

      {msg ? <div className="text-[10px] text-slate-300">{msg}</div> : null}
    </div>
  );
}
