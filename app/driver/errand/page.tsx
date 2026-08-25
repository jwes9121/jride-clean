"use client";

import * as React from "react";
import { supabase } from "@/lib/supabaseDriverClient";
import ErrandLocationField, {
  type ErrandLocationValue,
} from "@/app/errands/ErrandLocationField";

type StopDraft = {
  id: string;
  sequence: number;
  location: ErrandLocationValue | null;
  instructions: string;
};

type CurrentPayload = {
  ok?: boolean;
  auth_mode?: string;
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

function prettyStage(stageRaw: unknown, statusRaw: unknown): string {
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
    resolving_stop_issue: "Resolving stop issue",
    going_to_customer_for_cash: "Returning for Pabili funds",
    waiting_for_cash_topup: "Waiting for Pabili funds",
    returning_to_stop_after_cash: "Returning to task stop",
    going_to_final: "Going to final destination",
    waiting_at_final_handoff: "Waiting at final handoff",
    unreachable_escalated: "Final handoff escalated",
    handoff_complete: "Handoff complete",
    completed: "Errand completed",
  };
  if (labels[stage]) return labels[stage];
  if (status === "assigned") return "New Errand offer";
  if (status === "accepted") return "Go to customer";
  if (status === "fare_proposed") return "Waiting for customer confirmation";
  if (status === "ready") return "Task confirmed";
  return stage || status || "Errand";
}

async function driverToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return text(data?.session?.access_token);
}

