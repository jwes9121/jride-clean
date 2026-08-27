"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import ErrandLiveMap from "./ErrandLiveMap";
import ErrandLocationField, {
  type ErrandLocationValue,
} from "./ErrandLocationField";

const TOKEN_KEY = "jride_access_token";
const ERRAND_ID_KEY = "jride_active_errand_booking_id";
const ERRAND_CODE_KEY = "jride_active_errand_booking_code";

type Eligibility = {
  ok?: boolean;
  enabled?: boolean;
  authed?: boolean;
  verified?: boolean;
  verification_status?: string | null;
  profile_name?: string | null;
  profile_name_source?: string | null;
  error?: string | null;
  message?: string | null;
};

type StopDraft = {
  id: string;
  location: ErrandLocationValue | null;
  instructions: string;
};

type ErrandBundle = {
  booking?: any;
  job?: any;
  stops?: any[];
  route_adjustments?: any[];
  fare?: any;
  pabili?: any;
  driver?: any;
  driver_location?: any;
  map_note?: string;
};

type MapPoint = {
  label: string;
  lat: number;
  lng: number;
  kind: "stage0" | "stop" | "final";
  sequence?: number | null;
};

function text(value: unknown): string {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  return clean.toLowerCase() === "null" || clean.toLowerCase() === "undefined"
    ? ""
    : clean;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function money(value: unknown): string {
  const parsed = numberOrNull(value);
  return parsed == null ? "--" : `PHP ${parsed.toFixed(0)}`;
}

function km(value: unknown): string {
  const parsed = numberOrNull(value);
  return parsed == null ? "--" : `${parsed.toFixed(1)} km`;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return text(
      localStorage.getItem(TOKEN_KEY) ||
        localStorage.getItem("jride_passenger_token") ||
        ""
    );
  } catch {
    return "";
  }
}

function authHeaders(json = false): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (json) headers["content-type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function getAuthJson(url: string) {
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders(false),
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  return { response, json };
}

async function postAuthJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(true),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json: any = await response.json().catch(() => ({}));
  return { response, json };
}

function loadStoredErrand() {
  if (typeof window === "undefined") return { id: "", code: "" };
  try {
    return {
      id: text(localStorage.getItem(ERRAND_ID_KEY)),
      code: text(localStorage.getItem(ERRAND_CODE_KEY)),
    };
  } catch {
    return { id: "", code: "" };
  }
}

function storeErrand(id: string, code: string) {
  if (typeof window === "undefined") return;
  try {
    if (id) localStorage.setItem(ERRAND_ID_KEY, id);
    else localStorage.removeItem(ERRAND_ID_KEY);
    if (code) localStorage.setItem(ERRAND_CODE_KEY, code);
    else localStorage.removeItem(ERRAND_CODE_KEY);
  } catch {}
}

function prettyStage(stageRaw: unknown, statusRaw: unknown): string {
  const stage = text(stageRaw).toLowerCase();
  const status = text(statusRaw).toLowerCase();
  const labels: Record<string, string> = {
    draft: "Preparing request",
    matching: "Looking for a driver",
    driver_assigned: "Driver assigned",
    going_to_customer: "Driver going to your meeting point",
    stage0_review: "Confirming the task with you",
    awaiting_customer_confirmation: "Waiting for your confirmation",
    task_confirmed: "Task confirmed",
    going_to_stop: "Going to a task stop",
    waiting_at_stop: "Driver waiting at a task stop",
    resolving_stop_issue: "Resolving a task-stop issue",
    going_to_customer_for_cash: "Returning to you for additional Pabili funds",
    waiting_for_cash_topup: "Waiting for additional Pabili funds",
    returning_to_stop_after_cash: "Returning to the task stop",
    going_to_final: "Going to the Errand destination",
    waiting_at_final_handoff: "Waiting at the Errand destination",
    unreachable_escalated: "Destination handoff escalated",
    handoff_complete: "Errand handoff complete",
    completed: "Errand completed",
    cancelled: "Errand cancelled",
    expired: "Errand expired",
  };
  if (labels[stage]) return labels[stage];
  if (["requested", "pending", "searching"].includes(status)) {
    return "Looking for a driver";
  }
  if (status === "assigned") return "Driver assigned";
  return stage || status || "Updating Errand";
}

