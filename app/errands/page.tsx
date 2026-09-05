"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import ErrandLiveMap from "./ErrandLiveMap";
import ErrandLocationField, {
  type ErrandLocationValue,
} from "./ErrandLocationField";

const TOKEN_KEY = "jride_access_token";
const PASSENGER_TOKEN_KEY = "jride_passenger_token";
const ERRAND_ID_KEY = "jride_active_errand_booking_id";
const ERRAND_CODE_KEY = "jride_active_errand_booking_code";
const DISMISSED_RECEIPT_KEY = "jride_errand_receipt_dismissed_id";

const REQUEST_STEPS = ["Meeting", "Task", "Stops", "Cargo", "Review"] as const;

const ACTIVE_STEPS = [
  "Matching",
  "Meet driver",
  "Review & fare",
  "Task confirmed",
  "Task stops",
  "Final handoff",
] as const;

type Eligibility = {
  ok?: boolean;
  enabled?: boolean;
  authed?: boolean;
  verified?: boolean;
  verification_status?: string | null;
  profile_name?: string | null;
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

type Receipt = {
  booking_id?: string;
  booking_code?: string;
  completed_at?: string | null;
  starting_fare?: number | null;
  final_fare?: number | null;
  approach_fee?: number | null;
  base_fare?: number | null;
  pickup_distance_fee?: number | null;
  distance_fare?: number | null;
  extra_stop_fee?: number | null;
  waiting_minutes?: number | null;
  waiting_fee?: number | null;
  elevation_surcharge?: number | null;
  heavy_load_fee?: number | null;
};

type MapPoint = {
  label: string;
  lat: number;
  lng: number;
  kind: "stage0" | "stop" | "final";
  sequence?: number | null;
};

function clean(value: unknown): string {
  const result = String(value ?? "").replace(/\s+/g, " ").trim();
  const lower = result.toLowerCase();
  return lower === "null" || lower === "undefined" ? "" : result;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberOrZero(value: unknown): number {
  return numberOrNull(value) ?? 0;
}

function money(value: unknown): string {
  const parsed = numberOrNull(value);
  return parsed == null
    ? "--"
    : `PHP ${Math.round(parsed).toLocaleString("en-PH")}`;
}

function km(value: unknown): string {
  const parsed = numberOrNull(value);
  return parsed == null ? "--" : `${parsed.toFixed(1)} km`;
}

function getToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return clean(
      localStorage.getItem(TOKEN_KEY) ||
        localStorage.getItem(PASSENGER_TOKEN_KEY) ||
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

function nextStopId(): string {
  return `stop_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function storeActiveErrand(id: string, code: string) {
  try {
    if (id) localStorage.setItem(ERRAND_ID_KEY, id);
    else localStorage.removeItem(ERRAND_ID_KEY);
    if (code) localStorage.setItem(ERRAND_CODE_KEY, code);
    else localStorage.removeItem(ERRAND_CODE_KEY);
  } catch {}
}

function activeStepIndex(stageRaw: unknown, statusRaw: unknown): number {
  const stage = clean(stageRaw).toLowerCase();
  const status = clean(statusRaw).toLowerCase();
  if (["requested", "pending", "searching"].includes(status) || stage === "matching") return 0;
  if (["driver_assigned", "going_to_customer"].includes(stage) || status === "assigned") return 1;
  if (["stage0_review", "awaiting_customer_confirmation"].includes(stage) || status === "fare_proposed") return 2;
  if (stage === "task_confirmed") return 3;
  if ([
    "going_to_stop",
    "waiting_at_stop",
    "resolving_stop_issue",
    "going_to_customer_for_cash",
    "waiting_for_cash_topup",
    "returning_to_stop_after_cash",
  ].includes(stage)) return 4;
  return 5;
}

function stageMeta(stageRaw: unknown, statusRaw: unknown) {
  const stage = clean(stageRaw).toLowerCase();
  const status = clean(statusRaw).toLowerCase();

  if (["requested", "pending", "searching"].includes(status) || stage === "matching") {
    return {
      label: "Finding your driver",
      detail: "JRide is matching an eligible driver from your meeting-point town.",
      tone: "sky",
    };
  }
  if (["driver_assigned", "going_to_customer"].includes(stage) || status === "assigned") {
    return {
      label: "Driver coming to you",
      detail: "Meet the driver at your pinned customer meeting point.",
      tone: "blue",
    };
  }
  if (stage === "stage0_review") {
    return {
      label: "Review the task together",
      detail: "The driver is checking the task, cargo and route with you.",
      tone: "amber",
    };
  }
  if (stage === "awaiting_customer_confirmation" || status === "fare_proposed") {
    return {
      label: "Your confirmation is needed",
      detail: "Check the confirmed task and starting fare before the Errand starts.",
      tone: "amber",
    };
  }
  if (stage === "task_confirmed") {
    return {
      label: "Task confirmed",
      detail: "The driver can start the confirmed Errand route.",
      tone: "emerald",
    };
  }
  if (stage === "waiting_at_stop") {
    return {
      label: "Driver is at a task stop",
      detail: "Waiting is cumulative. The first 15 total waiting minutes are free.",
      tone: "violet",
    };
  }
  if ([
    "going_to_stop",
    "resolving_stop_issue",
    "going_to_customer_for_cash",
    "waiting_for_cash_topup",
    "returning_to_stop_after_cash",
  ].includes(stage)) {
    return {
      label: "Errand in progress",
      detail: "Follow the current task stop and driver progress below.",
      tone: "violet",
    };
  }
  if (stage === "going_to_final") {
    return {
      label: "Heading to final destination",
      detail: "The driver is on the final confirmed leg of the Errand.",
      tone: "orange",
    };
  }
  if (stage === "waiting_at_final_handoff") {
    return {
      label: "Driver is at the destination",
      detail: "The driver is waiting for the final recipient or customer handoff.",
      tone: "orange",
    };
  }
  if (stage === "final_recipient_met") {
    return {
      label: "Recipient met",
      detail: "Billable waiting has stopped. The final handoff is being completed.",
      tone: "emerald",
    };
  }
  if (stage === "unreachable_escalated") {
    return {
      label: "Handoff escalated",
      detail: "JRide support or dispatch must resolve the destination handoff.",
      tone: "red",
    };
  }

  return {
    label: "Errand active",
    detail: "JRide is updating the trip status.",
    tone: "emerald",
  };
}

function toneClasses(tone: string) {
  if (tone === "sky") return "border-sky-400/30 bg-sky-400/10 text-sky-100";
  if (tone === "blue") return "border-blue-400/30 bg-blue-400/10 text-blue-100";
  if (tone === "amber") return "border-amber-400/30 bg-amber-400/10 text-amber-100";
  if (tone === "violet") return "border-violet-400/30 bg-violet-400/10 text-violet-100";
  if (tone === "orange") return "border-orange-400/30 bg-orange-400/10 text-orange-100";
  if (tone === "red") return "border-red-400/30 bg-red-400/10 text-red-100";
  return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
}

function vehicleLabel(raw: unknown): string {
  const value = clean(raw).toLowerCase();
  if (value === "motorcycle") return "Motorcycle";
  if (value === "tricycle") return "Tricycle";
  return "Motorcycle or Tricycle";
}

function stopStatusClasses(statusRaw: unknown): string {
  const status = clean(statusRaw).toLowerCase();
  if (["completed", "done"].includes(status)) return "bg-emerald-100 text-emerald-800";
  if (["arrived", "waiting", "waiting_at_stop"].includes(status)) return "bg-violet-100 text-violet-800";
  if (["skipped", "cancelled", "blocked"].includes(status)) return "bg-red-100 text-red-800";
  return "bg-slate-100 text-slate-600";
}

export default function ErrandPage() {
  const router = useRouter();

  const [eligibility, setEligibility] = React.useState<Eligibility | null>(null);
  const [eligibilityLoading, setEligibilityLoading] = React.useState(true);
  const [current, setCurrent] = React.useState<ErrandBundle | null>(null);
  const [currentLoading, setCurrentLoading] = React.useState(false);
  const [currentError, setCurrentError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [receipt, setReceipt] = React.useState<Receipt | null>(null);

  const [requestStep, setRequestStep] = React.useState(0);
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

  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActiveIdRef = React.useRef("");

  const enabled = eligibility?.enabled === true;
  const authed = eligibility?.authed === true;
  const verified = eligibility?.verified === true;
  const profileName = clean(eligibility?.profile_name);

  const cargoKg = numberOrNull(cargoWeight);
  const cargoTooHeavy = cargoKg != null && cargoKg > 100;

  React.useEffect(() => {
    if (cargoKg != null && cargoKg > 25 && vehicleRequirement !== "tricycle") {
      setVehicleRequirement("tricycle");
    }
  }, [cargoKg, vehicleRequirement]);

  const fetchReceipt = React.useCallback(async (bookingId: string) => {
    const id = clean(bookingId);
    if (!id || !getToken()) return;

    let dismissed = "";
    try {
      dismissed = clean(localStorage.getItem(DISMISSED_RECEIPT_KEY));
    } catch {}
    if (dismissed === id) return;

    try {
      const { response, json } = await getAuthJson(
        `/api/passenger/errand/completed?booking_id=${encodeURIComponent(id)}`
      );
      if (response.ok && json?.ok === true && json?.receipt?.booking_id) {
        setReceipt(json.receipt as Receipt);
      }
    } catch {}
  }, []);

  const refreshEligibility = React.useCallback(async () => {
    setEligibilityLoading(true);
    try {
      const { response, json } = await getAuthJson(
        "/api/passenger/errand/eligibility"
      );

      if (response.status === 401 || json?.authed === false) {
        setEligibility({ enabled: false, authed: false, verified: false });
        return;
      }

      if (!response.ok || json?.ok === false) {
        setEligibility({
          enabled: false,
          authed: false,
          verified: false,
          error: clean(json?.error),
          message: clean(json?.message) || `HTTP ${response.status}`,
        });
        return;
      }

      setEligibility(json as Eligibility);
    } catch (error: any) {
      setEligibility({
        enabled: false,
        authed: false,
        verified: false,
        error: "ERRAND_ELIGIBILITY_READ_FAILED",
        message: clean(error?.message) || "Could not check Errand availability.",
      });
    } finally {
      setEligibilityLoading(false);
    }
  }, []);

  const refreshCurrent = React.useCallback(
    async (silent = false) => {
      if (!getToken()) {
        setCurrent(null);
        return;
      }

      if (!silent) setCurrentLoading(true);

      try {
        const { response, json } = await getAuthJson(
          "/api/passenger/errand/current"
        );

        if (response.status === 401) {
          setCurrent(null);
          window.location.replace(
            "/passenger-login?callbackUrl=" + encodeURIComponent("/errands")
          );
          return;
        }

        if (response.status === 503) {
          setCurrent(null);
          return;
        }

        if (!response.ok || json?.ok === false) {
          setCurrentError(
            clean(json?.message || json?.error) || `HTTP ${response.status}`
          );
          return;
        }

        setCurrentError("");
        const next = json?.errand || null;

        if (next?.booking?.id) {
          const id = clean(next.booking.id);
          const code = clean(next.booking.booking_code);
          lastActiveIdRef.current = id;
          storeActiveErrand(id, code);
          setReceipt(null);
          setNotice("");
          setCurrent(next as ErrandBundle);
          return;
        }

        setCurrent(null);

        let completedCandidate = lastActiveIdRef.current;
        if (!completedCandidate) {
          try {
            completedCandidate = clean(localStorage.getItem(ERRAND_ID_KEY));
          } catch {}
        }
        if (completedCandidate) {
          await fetchReceipt(completedCandidate);
        }
      } catch (error: any) {
        if (!silent) {
          setCurrentError(clean(error?.message) || "Could not refresh Errand status.");
        }
      } finally {
        if (!silent) setCurrentLoading(false);
      }
    },
    [fetchReceipt]
  );

  React.useEffect(() => {
    void refreshEligibility();
  }, [refreshEligibility]);

  React.useEffect(() => {
    if (!enabled || !authed) return;

    void refreshCurrent(false);
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => void refreshCurrent(true), 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [enabled, authed, refreshCurrent]);

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

  function resetDraft() {
    setRequestStep(0);
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

  const validStops = stops.every((stop) => !!stop.location);
  const finalReady =
    finalMode === "return_to_customer" ? !!stage0 : !!finalLocation;

  const stepReady = [
    !!stage0,
    clean(taskDescription).length >= 3,
    stops.length >= 1 && validStops && finalReady,
    !cargoTooHeavy && (!isPabili || numberOrNull(estimatedPurchase) != null),
    true,
  ];

  const formReady = stepReady.slice(0, 4).every(Boolean);

  function goNext() {
    if (!stepReady[requestStep]) return;
    setNotice("");
    setRequestStep((value) => Math.min(value + 1, REQUEST_STEPS.length - 1));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function goBack() {
    setNotice("");
    setRequestStep((value) => Math.max(value - 1, 0));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function submitErrand() {
    if (!formReady || !stage0 || bookingBusy) return;

    const final =
      finalMode === "return_to_customer" ? stage0 : finalLocation;
    if (!final) return;

    setBookingBusy(true);
    setNotice("");

    try {
      const body = {
        stage0_label: stage0.label,
        stage0_lat: stage0.lat,
        stage0_lng: stage0.lng,
        task_description: clean(taskDescription),
        stops: stops.map((stop) => ({
          place_name: stop.location?.label || null,
          location_label: stop.location?.label || "",
          lat: stop.location?.lat ?? null,
          lng: stop.location?.lng ?? null,
          instructions: clean(stop.instructions) || null,
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
        const code = clean(json?.code || json?.error || "ERRAND_BOOKING_FAILED");
        if (code === "ERRAND_REQUIRES_VERIFIED_PASSENGER") {
          await refreshEligibility();
        }
        throw new Error(
          [code, clean(json?.message)].filter(Boolean).join(" - ")
        );
      }

      const id = clean(json?.booking_id);
      const code = clean(json?.booking_code);
      lastActiveIdRef.current = id;
      storeActiveErrand(id, code);
      await refreshCurrent(false);
    } catch (error: any) {
      setNotice(clean(error?.message) || "Errand booking failed.");
    } finally {
      setBookingBusy(false);
    }
  }

  async function confirmTask() {
    const bookingId = clean(current?.booking?.id);
    if (!bookingId || confirmBusy) return;

    setConfirmBusy(true);
    setNotice("");

    try {
      const { response, json } = await postAuthJson(
        "/api/passenger/errand/confirm",
        { booking_id: bookingId }
      );

      if (!response.ok || json?.ok === false) {
        throw new Error(
          clean(json?.message || json?.error) || `HTTP ${response.status}`
        );
      }

      await refreshCurrent(false);
    } catch (error: any) {
      setNotice(clean(error?.message) || "Task confirmation failed.");
    } finally {
      setConfirmBusy(false);
    }
  }

  function dismissReceipt() {
    const id = clean(receipt?.booking_id);
    if (id) {
      try {
        localStorage.setItem(DISMISSED_RECEIPT_KEY, id);
      } catch {}
    }
    storeActiveErrand("", "");
    lastActiveIdRef.current = "";
    setReceipt(null);
    resetDraft();
  }

  if (eligibilityLoading) {
    return <LoadingScreen label="Checking your JRide Errand access..." />;
  }

  if (!enabled) {
    return (
      <GateScreen
        title="Errand is temporarily unavailable"
        message="Please try again later or contact JRide support."
        action="Back to Passenger"
        onAction={() => router.push("/passenger")}
      />
    );
  }

  if (!authed) {
    return (
      <GateScreen
        title="Sign in to use Errand"
        message="Your session is no longer active. Sign in before starting or continuing a transaction."
        action="Passenger Sign In"
        onAction={() =>
          router.push(
            "/passenger-login?callbackUrl=" + encodeURIComponent("/errands")
          )
        }
      />
    );
  }

  if (!verified) {
    return (
      <GateScreen
        title="Verification required"
        message={`Errand is available after your passenger account is approved. Current status: ${clean(eligibility?.verification_status) || "not approved"}.`}
        action="Open Verification"
        onAction={() => router.push("/verification")}
      />
    );
  }

  if (!profileName) {
    return (
      <GateScreen
        title="Complete your passenger profile"
        message="Add your full name before booking an Errand."
        action="Back to Passenger"
        onAction={() => router.push("/passenger")}
      />
    );
  }

  if (receipt?.booking_id) {
    return <CompletedReceipt receipt={receipt} onDone={dismissReceipt} />;
  }

  if (current) {
    return (
      <ActiveErrandScreen
        current={current}
        loading={currentLoading}
        error={currentError}
        notice={notice}
        confirmBusy={confirmBusy}
        onConfirm={confirmTask}
        onBack={() => router.push("/passenger")}
      />
    );
  }

  return (
    <NewErrandFlow
      profileName={profileName}
      requestStep={requestStep}
      stage0={stage0}
      setStage0={setStage0}
      taskDescription={taskDescription}
      setTaskDescription={setTaskDescription}
      stops={stops}
      addStop={addStop}
      removeStop={removeStop}
      updateStopLocation={updateStopLocation}
      updateStopInstructions={updateStopInstructions}
      finalMode={finalMode}
      setFinalMode={setFinalMode}
      finalLocation={finalLocation}
      setFinalLocation={setFinalLocation}
      isPabili={isPabili}
      setIsPabili={setIsPabili}
      estimatedPurchase={estimatedPurchase}
      setEstimatedPurchase={setEstimatedPurchase}
      cargoWeight={cargoWeight}
      setCargoWeight={setCargoWeight}
      cargoKg={cargoKg}
      cargoTooHeavy={cargoTooHeavy}
      vehicleRequirement={vehicleRequirement}
      setVehicleRequirement={setVehicleRequirement}
      stepReady={stepReady}
      formReady={formReady}
      notice={notice}
      bookingBusy={bookingBusy}
      onBackToPassenger={() => router.push("/passenger")}
      onPrevious={goBack}
      onNext={goNext}
      onSubmit={submitErrand}
      onReset={resetDraft}
    />
  );
}

function NewErrandFlow(props: {
  profileName: string;
  requestStep: number;
  stage0: ErrandLocationValue | null;
  setStage0: (value: ErrandLocationValue | null) => void;
  taskDescription: string;
  setTaskDescription: (value: string) => void;
  stops: StopDraft[];
  addStop: () => void;
  removeStop: (id: string) => void;
  updateStopLocation: (id: string, location: ErrandLocationValue) => void;
  updateStopInstructions: (id: string, instructions: string) => void;
  finalMode: "return_to_customer" | "different_address";
  setFinalMode: (value: "return_to_customer" | "different_address") => void;
  finalLocation: ErrandLocationValue | null;
  setFinalLocation: (value: ErrandLocationValue | null) => void;
  isPabili: boolean;
  setIsPabili: (value: boolean) => void;
  estimatedPurchase: string;
  setEstimatedPurchase: (value: string) => void;
  cargoWeight: string;
  setCargoWeight: (value: string) => void;
  cargoKg: number | null;
  cargoTooHeavy: boolean;
  vehicleRequirement: "either" | "motorcycle" | "tricycle";
  setVehicleRequirement: (value: "either" | "motorcycle" | "tricycle") => void;
  stepReady: boolean[];
  formReady: boolean;
  notice: string;
  bookingBusy: boolean;
  onBackToPassenger: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const {
    profileName,
    requestStep,
    stage0,
    setStage0,
    taskDescription,
    setTaskDescription,
    stops,
    addStop,
    removeStop,
    updateStopLocation,
    updateStopInstructions,
    finalMode,
    setFinalMode,
    finalLocation,
    setFinalLocation,
    isPabili,
    setIsPabili,
    estimatedPurchase,
    setEstimatedPurchase,
    cargoWeight,
    setCargoWeight,
    cargoKg,
    cargoTooHeavy,
    vehicleRequirement,
    setVehicleRequirement,
    stepReady,
    formReady,
    notice,
    bookingBusy,
    onBackToPassenger,
    onPrevious,
    onNext,
    onSubmit,
    onReset,
  } = props;

  const finalLabel =
    finalMode === "return_to_customer"
      ? stage0?.label || "Same as meeting point"
      : finalLocation?.label || "Not set";

  return (
    <main className="min-h-screen bg-slate-100 pb-28 text-slate-900">
      <div className="mx-auto min-h-screen max-w-xl bg-white shadow-xl shadow-slate-300/20">
        <header className="bg-slate-950 px-5 pb-5 pt-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBackToPassenger}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl ring-1 ring-white/10"
              aria-label="Back to Passenger"
            >
              <span aria-hidden="true">&#8249;</span>
            </button>
            <div className="text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">JRide Passenger</div>
              <div className="text-lg font-black">Errand</div>
            </div>
            <button
              type="button"
              onClick={onReset}
              className="rounded-xl px-2 py-2 text-xs font-bold text-slate-300"
            >
              Reset
            </button>
          </div>

          <div className="mt-5 grid grid-cols-5 gap-1.5">
            {REQUEST_STEPS.map((label, index) => (
              <div key={label} className="min-w-0 text-center">
                <div
                  className={
                    "mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ring-1 " +
                    (index < requestStep
                      ? "bg-emerald-400 text-slate-950 ring-emerald-300"
                      : index === requestStep
                        ? "bg-white text-slate-950 ring-white"
                        : "bg-white/5 text-slate-500 ring-white/10")
                  }
                >
                  {index + 1}
                </div>
                <div className={"mt-1 truncate text-[9px] font-bold " + (index === requestStep ? "text-white" : "text-slate-500")}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </header>

        <div className="px-4 py-5">
          <div className="mb-4 rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600 ring-1 ring-slate-200">
            Passenger: <span className="font-bold text-slate-900">{profileName}</span>
          </div>

          {notice ? (
            <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">
              {notice}
            </div>
          ) : null}

          {requestStep === 0 ? (
            <StepCard
              eyebrow="Step 1"
              title="Where should the driver meet you?"
              subtitle="This is the only pickup point used to match your driver and calculate the approach charge."
            >
              <ErrandLocationField
                title="Customer meeting point"
                value={stage0}
                onChange={setStage0}
                allowCurrentLocation
                placeholder="Search or pin your meeting point"
                helpText="The PHP 40 minimum approach charge is replaced by a higher routed pickup-distance charge when applicable."
              />
            </StepCard>
          ) : null}

          {requestStep === 1 ? (
            <StepCard
              eyebrow="Step 2"
              title="What should the driver do?"
              subtitle="Keep it short and specific. You will review this together before the Errand starts."
            >
              <textarea
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                placeholder="Example: Pick up one sack of rice and two cases of drinks, then return them to me."
                className="min-h-[150px] w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-base leading-6 outline-none transition focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100"
              />
              <div className="mt-2 text-right text-xs text-slate-400">
                {clean(taskDescription).length < 3 ? "Add a short task description" : "Ready"}
              </div>
            </StepCard>
          ) : null}

          {requestStep === 2 ? (
            <div className="space-y-4">
              <StepCard
                eyebrow="Step 3"
                title="Task stops"
                subtitle="Task Stop 1 is included. Each additional confirmed stop adds PHP 40."
              >
                <div className="space-y-3">
                  {stops.map((stop, index) => (
                    <div key={stop.id} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-200">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="font-bold text-slate-900">Task Stop {index + 1}</div>
                        {stops.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeStop(stop.id)}
                            className="text-xs font-bold text-red-600"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <ErrandLocationField
                        title={`Task Stop ${index + 1} location`}
                        value={stop.location}
                        onChange={(location) => updateStopLocation(stop.id, location)}
                        proximity={stage0 ? { lat: stage0.lat, lng: stage0.lng } : null}
                        placeholder="Search store, office, house or destination"
                      />
                      <input
                        value={stop.instructions}
                        onChange={(event) => updateStopInstructions(stop.id, event.target.value)}
                        placeholder="Optional instructions"
                        className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-400"
                      />
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={addStop}
                  className="mt-3 w-full rounded-2xl border border-dashed border-emerald-400 bg-emerald-50 py-3 text-sm font-black text-emerald-800"
                >
                  + Add another task stop
                </button>
              </StepCard>

              <StepCard
                eyebrow="Final handoff"
                title="Where should the Errand end?"
                subtitle="Choose whether the driver returns to you or hands off somewhere else."
              >
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceCard
                    selected={finalMode === "return_to_customer"}
                    title="Return to me"
                    detail="Back to meeting point"
                    onClick={() => setFinalMode("return_to_customer")}
                  />
                  <ChoiceCard
                    selected={finalMode === "different_address"}
                    title="Different place"
                    detail="Another handoff pin"
                    onClick={() => setFinalMode("different_address")}
                  />
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
                ) : (
                  <div className="mt-3 rounded-2xl bg-emerald-50 px-3 py-3 text-xs font-semibold text-emerald-900">
                    {stage0?.label || "Set the meeting point first"}
                  </div>
                )}
              </StepCard>
            </div>
          ) : null}

          {requestStep === 3 ? (
            <div className="space-y-4">
              <StepCard
                eyebrow="Step 4"
                title="Errand type"
                subtitle="Select Pabili only when the driver needs to buy something using money you provide."
              >
                <div className="grid grid-cols-2 gap-2">
                  <ChoiceCard
                    selected={!isPabili}
                    title="Regular Errand"
                    detail="Pickup, deliver or do a task"
                    onClick={() => setIsPabili(false)}
                  />
                  <ChoiceCard
                    selected={isPabili}
                    title="Pabili"
                    detail="Driver buys for you"
                    onClick={() => setIsPabili(true)}
                  />
                </div>

                {isPabili ? (
                  <div className="mt-4 rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                    <label className="text-xs font-black uppercase tracking-wide text-amber-900">Estimated purchase amount</label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={estimatedPurchase}
                      onChange={(event) => setEstimatedPurchase(event.target.value)}
                      placeholder="PHP 0"
                      className="mt-2 w-full rounded-2xl border border-amber-200 bg-white px-4 py-3 text-base font-bold outline-none focus:border-amber-400"
                    />
                    <div className="mt-2 text-xs leading-5 text-amber-800">
                      Customer-funded only. Hand cash to the driver only after the in-person task review.
                    </div>
                  </div>
                ) : null}
              </StepCard>

              <StepCard
                eyebrow="Cargo"
                title="Weight and vehicle"
                subtitle="This helps JRide send a vehicle that can safely handle the load."
              >
                <label className="text-xs font-black uppercase tracking-wide text-slate-500">Estimated cargo weight</label>
                <div className="relative mt-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={cargoWeight}
                    onChange={(event) => setCargoWeight(event.target.value)}
                    placeholder="0"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 pr-12 text-base font-bold outline-none focus:border-emerald-400 focus:bg-white"
                  />
                  <span className="absolute right-4 top-3.5 text-sm font-bold text-slate-400">kg</span>
                </div>

                {cargoTooHeavy ? (
                  <div className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">More than 100 kg is not eligible for a normal JRide Errand.</div>
                ) : cargoKg != null && cargoKg > 50 ? (
                  <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">51-100 kg requires a tricycle and driver acceptance.</div>
                ) : cargoKg != null && cargoKg > 25 ? (
                  <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">Above 25 kg requires a tricycle.</div>
                ) : null}

                <div className="mt-4 grid grid-cols-3 gap-2">
                  {([
                    ["either", "Either"],
                    ["motorcycle", "Motorcycle"],
                    ["tricycle", "Tricycle"],
                  ] as const).map(([value, label]) => {
                    const disabled = cargoKg != null && cargoKg > 25 && value !== "tricycle";
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={disabled}
                        onClick={() => setVehicleRequirement(value)}
                        className={
                          "rounded-2xl border px-2 py-3 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-30 " +
                          (vehicleRequirement === value
                            ? "border-emerald-400 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
                            : "border-slate-200 bg-white text-slate-700")
                        }
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </StepCard>
            </div>
          ) : null}

          {requestStep === 4 ? (
            <div className="space-y-4">
              <StepCard
                eyebrow="Step 5"
                title="Review your Errand"
                subtitle="The driver will still review the actual task and cargo with you before the starting fare is confirmed."
              >
                <ReviewRow label="Meet driver" value={stage0?.label || "Not set"} />
                <ReviewRow label="Task" value={clean(taskDescription) || "Not set"} />
                <ReviewRow label="Task stops" value={`${stops.length} stop${stops.length === 1 ? "" : "s"}`} />
                <ReviewRow label="Final handoff" value={finalLabel} />
                <ReviewRow label="Errand type" value={isPabili ? "Pabili" : "Regular Errand"} />
                {isPabili ? <ReviewRow label="Estimated purchase" value={money(estimatedPurchase)} /> : null}
                <ReviewRow label="Cargo" value={`${cargoKg ?? 0} kg`} />
                <ReviewRow label="Vehicle" value={vehicleLabel(vehicleRequirement)} />
              </StepCard>

              <details className="rounded-2xl bg-slate-50 p-4 text-sm ring-1 ring-slate-200">
                <summary className="cursor-pointer font-black text-slate-800">How the fare is calculated</summary>
                <div className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
                  <div><span className="font-bold text-slate-900">Approach:</span> PHP 40 minimum, or the routed pickup-distance charge when higher. They are never added together.</div>
                  <div><span className="font-bold text-slate-900">Confirmed route:</span> PHP 15 per kilometer.</div>
                  <div><span className="font-bold text-slate-900">Extra stops:</span> Task Stop 1 included; PHP 40 for each additional confirmed stop.</div>
                  <div><span className="font-bold text-slate-900">Waiting:</span> First 15 total minutes free, then PHP 20 per started 15-minute block.</div>
                </div>
              </details>
            </div>
          ) : null}
        </div>

        <div className="fixed inset-x-0 bottom-0 z-40 px-3 pb-3">
          <div className="mx-auto max-w-xl rounded-[24px] border border-slate-200 bg-white/95 p-3 shadow-[0_-12px_40px_rgba(15,23,42,0.12)] backdrop-blur">
            <div className="flex gap-2">
              {requestStep > 0 ? (
                <button
                  type="button"
                  onClick={onPrevious}
                  className="w-28 rounded-2xl border border-slate-200 bg-white py-3 text-sm font-black text-slate-700"
                >
                  Back
                </button>
              ) : null}

              {requestStep < REQUEST_STEPS.length - 1 ? (
                <button
                  type="button"
                  onClick={onNext}
                  disabled={!stepReady[requestStep]}
                  className="flex-1 rounded-2xl bg-emerald-500 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  Continue
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={!formReady || bookingBusy}
                  className="flex-1 rounded-2xl bg-emerald-500 py-3 text-sm font-black text-white shadow-lg shadow-emerald-500/20 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                >
                  {bookingBusy ? "Requesting Errand..." : "Request Errand"}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ActiveErrandScreen(props: {
  current: ErrandBundle;
  loading: boolean;
  error: string;
  notice: string;
  confirmBusy: boolean;
  onConfirm: () => void;
  onBack: () => void;
}) {
  const { current, loading, error, notice, confirmBusy, onConfirm, onBack } = props;
  const booking = current.booking || {};
  const job = current.job || {};
  const fare = current.fare || {};
  const pabili = current.pabili || {};
  const driver = current.driver || {};
  const driverLocation = current.driver_location || {};
  const currentStops = Array.isArray(current.stops) ? current.stops || [] : [];

  const stage = clean(job?.errand_stage).toLowerCase();
  const status = clean(booking?.status).toLowerCase();
  const currentStep = activeStepIndex(stage, status);
  const meta = stageMeta(stage, status);
  const awaitingConfirmation =
    stage === "awaiting_customer_confirmation" || status === "fare_proposed";

  const base = numberOrZero(fare?.base_fare ?? booking?.base_fee);
  const pickup = numberOrZero(fare?.pickup_distance_fee ?? booking?.pickup_distance_fee);
  const approach = numberOrZero(fare?.approach_fee) || Math.max(base, pickup);
  const routeFare = numberOrZero(fare?.distance_fare);
  const extraStops = numberOrZero(fare?.extra_stop_fee);
  const waitingFee = numberOrZero(fare?.waiting_fee);
  const elevation = numberOrZero(fare?.elevation_surcharge);
  const heavy = numberOrZero(fare?.heavy_load_fee);
  const totalFare = numberOrZero(fare?.total_errand_fare);
  const waiting = fare?.waiting || {};

  const returnsToCustomer =
    clean(job?.final_destination_mode).toLowerCase() === "return_to_customer";

  const stage0Lat = numberOrNull(booking?.pickup_lat);
  const stage0Lng = numberOrNull(booking?.pickup_lng);
  const stage0MapPoint: MapPoint | null =
    stage0Lat != null && stage0Lng != null
      ? {
          label: clean(booking?.from_label) || "Customer meeting point",
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
      label: clean(stop?.location_label) || `Task Stop ${stop?.sequence || points.length + 1}`,
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
          label: clean(job?.final_label) || clean(booking?.to_label) || "Final destination",
          lat: finalLat,
          lng: finalLng,
          kind: "final",
        }
      : null;

  const matching = currentStep === 0;
  const fareTitle = matching
    ? "Minimum approach"
    : awaitingConfirmation
      ? "Starting fare"
      : "Current fare";
  const fareValue = matching ? money(Math.max(base, 40)) : money(totalFare);

  return (
    <main className="min-h-screen bg-slate-100 pb-6 text-slate-900">
      <div className="mx-auto min-h-screen max-w-xl bg-white shadow-xl shadow-slate-300/20">
        <header className="bg-slate-950 px-4 pb-5 pt-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-xl ring-1 ring-white/10"
              aria-label="Back to Passenger"
            >
              <span aria-hidden="true">&#8249;</span>
            </button>
            <div className="text-center">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">JRide Errand</div>
              <div className="text-sm font-black">{clean(booking?.booking_code) || "Active trip"}</div>
            </div>
            <div className="w-10" />
          </div>

          <div className={`mt-5 rounded-[24px] border p-4 ${toneClasses(meta.tone)}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] opacity-70">Step {currentStep + 1} of 6</div>
                <div className="mt-1 text-xl font-black leading-tight">{meta.label}</div>
                <div className="mt-1 text-xs leading-5 opacity-80">{meta.detail}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[10px] font-bold uppercase tracking-wide opacity-60">{fareTitle}</div>
                <div className="mt-1 text-2xl font-black">{fareValue}</div>
              </div>
            </div>
            {matching ? (
              <div className="mt-3 rounded-xl bg-black/15 px-3 py-2 text-[11px] font-semibold">
                Final approach charge is set after a driver is assigned. The PHP 40 minimum is not added again when the routed pickup charge is higher.
              </div>
            ) : null}
          </div>

          <div className="mt-4 grid grid-cols-6 gap-1.5">
            {ACTIVE_STEPS.map((label, index) => (
              <div key={label} className="min-w-0 text-center">
                <div className={"h-1.5 rounded-full " + (index <= currentStep ? "bg-emerald-400" : "bg-white/10")} />
                <div className={"mt-1 truncate text-[8px] font-bold " + (index === currentStep ? "text-white" : "text-slate-600")}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </header>

        <div className="space-y-4 px-4 py-4">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800">{error}</div>
          ) : null}
          {notice ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">{notice}</div>
          ) : null}
          {loading ? <div className="text-center text-xs font-semibold text-slate-400">Refreshing trip...</div> : null}

          {clean(driver?.driver_id) ? (
            <section className="rounded-[22px] bg-white p-4 ring-1 ring-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                {clean(driver?.photo_url) ? (
                  <img
                    src={clean(driver.photo_url)}
                    alt="Assigned driver"
                    className="h-14 w-14 rounded-2xl object-cover ring-1 ring-slate-200"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-xs font-bold text-slate-500">Driver</div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Assigned driver</div>
                  <div className="truncate text-lg font-black text-slate-950">{clean(driver?.full_name) || "JRide Driver"}</div>
                  <div className="text-xs font-semibold text-slate-500">
                    {[vehicleLabel(driver?.vehicle_type), clean(driver?.plate_number)].filter(Boolean).join(" | ")}
                  </div>
                </div>
                {driverLocation?.updated_at ? (
                  <div className="text-right text-[10px] font-semibold text-slate-400">
                    GPS<br />
                    {new Date(driverLocation.updated_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-[22px] bg-sky-50 p-4 ring-1 ring-sky-200">
              <div className="font-black text-sky-950">Looking for your driver</div>
              <div className="mt-1 text-xs leading-5 text-sky-800">JRide will keep matching an eligible driver from your meeting-point town.</div>
            </section>
          )}

          {clean(booking?.id) ? (
            <ErrandLiveMap
              bookingId={clean(booking.id)}
              stage0={stage0MapPoint}
              stops={stopMapPoints}
              finalPoint={finalMapPoint}
              errandStage={stage}
              currentStopSequence={numberOrNull(job?.current_stop_sequence)}
            />
          ) : null}

          {awaitingConfirmation ? (
            <section className="overflow-hidden rounded-[24px] bg-slate-950 text-white shadow-xl shadow-slate-300/30">
              <div className="bg-amber-400 px-4 py-2 text-xs font-black uppercase tracking-[0.16em] text-slate-950">Fare ready - your action</div>
              <div className="p-4">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Starting fare</div>
                    <div className="mt-1 text-3xl font-black">{money(totalFare)}</div>
                  </div>
                  <div className="rounded-xl bg-white/5 px-3 py-2 text-right text-[10px] font-semibold text-slate-400 ring-1 ring-white/10">
                    Route {km(job?.confirmed_route_distance_km)}
                  </div>
                </div>

                <div className="mt-4 space-y-2 border-t border-white/10 pt-3 text-sm">
                  <DarkFareRow label="Approach" value={approach} />
                  <DarkFareRow label="Confirmed task route" value={routeFare} />
                  {extraStops > 0 ? <DarkFareRow label="Additional task stops" value={extraStops} /> : null}
                  {waitingFee > 0 ? <DarkFareRow label="Waiting" value={waitingFee} /> : null}
                  {elevation > 0 ? <DarkFareRow label="Elevation" value={elevation} /> : null}
                  {heavy > 0 ? <DarkFareRow label="Heavy load" value={heavy} /> : null}
                </div>

                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={confirmBusy}
                  className="mt-4 w-full rounded-2xl bg-emerald-400 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/20 disabled:opacity-50"
                >
                  {confirmBusy ? "Confirming..." : `Confirm ${money(totalFare)}`}
                </button>
                <div className="mt-2 text-center text-[10px] leading-4 text-slate-400">
                  Waiting can add charges only after the first 15 total waiting minutes.
                </div>
              </div>
            </section>
          ) : (
            <section className="rounded-[22px] bg-white p-4 ring-1 ring-slate-200 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Fare</div>
                  <div className="mt-1 text-2xl font-black text-slate-950">{matching ? money(Math.max(base, 40)) : money(totalFare)}</div>
                </div>
                <div className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-800">
                  {numberOrZero(waiting?.current_fee) > 0 ? `Waiting ${money(waiting.current_fee)}` : "No waiting fee"}
                </div>
              </div>
              {!matching ? (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <MiniMetric label="Approach" value={money(approach)} />
                  <MiniMetric label="Route" value={money(routeFare)} />
                </div>
              ) : null}
              {waiting?.running === true ? (
                <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                  {numberOrZero(waiting?.free_remaining_seconds) > 0
                    ? `Free waiting remaining: ${Math.floor(numberOrZero(waiting.free_remaining_seconds) / 60)}m ${Math.floor(numberOrZero(waiting.free_remaining_seconds) % 60)}s`
                    : `Current waiting fee: ${money(waiting?.current_fee)}`}
                </div>
              ) : null}
            </section>
          )}

          <details className="rounded-[22px] bg-white p-4 ring-1 ring-slate-200 shadow-sm">
            <summary className="cursor-pointer list-none font-black text-slate-950">
              <div className="flex items-center justify-between gap-3">
                <span>Task & route details</span>
                <span className="text-xs font-bold text-emerald-700">View</span>
              </div>
            </summary>

            <div className="mt-4 space-y-4 border-t border-slate-100 pt-4 text-sm">
              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Task</div>
                <div className="mt-1 font-semibold text-slate-800">{clean(job?.task_description) || "--"}</div>
              </div>

              <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Meet driver</div>
                <div className="mt-1 font-semibold text-slate-800">{clean(booking?.from_label) || "--"}</div>
              </div>

              <div>
                <div className="mb-2 text-[10px] font-black uppercase tracking-wide text-slate-400">Task stops</div>
                <div className="space-y-2">
                  {currentStops.map((stop: any) => (
                    <div key={String(stop?.id || stop?.sequence)} className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">Stop {stop?.sequence || "-"}: {clean(stop?.location_label) || "--"}</div>
                          {clean(stop?.instructions) ? <div className="mt-1 text-xs text-slate-500">{clean(stop.instructions)}</div> : null}
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-black ${stopStatusClasses(stop?.status)}`}>
                          {clean(stop?.status) || "pending"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <ReviewRow
                label={returnsToCustomer ? "Return to you" : "Final destination"}
                value={clean(job?.final_label) || clean(booking?.to_label) || "--"}
              />
              <ReviewRow
                label="Cargo"
                value={`${numberOrNull(job?.confirmed_cargo_weight_kg ?? job?.estimated_cargo_weight_kg) ?? 0} kg`}
              />
              <ReviewRow label="Vehicle" value={vehicleLabel(job?.vehicle_requirement)} />
            </div>
          </details>

          {job?.is_pabili ? (
            <section className="rounded-[22px] bg-amber-50 p-4 ring-1 ring-amber-200">
              <div className="font-black text-amber-950">Pabili money</div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniMetric label="Customer funds" value={money(pabili?.customer_funds_received)} />
                <MiniMetric label="Purchase total" value={money(pabili?.purchase_total)} />
                <MiniMetric label="Change due" value={money(pabili?.change_due)} />
                <MiniMetric label="Change returned" value={money(pabili?.change_returned)} />
              </div>
              <div className="mt-2 text-[10px] leading-4 text-amber-800">Purchase money is separate from the JRide service fare.</div>
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function CompletedReceipt(props: { receipt: Receipt; onDone: () => void }) {
  const { receipt, onDone } = props;
  const finalFare = numberOrZero(receipt.final_fare);
  const startingFare = numberOrZero(receipt.starting_fare);
  const approach = numberOrZero(receipt.approach_fee) || Math.max(numberOrZero(receipt.base_fare), numberOrZero(receipt.pickup_distance_fee));

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-md overflow-hidden rounded-[30px] bg-slate-950 text-white shadow-2xl shadow-slate-400/30">
        <div className="h-1.5 bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400" />
        <div className="p-5">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">Errand completed</div>
          <div className="mt-1 text-xl font-black">{clean(receipt.booking_code) || "JRide Errand"}</div>

          <div className="mt-5 rounded-[22px] bg-white/5 p-4 ring-1 ring-white/10">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Final fare</div>
            <div className="mt-1 text-4xl font-black">{money(finalFare)}</div>
            {startingFare > 0 ? <div className="mt-1 text-xs text-slate-400">Started at {money(startingFare)}</div> : null}
          </div>

          <div className="mt-4 space-y-2 text-sm">
            <DarkFareRow label="Approach" value={approach} />
            <DarkFareRow label="Confirmed route" value={receipt.distance_fare} />
            {numberOrZero(receipt.extra_stop_fee) > 0 ? <DarkFareRow label="Additional stops" value={receipt.extra_stop_fee} /> : null}
            <DarkFareRow label="Waiting" value={receipt.waiting_fee} />
            {numberOrZero(receipt.elevation_surcharge) > 0 ? <DarkFareRow label="Elevation" value={receipt.elevation_surcharge} /> : null}
            {numberOrZero(receipt.heavy_load_fee) > 0 ? <DarkFareRow label="Heavy load" value={receipt.heavy_load_fee} /> : null}
          </div>

          <div className="mt-4 text-xs leading-5 text-slate-400">
            Waiting time: {Math.max(0, Math.round(numberOrZero(receipt.waiting_minutes)))} min total.
            {receipt.completed_at
              ? ` Completed ${new Date(receipt.completed_at).toLocaleString("en-PH", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}.`
              : ""}
          </div>

          <button
            type="button"
            onClick={onDone}
            className="mt-5 w-full rounded-2xl bg-emerald-400 py-3.5 text-sm font-black text-slate-950"
          >
            Done
          </button>
        </div>
      </div>
    </main>
  );
}

function StepCard(props: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[24px] bg-white p-4 ring-1 ring-slate-200 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">{props.eyebrow}</div>
      <h2 className="mt-1 text-xl font-black tracking-tight text-slate-950">{props.title}</h2>
      <p className="mt-1 text-xs leading-5 text-slate-500">{props.subtitle}</p>
      <div className="mt-4">{props.children}</div>
    </section>
  );
}

function ChoiceCard(props: {
  selected: boolean;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={
        "rounded-2xl border p-3 text-left transition " +
        (props.selected
          ? "border-emerald-400 bg-emerald-500 text-white shadow-lg shadow-emerald-500/20"
          : "border-slate-200 bg-white text-slate-800")
      }
    >
      <div className="text-sm font-black">{props.title}</div>
      <div className={"mt-1 text-[11px] leading-4 " + (props.selected ? "text-emerald-50" : "text-slate-500")}>
        {props.detail}
      </div>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 last:border-b-0">
      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <span className="max-w-[65%] text-right text-sm font-bold leading-5 text-slate-900">{value}</span>
    </div>
  );
}

function DarkFareRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-300">{label}</span>
      <span className="font-black text-white">{money(value)}</span>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3 ring-1 ring-slate-100">
      <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
    </div>
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-pulse rounded-full bg-emerald-400" />
        <div className="mt-4 text-sm font-bold text-slate-300">{label}</div>
      </div>
    </main>
  );
}

function GateScreen(props: {
  title: string;
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-8 text-slate-900">
      <div className="w-full max-w-md overflow-hidden rounded-[30px] bg-slate-950 text-white shadow-2xl shadow-slate-400/30">
        <div className="h-1.5 bg-emerald-400" />
        <div className="p-6">
          <div className="text-xs font-black uppercase tracking-[0.18em] text-emerald-300">JRide Passenger</div>
          <h1 className="mt-2 text-2xl font-black">{props.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{props.message}</p>
          <button
            type="button"
            onClick={props.onAction}
            className="mt-6 w-full rounded-2xl bg-emerald-400 py-3.5 text-sm font-black text-slate-950"
          >
            {props.action}
          </button>
        </div>
      </div>
    </main>
  );
}