async function getDriverJson(url: string) {
  const token = await driverToken();
  const response = await fetch(url, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  return { response, json, token };
}

async function postDriverJson(url: string, body: unknown) {
  const token = await driverToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  return { response, json, token };
}

export default function DriverErrandPage() {
  const [sessionLoading, setSessionLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [featureDisabled, setFeatureDisabled] = React.useState(false);
  const [payload, setPayload] = React.useState<CurrentPayload | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [notice, setNotice] = React.useState("");
  const [error, setError] = React.useState("");
  const [busyAction, setBusyAction] = React.useState("");
  const [clock, setClock] = React.useState(Date.now());
  const expireAttemptRef = React.useRef("");
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const [reviewBookingId, setReviewBookingId] = React.useState("");
  const [taskDescription, setTaskDescription] = React.useState("");
  const [stops, setStops] = React.useState<StopDraft[]>([]);
  const [finalMode, setFinalMode] = React.useState<
    "return_to_customer" | "different_address"
  >("return_to_customer");
  const [finalLocation, setFinalLocation] = React.useState<ErrandLocationValue | null>(null);
  const [isPabili, setIsPabili] = React.useState(false);
  const [estimatedPurchase, setEstimatedPurchase] = React.useState("");
  const [cargoWeight, setCargoWeight] = React.useState("");
  const [vehicleRequirement, setVehicleRequirement] = React.useState<
    "either" | "motorcycle" | "tricycle"
  >("either");
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
  const stage = text(job?.errand_stage).toLowerCase();
  const status = text(booking?.status).toLowerCase();
  const bookingId = text(booking?.id);
  const currentStops = Array.isArray(errand?.stops) ? errand.stops : [];

  async function refreshCurrent(silent = false) {
    if (!silent) setLoading(true);
    try {
      const { response, json, token } = await getDriverJson(
        "/api/driver/errand/current"
      );
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

      if (response.status === 401 || response.status === 403) {
        setAuthed(false);
        setPayload(null);
        setError(text(json?.message || json?.error) || "Driver session is not authorized.");
        return;
      }
      if (!response.ok || json?.ok === false) {
        setError(text(json?.message || json?.error) || `HTTP ${response.status}`);
        return;
      }

      setError("");
      setPayload(json as CurrentPayload);
    } catch (err: any) {
      setError(text(err?.message) || "Could not refresh Errand work screen.");
    } finally {
      if (!silent) setLoading(false);
      setSessionLoading(false);
    }
  }

  React.useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      const signedIn = !!data?.session?.access_token;
      setAuthed(signedIn);
      setSessionLoading(false);
      if (signedIn) refreshCurrent(false);
      else setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  React.useEffect(() => {
    if (!authed || featureDisabled) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => refreshCurrent(true), 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [authed, featureDisabled]);

  React.useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const expiresAtMs = Date.parse(text(offer?.expires_at));
  const offerSecondsLeft =
    status === "assigned" && Number.isFinite(expiresAtMs)
      ? Math.max(0, Math.ceil((expiresAtMs - clock) / 1000))
      : null;

  async function offerAction(action: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return;
    setBusyAction(action);
    setNotice("");
    setError("");
    try {
      const { response, json } = await postDriverJson(
        "/api/driver/errand/offer",
        { action, booking_id: bookingId, ...extra }
      );
      if (!response.ok || json?.ok === false) {
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      if (action === "decline") {
        setNotice("Errand passed. JRide is checking the next eligible same-town driver.");
      } else if (action === "vehicle_not_suitable") {
        setNotice(
          `Released safely. Required vehicle is now ${text(json?.required_vehicle || json?.reassignment?.required_vehicle || "updated")}.`
        );
      }
      await refreshCurrent(false);
    } catch (err: any) {
      setError(text(err?.message) || "Errand offer action failed.");
    } finally {
      setBusyAction("");
    }
  }

  React.useEffect(() => {
    if (status !== "assigned" || offerSecondsLeft == null || offerSecondsLeft > 0) {
      return;
    }
    if (!bookingId || expireAttemptRef.current === bookingId) return;
    expireAttemptRef.current = bookingId;
    void offerAction("expire_offer");
  }, [status, offerSecondsLeft, bookingId]);

  async function normalAction(action: string, extra: Record<string, unknown> = {}) {
    if (!bookingId) return null;
    setBusyAction(action);
    setNotice("");
    setError("");
    try {
      const { response, json } = await postDriverJson(
        "/api/driver/errand/action",
        { action, booking_id: bookingId, ...extra }
      );
      if (!response.ok || json?.ok === false) {
        if (text(json?.error) === "ERRAND_OFFER_EXPIRED") {
          await refreshCurrent(false);
        }
        throw new Error(text(json?.message || json?.error) || `HTTP ${response.status}`);
      }
      setPayload((previous) => ({ ...(previous || {}), errand: json?.errand || previous?.errand }));
      await refreshCurrent(false);
      return json;
    } catch (err: any) {
      setError(text(err?.message) || `Errand action failed: ${action}`);
      return null;
    } finally {
      setBusyAction("");
    }
  }

  React.useEffect(() => {
    if (!bookingId || stage !== "stage0_review") return;
    if (reviewBookingId === bookingId) return;

    setReviewBookingId(bookingId);
    setTaskDescription(text(job?.task_description));
    setStops(
      currentStops.map((stop: any, index: number) => ({
        id: text(stop?.id) || nextId(),
        sequence: Number(stop?.sequence || index + 1),
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
    setFinalMode(
      text(job?.final_destination_mode) === "different_address"
        ? "different_address"
        : "return_to_customer"
    );
    setFinalLocation(
      num(job?.final_lat) != null && num(job?.final_lng) != null
        ? {
            label: text(job?.final_label) || text(booking?.to_label) || "Final destination",
            lat: Number(job.final_lat),
            lng: Number(job.final_lng),
          }
        : null
    );
    setIsPabili(job?.is_pabili === true);
    setEstimatedPurchase(
      num(job?.estimated_purchase_amount) == null
        ? ""
        : String(Number(job.estimated_purchase_amount))
    );
    setCargoWeight(
      String(
        num(job?.confirmed_cargo_weight_kg ?? job?.estimated_cargo_weight_kg) ?? 0
      )
    );
    setVehicleRequirement(
      ["motorcycle", "tricycle", "either"].includes(text(job?.vehicle_requirement))
        ? (text(job?.vehicle_requirement) as "motorcycle" | "tricycle" | "either")
        : "either"
    );
    const existingCash = num(job?.pabili_cash_received);
    setCashReceived(existingCash == null ? "" : String(existingCash));
    setCashRecorded(existingCash != null && existingCash > 0);
    setVehicleSuitable(null);
    setReviewDirty(true);
  }, [bookingId, stage, reviewBookingId, job, booking, currentStops]);

  function markDirty() {
    setReviewDirty(true);
    setVehicleSuitable(null);
  }

  function addStop() {
    setStops((rows) => [
      ...rows,
      {
        id: nextId(),
        sequence: rows.length + 1,
        location: null,
        instructions: "",
      },
    ]);
    markDirty();
  }

  function removeStop(id: string) {
    setStops((rows) =>
      rows.length <= 1
        ? rows
        : rows
            .filter((row) => row.id !== id)
            .map((row, index) => ({ ...row, sequence: index + 1 }))
    );
    markDirty();
  }

  const reviewPinsValid =
    stops.length >= 1 && stops.every((stop) => stop.location != null);
  const finalValid =
    finalMode === "return_to_customer" || finalLocation != null;
  const cargoKg = num(cargoWeight);
  const reviewValid =
    text(taskDescription).length >= 3 &&
    reviewPinsValid &&
    finalValid &&
    cargoKg != null &&
    cargoKg >= 0 &&
    cargoKg <= 100 &&
    (!isPabili || num(estimatedPurchase) != null);

  async function saveReview(recordCash: boolean) {
    if (!reviewValid) {
      setError("Complete the task, all stop pins, final destination and cargo details first.");
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

    const json = await normalAction("save_stage0_review", {
      task_description: text(taskDescription),
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
      pabili_cash_received:
        isPabili && recordCash ? num(cashReceived) : null,
      confirmed_cargo_weight_kg: cargoKg,
      vehicle_requirement: vehicleRequirement,
    });

    if (!json) return;
    const suitable = json?.vehicle_suitable === true;
    setVehicleSuitable(suitable);
    setReviewDirty(false);

    if (isPabili && recordCash && suitable && (num(cashReceived) || 0) > 0) {
      setCashRecorded(true);
      setNotice("Customer Pabili cash recorded. Review is ready for the final route/fare calculation.");
    } else if (suitable) {
      setNotice(
        isPabili
          ? "Vehicle/load check passed. You may now receive and record the customer's Pabili cash."
          : "Vehicle/load check passed. Review saved."
      );
    } else {
      setNotice("Vehicle/load check did not pass. Do not accept Pabili cash.");
    }
  }

  async function readyForCustomerReview() {
    if (vehicleSuitable !== true || reviewDirty) {
      setError("Save and pass the vehicle/load check before sending the task to the customer.");
      return;
    }
    if (isPabili && !cashRecorded) {
      setError("Record the customer's Pabili cash before sending the task for confirmation.");
      return;
    }
    const json = await normalAction("ready_for_customer_review");
    if (json) {
      setNotice("Task and starting fare sent to the customer. Wait for Confirm Task.");
    }
  }

  const offerCargoKg = num(job?.estimated_cargo_weight_kg ?? job?.confirmed_cargo_weight_kg) ?? 0;
  const extraHeavyOffer = offerCargoKg > 50;
  const finalLabel = text(job?.final_label || booking?.to_label);
  const passengerName = text(booking?.passenger_name) || "JRide Passenger";

  if (sessionLoading || loading) {
    return (
      <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900 p-5 text-sm">
          Loading JRide Driver Errand...
        </div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-950 p-5 text-slate-100">
        <div className="mx-auto max-w-xl rounded-3xl border border-slate-800 bg-slate-900 p-6">
          <h1 className="text-xl font-semibold">Driver sign-in required</h1>
          <p className="mt-2 text-sm text-slate-400">
            Sign in with your JRide driver account before opening the Errand work screen.
          </p>
          <a
            href="/driver/login"
            className="mt-4 inline-flex rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white"
          >
            Driver Login
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#071019_0%,#0b1722_48%,#0b1220_100%)] text-slate-100">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-5">
        <header className="rounded-[26px] border border-slate-700/70 bg-slate-900/90 p-5 shadow-xl">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">
                JRide Driver
              </div>
              <h1 className="mt-1 text-2xl font-semibold">Errand / Pabili Work Screen</h1>
              <p className="mt-1 text-sm text-slate-400">
                Offer, Stage 0 review, cargo check, Pabili cash, and customer confirmation.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a
                href="/driver/livetracking"
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"
              >
                Live Tracking
              </a>
              <a
                href="/driver"
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"
              >
                Driver Dashboard
              </a>
            </div>
          </div>
        </header>

        {featureDisabled ? (
          <div className="rounded-3xl border border-amber-700/60 bg-amber-950/40 p-5 text-amber-100">
            <div className="font-semibold">Errand pilot is not enabled yet</div>
            <div className="mt-1 text-sm text-amber-200/80">
              The driver screen is installed, but the production feature flag is still off.
            </div>
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-emerald-700/50 bg-emerald-950/40 p-4 text-sm text-emerald-100">
            {notice}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-2xl border border-red-700/50 bg-red-950/40 p-4 text-sm text-red-100">
            {error}
          </div>
        ) : null}

        {!featureDisabled ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-500">Driver</div>
                <div className="mt-1 font-semibold text-slate-100">
                  {text(driver?.full_name) || text(driver?.callsign) || "JRide Driver"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  {[text(driver?.vehicle_type || driverLocation?.vehicle_type), text(driver?.plate_number), text(driver?.municipality || driverLocation?.town)]
                    .filter(Boolean)
                    .join(" | ") || "Profile details unavailable"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => refreshCurrent(false)}
                className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200"
              >
                Refresh
              </button>
            </div>
          </div>
        ) : null}

        {!featureDisabled && !errand ? (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/85 p-6 text-center">
            <div className="text-lg font-semibold">No active Errand</div>
            <div className="mt-2 text-sm text-slate-400">
              Stay online in your service town. New Errand offers will appear here when assigned.
            </div>
          </div>
        ) : null}

        {errand ? (
          <section className="space-y-4">
            <div className="rounded-3xl border border-slate-700 bg-slate-900/90 p-5 shadow-xl">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Current stage</div>
                  <div className="mt-1 text-xl font-semibold text-white">
                    {prettyStage(stage, status)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Booking: <span className="font-mono">{text(booking?.booking_code)}</span>
                  </div>
                </div>
                <div className="rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-300">
                  {status || "active"}
                </div>
              </div>
            </div>

            {status === "assigned" ? (
              <div className="rounded-[28px] border border-amber-500/60 bg-amber-950/35 p-5 shadow-2xl">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">
                      New Errand Offer
                    </div>
                    <div className="mt-1 text-2xl font-bold text-white">{passengerName}</div>
                    <div className="mt-1 text-sm text-amber-100/80">Stage 0: {text(booking?.from_label) || "--"}</div>
                  </div>
                  <div className="rounded-2xl border border-amber-500/40 bg-black/20 px-4 py-3 text-center">
                    <div className="text-[11px] uppercase tracking-wide text-amber-200/70">Accept within</div>
                    <div className="mt-1 text-2xl font-bold text-amber-200">
                      {offerSecondsLeft == null
                        ? "--"
                        : `${Math.floor(offerSecondsLeft / 60)}:${String(offerSecondsLeft % 60).padStart(2, "0")}`}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <MetricDark label="Driver -> Stage 0" value={km(offer?.pickup_road_distance_km ?? booking?.driver_to_pickup_km)} />
                  <MetricDark label="Pickup surcharge" value={money(offer?.pickup_distance_fee ?? booking?.pickup_distance_fee)} />
                  <MetricDark label="Stops" value={String(currentStops.length || job?.declared_stop_count || 0)} />
                  <MetricDark label="Estimated cargo" value={`${offerCargoKg} kg`} />
                </div>

                <div className="mt-4 rounded-2xl border border-slate-700/80 bg-slate-950/45 p-4">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Task</div>
                  <div className="mt-1 text-sm text-slate-100">{text(job?.task_description) || "--"}</div>
                  <div className="mt-3 text-xs text-slate-400">
                    Required vehicle: {text(job?.vehicle_requirement) || "either"} | Final: {finalLabel || "--"}
                  </div>
                  {job?.is_pabili ? (
                    <div className="mt-2 text-xs text-sky-300">
                      Pabili | Estimated purchase: {money(job?.estimated_purchase_amount)}. Do not accept customer cash until Stage 0 vehicle/load check passes.
                    </div>
                  ) : null}
                </div>

                {extraHeavyOffer ? (
                  <div className="mt-4 rounded-2xl border border-orange-500/50 bg-orange-950/40 p-4 text-sm text-orange-100">
                    <div className="font-semibold">EXTRA HEAVY: 51-100 kg</div>
                    <div className="mt-1 text-xs text-orange-200/80">
                      Tricycle only. This tier is optional. You may pass without penalty if the load is unsafe, too bulky, or you do not want to carry it.
                    </div>
                  </div>
                ) : null}

                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={!!busyAction || offerSecondsLeft === 0}
                    onClick={() => normalAction("accept")}
                    className="rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-white hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {busyAction === "accept" ? "Accepting..." : "Accept Errand"}
                  </button>
                  <button
                    type="button"
                    disabled={!!busyAction}
                    onClick={() =>
                      offerAction("decline", {
                        reason_code: extraHeavyOffer ? "extra_heavy_driver_pass" : "driver_passed",
                      })
                    }
                    className="rounded-2xl border border-slate-600 bg-slate-800 py-3.5 text-sm font-semibold text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                  >
                    {busyAction === "decline" ? "Passing..." : "Pass"}
                  </button>
                </div>
              </div>
            ) : null}

            {status === "accepted" && stage === "going_to_customer" ? (
              <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
                <div className="text-sm font-semibold text-white">Go to Customer / Stage 0</div>
                <div className="mt-2 text-lg text-slate-100">{text(booking?.from_label) || "--"}</div>
                <div className="mt-2 text-xs text-slate-400">
                  Driver -> Stage 0: {km(booking?.driver_to_pickup_km)} | Pickup surcharge: {money(booking?.pickup_distance_fee)}
                </div>
                {num(booking?.pickup_lat) != null && num(booking?.pickup_lng) != null ? (
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${Number(booking.pickup_lat)},${Number(booking.pickup_lng)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-4 inline-flex rounded-xl border border-sky-600/60 bg-sky-950/40 px-4 py-2 text-sm font-semibold text-sky-200"
                  >
                    Open Directions
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => normalAction("arrive_stage0")}
                  disabled={!!busyAction}
                  className="mt-4 w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-white hover:bg-emerald-400 disabled:opacity-50"
                >
                  {busyAction === "arrive_stage0" ? "Updating..." : "Arrived at Customer - Start Stage 0 Review"}
                </button>
                <div className="mt-2 text-[11px] text-slate-500">
                  Stage 0 discussion time is not counted as waiting time.
                </div>
              </div>
            ) : null}

            {status === "accepted" && stage === "stage0_review" ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
                  <div className="text-sm font-semibold text-white">Stage 0: Review the task with the customer</div>
                  <div className="mt-1 text-xs text-slate-400">
                    Edit only what you and the customer agree on. The passenger will have the final Confirm Task button.
                  </div>

                  <label className="mt-4 block text-xs font-semibold text-slate-300">Task description</label>
                  <textarea
                    value={taskDescription}
                    onChange={(event) => {
                      setTaskDescription(event.target.value);
                      markDirty();
                    }}
                    className="mt-1 min-h-[110px] w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Confirmed task stops</div>
                      <div className="text-xs text-slate-400">Stop 1 is included; additional confirmed stops affect the fare.</div>
                    </div>
                    <button
                      type="button"
                      onClick={addStop}
                      className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white"
                    >
                      Add stop
                    </button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {stops.map((stop, index) => (
                      <div key={stop.id} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold">Stop {index + 1}</div>
                          {stops.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeStop(stop.id)}
                              className="text-xs font-semibold text-red-400"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3 text-slate-900">
                          <ErrandLocationField
                            title={`Stop ${index + 1} location`}
                            value={stop.location}
                            onChange={(location) => {
                              setStops((rows) =>
                                rows.map((row) =>
                                  row.id === stop.id ? { ...row, location } : row
                                )
                              );
                              markDirty();
                            }}
                            placeholder="Search confirmed task stop"
                          />
                        </div>
                        <input
                          value={stop.instructions}
                          onChange={(event) => {
                            const instructions = event.target.value;
                            setStops((rows) =>
                              rows.map((row) =>
                                row.id === stop.id ? { ...row, instructions } : row
                              )
                            );
                            markDirty();
                          }}
                          placeholder="Instructions for this stop"
                          className="mt-3 w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-slate-100"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
                    <div className="text-sm font-semibold text-white">Final destination</div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFinalMode("return_to_customer");
                          markDirty();
                        }}
                        className={
                          "rounded-2xl border p-3 text-left text-xs " +
                          (finalMode === "return_to_customer"
                            ? "border-emerald-500 bg-emerald-950/40 text-emerald-100"
                            : "border-slate-700 bg-slate-950 text-slate-300")
                        }
                      >
                        Return to customer
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setFinalMode("different_address");
                          markDirty();
                        }}
                        className={
                          "rounded-2xl border p-3 text-left text-xs " +
                          (finalMode === "different_address"
                            ? "border-emerald-500 bg-emerald-950/40 text-emerald-100"
                            : "border-slate-700 bg-slate-950 text-slate-300")
                        }
                      >
                        Different address
                      </button>
                    </div>
                    {finalMode === "different_address" ? (
                      <div className="mt-3 text-slate-900">
                        <ErrandLocationField
                          title="Final destination"
                          value={finalLocation}
                          onChange={(location) => {
                            setFinalLocation(location);
                            markDirty();
                          }}
                          placeholder="Search final destination"
                        />
                      </div>
                    ) : (
                      <div className="mt-3 rounded-2xl bg-slate-950 p-3 text-xs text-slate-400">
                        {text(booking?.from_label)}
                      </div>
                    )}
                  </div>

                  <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
                    <div className="text-sm font-semibold text-white">Cargo / vehicle check</div>
                    <label className="mt-3 block text-xs font-semibold text-slate-300">Actual peak cargo weight</label>
                    <div className="relative mt-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.5"
                        value={cargoWeight}
                        onChange={(event) => {
                          setCargoWeight(event.target.value);
                          markDirty();
                        }}
                        className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 pr-10 text-sm text-slate-100"
                      />
                      <span className="absolute right-3 top-3 text-sm text-slate-500">kg</span>
                    </div>
                    <label className="mt-3 block text-xs font-semibold text-slate-300">Required vehicle</label>
                    <select
                      value={vehicleRequirement}
                      onChange={(event) => {
                        setVehicleRequirement(
                          event.target.value as "either" | "motorcycle" | "tricycle"
                        );
                        markDirty();
                      }}
                      className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100"
                    >
                      <option value="either">Motorcycle or Tricycle</option>
                      <option value="motorcycle">Motorcycle</option>
                      <option value="tricycle">Tricycle</option>
                    </select>
                    {cargoKg != null && cargoKg > 50 ? (
                      <div className="mt-2 text-xs text-orange-300">
                        51-100 kg is Extra Heavy and optional to a tricycle driver.
                      </div>
                    ) : cargoKg != null && cargoKg > 25 ? (
                      <div className="mt-2 text-xs text-amber-300">Above 25 kg requires a tricycle.</div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-5">
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={isPabili}
                      onChange={(event) => {
                        setIsPabili(event.target.checked);
                        setCashRecorded(false);
                        markDirty();
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-semibold text-white">Pabili purchase</span>
                      <span className="mt-1 block text-xs text-slate-400">
                        Customer-funded only. Never use your own money.
                      </span>
                    </span>
                  </label>
                  {isPabili ? (
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <label className="text-xs font-semibold text-slate-300">Estimated purchase amount</label>
                        <input
                          type="number"
                          min="0"
                          value={estimatedPurchase}
                          onChange={(event) => {
                            setEstimatedPurchase(event.target.value);
                            markDirty();
                          }}
                          className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-300">Customer cash received</label>
                        <input
                          type="number"
                          min="0"
                          value={cashReceived}
                          disabled={vehicleSuitable !== true}
                          onChange={(event) => setCashReceived(event.target.value)}
                          placeholder={vehicleSuitable === true ? "Enter cash actually received" : "Vehicle check first"}
                          className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-3xl border border-slate-700 bg-slate-900/95 p-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => saveReview(false)}
                      disabled={!reviewValid || !!busyAction}
                      className="rounded-2xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {busyAction === "save_stage0_review"
                        ? "Checking..."
                        : "Save Review + Check Vehicle"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        offerAction("vehicle_not_suitable", {
                          confirmed_cargo_weight_kg: cargoKg,
                          reason_code:
                            cargoKg != null && cargoKg > 25
                              ? "cargo_too_heavy_or_bulky"
                              : "vehicle_or_load_not_suitable",
                        })
                      }
                      disabled={!!busyAction || cashRecorded || (num(job?.pabili_cash_received) || 0) > 0}
                      className="rounded-2xl border border-orange-600/60 bg-orange-950/30 py-3 text-sm font-semibold text-orange-100 disabled:opacity-40"
                    >
                      Vehicle / Load Not Suitable
                    </button>
                  </div>

                  {vehicleSuitable === true ? (
                    <div className="mt-3 rounded-2xl border border-emerald-700/50 bg-emerald-950/35 p-3 text-xs text-emerald-100">
                      Vehicle/load check passed.
                    </div>
                  ) : vehicleSuitable === false ? (
                    <div className="mt-3 rounded-2xl border border-orange-700/50 bg-orange-950/35 p-3 text-xs text-orange-100">
                      Vehicle/load check did not pass. Do not accept customer cash. Release this Errand for a suitable vehicle.
                    </div>
                  ) : null}

                  {isPabili && vehicleSuitable === true ? (
                    <button
                      type="button"
                      onClick={() => saveReview(true)}
                      disabled={(num(cashReceived) || 0) <= 0 || !!busyAction}
                      className="mt-3 w-full rounded-2xl bg-emerald-600 py-3 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {cashRecorded ? "Update Recorded Customer Cash" : "Record Customer Cash"}
                    </button>
                  ) : null}

                  <button
                    type="button"
                    onClick={readyForCustomerReview}
                    disabled={
                      !!busyAction ||
                      vehicleSuitable !== true ||
                      reviewDirty ||
                      (isPabili && !cashRecorded)
                    }
                    className="mt-3 w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-bold text-white hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {busyAction === "ready_for_customer_review"
                      ? "Calculating route..."
                      : "Ready for Customer Review"}
                  </button>
                  <div className="mt-2 text-center text-[11px] text-slate-500">
                    This calculates the confirmed road route and sends the exact starting fare to the passenger.
                  </div>
                </div>
              </div>
            ) : null}

            {(stage === "awaiting_customer_confirmation" || status === "fare_proposed") ? (
              <div className="rounded-3xl border border-amber-600/50 bg-amber-950/30 p-5">
                <div className="text-lg font-semibold text-amber-100">Waiting for passenger Confirm Task</div>
                <div className="mt-1 text-sm text-amber-200/80">
                  Do not begin the task route until the passenger confirms.
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-300">
                  <FareRowDark label="Base" value={fare?.base_fare} />
                  <FareRowDark label={`Confirmed route (${km(job?.confirmed_route_distance_km)})`} value={fare?.distance_fare} />
                  <FareRowDark label="Pickup surcharge" value={fare?.pickup_distance_fee} />
                  <FareRowDark label="Additional stops" value={fare?.extra_stop_fee} />
                  <FareRowDark label="Heavy load" value={fare?.heavy_load_fee} />
                  <div className="border-t border-slate-700 pt-3">
                    <FareRowDark label="Starting service fare" value={fare?.total_errand_fare} strong />
                  </div>
                </div>
                {job?.is_pabili ? (
                  <div className="mt-3 rounded-2xl bg-slate-950/50 p-3 text-xs text-slate-400">
                    Customer purchase funds recorded: {money(pabili?.customer_funds_received ?? job?.pabili_cash_received)}. This is separate from the JRide service fare.
                  </div>
                ) : null}
              </div>
            ) : null}

            {(stage === "task_confirmed" || status === "ready") ? (
              <div className="rounded-3xl border border-emerald-700/60 bg-emerald-950/35 p-5">
                <div className="text-lg font-semibold text-emerald-100">Passenger confirmed the task</div>
                <div className="mt-1 text-sm text-emerald-200/80">
                  The task is now locked. Stop-execution controls are the next implementation slice.
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function MetricDark({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function FareRowDark({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: unknown;
  strong?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 ${strong ? "font-bold text-white" : ""}`}>
      <span>{label}</span>
      <span>{money(value)}</span>
    </div>
  );
}