function stageDescription(stageRaw: unknown, statusRaw: unknown): string {
  const stage = text(stageRaw).toLowerCase();
  const status = text(statusRaw).toLowerCase();
  if (["requested", "pending", "searching"].includes(status)) {
    return "JRide is searching for an eligible driver from your meeting-point town.";
  }
  if (stage === "driver_assigned") {
    return "A same-town driver has been assigned. Wait for the driver to accept.";
  }
  if (stage === "going_to_customer") {
    return "Your driver accepted the Errand and is travelling to your customer meeting point.";
  }
  if (stage === "stage0_review") {
    return "Review the task together. The driver checks cargo suitability before any Pabili cash changes hands.";
  }
  if (stage === "awaiting_customer_confirmation") {
    return "The driver finished reviewing the task with you. Check the task stops, cargo and starting fare before confirming.";
  }
  if (stage === "task_confirmed") {
    return "The task is locked and the driver can start the confirmed Errand route.";
  }
  if (stage === "waiting_at_stop") {
    return "Waiting is cumulative for the whole Errand. The first 15 total minutes are free.";
  }
  if (stage === "unreachable_escalated") {
    return "The 30-minute destination handoff limit was reached. JRide support or dispatch must resolve the handoff.";
  }
  if (stage === "waiting_at_final_handoff") {
    return "The driver is at the Errand destination. The local handoff waiting limit is 30 minutes.";
  }
  return "Follow the current Errand stage below.";
}

