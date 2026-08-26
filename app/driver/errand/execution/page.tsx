"use client";

import * as React from "react";
import { supabase } from "@/lib/supabaseDriverClient";
import ErrandLocationField, {
  type ErrandLocationValue,
} from "@/app/errands/ErrandLocationField";

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): string {
  const parsed = num(value);
  return parsed == null ? "--" : `PHP ${parsed.toFixed(0)}`;
}

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return text(data?.session?.access_token);
}

async function requestJson(url: string, method: "GET" | "POST", body?: unknown) {
  const accessToken = await token();
  const response = await fetch(url, {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  return { response, json, accessToken };
}

function stageLabel(stageRaw: unknown): string {
  const stage = text(stageRaw).toLowerCase();
  const labels: Record<string, string> = {
    task_confirmed: "Task confirmed",
    going_to_stop: "Going to task stop",
    waiting_at_stop: "At task stop",
    resolving_stop_issue: "Resolving stop issue",
    going_to_customer_for_cash: "Going back for Pabili cash",
    waiting_for_cash_topup: "Waiting for Pabili cash",
    returning_to_stop_after_cash: "Returning to task stop",
    going_to_final: "Going to final destination",
    waiting_at_final_handoff: "Final handoff",
    unreachable_escalated: "Handoff escalated",
    handoff_complete: "Handoff complete",
    completed: "Errand completed",
  };
  return labels[stage] || stage || "Errand execution";
}

export default function DriverErrandExecutionPage() {
  const [payload, setPayload] = React.useState<any>(null);
  const [ready, setReady] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);
  const [featureDisabled, setFeatureDisabled] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [purchaseTotal, setPurchaseTotal] = React.useState("");
  const [receiptPath, setReceiptPath] = React.useState("");
  const [receiptBusy, setReceiptBusy] = React.useState(false);
  const [substitute, setSubstitute] = React.useState<ErrandLocationValue | null>(null);
  const [topupRequested, setTopupRequested] = React.useState("");
  const [topupReceived, setTopupReceived] = React.useState("");
  const [remoteTopup, setRemoteTopup] = React.useState("");
  const [changeReturned, setChangeReturned] = React.useState("");
  const [clock, setClock] = React.useState(Date.now());

  const errand = payload?.errand || null;
  const booking = errand?.booking || {};
  const job = errand?.job || {};
  const stops = Array.isArray(errand?.stops) ? errand.stops : [];
  const fare = errand?.fare || {};
  const pabili = errand?.pabili || {};
  const bookingId = text(booking?.id);
  const stage = text(job?.errand_stage).toLowerCase();
  const status = text(booking?.status).toLowerCase();
  const currentSequence = Number(job?.current_stop_sequence || 0) || null;
  const currentStop = currentSequence
    ? stops.find((stop: any) => Number(stop?.sequence) === currentSequence) || null
    : null;

  async function refresh(silent = false) {
    try {
      const { response, json, accessToken } = await requestJson(
        "/api/driver/errand/current",
        "GET"
      );
      if (!accessToken) {
        setAuthed(false);
        setPayload(null);
        return;
      }
      setAuthed(true);
      if (response.status === 503) {
        setFeatureDisabled(true);
        setPayload(null);
        return;
      }
      setFeatureDisabled(false);
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setError("");
      setPayload(json);
      if (!silent && json?.errand?.job?.pabili_change_remaining != null) {
        setChangeReturned(String(json.errand.job.pabili_change_remaining));
      }
    } catch (err: any) {
      setError(text(err?.message) || "Could not load Errand execution.");
    } finally {
      setReady(true);
    }
  }

  React.useEffect(() => {
    void refresh(false);
    const poll = setInterval(() => void refresh(true), 3000);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(timer);
    };
  }, []);

  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return null;
    setBusy(name);
    setError("");
    setNotice("");
    try {
      const { response, json } = await requestJson(
        "/api/driver/errand/action",
        "POST",
        { action: name, booking_id: bookingId, ...extra }
      );
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setNotice(`Updated: ${name.replaceAll("_", " ")}.`);
      await refresh(false);
      return json;
    } catch (err: any) {
      setError(text(err?.message) || `Action failed: ${name}`);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function pabiliAction(name: string, amount: number) {
    if (!bookingId) return null;
    setBusy(name);
    setError("");
    try {
      const { response, json } = await requestJson(
        "/api/driver/errand/pabili/action",
        "POST",
        {
          action: name,
          booking_id: bookingId,
          amount,
          confirmation_method: "phone",
        }
      );
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setNotice(name === "record_change_returned" ? "Customer change recorded as returned." : "Remote customer top-up recorded.");
      await refresh(false);
      return json;
    } catch (err: any) {
      setError(text(err?.message) || "Pabili action failed.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function uploadReceipt(file: File) {
    if (!bookingId || !currentSequence) return;
    setReceiptBusy(true);
    setError("");
    try {
      const accessToken = await token();
      const form = new FormData();
      form.set("booking_id", bookingId);
      form.set("sequence", String(currentSequence));
      form.set("file", file);
      const response = await fetch("/api/driver/errand/receipt/upload", {
        method: "POST",
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
        body: form,
        cache: "no-store",
      });
      const json: any = await response.json().catch(() => ({}));
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setReceiptPath(text(json?.receipt_path || json?.receipt_photo_url));
      setNotice("Receipt uploaded privately. Enter the actual purchase total, then complete this stop.");
    } catch (err: any) {
      setError(text(err?.message) || "Receipt upload failed.");
    } finally {
      setReceiptBusy(false);
    }
  }

  function directions(lat: unknown, lng: unknown): string {
    const a = num(lat);
    const b = num(lng);
    if (a == null || b == null) return "";
    return `https://www.google.com/maps/dir/?api=1&destination=${a},${b}`;
  }

  const waitingStartedAt = text(job?.waiting_started_at);
  const runningWaitSeconds = waitingStartedAt
    ? Math.max(0, Math.floor((clock - Date.parse(waitingStartedAt)) / 1000))
    : 0;
  const accumulated = Number(job?.waiting_accumulated_seconds || 0);
  const liveWaitMinutes = Math.ceil((accumulated + runningWaitSeconds) / 60);
  const finalArrivedAt = text(job?.final_arrived_at);
  const finalLocalSeconds = finalArrivedAt
    ? Math.max(0, Math.floor((clock - Date.parse(finalArrivedAt)) / 1000))
    : 0;
  const finalCutoffReached = finalLocalSeconds >= 1800;
  const changeRemaining = num(pabili?.change_remaining ?? job?.pabili_change_remaining) ?? 0;

  if (!ready) {
    return <main className="min-h-screen bg-slate-950 p-5 text-white">Loading Errand execution...</main>;
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-950 p-5 text-white">
        <div className="mx-auto max-w-lg rounded-3xl bg-slate-900 p-6">
          Driver sign-in required.
          <a href="/driver/login" className="ml-2 text-emerald-400">Login</a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-4xl space-y-4 px-4 py-5">
        <header className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-emerald-400">JRide Driver</div>
              <h1 className="mt-1 text-2xl font-semibold">Errand Execution</h1>
              <div className="mt-1 text-xs text-slate-400">{stageLabel(stage)} | {text(booking?.booking_code) || "No active booking"}</div>
            </div>
            <div className="flex gap-2">
              <a href="/driver/errand" className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Stage 0</a>
              <a href="/driver/livetracking" className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Tracking</a>
            </div>
          </div>
        </header>

        {featureDisabled ? <Banner tone="amber">Errand pilot is disabled by feature flag.</Banner> : null}
        {notice ? <Banner tone="green">{notice}</Banner> : null}
        {error ? <Banner tone="red">{error}</Banner> : null}

        {!featureDisabled && !errand ? (
          <Card title="No active Errand">There is no active Errand assigned to this driver.</Card>
        ) : null}

        {errand ? (
          <>
            <Card title="Running fare">
              <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <Metric label="Service fare" value={money(fare?.total_errand_fare)} />
                <Metric label="Waiting" value={`${liveWaitMinutes} min | ${money(fare?.waiting_fee)}`} />
                <Metric label="Current stop" value={currentSequence ? `Stop ${currentSequence}` : "Final"} />
                <Metric label="Driver payout" value={money(fare?.driver_payout)} />
              </div>
              <div className="mt-3 text-[11px] text-slate-500">Fare is based on the confirmed route, not the driver's live GPS path.</div>
            </Card>

            {(stage === "task_confirmed" || status === "ready") ? (
              <Card title="Passenger confirmed the task">
                <div className="text-sm text-emerald-200">The task is locked. Start only when ready to travel to Stop 1.</div>
                <button disabled={!!busy} onClick={() => void action("start_execution")} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-50">Start Errand</button>
              </Card>
            ) : null}

            {stage === "going_to_stop" && currentStop ? (
              <Card title={`Go to Stop ${currentSequence}`}>
                <div className="text-lg font-semibold">{text(currentStop?.location_label)}</div>
                {text(currentStop?.instructions) ? <div className="mt-1 text-sm text-slate-400">{text(currentStop.instructions)}</div> : null}
                {directions(currentStop?.lat, currentStop?.lng) ? <a href={directions(currentStop?.lat, currentStop?.lng)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold">Open Directions</a> : null}
                <button disabled={!!busy} onClick={() => void action("arrive_stop", { sequence: currentSequence })} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-50">Arrived at Stop {currentSequence}</button>
              </Card>
            ) : null}

            {stage === "waiting_at_stop" && currentStop ? (
              <Card title={`Stop ${currentSequence}: ${text(currentStop?.location_label)}`}>
                <div className="rounded-2xl bg-slate-950/60 p-3 text-sm">Cumulative waiting: {liveWaitMinutes} min. First 15 total minutes are free.</div>

                {job?.is_pabili ? (
                  <div className="mt-4 rounded-2xl border border-slate-800 p-4">
                    <div className="font-semibold">Pabili purchase proof</div>
                    <div className="mt-1 text-xs text-slate-400">Customer funds available: {money(pabili?.customer_funds_received)}</div>
                    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={receiptBusy} onChange={(e) => { const file = e.target.files?.[0]; if (file) void uploadReceipt(file); }} className="mt-3 block w-full text-xs" />
                    {receiptPath ? <div className="mt-2 text-xs text-emerald-300">Receipt uploaded.</div> : null}
                    <input type="number" min="0" value={purchaseTotal} onChange={(e) => setPurchaseTotal(e.target.value)} placeholder="Actual purchase total" className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" />
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input type="number" min="0" value={remoteTopup} onChange={(e) => setRemoteTopup(e.target.value)} placeholder="Remote top-up amount" className="rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" />
                      <button disabled={(num(remoteTopup) ?? 0) <= 0 || !!busy} onClick={() => void pabiliAction("record_remote_topup", num(remoteTopup) || 0)} className="rounded-2xl border border-sky-700 bg-sky-950/40 p-3 text-sm font-semibold disabled:opacity-40">Record Remote Top-Up</button>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <input type="number" min="0" value={topupRequested} onChange={(e) => setTopupRequested(e.target.value)} placeholder="Cash needed if returning" className="rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" />
                      <button disabled={(num(topupRequested) ?? 0) <= 0 || !!busy} onClick={() => void action("confirm_cash_topup_return", { sequence: currentSequence, requested_additional_cash: num(topupRequested), confirmation_method: "phone" })} className="rounded-2xl border border-amber-700 bg-amber-950/40 p-3 text-sm font-semibold disabled:opacity-40">Customer Confirmed Return for Cash</button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <button disabled={!!busy || (job?.is_pabili && ((num(purchaseTotal) ?? 0) > 0 && !receiptPath))} onClick={() => void action("complete_stop", { sequence: currentSequence, receipt_photo_url: receiptPath || null, purchase_total: num(purchaseTotal) })} className="rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-40">Complete Stop</button>
                  <button disabled={!!busy} onClick={() => void action("mark_stop_closed", { sequence: currentSequence })} className="rounded-2xl border border-amber-700 bg-amber-950/30 py-3 font-semibold">Store / Location Closed</button>
                  <button disabled={!!busy} onClick={() => void action("mark_stop_unfulfilled", { sequence: currentSequence, reason_code: "item_unavailable" })} className="rounded-2xl border border-slate-700 bg-slate-800 py-3 font-semibold">Item Unavailable</button>
                </div>
              </Card>
            ) : null}

            {stage === "resolving_stop_issue" && currentStop ? (
              <Card title={`Resolve Stop ${currentSequence}`}>
                <div className="text-sm text-slate-400">Waiting continues only while you are actually contacting the customer. A confirmed substitute inherits this same stop slot.</div>
                <div className="mt-4 text-slate-900"><ErrandLocationField title="Confirmed substitute location" value={substitute} onChange={setSubstitute} /></div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <button disabled={!substitute || !!busy} onClick={() => substitute && void action("confirm_substitute", { sequence: currentSequence, substitute_place_name: substitute.label, substitute_location_label: substitute.label, substitute_lat: substitute.lat, substitute_lng: substitute.lng, confirmation_method: "phone" })} className="rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-40">Customer Confirmed Substitute</button>
                  <button disabled={!!busy} onClick={() => void action("mark_stop_unfulfilled", { sequence: currentSequence, reason_code: "location_closed_no_substitute" })} className="rounded-2xl border border-slate-700 bg-slate-800 py-3 font-semibold">No Substitute - Unfulfilled</button>
                </div>
              </Card>
            ) : null}

            {stage === "going_to_customer_for_cash" ? (
              <Card title="Return to Customer for Additional Cash">
                <div className="text-sm text-slate-400">Travel is not waiting. This confirmed return route is added to route distance with no extra stop fee.</div>
                {directions(booking?.pickup_lat, booking?.pickup_lng) ? <a href={directions(booking?.pickup_lat, booking?.pickup_lng)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold">Directions to Customer</a> : null}
                <button disabled={!!busy} onClick={() => void action("arrive_cash_topup_customer")} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold">Arrived at Customer</button>
              </Card>
            ) : null}

            {stage === "waiting_for_cash_topup" ? (
              <Card title="Receive Additional Customer Cash">
                <div className="text-sm text-slate-400">Waiting here joins the same cumulative waiting meter.</div>
                <input type="number" min="0" value={topupReceived} onChange={(e) => setTopupReceived(e.target.value)} placeholder="Cash actually received" className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" />
                <button disabled={(num(topupReceived) ?? 0) <= 0 || !!busy} onClick={() => void action("receive_cash_topup", { received_additional_cash: num(topupReceived) })} className="mt-3 w-full rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-40">Record Cash and Return to Store</button>
              </Card>
            ) : null}

            {stage === "returning_to_stop_after_cash" && currentStop ? (
              <Card title={`Return to Stop ${currentSequence}`}>
                <div className="text-lg font-semibold">{text(currentStop?.location_label)}</div>
                {directions(currentStop?.lat, currentStop?.lng) ? <a href={directions(currentStop?.lat, currentStop?.lng)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold">Directions Back to Stop</a> : null}
                <button disabled={!!busy} onClick={() => void action("return_to_stop_after_cash")} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold">Returned to Stop</button>
              </Card>
            ) : null}

            {stage === "going_to_final" ? (
              <Card title="Go to Final Destination">
                <div className="text-lg font-semibold">{text(job?.final_label || booking?.to_label)}</div>
                {directions(job?.final_lat, job?.final_lng) ? <a href={directions(job?.final_lat, job?.final_lng)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-xl bg-sky-700 px-4 py-2 text-sm font-semibold">Open Final Directions</a> : null}
                <button disabled={!!busy} onClick={() => void action("arrive_final")} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold">Arrived at Final Handoff</button>
              </Card>
            ) : null}

            {stage === "waiting_at_final_handoff" ? (
              <Card title="Final Handoff">
                <div className="rounded-2xl bg-slate-950/60 p-3 text-sm">Local final-handoff wait: {Math.min(30, Math.ceil(finalLocalSeconds / 60))} / 30 min</div>
                {job?.is_pabili && changeRemaining > 0 ? (
                  <div className="mt-4 rounded-2xl border border-amber-800 bg-amber-950/30 p-4">
                    <div className="text-sm">Change remaining: {money(changeRemaining)}</div>
                    <input type="number" min="0" value={changeReturned} onChange={(e) => setChangeReturned(e.target.value)} className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" />
                    <button disabled={(num(changeReturned) ?? 0) <= 0 || !!busy} onClick={() => void pabiliAction("record_change_returned", num(changeReturned) || 0)} className="mt-2 w-full rounded-2xl bg-emerald-600 py-3 font-semibold disabled:opacity-40">Record Change Returned</button>
                  </div>
                ) : null}
                {!finalCutoffReached ? <button disabled={!!busy || changeRemaining > 0} onClick={() => void action("complete_errand")} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-40">Complete Handoff and Errand</button> : <button disabled={!!busy} onClick={() => void action("escalate_unreachable")} className="mt-4 w-full rounded-2xl bg-red-600 py-3 font-semibold">30 Minutes Reached - Escalate Unreachable</button>}
              </Card>
            ) : null}

            {stage === "unreachable_escalated" ? <Banner tone="red">Final handoff is escalated. Do not abandon, redirect, or dispose of goods. Wait for JRide dispatcher/support instructions.</Banner> : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5"><div className="mb-3 font-semibold">{title}</div>{children}</section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-950/50 p-3"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

function Banner({ tone, children }: { tone: "green" | "amber" | "red"; children: React.ReactNode }) {
  const cls = tone === "green" ? "border-emerald-700 bg-emerald-950/40 text-emerald-100" : tone === "amber" ? "border-amber-700 bg-amber-950/40 text-amber-100" : "border-red-700 bg-red-950/40 text-red-100";
  return <div className={`rounded-2xl border p-4 text-sm ${cls}`}>{children}</div>;
}
