"use client";

import * as React from "react";

type Trip = {
  id: string;
  booking_code: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  status: string;
  payment_status: string;
  fully_paid_at?: string | null;
  original_quote_amount: number | string;
  addon_total: number | string;
  final_trip_value: number | string;
  vehicle?: {
    id: string;
    unit_code: string;
    vehicle_type: string;
    make?: string | null;
    model?: string | null;
    plate_number: string;
  } | null;
  passenger?: {
    user_id: string;
    full_name?: string | null;
    phone?: string | null;
  } | null;
  itinerary?: Array<{
    id: string;
    sequence_no: number;
    stop_type: string;
    location_label: string;
    lat?: number | null;
    lng?: number | null;
    notes?: string | null;
  }>;
};

type ActiveResponse = {
  ok?: boolean;
  driver?: {
    id: string;
    driver_code: string;
    full_name: string;
    status: string;
    documents_verified: boolean;
  };
  trips?: Trip[];
  message?: string;
};

function title(value: string): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

function nextActions(status: string): Array<{ action: string; label: string }> {
  if (["assigned", "upcoming", "ready_for_trip"].includes(status)) {
    return [{ action: "en_route", label: "Start Driving to Pickup" }];
  }
  if (status === "driver_en_route") {
    return [{ action: "arrived", label: "Mark Arrived" }];
  }
  if (status === "driver_arrived") {
    return [{ action: "start", label: "Start Trip" }];
  }
  if (status === "on_trip") {
    return [{ action: "complete", label: "Complete Trip" }];
  }
  return [];
}