function nextStopId(): string {
  return `stop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function ErrandPage() {
  const router = useRouter();

  const [eligibility, setEligibility] = React.useState<Eligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = React.useState(true);
  const [current, setCurrent] = React.useState<ErrandBundle | null>(null);
  const [currentLoading, setCurrentLoading] = React.useState(false);
  const [currentError, setCurrentError] = React.useState("");
  const [stored, setStored] = React.useState(() => loadStoredErrand());

  const [stage0, setStage0] = React.useState<ErrandLocationValue | null>(null);
  const [taskDescription, setTaskDescription] = React.useState("");
  const [stops, setStops] = React.useState<StopDraft[]>([
    { id: nextStopId(), location: null, instructions: "" },
  ]);
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
  const [bookingBusy, setBookingBusy] = React.useState(false);
  const [confirmBusy, setConfirmBusy] = React.useState(false);
  const [notice, setNotice] = React.useState("");
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  const enabled = eligibility?.enabled === true;
  const authed = eligibility?.authed === true;
  const verified = eligibility?.verified === true;
  const profileName = text(eligibility?.profile_name);

  const cargoKg = numberOrNull(cargoWeight);
  const cargoTooHeavy = cargoKg != null && cargoKg > 100;

  React.useEffect(() => {
    if (cargoKg != null && cargoKg > 25 && vehicleRequirement !== "tricycle") {
      setVehicleRequirement("tricycle");
    }
  }, [cargoKg, vehicleRequirement]);

  async function refreshEligibility() {
    setEligibilityLoading(true);
    try {
      const { response, json } = await getAuthJson(
        "/api/passenger/errand/eligibility"
      );
      if (!response.ok || json?.ok === false) {
        setEligibility({
          ok: false,
          enabled: false,
          authed: false,
          verified: false,
          error: text(json?.error),
          message: text(json?.message) || `HTTP ${response.status}`,
        });
        return;
      }
      setEligibility(json as Eligibility);
    } catch (error: any) {
      setEligibility({
        ok: false,
        enabled: false,
        authed: false,
        verified: false,
        error: "ERRAND_ELIGIBILITY_READ_FAILED",
        message: text(error?.message) || "Could not check Errand availability.",
      });
    } finally {
      setEligibilityLoading(false);
    }
  }

  async function refreshCurrent(silent = false) {
    if (!getToken()) {
      setCurrent(null);
      return;
    }
    if (!silent) setCurrentLoading(true);
    try {
      const { response, json } = await getAuthJson(
        "/api/passenger/errand/current"
      );
      if (response.status === 503) {
        setCurrent(null);
        return;
      }
      if (response.status === 401) {
        setCurrent(null);
        setCurrentError("Passenger session expired. Please sign in again.");
        return;
      }
      if (!response.ok || json?.ok === false) {
        setCurrentError(
          text(json?.message || json?.error) || `HTTP ${response.status}`
        );
        return;
      }
      setCurrentError("");
      const next = json?.errand || null;
      setCurrent(next);
      if (next?.booking?.id) {
        const nextStored = {
          id: text(next.booking.id),
          code: text(next.booking.booking_code),
        };
        storeErrand(nextStored.id, nextStored.code);
        setStored(nextStored);
      }
    } catch (error: any) {
      setCurrentError(text(error?.message) || "Could not refresh Errand status.");
    } finally {
      if (!silent) setCurrentLoading(false);
    }
  }

  React.useEffect(() => {
    refreshEligibility();
  }, []);

  React.useEffect(() => {
    if (!enabled || !authed) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }

    refreshCurrent(false);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => refreshCurrent(true), 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [enabled, authed]);

  const validStops = stops.every((stop) => !!stop.location);
  const finalReady =
    finalMode === "return_to_customer" ? !!stage0 : !!finalLocation;
  const formReady =
    !!stage0 &&
    text(taskDescription).length >= 3 &&
    stops.length >= 1 &&
    validStops &&
    finalReady &&
    !cargoTooHeavy &&
    (!isPabili || numberOrNull(estimatedPurchase) != null);
  const firstMissingStopIndex = stops.findIndex((stop) => !stop.location);
  const missingRequirement = !stage0
    ? "Customer meeting point"
    : text(taskDescription).length < 3
      ? "Task description"
      : firstMissingStopIndex >= 0
        ? `Task Stop ${firstMissingStopIndex + 1} location`
        : !finalReady
          ? "Errand destination"
          : cargoTooHeavy
            ? "Cargo must not exceed 100 kg"
            : isPabili && numberOrNull(estimatedPurchase) == null
              ? "Estimated Pabili purchase amount"
              : "";

  function updateStopLocation(id: string, location: ErrandLocationValue) {
    setStops((rows) =>
      rows.map((row) => (row.id === id ? { ...row, location } : row))
    );
  }

  function updateStopInstructions(id: string, instructions: string) {
    setStops((rows) =>
      rows.map((row) => (row.id === id ? { ...row, instructions } : row))
    );
  }

  function addStop() {
    setStops((rows) => [
      ...rows,
      { id: nextStopId(), location: null, instructions: "" },
    ]);
  }

  function removeStop(id: string) {
    setStops((rows) =>
      rows.length <= 1 ? rows : rows.filter((row) => row.id !== id)
    );
  }

  async function submitErrand() {
    setNotice("");
    if (!enabled) {
      setNotice("Errand booking is not enabled yet.");
      return;
    }
    if (!authed || !getToken()) {
      router.push("/passenger-login?next=/errands");
      return;
    }
    if (!verified) {
      setNotice("Errand requires a fully verified passenger account.");
      return;
    }
    if (!profileName) {
      setNotice("Update your JRide passenger profile name before booking an Errand.");
      return;
    }
    if (!formReady || !stage0) {
      setNotice(
        missingRequirement
          ? `Missing: ${missingRequirement}.`
          : "Complete the meeting point, task stops, destination and cargo details before booking."
      );
      return;
    }

    const final =
      finalMode === "return_to_customer" ? stage0 : finalLocation;
    if (!final) return;

    setBookingBusy(true);
    try {
      const body = {
        stage0_label: stage0.label,
        stage0_lat: stage0.lat,
        stage0_lng: stage0.lng,
        task_description: text(taskDescription),
        stops: stops.map((stop) => ({
          place_name: stop.location?.label || null,
          location_label: stop.location?.label || "",
          lat: stop.location?.lat ?? null,
          lng: stop.location?.lng ?? null,
          instructions: text(stop.instructions) || null,
        })),
        final_destination_mode: finalMode,
        final_label: final.label,
        final_lat: final.lat,
        final_lng: final.lng,
        is_pabili: isPabili,
        estimated_purchase_amount: isPabili
          ? numberOrNull(estimatedPurchase)
          : null,
        estimated_cargo_weight_kg: cargoKg,
        vehicle_requirement: vehicleRequirement,
        accompanied: false,
      };

      const { response, json } = await postAuthJson(
        "/api/passenger/errand/book",
        body
      );
      if (!response.ok || json?.ok === false) {
        const code = text(json?.code || json?.error || "ERRAND_BOOKING_FAILED");
        if (code === "ERRAND_REQUIRES_VERIFIED_PASSENGER") {
          await refreshEligibility();
        }
        throw new Error(
          [code, text(json?.message)].filter(Boolean).join(" - ")
        );
      }

      const nextStored = {
        id: text(json?.booking_id),
        code: text(json?.booking_code),
      };
      storeErrand(nextStored.id, nextStored.code);
      setStored(nextStored);
      setNotice(
        json?.assignment?.assigned === true
          ? "Errand submitted. A driver has been assigned."
          : "Errand submitted. JRide is looking for an eligible same-town driver."
      );
      await refreshCurrent(false);
    } catch (error: any) {
      setNotice(text(error?.message) || "Errand booking failed.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function confirmTask() {
    const bookingId = text(current?.booking?.id || stored.id);
    if (!bookingId) return;
    setConfirmBusy(true);
    setNotice("");
    try {
      const { response, json } = await postAuthJson(
        "/api/passenger/errand/confirm",
        { booking_id: bookingId }
      );
      if (!response.ok || json?.ok === false) {
        throw new Error(
          text(json?.message || json?.error) || `HTTP ${response.status}`
        );
      }
      setNotice("Task confirmed. The driver can now start the Errand.");
      await refreshCurrent(false);
    } catch (error: any) {
      setNotice(text(error?.message) || "Task confirmation failed.");
    } finally {
      setConfirmBusy(false);
    }
  }

  function resetDraft() {
    setStage0(null);
    setTaskDescription("");
    setStops([{ id: nextStopId(), location: null, instructions: "" }]);
    setFinalMode("return_to_customer");
    setFinalLocation(null);
    setIsPabili(false);
    setEstimatedPurchase("");
    setCargoWeight("");
    setVehicleRequirement("either");
    setNotice("");
  }

  const booking = current?.booking || {};
  const job = current?.job || {};
  const currentStops = Array.isArray(current?.stops) ? current?.stops || [] : [];
  const fare = current?.fare || {};
  const pabili = current?.pabili || {};
  const driver = current?.driver || {};
  const driverLocation = current?.driver_location || {};
  const stage = text(job?.errand_stage).toLowerCase();
  const status = text(booking?.status).toLowerCase();
  const returnsToCustomer =
    text(job?.final_destination_mode).toLowerCase() === "return_to_customer";
  const awaitingConfirmation =
    stage === "awaiting_customer_confirmation" || status === "fare_proposed";
  const taskLocked = job?.task_locked === true;

  const stage0Lat = numberOrNull(booking?.pickup_lat);
  const stage0Lng = numberOrNull(booking?.pickup_lng);
  const stage0MapPoint: MapPoint | null =
    stage0Lat != null && stage0Lng != null
      ? {
          label: text(booking?.from_label) || "Customer meeting point",
          lat: stage0Lat,
          lng: stage0Lng,
          kind: "stage0",
        }
      : null;

  const stopMapPoints = currentStops.reduce<MapPoint[]>((points, stop: any) => {
    const lat = numberOrNull(stop?.lat);
    const lng = numberOrNull(stop?.lng);
    if (lat == null || lng == null) return points;
    points.push({
      label:
        text(stop?.location_label) ||
        `Task Stop ${Number(stop?.sequence || points.length + 1)}`,
      lat,
      lng,
      kind: "stop",
      sequence: numberOrNull(stop?.sequence),
    });
    return points;
  }, []);

  const finalLat = numberOrNull(job?.final_lat);
  const finalLng = numberOrNull(job?.final_lng);
  const finalMapPoint: MapPoint | null =
    finalLat != null && finalLng != null
      ? {
          label:
            text(job?.final_label) ||
            text(booking?.to_label) ||
            (returnsToCustomer ? "Return to you" : "Final destination"),
          lat: finalLat,
          lng: finalLng,
          kind: "final",
        }
      : null;

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f7faf9_0%,#f1f7f4_52%,#edf5f1_100%)] text-slate-900">
      <div className="mx-auto max-w-5xl space-y-5 px-4 py-6">
        <header className="rounded-[28px] border border-white/80 bg-white/95 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
                JRide Passenger
              </div>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">Errand</h1>
              <p className="mt-1 max-w-2xl text-sm text-slate-500">
                The driver meets you first, reviews the task with you, then you confirm it before the Errand starts. Select Pabili only when the driver needs to buy something.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/passenger")}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to Passenger
            </button>
          </div>
        </header>

        {eligibilityLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
            Checking Errand availability...
          </div>
        ) : !enabled ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 text-amber-950 shadow-sm">
            <div className="font-semibold">Errand pilot is not enabled yet</div>
            <div className="mt-1 text-sm opacity-80">
              The booking backend remains safely gated. This page will become active when the Errand pilot flag is enabled.
            </div>
          </div>
        ) : !authed ? (
          <div className="rounded-[24px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="font-semibold text-amber-950">Sign in required</div>
            <div className="mt-1 text-sm text-amber-900">
              Errand requires a signed-in and fully verified JRide passenger account.
            </div>
            <button
              type="button"
              onClick={() => router.push("/passenger-login?next=/errands")}
              className="mt-3 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              Sign in
            </button>
          </div>
        ) : !verified ? (
          <div className="rounded-[24px] border border-red-200 bg-red-50 p-5 shadow-sm">
            <div className="font-semibold text-red-950">Full verification required</div>
            <div className="mt-1 text-sm text-red-900">
              Current verification status: {text(eligibility?.verification_status) || "not approved"}. Errand and Pabili Errand are available only after admin approval.
            </div>
            <button
              type="button"
              onClick={() => router.push("/verification")}
              className="mt-3 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-400"
            >
              Open verification
            </button>
          </div>
        ) : !profileName ? (
          <div className="rounded-[24px] border border-red-200 bg-red-50 p-5 text-sm text-red-900 shadow-sm">
            Your JRide passenger profile needs a valid full name before Errand booking can continue.
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950 shadow-sm">
            {notice}
          </div>
        ) : null}

        {currentError ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            {currentError}
          </div>
        ) : null}

        {enabled && authed && verified && current ? (
          <section className="space-y-4">
            <div className="rounded-[28px] border border-white/80 bg-white p-5 shadow-[0_16px_45px_rgba(15,23,42,0.06)]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Current Errand</div>
                  <div className="mt-1 text-xl font-semibold text-slate-950">
                    {prettyStage(stage, status)}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {stageDescription(stage, status)}
                  </div>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">
                  {text(booking?.booking_code) || stored.code || "Active"}
                </div>
              </div>

              {currentLoading ? (
                <div className="mt-3 text-xs text-slate-500">Refreshing status...</div>
              ) : null}
            </div>

            {text(driver?.driver_id) ? (
              <div className="rounded-[24px] border border-white/80 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-4">
                  {text(driver?.photo_url) ? (
                    <img
                      src={text(driver.photo_url)}
                      alt="Assigned driver"
                      className="h-16 w-16 rounded-full border border-slate-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
                      Driver
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Assigned driver</div>
                    <div className="text-lg font-semibold text-slate-950">
                      {text(driver?.full_name) || "JRide Driver"}
                    </div>
                    <div className="text-sm text-slate-600">
                      {[text(driver?.vehicle_type), text(driver?.plate_number)]
                        .filter(Boolean)
                        .join(" | ") || "Vehicle details pending"}
                    </div>
                    {text(driver?.phone) ? (
                      <div className="mt-1 text-sm text-slate-600">{text(driver.phone)}</div>
                    ) : null}
                  </div>
                  {driverLocation?.updated_at ? (
                    <div className="hidden text-right text-[11px] text-slate-500 sm:block">
                      Location updated
                      <br />
                      {new Date(driverLocation.updated_at).toLocaleTimeString("en-PH", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="rounded-[24px] border border-white/80 bg-white p-4 text-sm text-slate-600 shadow-sm">
                No driver is assigned yet. JRide will keep the Errand in matching; it will not silently pull a driver from another town.
              </div>
            )}

            {text(booking?.id) ? (
              <ErrandLiveMap
                bookingId={text(booking.id)}
                stage0={stage0MapPoint}
                stops={stopMapPoints}
                finalPoint={finalMapPoint}
                errandStage={stage}
                currentStopSequence={numberOrNull(job?.current_stop_sequence)}
              />
            ) : null}

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-slate-950">Confirmed task details</div>
                <div className="mt-3 space-y-3 text-sm">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Task</div>
                    <div className="mt-1 text-slate-800">{text(job?.task_description) || "--"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Customer meeting point</div>
                    <div className="mt-1 text-slate-800">{text(booking?.from_label) || "--"}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">Task stops</div>
                    <div className="mt-2 space-y-2">
                      {currentStops.map((stop: any) => (
                        <div
                          key={String(stop?.id || stop?.sequence)}
                          className={
                            "rounded-2xl border p-3 " +
                            (Number(job?.current_stop_sequence) === Number(stop?.sequence)
                              ? "border-emerald-300 bg-emerald-50"
                              : "border-slate-100 bg-slate-50")
                          }
                        >
                          <div className="font-semibold text-slate-800">
                            Task Stop {String(stop?.sequence || "-")}: {text(stop?.location_label) || "--"}
                          </div>
                          {text(stop?.instructions) ? (
                            <div className="mt-1 text-xs text-slate-600">{text(stop.instructions)}</div>
                          ) : null}
                          <div className="mt-1 text-[11px] text-slate-500">
                            Status: {text(stop?.status) || "pending"}
                            {stop?.is_substitute ? " | confirmed substitute" : ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400">
                      {returnsToCustomer ? "Return to you" : "Final destination"}
                    </div>
                    <div className="mt-1 text-slate-800">{text(job?.final_label) || text(booking?.to_label) || "--"}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div className="rounded-xl bg-slate-50 p-3">
                      Cargo: {numberOrNull(job?.confirmed_cargo_weight_kg ?? job?.estimated_cargo_weight_kg) ?? 0} kg
                    </div>
                    <div className="rounded-xl bg-slate-50 p-3">
                      Vehicle: {text(job?.vehicle_requirement) || "either"}
                    </div>
                  </div>
                </div>
              </div>

              <div
                className={
                  "rounded-[24px] border p-5 shadow-sm " +
                  (awaitingConfirmation
                    ? "border-amber-300 bg-amber-50"
                    : "border-white/80 bg-white")
                }
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-950">
                    {awaitingConfirmation ? "Review starting fare" : "Running Errand fare"}
                  </div>
                  {taskLocked ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-800">
                      Task locked
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <FareRow label="Base fare" value={fare?.base_fare} />
                  <FareRow label="Pickup distance" value={fare?.pickup_distance_fee} />
                  <FareRow label={`Confirmed route (${km(job?.confirmed_route_distance_km)})`} value={fare?.distance_fare} />
                  <FareRow label="Additional task stops" value={fare?.extra_stop_fee} />
                  <FareRow label="Waiting" value={fare?.waiting_fee} />
                  <FareRow label="Elevation" value={fare?.elevation_surcharge} />
                  <FareRow label="Heavy load" value={fare?.heavy_load_fee} />
                  <div className="border-t border-slate-200 pt-3">
                    <div className="flex items-center justify-between gap-3 text-base font-bold text-slate-950">
                      <span>Current service fare</span>
                      <span>{money(fare?.total_errand_fare)}</span>
                    </div>
                  </div>
                </div>

                {fare?.waiting ? (
                  <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                    Waiting: {Math.floor(Number(fare.waiting.current_total_seconds || 0) / 60)} min total | First {fare.waiting.free_minutes ?? 15} min free | Current waiting fee {money(fare.waiting.current_fee)}
                  </div>
                ) : null}

                {awaitingConfirmation ? (
                  <div className="mt-4 rounded-2xl border border-amber-200 bg-white/70 p-4">
                    <div className="text-sm font-semibold text-amber-950">Your confirmation locks the task.</div>
                    <div className="mt-1 text-xs text-amber-900">
                      Check the task stops, cargo and starting fare above. After confirmation there is no normal edit flow; exceptions require explicit handling.
                    </div>
                    <button
                      type="button"
                      onClick={confirmTask}
                      disabled={confirmBusy}
                      className="mt-3 w-full rounded-2xl bg-emerald-500 py-3 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
                    >
                      {confirmBusy ? "Confirming..." : "Confirm Task"}
                    </button>
                  </div>
                ) : null}

                <div className="mt-3 text-[11px] text-slate-500">
                  {current?.map_note || "Fare is based on the confirmed route, not the driver's live path."}
                </div>
              </div>
            </div>

            {job?.is_pabili ? (
              <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                <div className="text-sm font-semibold text-slate-950">Pabili money</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <Metric label="Customer funds" value={money(pabili?.customer_funds_received)} />
                  <Metric label="Purchase total" value={money(pabili?.purchase_total)} />
                  <Metric label="Change due" value={money(pabili?.change_due)} />
                  <Metric label="Change returned" value={money(pabili?.change_returned)} />
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  Purchase money is separate from the JRide service fare. The driver is never required to advance personal money.
                </div>
              </div>
            ) : null}
          </section>
        ) : enabled && authed && verified && profileName ? (
          <section className="space-y-4">
            <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-semibold text-slate-950">New Errand</div>
                  <div className="mt-1 text-xs text-slate-500">
                    Passenger: {profileName}. The customer meeting point is where the driver meets you and confirms the task.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={resetDraft}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Clear form
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-950">1. Set the customer meeting point</div>
                  <div className="mt-3">
                    <ErrandLocationField
                      title="Customer meeting point"
                      value={stage0}
                      onChange={setStage0}
                      allowCurrentLocation
                      placeholder="Search where the driver should meet you"
                      helpText="Pickup-distance surcharge is based on the driver's routed road distance to this pin."
                    />
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-950">2. Describe the task</div>
                  <textarea
                    value={taskDescription}
                    onChange={(event) => setTaskDescription(event.target.value)}
                    placeholder="Example: Buy one 25 kg sack of rice and two cases of drinks, then bring them back to me."
                    className="mt-3 min-h-[110px] w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                  />
                </div>

                <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-950">3. Task stops</div>
                      <div className="text-xs text-slate-500">Task Stop 1 is included. Each confirmed task stop after Task Stop 1 currently adds PHP 40.</div>
                    </div>
                    <button
                      type="button"
                      onClick={addStop}
                      className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-400"
                    >
                      Add task stop
                    </button>
                  </div>

                  <div className="mt-4 space-y-4">
                    {stops.map((stop, index) => (
                      <div key={stop.id} className="rounded-2xl border border-slate-100 bg-slate-50/70 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-800">Task Stop {index + 1}</div>
                          {stops.length > 1 ? (
                            <button
                              type="button"
                              onClick={() => removeStop(stop.id)}
                              className="text-xs font-semibold text-red-600 hover:text-red-700"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-3">
                          <ErrandLocationField
                            title={`Task Stop ${index + 1} location`}
                            value={stop.location}
                            onChange={(location) => updateStopLocation(stop.id, location)}
                            proximity={stage0 ? { lat: stage0.lat, lng: stage0.lng } : null}
                            placeholder="Search store, office, house, or destination"
                          />
                        </div>
                        <input
                          value={stop.instructions}
                          onChange={(event) => updateStopInstructions(stop.id, event.target.value)}
                          placeholder="Optional instructions for this task stop"
                          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm outline-none focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-950">4. Where should the Errand end?</div>
                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setFinalMode("return_to_customer")}
                      className={
                        "rounded-2xl border p-3 text-left text-sm " +
                        (finalMode === "return_to_customer"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                          : "border-slate-200 bg-white text-slate-700")
                      }
                    >
                      <div className="font-semibold">Return to me</div>
                      <div className="mt-1 text-xs opacity-70">The driver returns to your customer meeting point.</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setFinalMode("different_address")}
                      className={
                        "rounded-2xl border p-3 text-left text-sm " +
                        (finalMode === "different_address"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-950"
                          : "border-slate-200 bg-white text-slate-700")
                      }
                    >
                      <div className="font-semibold">Different destination</div>
                      <div className="mt-1 text-xs opacity-70">End the Errand somewhere else.</div>
                    </button>
                  </div>

                  {finalMode === "different_address" ? (
                    <div className="mt-4">
                      <ErrandLocationField
                        title="Final destination"
                        value={finalLocation}
                        onChange={setFinalLocation}
                        proximity={stage0 ? { lat: stage0.lat, lng: stage0.lng } : null}
                        placeholder="Search final destination"
                      />
                    </div>
                  ) : stage0 ? (
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
                      Return to you: {stage0.label}
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-950">Pabili option</div>
                  <label className="mt-3 flex items-start gap-3 rounded-2xl bg-slate-50 p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={isPabili}
                      onChange={(event) => setIsPabili(event.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      <span className="font-semibold text-slate-800">Buy something for me (Pabili)</span>
                      <span className="mt-1 block text-xs text-slate-500">Customer-funded only. Do not hand over cash until the driver checks the task and cargo with you at the meeting point.</span>
                    </span>
                  </label>

                  {isPabili ? (
                    <div className="mt-3">
                      <label className="text-xs font-semibold text-slate-700">Estimated purchase amount</label>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={estimatedPurchase}
                        onChange={(event) => setEstimatedPurchase(event.target.value)}
                        placeholder="PHP"
                        className="mt-1 w-full rounded-2xl border border-slate-200 px-3 py-3 text-sm shadow-sm"
                      />
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[24px] border border-white/80 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-950">Cargo / vehicle</div>
                  <label className="mt-3 block text-xs font-semibold text-slate-700">Estimated total cargo weight</label>
                  <div className="relative mt-1">
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={cargoWeight}
                      onChange={(event) => setCargoWeight(event.target.value)}
                      placeholder="0"
                      className="w-full rounded-2xl border border-slate-200 px-3 py-3 pr-10 text-sm shadow-sm"
                    />
                    <span className="absolute right-3 top-3 text-sm text-slate-400">kg</span>
                  </div>
                  {cargoTooHeavy ? (
                    <div className="mt-2 text-xs text-red-600">More than 100 kg is not a normal JRide Errand.</div>
                  ) : cargoKg != null && cargoKg > 50 ? (
                    <div className="mt-2 text-xs text-amber-700">51-100 kg is Extra Heavy, tricycle-only and optional to the driver.</div>
                  ) : cargoKg != null && cargoKg > 25 ? (
                    <div className="mt-2 text-xs text-amber-700">Above 25 kg requires a tricycle for the current working policy.</div>
                  ) : cargoKg != null && cargoKg > 15 ? (
                    <div className="mt-2 text-xs text-slate-500">16-25 kg is a working Heavy Load tier. Motorcycle still depends on safe fit and securing.</div>
                  ) : null}

                  <label className="mt-4 block text-xs font-semibold text-slate-700">Vehicle preference</label>
                  <select
                    value={vehicleRequirement}
                    onChange={(event) =>
                      setVehicleRequirement(
                        event.target.value as "either" | "motorcycle" | "tricycle"
                      )
                    }
                    disabled={cargoKg != null && cargoKg > 25}
                    className="mt-1 w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm shadow-sm disabled:bg-slate-100"
                  >
                    <option value="either">Motorcycle or Tricycle</option>
                    <option value="motorcycle">Motorcycle</option>
                    <option value="tricycle">Tricycle</option>
                  </select>
                  <div className="mt-2 text-[11px] text-slate-500">
                    Safety overrides weight. A driver may reject bulky or unsafe cargo even when it is below the weight ceiling.
                  </div>
                </div>

                <div className="rounded-[24px] border border-emerald-100 bg-emerald-50/70 p-5 shadow-sm">
                  <div className="text-sm font-semibold text-emerald-950">Working field-test pricing</div>
                  <div className="mt-2 space-y-1 text-xs text-emerald-900">
                    <div>Base: PHP 40 candidate</div>
                    <div>Confirmed Errand route: PHP 15/km candidate</div>
                    <div>Task Stop 1 included; +PHP 40 each additional task stop</div>
                    <div>Waiting: first 15 cumulative minutes free; then PHP 20 per started 15 minutes</div>
                    <div>Pickup distance uses the existing JRide pickup surcharge separately</div>
                  </div>
                  <div className="mt-3 text-[11px] text-emerald-800">
                    The in-person task review determines the exact starting fare. Field-test rates can still be adjusted before public rollout.
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-sm font-semibold text-slate-950">Accompanied Errand</div>
                  <div className="mt-2 text-xs text-slate-500">
                    Not enabled in this test slice yet. When implemented, passenger-carrying travel will use the applicable LGU/JRide Ride Fare Matrix without double-charging the same kilometers as Errand distance.
                  </div>
                </div>

                <button
                  type="button"
                  onClick={submitErrand}
                  disabled={!formReady || bookingBusy}
                  className="w-full rounded-2xl bg-emerald-500 py-3.5 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(16,185,129,0.28)] hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {bookingBusy ? "Submitting Errand..." : "Request Errand"}
                </button>

                {!formReady ? (
                  <div className="text-center text-[11px] font-medium text-amber-700">
                    Missing: {missingRequirement || "required Errand information"}.
                  </div>
                ) : null}
              </aside>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function FareRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="font-semibold text-slate-900">{money(value)}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 font-semibold text-slate-900">{value}</div>
    </div>
  );
}
