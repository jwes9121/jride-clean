"use client";

import * as React from "react";
import { supabase } from "@/lib/supabaseDriverClient";
import ErrandLocationField, {
  type ErrandLocationValue,
} from "@/app/errands/ErrandLocationField";

type StopDraft = {
  id: string;
  location: ErrandLocationValue | null;
  instructions: string;
};

type CurrentPayload = {
  ok?: boolean;
  driver?: any;
  driver_location?: any;
  offer?: any;
  errand?: any;
  error?: string;
  message?: string;
};

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

function km(value: unknown): string {
  const parsed = num(value);
  return parsed == null ? "--" : `${parsed.toFixed(1)} km`;
}

function nextId(): string {
  return `stop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return text(data?.session?.access_token);
}

async function requestJson(url: string, method: "GET" | "POST", body?: unknown) {
  const token = await accessToken();
  const response = await fetch(url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST" ? { "content-type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body ?? {}) } : {}),
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  return { response, json, token };
}

function stageLabel(stageRaw: unknown, statusRaw: unknown): string {
  const stage = text(stageRaw).toLowerCase();
  const status = text(statusRaw).toLowerCase();
  const labels: Record<string, string> = {
    driver_assigned: "New Errand offer",
    going_to_customer: "Go to customer",
    stage0_review: "Stage 0 review",
    awaiting_customer_confirmation: "Waiting for customer confirmation",
    task_confirmed: "Task confirmed",
    going_to_stop: "Going to task stop",
    waiting_at_stop: "Waiting at task stop",
    going_to_final: "Going to final destination",
    waiting_at_final_handoff: "Waiting at final handoff",
    unreachable_escalated: "Final handoff escalated",
    completed: "Errand completed",
  };
  return labels[stage] || (status === "assigned" ? "New Errand offer" : stage || status || "Errand");
}

export default function DriverErrandPage() {
  const [payload, setPayload] = React.useState<CurrentPayload | null>(null);
  const [sessionReady, setSessionReady] = React.useState(false);
  const [authed, setAuthed] = React.useState(false);
  const [featureDisabled, setFeatureDisabled] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [clock, setClock] = React.useState(Date.now());
  const expireRef = React.useRef("");

  const [reviewId, setReviewId] = React.useState("");
  const [task, setTask] = React.useState("");
  const [stops, setStops] = React.useState<StopDraft[]>([]);
  const [finalMode, setFinalMode] = React.useState<"return_to_customer" | "different_address">("return_to_customer");
  const [finalLocation, setFinalLocation] = React.useState<ErrandLocationValue | null>(null);
  const [cargoWeight, setCargoWeight] = React.useState("0");
  const [vehicleRequirement, setVehicleRequirement] = React.useState<"either" | "motorcycle" | "tricycle">("either");
  const [isPabili, setIsPabili] = React.useState(false);
  const [estimatedPurchase, setEstimatedPurchase] = React.useState("");
  const [cashReceived, setCashReceived] = React.useState("");
  const [vehicleSuitable, setVehicleSuitable] = React.useState<boolean | null>(null);
  const [reviewDirty, setReviewDirty] = React.useState(true);
  const [cashRecorded, setCashRecorded] = React.useState(false);

  const errand = payload?.errand || null;
  const booking = errand?.booking || {};
  const job = errand?.job || {};
  const fare = errand?.fare || {};
  const pabili = errand?.pabili || {};
  const offer = payload?.offer || {};
  const driver = payload?.driver || {};
  const driverLocation = payload?.driver_location || {};
  const currentStops = Array.isArray(errand?.stops) ? errand.stops : [];
  const bookingId = text(booking?.id);
  const status = text(booking?.status).toLowerCase();
  const stage = text(job?.errand_stage).toLowerCase();

  async function refresh(silent = false) {
    if (!silent) setLoading(true);
    try {
      const { response, json, token } = await requestJson("/api/driver/errand/current", "GET");
      if (!token) {
        setAuthed(false);
        setPayload(null);
        return;
      }
      setAuthed(true);
      if (response.status === 503) {
        setFeatureDisabled(true);
        setPayload(null);
        setError("");
        return;
      }
      setFeatureDisabled(false);
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setError("");
      setPayload(json as CurrentPayload);
    } catch (err: any) {
      setError(text(err?.message) || "Could not refresh Errand screen.");
    } finally {
      setSessionReady(true);
      if (!silent) setLoading(false);
    }
  }

  React.useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const signedIn = !!data?.session?.access_token;
      setAuthed(signedIn);
      setSessionReady(true);
      if (signedIn) void refresh(false);
      else setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    if (!authed || featureDisabled) return;
    const timer = setInterval(() => void refresh(true), 3000);
    return () => clearInterval(timer);
  }, [authed, featureDisabled]);

  React.useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresAt = Date.parse(text(offer?.expires_at));
  const secondsLeft =
    status === "assigned" && Number.isFinite(expiresAt)
      ? Math.max(0, Math.ceil((expiresAt - clock) / 1000))
      : null;

  async function normalAction(action: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return null;
    setBusy(action);
    setNotice("");
    setError("");
    try {
      const { response, json } = await requestJson("/api/driver/errand/action", "POST", {
        action,
        booking_id: bookingId,
        ...extra,
      });
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      await refresh(false);
      return json;
    } catch (err: any) {
      setError(text(err?.message) || `Errand action failed: ${action}`);
      return null;
    } finally {
      setBusy("");
    }
  }

  async function offerAction(action: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return null;
    setBusy(action);
    setNotice("");
    setError("");
    try {
      const { response, json } = await requestJson("/api/driver/errand/offer", "POST", {
        action,
        booking_id: bookingId,
        ...extra,
      });
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      if (action === "decline") {
        setNotice("Errand passed. JRide is checking the next eligible same-town driver.");
      } else if (action === "vehicle_not_suitable") {
        setNotice("Errand released for a suitable vehicle. No Pabili cash was accepted.");
      }
      await refresh(false);
      return json;
    } catch (err: any) {
      setError(text(err?.message) || "Errand release action failed.");
      return null;
    } finally {
      setBusy("");
    }
  }

  React.useEffect(() => {
    if (status !== "assigned" || secondsLeft == null || secondsLeft > 0 || !bookingId) return;
    if (expireRef.current === bookingId) return;
    expireRef.current = bookingId;
    void offerAction("expire_offer");
  }, [status, secondsLeft, bookingId]);

  React.useEffect(() => {
    if (!bookingId || stage !== "stage0_review" || reviewId === bookingId) return;
    setReviewId(bookingId);
    setTask(text(job?.task_description));
    setStops(
      currentStops.map((stop: any, index: number) => ({
        id: text(stop?.id) || nextId(),
        location:
          num(stop?.lat) != null && num(stop?.lng) != null
            ? {
                label: text(stop?.location_label) || `Stop ${index + 1}`,
                lat: Number(stop.lat),
                lng: Number(stop.lng),
              }
            : null,
        instructions: text(stop?.instructions),
      }))
    );
    setFinalMode(text(job?.final_destination_mode) === "different_address" ? "different_address" : "return_to_customer");
    setFinalLocation(
      num(job?.final_lat) != null && num(job?.final_lng) != null
        ? {
            label: text(job?.final_label) || "Final destination",
            lat: Number(job.final_lat),
            lng: Number(job.final_lng),
          }
        : null
    );
    setCargoWeight(String(num(job?.confirmed_cargo_weight_kg ?? job?.estimated_cargo_weight_kg) ?? 0));
    setVehicleRequirement(
      ["either", "motorcycle", "tricycle"].includes(text(job?.vehicle_requirement))
        ? (text(job?.vehicle_requirement) as "either" | "motorcycle" | "tricycle")
        : "either"
    );
    setIsPabili(job?.is_pabili === true);
    setEstimatedPurchase(num(job?.estimated_purchase_amount) == null ? "" : String(Number(job.estimated_purchase_amount)));
    const existingCash = num(job?.pabili_cash_received);
    setCashReceived(existingCash == null ? "" : String(existingCash));
    setCashRecorded((existingCash ?? 0) > 0);
    setVehicleSuitable(null);
    setReviewDirty(true);
  }, [bookingId, stage, reviewId]);

  function dirty() {
    setReviewDirty(true);
    setVehicleSuitable(null);
  }

  const cargoKg = num(cargoWeight);
  const reviewValid =
    text(task).length >= 3 &&
    stops.length > 0 &&
    stops.every((stop) => !!stop.location) &&
    (finalMode === "return_to_customer" || !!finalLocation) &&
    cargoKg != null && cargoKg >= 0 && cargoKg <= 100 &&
    (!isPabili || num(estimatedPurchase) != null);

  async function saveReview(withCash: boolean) {
    if (!reviewValid) {
      setError("Complete task details, all pins, final destination, and cargo information first.");
      return;
    }
    const final =
      finalMode === "return_to_customer"
        ? {
            label: text(booking?.from_label),
            lat: num(booking?.pickup_lat),
            lng: num(booking?.pickup_lng),
          }
        : finalLocation;

    const result = await normalAction("save_stage0_review", {
      task_description: text(task),
      stops: stops.map((stop) => ({
        place_name: stop.location?.label || null,
        location_label: stop.location?.label || "",
        lat: stop.location?.lat ?? null,
        lng: stop.location?.lng ?? null,
        instructions: text(stop.instructions) || null,
      })),
      final_destination_mode: finalMode,
      final_label: final?.label || null,
      final_lat: final?.lat ?? null,
      final_lng: final?.lng ?? null,
      is_pabili: isPabili,
      estimated_purchase_amount: isPabili ? num(estimatedPurchase) : null,
      pabili_cash_received: isPabili && withCash ? num(cashReceived) : null,
      confirmed_cargo_weight_kg: cargoKg,
      vehicle_requirement: vehicleRequirement,
    });

    if (!result) return;
    const suitable = result?.vehicle_suitable === true;
    setVehicleSuitable(suitable);
    setReviewDirty(false);
    if (!suitable) {
      setNotice("Vehicle/load check did not pass. Do not accept Pabili cash.");
      return;
    }
    if (isPabili && withCash && (num(cashReceived) ?? 0) > 0) {
      setCashRecorded(true);
      setNotice("Customer Pabili cash recorded.");
    } else {
      setNotice(isPabili ? "Vehicle/load check passed. You may now receive customer cash." : "Vehicle/load check passed. Review saved.");
    }
  }

  async function sendForCustomerReview() {
    if (vehicleSuitable !== true || reviewDirty) {
      setError("Save the review and pass the vehicle/load check first.");
      return;
    }
    if (isPabili && !cashRecorded) {
      setError("Record customer Pabili cash first.");
      return;
    }
    const result = await normalAction("ready_for_customer_review");
    if (result) setNotice("Task and starting fare sent to the customer. Wait for Confirm Task.");
  }

  if (!sessionReady || loading) {
    return <main className="min-h-screen bg-slate-950 p-5 text-slate-100">Loading Driver Errand...</main>;
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
        <div className="mx-auto max-w-lg rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <h1 className="text-xl font-semibold">Driver sign-in required</h1>
          <a href="/driver/login" className="mt-4 inline-flex rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white">Driver Login</a>
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
              <h1 className="mt-1 text-2xl font-semibold">Errand / Pabili</h1>
              <div className="mt-1 text-xs text-slate-400">
                {text(driver?.full_name || driver?.callsign) || "JRide Driver"} | {text(driver?.vehicle_type || driverLocation?.vehicle_type) || "vehicle pending"}
              </div>
            </div>
            <div className="flex gap-2">
              <a href="/driver/livetracking" className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Live Tracking</a>
              <a href="/driver" className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs">Dashboard</a>
            </div>
          </div>
        </header>

        {featureDisabled ? (
          <div className="rounded-3xl border border-amber-700 bg-amber-950/40 p-5 text-amber-100">Errand pilot is installed but the production feature flag is off.</div>
        ) : null}
        {notice ? <div className="rounded-2xl border border-emerald-700 bg-emerald-950/40 p-4 text-sm">{notice}</div> : null}
        {error ? <div className="rounded-2xl border border-red-700 bg-red-950/40 p-4 text-sm text-red-100">{error}</div> : null}

        {!featureDisabled && !errand ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900 p-6 text-center">
            <div className="text-lg font-semibold">No active Errand</div>
            <div className="mt-2 text-sm text-slate-400">Stay online in your service town. Assigned Errand offers will appear here.</div>
          </div>
        ) : null}

        {errand ? (
          <>
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <div className="text-xs uppercase tracking-wide text-slate-500">Current stage</div>
              <div className="mt-1 text-xl font-semibold">{stageLabel(stage, status)}</div>
              <div className="mt-1 text-xs text-slate-400">Booking: {text(booking?.booking_code)}</div>
            </div>

            {status === "assigned" ? (
              <section className="rounded-3xl border border-amber-600 bg-amber-950/30 p-5">
                <div className="flex justify-between gap-4">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider text-amber-300">New Errand Offer</div>
                    <div className="mt-1 text-xl font-bold">{text(booking?.passenger_name) || "Passenger"}</div>
                    <div className="mt-1 text-sm text-amber-100">Stage 0: {text(booking?.from_label)}</div>
                  </div>
                  <div className="rounded-2xl bg-black/20 px-4 py-3 text-center">
                    <div className="text-[10px] uppercase text-amber-300">Accept within</div>
                    <div className="text-xl font-bold text-amber-100">
                      {secondsLeft == null ? "--" : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <Metric label="Driver to Stage 0" value={km(offer?.pickup_road_distance_km ?? booking?.driver_to_pickup_km)} />
                  <Metric label="Pickup surcharge" value={money(offer?.pickup_distance_fee ?? booking?.pickup_distance_fee)} />
                  <Metric label="Stops" value={String(currentStops.length || job?.declared_stop_count || 0)} />
                  <Metric label="Est. cargo" value={`${num(job?.estimated_cargo_weight_kg) ?? 0} kg`} />
                </div>
                <div className="mt-4 rounded-2xl bg-slate-950/50 p-4 text-sm">
                  <div>{text(job?.task_description) || "--"}</div>
                  <div className="mt-2 text-xs text-slate-400">Required vehicle: {text(job?.vehicle_requirement) || "either"} | Final: {text(job?.final_label || booking?.to_label) || "--"}</div>
                  {job?.is_pabili ? <div className="mt-2 text-xs text-sky-300">Pabili estimate: {money(job?.estimated_purchase_amount)}. Do not accept cash until Stage 0 vehicle/load check passes.</div> : null}
                </div>
                {num(job?.estimated_cargo_weight_kg) != null && Number(job.estimated_cargo_weight_kg) > 50 ? (
                  <div className="mt-3 rounded-2xl border border-orange-700 bg-orange-950/40 p-3 text-xs text-orange-100">51-100 kg Extra Heavy is optional to a tricycle driver. You may pass without penalty if unsafe or unsuitable.</div>
                ) : null}
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button disabled={!!busy || secondsLeft === 0} onClick={() => void normalAction("accept")} className="rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-50">{busy === "accept" ? "Accepting..." : "Accept Errand"}</button>
                  <button disabled={!!busy} onClick={() => void offerAction("decline", { reason_code: "driver_passed" })} className="rounded-2xl border border-slate-600 bg-slate-800 py-3 font-semibold disabled:opacity-50">{busy === "decline" ? "Passing..." : "Pass"}</button>
                </div>
              </section>
            ) : null}

            {status === "accepted" && stage === "going_to_customer" ? (
              <section className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
                <div className="font-semibold">Go to Customer / Stage 0</div>
                <div className="mt-2 text-lg">{text(booking?.from_label)}</div>
                <div className="mt-2 text-xs text-slate-400">Driver to Stage 0: {km(booking?.driver_to_pickup_km)} | Pickup surcharge: {money(booking?.pickup_distance_fee)}</div>
                <button disabled={!!busy} onClick={() => void normalAction("arrive_stage0")} className="mt-4 w-full rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-50">Arrived at Customer - Start Stage 0 Review</button>
                <div className="mt-2 text-[11px] text-slate-500">Stage 0 discussion time is not waiting time.</div>
              </section>
            ) : null}

            {status === "accepted" && stage === "stage0_review" ? (
              <section className="space-y-4">
                <Card title="Stage 0 review">
                  <textarea value={task} onChange={(e) => { setTask(e.target.value); dirty(); }} className="min-h-28 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" />
                </Card>

                <Card title="Confirmed task stops">
                  <button onClick={() => { setStops((rows) => [...rows, { id: nextId(), location: null, instructions: "" }]); dirty(); }} className="mb-3 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold">Add stop</button>
                  <div className="space-y-4">
                    {stops.map((stop, index) => (
                      <div key={stop.id} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
                        <div className="mb-2 flex justify-between"><span className="font-semibold">Stop {index + 1}</span>{stops.length > 1 ? <button onClick={() => { setStops((rows) => rows.filter((r) => r.id !== stop.id)); dirty(); }} className="text-xs text-red-400">Remove</button> : null}</div>
                        <div className="text-slate-900"><ErrandLocationField title={`Stop ${index + 1} location`} value={stop.location} onChange={(location) => { setStops((rows) => rows.map((r) => r.id === stop.id ? { ...r, location } : r)); dirty(); }} /></div>
                        <input value={stop.instructions} onChange={(e) => { const instructions = e.target.value; setStops((rows) => rows.map((r) => r.id === stop.id ? { ...r, instructions } : r)); dirty(); }} placeholder="Stop instructions" className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900 p-3 text-sm" />
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Final destination">
                  <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => { setFinalMode("return_to_customer"); dirty(); }} className={`rounded-2xl border p-3 text-xs ${finalMode === "return_to_customer" ? "border-emerald-500 bg-emerald-950/40" : "border-slate-700"}`}>Return to customer</button>
                    <button onClick={() => { setFinalMode("different_address"); dirty(); }} className={`rounded-2xl border p-3 text-xs ${finalMode === "different_address" ? "border-emerald-500 bg-emerald-950/40" : "border-slate-700"}`}>Different address</button>
                  </div>
                  {finalMode === "different_address" ? <div className="mt-3 text-slate-900"><ErrandLocationField title="Final destination" value={finalLocation} onChange={(location) => { setFinalLocation(location); dirty(); }} /></div> : <div className="mt-3 rounded-2xl bg-slate-950 p-3 text-xs text-slate-400">{text(booking?.from_label)}</div>}
                </Card>

                <Card title="Cargo, vehicle, and Pabili">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs">Actual peak cargo weight<input type="number" min="0" max="100" step="0.5" value={cargoWeight} onChange={(e) => { setCargoWeight(e.target.value); dirty(); }} className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" /></label>
                    <label className="text-xs">Required vehicle<select value={vehicleRequirement} onChange={(e) => { setVehicleRequirement(e.target.value as any); dirty(); }} className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm"><option value="either">Motorcycle or Tricycle</option><option value="motorcycle">Motorcycle</option><option value="tricycle">Tricycle</option></select></label>
                  </div>
                  <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={isPabili} onChange={(e) => { setIsPabili(e.target.checked); setCashRecorded(false); dirty(); }} />Pabili purchase - customer funded only</label>
                  {isPabili ? <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs">Estimated purchase<input type="number" min="0" value={estimatedPurchase} onChange={(e) => { setEstimatedPurchase(e.target.value); dirty(); }} className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm" /></label><label className="text-xs">Customer cash received<input type="number" min="0" value={cashReceived} disabled={vehicleSuitable !== true} onChange={(e) => setCashReceived(e.target.value)} className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-sm disabled:opacity-40" /></label></div> : null}
                </Card>

                <Card title="Stage 0 actions">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button disabled={!reviewValid || !!busy} onClick={() => void saveReview(false)} className="rounded-2xl bg-sky-600 py-3 font-semibold disabled:opacity-40">Save Review + Check Vehicle</button>
                    <button disabled={!!busy || cashRecorded || (num(job?.pabili_cash_received) ?? 0) > 0} onClick={() => void offerAction("vehicle_not_suitable", { confirmed_cargo_weight_kg: cargoKg, reason_code: "vehicle_or_load_not_suitable" })} className="rounded-2xl border border-orange-700 bg-orange-950/30 py-3 font-semibold text-orange-100 disabled:opacity-40">Vehicle / Load Not Suitable</button>
                  </div>
                  {vehicleSuitable === true ? <div className="mt-3 rounded-2xl bg-emerald-950/40 p-3 text-xs text-emerald-100">Vehicle/load check passed.</div> : vehicleSuitable === false ? <div className="mt-3 rounded-2xl bg-orange-950/40 p-3 text-xs text-orange-100">Vehicle/load check did not pass. Do not accept cash.</div> : null}
                  {isPabili && vehicleSuitable === true ? <button disabled={(num(cashReceived) ?? 0) <= 0 || !!busy} onClick={() => void saveReview(true)} className="mt-3 w-full rounded-2xl bg-emerald-600 py-3 font-semibold disabled:opacity-40">{cashRecorded ? "Update Recorded Customer Cash" : "Record Customer Cash"}</button> : null}
                  <button disabled={!!busy || vehicleSuitable !== true || reviewDirty || (isPabili && !cashRecorded)} onClick={() => void sendForCustomerReview()} className="mt-3 w-full rounded-2xl bg-emerald-500 py-3 font-semibold disabled:opacity-40">Ready for Customer Review</button>
                </Card>
              </section>
            ) : null}

            {stage === "awaiting_customer_confirmation" || status === "fare_proposed" ? (
              <section className="rounded-3xl border border-amber-700 bg-amber-950/30 p-5">
                <div className="text-lg font-semibold">Waiting for passenger Confirm Task</div>
                <div className="mt-1 text-sm text-amber-200">Do not begin the task route until the passenger confirms.</div>
                <div className="mt-4 space-y-2 text-sm"><Fare label="Base" value={fare?.base_fare} /><Fare label={`Confirmed route (${km(job?.confirmed_route_distance_km)})`} value={fare?.distance_fare} /><Fare label="Pickup surcharge" value={fare?.pickup_distance_fee} /><Fare label="Additional stops" value={fare?.extra_stop_fee} /><Fare label="Heavy load" value={fare?.heavy_load_fee} /><div className="border-t border-slate-700 pt-2"><Fare label="Starting service fare" value={fare?.total_errand_fare} /></div></div>
                {job?.is_pabili ? <div className="mt-3 text-xs text-slate-400">Customer purchase funds: {money(pabili?.customer_funds_received ?? job?.pabili_cash_received)}</div> : null}
              </section>
            ) : null}

            {stage === "task_confirmed" || status === "ready" ? (
              <section className="rounded-3xl border border-emerald-700 bg-emerald-950/30 p-5"><div className="text-lg font-semibold">Passenger confirmed the task</div><div className="mt-1 text-sm text-emerald-200">Task is locked. Stop-execution controls are the next slice.</div></section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5"><div className="mb-3 font-semibold">{title}</div>{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl bg-slate-950/50 p-3"><div className="text-[10px] uppercase text-slate-500">{label}</div><div className="mt-1 font-semibold">{value}</div></div>;
}

function Fare({ label, value }: { label: string; value: unknown }) {
  return <div className="flex justify-between gap-3"><span>{label}</span><span className="font-semibold">{money(value)}</span></div>;
}