export default function JFleetDriverPage() {
  const [data, setData] = React.useState<ActiveResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [tracking, setTracking] = React.useState(false);
  const [lastLocation, setLastLocation] = React.useState<string>("");
  const watchRef = React.useRef<number | null>(null);
  const lastSentAtRef = React.useRef(0);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/jfleet/driver/active", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as ActiveResponse;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "Could not load your assigned JFleet trip.");
      }
      setData(body);
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load your assigned JFleet trip."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    return () => {
      if (watchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchRef.current);
      }
    };
  }, [load]);

  const activeTrip = (data?.trips ?? [])[0] ?? null;

  async function sendLocation(position: GeolocationPosition, trip: Trip) {
    const now = Date.now();
    if (now - lastSentAtRef.current < 5000) return;
    lastSentAtRef.current = now;

    const coords = position.coords;
    setLastLocation(
      coords.latitude.toFixed(6) +
        ", " +
        coords.longitude.toFixed(6) +
        " +/-" +
        Math.round(coords.accuracy) +
        "m"
    );

    try {
      const response = await fetch("/api/jfleet/driver/location", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: trip.id,
          lat: coords.latitude,
          lng: coords.longitude,
          accuracy_m: coords.accuracy,
          heading_deg: Number.isFinite(coords.heading ?? Number.NaN)
            ? coords.heading
            : null,
          speed_mps: Number.isFinite(coords.speed ?? Number.NaN)
            ? coords.speed
            : null,
          captured_at: new Date(position.timestamp).toISOString(),
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        setError(body?.message || "GPS update was rejected.");
      }
    } catch {
      setError("GPS update could not be sent. Keep this screen open and check your connection.");
    }
  }

  function startTracking() {
    if (!activeTrip) {
      setError("No assigned active JFleet trip.");
      return;
    }
    if (!navigator.geolocation) {
      setError("Location tracking is not available on this device.");
      return;
    }
    if (watchRef.current !== null) return;

    setError("");
    const watch = navigator.geolocation.watchPosition(
      (position) => void sendLocation(position, activeTrip),
      (failure) => {
        setError("Location permission/error: " + failure.message);
        setTracking(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
      }
    );
    watchRef.current = watch;
    setTracking(true);
    setMessage("JFleet GPS tracking started. Keep this screen open during the trip.");
  }

  function stopTracking() {
    if (watchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchRef.current);
    }
    watchRef.current = null;
    setTracking(false);
    setMessage("Foreground GPS tracking stopped.");
  }

  async function transition(action: string) {
    if (!activeTrip || busy) return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jfleet/driver/transition", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: activeTrip.id,
          action,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "Trip status could not be changed.");
      }
      setMessage(activeTrip.booking_code + " is now " + title(body.status) + ".");
      if (action === "en_route" || action === "start") {
        startTracking();
      }
      if (action === "complete") {
        stopTracking();
      }
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Trip status could not be changed."
      );
    } finally {
      setBusy("");
    }
  }

  if (loading && !data) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-3xl rounded-2xl bg-white p-6">
          Loading JFleet driver trip...
        </div>
      </main>
    );
  }

  if (!data?.ok) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold">JFleet Driver</h1>
          <p className="mt-3 text-red-700">
            {error || "This account is not linked to an active verified JFleet driver yet."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
            JRide
          </p>
          <h1 className="mt-1 text-3xl font-bold">JFleet Driver</h1>
          <p className="mt-2 text-slate-300">
            {data.driver?.full_name} - {data.driver?.driver_code}
          </p>
        </header>

        {error ? (
          <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">
            {error}
          </p>
        ) : null}
        {message ? (
          <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
            {message}
          </p>
        ) : null}

        {!activeTrip ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold">No active assignment</h2>
            <p className="mt-2 text-slate-600">
              A JFleet trip will appear here only after the company owner assigns it to you.
            </p>
          </section>
        ) : (
          <>
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {activeTrip.booking_code}
                  </p>
                  <h2 className="mt-1 text-2xl font-bold">{title(activeTrip.status)}</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">
                  {title(activeTrip.payment_status)}
                </span>
              </div>

              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <p>
                  <strong>Departure:</strong> {formatDate(activeTrip.scheduled_start_at)}
                </p>
                <p>
                  <strong>Expected end:</strong> {formatDate(activeTrip.scheduled_end_at)}
                </p>
                <p>
                  <strong>Passenger:</strong> {activeTrip.passenger?.full_name || "Customer"}
                </p>
                <p>
                  <strong>Contact:</strong> {activeTrip.passenger?.phone || "Not available"}
                </p>
              </div>

              {activeTrip.vehicle ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
                  <strong>Assigned vehicle</strong>
                  <p className="mt-1">
                    {activeTrip.vehicle.unit_code} - {activeTrip.vehicle.make || ""}{" "}
                    {activeTrip.vehicle.model || ""} - {activeTrip.vehicle.plate_number}
                  </p>
                </div>
              ) : null}

              <div className="mt-4 rounded-xl border border-slate-200 p-3">
                <strong>Approved itinerary</strong>
                <div className="mt-2 space-y-2 text-sm">
                  {(activeTrip.itinerary ?? []).map((stop) => (
                    <div key={stop.id} className="rounded-lg bg-slate-50 p-2">
                      <p>
                        {stop.sequence_no}. {stop.location_label} - {title(stop.stop_type)}
                      </p>
                      {stop.notes ? <p className="mt-1 text-xs text-slate-500">{stop.notes}</p> : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <strong>GPS security tracking</strong>
                <p className="mt-1">
                  Tracking: {tracking ? "ON" : "OFF"}
                  {lastLocation ? " | Last GPS: " + lastLocation : ""}
                </p>
                <p className="mt-1 text-xs">
                  Foreground web tracking requires this screen to remain open. Native Android background tracking is a separate integration.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!tracking ? (
                    <button
                      type="button"
                      onClick={startTracking}
                      className="rounded-lg bg-blue-800 px-4 py-2 font-bold text-white"
                    >
                      Start GPS Tracking
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={stopTracking}
                      className="rounded-lg border border-blue-500 bg-white px-4 py-2 font-bold text-blue-900"
                    >
                      Stop Foreground Tracking
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {nextActions(activeTrip.status).map((item) => (
                  <button
                    key={item.action}
                    type="button"
                    disabled={busy === item.action}
                    onClick={() => void transition(item.action)}
                    className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-50"
                  >
                    {busy === item.action ? "Saving..." : item.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void load()}
                  className="rounded-xl border border-slate-300 bg-white px-5 py-3 font-bold"
                >
                  Refresh Trip
                </button>
              </div>

              {activeTrip.status === "driver_arrived" &&
              activeTrip.payment_status !== "fully_paid" ? (
                <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                  The owner has not yet confirmed full payment of the original quotation. Start Trip will be rejected until payment is fully confirmed.
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
