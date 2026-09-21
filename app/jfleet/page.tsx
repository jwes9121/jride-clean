"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  passengerAuthHeaders,
  passengerLoginHref,
  preparePassengerSession,
} from "@/lib/passenger/browserSession";

type JFleetStatus = {
  ok?: boolean;
  enabled?: boolean;
  brand?: string;
  subtitle?: string;
  quote_tat_minutes?: number;
  reservation_percent?: number;
  free_cancel_hours?: number;
  late_cancel_percent?: number;
  reason?: string;
};

type RouteStop = {
  label: string;
  notes: string;
};

type Inquiry = {
  id: string;
  inquiry_code: string;
  purpose: string;
  requested_vehicle_type: string;
  trip_mode: string;
  pickup_label: string;
  scheduled_start_at: string;
  scheduled_end_at?: string | null;
  status: string;
  submitted_at: string;
  quote_due_at: string;
  current_itinerary_version: number;
  jfleet_itineraries?: Array<{
    id: string;
    version_no: number;
    status: string;
    source: string;
    jfleet_itinerary_stops?: Array<{
      sequence_no: number;
      stop_type: string;
      location_label: string;
    }>;
  }>;
  jfleet_quotes?: Array<{
    id: string;
    version_no: number;
    status: string;
    total_amount: number | string;
    currency: string;
    valid_until: string;
    sent_at: string;
    accepted_at?: string | null;
  }>;
};

type JFleetBooking = {
  id: string;
  booking_code: string;
  inquiry_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  original_quote_amount: number | string;
  addon_total: number | string;
  reservation_percent: number | string;
  reservation_required_amount: number | string;
  cancellation_free_until: string;
  final_trip_value: number | string;
  status: string;
  payment_status: string;
  reservation_paid_at?: string | null;
  fully_paid_at?: string | null;
  cancellation_penalty_amount: number | string;
  refund_amount: number | string;
  vehicle?: {
    id: string;
    vehicle_type: string;
    make?: string | null;
    model?: string | null;
    plate_number: string;
  } | null;
  driver?: {
    id: string;
    full_name: string;
    photo_url?: string | null;
    rating_average: number | string;
    rating_count: number;
    completed_trips: number;
  } | null;
  addons?: Array<{
    id: string;
    requested_by: string;
    description: string;
    additional_route: { label?: string } | unknown;
    fuel_vehicle_fee: number | string;
    driver_fee: number | string;
    other_fee: number | string;
    total_amount: number | string;
    status: string;
    proposed_at: string;
    accepted_at?: string | null;
    payment_confirmed_at?: string | null;
    notes?: string | null;
  }>;
};

const PURPOSE_OPTIONS = [
  ["tour_leisure", "Tour / Leisure"],
  ["family", "Family trip"],
  ["business", "Business trip"],
  ["event", "Event"],
  ["cargo_delivery", "Cargo / Delivery"],
  ["moving_hauling", "Moving / Hauling"],
  ["other", "Other"],
] as const;

const VEHICLE_OPTIONS = [
  ["recommend", "Let the operator recommend"],
  ["van", "Van"],
  ["pickup", "Pickup truck"],
  ["truck", "Truck"],
] as const;

const TRIP_OPTIONS = [
  ["one_way", "One-way"],
  ["round_trip", "Round trip"],
  ["multi_day", "Multi-day"],
] as const;

function readable(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString();
}

function money(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "PHP 0.00";
  return "PHP " + amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function latestQuote(inquiry: Inquiry) {
  const quotes = Array.isArray(inquiry.jfleet_quotes) ? inquiry.jfleet_quotes : [];
  return [...quotes].sort((a, b) => b.version_no - a.version_no)[0] ?? null;
}

function currentStops(inquiry: Inquiry) {
  const itineraries = Array.isArray(inquiry.jfleet_itineraries)
    ? inquiry.jfleet_itineraries
    : [];
  const current =
    itineraries.find((itinerary) => itinerary.status === "current") ??
    [...itineraries].sort((a, b) => b.version_no - a.version_no)[0];
  return [...(current?.jfleet_itinerary_stops ?? [])].sort(
    (a, b) => a.sequence_no - b.sequence_no
  );
}

export default function JFleetPage() {
  const router = useRouter();
  const [status, setStatus] = React.useState<JFleetStatus | null>(null);
  const [authed, setAuthed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [inquiries, setInquiries] = React.useState<Inquiry[]>([]);
  const [bookings, setBookings] = React.useState<JFleetBooking[]>([]);
  const [reading, setReading] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState("");
  const [cancelReasons, setCancelReasons] = React.useState<Record<string, string>>({});
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  const [purpose, setPurpose] = React.useState("tour_leisure");
  const [vehicleType, setVehicleType] = React.useState("recommend");
  const [tripMode, setTripMode] = React.useState("round_trip");
  const [pickupLabel, setPickupLabel] = React.useState("");
  const [scheduledStart, setScheduledStart] = React.useState("");
  const [scheduledEnd, setScheduledEnd] = React.useState("");
  const [passengerCount, setPassengerCount] = React.useState("");
  const [cargoDescription, setCargoDescription] = React.useState("");
  const [cargoWeightKg, setCargoWeightKg] = React.useState("");
  const [luggageNotes, setLuggageNotes] = React.useState("");
  const [specialNotes, setSpecialNotes] = React.useState("");
  const [stops, setStops] = React.useState<RouteStop[]>([
    { label: "", notes: "" },
  ]);

  const loadInquiries = React.useCallback(async () => {
    setReading(true);
    try {
      const response = await fetch("/api/jfleet/inquiries", {
        cache: "no-store",
        headers: passengerAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.ok) {
        setInquiries(Array.isArray(body.inquiries) ? body.inquiries : []);
      }
    } finally {
      setReading(false);
    }
  }, []);

  const loadBookings = React.useCallback(async () => {
    try {
      const response = await fetch("/api/jfleet/bookings", {
        cache: "no-store",
        headers: passengerAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body?.ok) {
        setBookings(Array.isArray(body.bookings) ? body.bookings : []);
      }
    } catch {}
  }, []);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [statusResponse, session] = await Promise.all([
          fetch("/api/jfleet/status", { cache: "no-store" }),
          preparePassengerSession(),
        ]);
        const statusBody = (await statusResponse.json().catch(() => ({}))) as JFleetStatus;
        if (!alive) return;
        setStatus(statusBody);
        setAuthed(session?.authed === true);

        if (statusBody?.enabled && session?.authed === true) {
          await Promise.all([loadInquiries(), loadBookings()]);
        }
      } catch {
        if (alive) setError("JFleet could not be loaded. Try again.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadBookings, loadInquiries]);

  function updateStop(index: number, patch: Partial<RouteStop>) {
    setStops((current) =>
      current.map((stop, stopIndex) =>
        stopIndex === index ? { ...stop, ...patch } : stop
      )
    );
  }

  function addStop() {
    if (stops.length >= 20) return;
    setStops((current) => [...current, { label: "", notes: "" }]);
  }

  function removeStop(index: number) {
    setStops((current) =>
      current.length <= 1
        ? current
        : current.filter((_, stopIndex) => stopIndex !== index)
    );
  }

  async function submitInquiry(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError("");
    setSuccess("");

    if (!authed) {
      router.push(passengerLoginHref("/jfleet"));
      return;
    }

    if (!pickupLabel.trim()) {
      setError("Enter the pickup location.");
      return;
    }

    if (!scheduledStart) {
      setError("Enter the trip departure date and time.");
      return;
    }

    if (!scheduledEnd) {
      setError("Enter the expected trip end date and time.");
      return;
    }

    if (stops.some((stop) => !stop.label.trim())) {
      setError("Complete every itinerary stop before requesting a quote.");
      return;
    }

    const startDate = new Date(scheduledStart);
    const endDate = scheduledEnd ? new Date(scheduledEnd) : null;
    if (!Number.isFinite(startDate.getTime()) || startDate.getTime() <= Date.now()) {
      setError("The departure date and time must be in the future.");
      return;
    }
    if (
      endDate &&
      (!Number.isFinite(endDate.getTime()) || endDate.getTime() < startDate.getTime())
    ) {
      setError("The expected trip end cannot be before departure.");
      return;
    }

    const finalStopType = tripMode === "round_trip" ? "return" : "destination";
    const itinerary = stops.map((stop, index) => ({
      label: stop.label.trim(),
      stop_type: index === stops.length - 1 ? finalStopType : "stop",
      lat: null,
      lng: null,
      notes: stop.notes.trim() || null,
    }));

    setSubmitting(true);
    try {
      const response = await fetch("/api/jfleet/inquiries", {
        method: "POST",
        headers: passengerAuthHeaders(true),
        body: JSON.stringify({
          purpose,
          requested_vehicle_type: vehicleType,
          trip_mode: tripMode,
          pickup_label: pickupLabel.trim(),
          pickup_lat: null,
          pickup_lng: null,
          scheduled_start_at: startDate.toISOString(),
          scheduled_end_at: endDate?.toISOString() ?? null,
          passenger_count: passengerCount ? Number(passengerCount) : null,
          cargo_description: cargoDescription.trim() || null,
          cargo_weight_kg: cargoWeightKg ? Number(cargoWeightKg) : null,
          luggage_notes: luggageNotes.trim() || null,
          special_notes: specialNotes.trim() || null,
          stops: itinerary,
        }),
      });

      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "The quote request could not be submitted.");
      }

      setSuccess(
        "Quote request " +
          body.inquiry_code +
          " submitted. Expected response is within " +
          Math.round(Number(body.quote_tat_minutes || 180) / 60) +
          " hours."
      );
      await loadInquiries();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The quote request could not be submitted."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function acceptQuote(inquiry: Inquiry, quoteId: string) {
    if (actionBusy) return;
    setActionBusy("accept:" + quoteId);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/jfleet/quotes/accept", {
        method: "POST",
        headers: passengerAuthHeaders(true),
        body: JSON.stringify({ inquiry_id: inquiry.id, quote_id: quoteId }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "The quotation could not be accepted.");
      }
      setSuccess(
        "Booking " +
          body.booking_code +
          " created. Minimum reservation required: " +
          money(body.reservation_required_amount) +
          "."
      );
      await Promise.all([loadInquiries(), loadBookings()]);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The quotation could not be accepted."
      );
    } finally {
      setActionBusy("");
    }
  }

  async function respondAddon(addonId: string, responseValue: "accept" | "decline") {
    if (actionBusy) return;
    setActionBusy("addon:" + addonId + ":" + responseValue);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/jfleet/addons/respond", {
        method: "POST",
        headers: passengerAuthHeaders(true),
        body: JSON.stringify({ addon_id: addonId, response: responseValue }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "The additional-charge response could not be saved.");
      }
      setSuccess(
        responseValue === "accept"
          ? "Additional charge accepted. Pay the amount requested by the transport owner before taking the side trip."
          : "Additional route declined. The original itinerary remains in effect."
      );
      await loadBookings();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The additional-charge response could not be saved."
      );
    } finally {
      setActionBusy("");
    }
  }

  async function cancelBooking(booking: JFleetBooking) {
    if (actionBusy) return;
    const confirmed = window.confirm(
      "Cancel " +
        booking.booking_code +
        "? Cancellations after " +
        formatDate(booking.cancellation_free_until) +
        " forfeit 10% of the accepted quotation."
    );
    if (!confirmed) return;

    setActionBusy("cancel:" + booking.id);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/jfleet/bookings/cancel", {
        method: "POST",
        headers: passengerAuthHeaders(true),
        body: JSON.stringify({
          booking_id: booking.id,
          reason: cancelReasons[booking.id] || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "The booking could not be cancelled.");
      }
      setSuccess(
        body.late_cancellation
          ? "Booking cancelled. Late-cancellation penalty: " +
              money(body.penalty_amount) +
              ". Refund due: " +
              money(body.refund_amount) +
              "."
          : "Booking cancelled within the refundable period. Refund due: " +
              money(body.refund_amount) +
              "."
      );
      await Promise.all([loadInquiries(), loadBookings()]);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "The booking could not be cancelled."
      );
    } finally {
      setActionBusy("");
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-4xl rounded-2xl border bg-white p-6">
          Loading JFleet...
        </div>
      </main>
    );
  }

  if (!status?.enabled) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-2xl rounded-2xl border bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            JRide
          </p>
          <h1 className="mt-1 text-3xl font-bold">JFleet</h1>
          <p className="mt-1 text-slate-600">Vans, Pickups & Trucks for Hire</p>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
            JFleet is still being prepared for its pilot transport partner.
          </div>
          <button
            type="button"
            onClick={() => router.push("/passenger")}
            className="mt-5 rounded-xl border px-4 py-2 font-semibold"
          >
            Back to Passenger Dashboard
          </button>
        </div>
      </main>
    );
  }

  if (!authed) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-2xl rounded-2xl border bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold">JFleet</h1>
          <p className="mt-1 text-slate-600">Vans, Pickups & Trucks for Hire</p>
          <p className="mt-5">Sign in before requesting a transport quotation.</p>
          <button
            type="button"
            onClick={() => router.push(passengerLoginHref("/jfleet"))}
            className="mt-4 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white"
          >
            Sign in to continue
          </button>
        </div>
      </main>
    );
  }

  const quoteHours = Math.max(
    1,
    Math.round(Number(status.quote_tat_minutes || 180) / 60)
  );

  return (
    <main className="min-h-screen bg-slate-50 p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
            JRide
          </p>
          <h1 className="mt-1 text-3xl font-bold">JFleet</h1>
          <p className="mt-1 text-slate-300">Vans, Pickups & Trucks for Hire</p>
          <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-white/10 p-3">
              <strong>1. Send itinerary</strong>
              <p className="mt-1 text-slate-300">
                Include every planned destination so the operator can price fuel and time.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <strong>2. Receive quotation</strong>
              <p className="mt-1 text-slate-300">
                Target response is within {quoteHours} hours.
              </p>
            </div>
            <div className="rounded-xl bg-white/10 p-3">
              <strong>3. Reserve after acceptance</strong>
              <p className="mt-1 text-slate-300">
                Minimum reservation is {Number(status.reservation_percent || 20)}%.
              </p>
            </div>
          </div>
        </header>

        <form
          onSubmit={submitInquiry}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Request a Quote</h2>
              <p className="mt-1 text-sm text-slate-600">
                This is an inquiry, not yet a confirmed booking.
              </p>
            </div>
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
              Quote TAT: max {quoteHours} hours
            </span>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Purpose of hire
              <select
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
              >
                {PURPOSE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Vehicle
              <select
                value={vehicleType}
                onChange={(event) => setVehicleType(event.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
              >
                {VEHICLE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Trip type
              <select
                value={tripMode}
                onChange={(event) => {
                  setTripMode(event.target.value);
                }}
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
              >
                {TRIP_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-medium text-slate-700">
              Number of passengers
              <input
                type="number"
                min="1"
                max="100"
                value={passengerCount}
                onChange={(event) => setPassengerCount(event.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3"
              />
            </label>
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="font-bold">Trip schedule and itinerary</h3>
            <p className="mt-1 text-sm text-slate-600">
              The transport company will quote against this exact itinerary. Fuel prices,
              distance, duration, vehicle requirements, and side trips can affect the price.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">
                Pickup location
                <input
                  value={pickupLabel}
                  onChange={(event) => setPickupLabel(event.target.value)}
                  placeholder="Example: Lagawe, Ifugao"
                  maxLength={180}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
                />
              </label>

              <label className="text-sm font-medium text-slate-700">
                Departure date and time
                <input
                  type="datetime-local"
                  value={scheduledStart}
                  onChange={(event) => setScheduledStart(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
                />
              </label>

              <label className="text-sm font-medium text-slate-700">
                Expected trip end
                <input
                  type="datetime-local"
                  value={scheduledEnd}
                  onChange={(event) => setScheduledEnd(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
                />
              </label>
            </div>

            <div className="mt-5 space-y-3">
              {stops.map((stop, index) => {
                const isLast = index === stops.length - 1;
                const label = isLast
                  ? tripMode === "round_trip"
                    ? "Final return point"
                    : "Final destination"
                  : "Stop " + (index + 1);
                return (
                  <div
                    key={index}
                    className="rounded-xl border border-slate-200 bg-white p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <strong className="text-sm">{label}</strong>
                      {stops.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeStop(index)}
                          className="text-xs font-semibold text-red-700"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                    <input
                      value={stop.label}
                      onChange={(event) =>
                        updateStop(index, { label: event.target.value })
                      }
                      placeholder={
                        isLast && tripMode === "round_trip"
                          ? "Example: Return to Lagawe"
                          : "Enter town, landmark, or destination"
                      }
                      maxLength={180}
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                    <input
                      value={stop.notes}
                      onChange={(event) =>
                        updateStop(index, { notes: event.target.value })
                      }
                      placeholder="Optional instructions for this stop"
                      maxLength={500}
                      className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                );
              })}

              <button
                type="button"
                onClick={addStop}
                disabled={stops.length >= 20}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                + Add destination / stop
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
              Include all planned destinations now. A destination added after the trip has
              started may require an additional fuel, vehicle, and driver charge.
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium text-slate-700">
              Cargo description
              <textarea
                value={cargoDescription}
                onChange={(event) => setCargoDescription(event.target.value)}
                placeholder="Optional for passenger trips"
                maxLength={1000}
                rows={3}
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Estimated cargo weight (kg)
              <input
                type="number"
                min="0.001"
                step="0.001"
                value={cargoWeightKg}
                onChange={(event) => setCargoWeightKg(event.target.value)}
                placeholder="Optional"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Luggage details
              <textarea
                value={luggageNotes}
                onChange={(event) => setLuggageNotes(event.target.value)}
                maxLength={1000}
                rows={3}
                placeholder="Bags, equipment, bulky items, etc."
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3"
              />
            </label>

            <label className="text-sm font-medium text-slate-700">
              Special requests
              <textarea
                value={specialNotes}
                onChange={(event) => setSpecialNotes(event.target.value)}
                maxLength={1500}
                rows={3}
                placeholder="Accessibility, waiting, event requirements, and other details"
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-3"
              />
            </label>
          </div>

          <div className="mt-5 rounded-xl bg-slate-100 p-4 text-sm text-slate-700">
            After you accept a quotation, at least{" "}
            <strong>{Number(status.reservation_percent || 20)}%</strong> is required to
            reserve the vehicle. Cancellations made at least{" "}
            <strong>{Number(status.free_cancel_hours || 48)} hours</strong> before departure
            are refundable. Cancellations later than that forfeit{" "}
            <strong>{Number(status.late_cancel_percent || 10)}% of the total accepted quotation</strong>.
            The original quotation must be fully paid before the trip can start.
          </div>

          {error ? (
            <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          {success ? (
            <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
              {success}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 w-full rounded-xl bg-slate-950 px-5 py-3 font-bold text-white disabled:opacity-60"
          >
            {submitting ? "Submitting..." : "Request Quote"}
          </button>
        </form>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Your JFleet Inquiries</h2>
              <p className="mt-1 text-sm text-slate-600">
                Canvassing inquiries stay separate from confirmed bookings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadInquiries()}
              disabled={reading}
              className="rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {reading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {inquiries.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              You have no JFleet inquiries yet.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {inquiries.map((inquiry) => {
                const quote = latestQuote(inquiry);
                const route = currentStops(inquiry);
                return (
                  <article
                    key={inquiry.id}
                    className="rounded-2xl border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {inquiry.inquiry_code}
                        </p>
                        <h3 className="mt-1 font-bold">
                          {readable(inquiry.requested_vehicle_type)} - {readable(inquiry.trip_mode)}
                        </h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">
                        {readable(inquiry.status)}
                      </span>
                    </div>

                    <p className="mt-3 text-sm">
                      <strong>Departure:</strong> {formatDate(inquiry.scheduled_start_at)}
                    </p>
                    {inquiry.scheduled_end_at ? (
                      <p className="mt-1 text-sm">
                        <strong>Expected end:</strong> {formatDate(inquiry.scheduled_end_at)}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm">
                      <strong>Route:</strong>{" "}
                      {route.length
                        ? route.map((stop) => stop.location_label).join(" -> ")
                        : inquiry.pickup_label}
                    </p>

                    {inquiry.status === "quote_requested" ||
                    inquiry.status === "under_review" ? (
                      <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                        Response due by <strong>{formatDate(inquiry.quote_due_at)}</strong>.
                      </div>
                    ) : null}

                    {quote ? (
                      <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
                        <div className="flex items-center justify-between gap-3">
                          <span>Latest quotation v{quote.version_no}</span>
                          <strong>{money(quote.total_amount)}</strong>
                        </div>
                        <p className="mt-1 text-xs">
                          Status: {readable(quote.status)} | Valid until:{" "}
                          {formatDate(quote.valid_until)}
                        </p>
                        {quote.status === "sent" && inquiry.status === "quote_ready" ? (
                          <button
                            type="button"
                            disabled={actionBusy === "accept:" + quote.id}
                            onClick={() => void acceptQuote(inquiry, quote.id)}
                            className="mt-3 w-full rounded-lg bg-emerald-800 px-4 py-2 font-bold text-white disabled:opacity-50"
                          >
                            {actionBusy === "accept:" + quote.id
                              ? "Accepting..."
                              : "Accept Quote"}
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Your JFleet Bookings</h2>
              <p className="mt-1 text-sm text-slate-600">
                A booking appears here only after you accept a quotation.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadBookings()}
              className="rounded-xl border px-3 py-2 text-sm font-semibold"
            >
              Refresh
            </button>
          </div>

          {bookings.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              You have no confirmed JFleet booking yet.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {bookings.map((booking) => {
                const active = ![
                  "completed",
                  "cancelled_customer",
                  "cancelled_operator",
                ].includes(booking.status);
                return (
                  <article key={booking.id} className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {booking.booking_code}
                        </p>
                        <h3 className="mt-1 font-bold">{readable(booking.status)}</h3>
                      </div>
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">
                        {readable(booking.payment_status)}
                      </span>
                    </div>

                    <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <p><strong>Trip:</strong> {formatDate(booking.scheduled_start_at)} to {formatDate(booking.scheduled_end_at)}</p>
                      <p><strong>Original quotation:</strong> {money(booking.original_quote_amount)}</p>
                      <p><strong>Minimum reservation:</strong> {money(booking.reservation_required_amount)}</p>
                      <p><strong>Free cancellation until:</strong> {formatDate(booking.cancellation_free_until)}</p>
                      <p><strong>Add-ons:</strong> {money(booking.addon_total)}</p>
                      <p><strong>Current trip value:</strong> {money(booking.final_trip_value)}</p>
                    </div>

                    {booking.driver && booking.vehicle ? (
                      <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
                        <strong>Assigned driver and vehicle</strong>
                        <p className="mt-1">
                          {booking.driver.full_name} | Rating:{" "}
                          {booking.driver.rating_count
                            ? Number(booking.driver.rating_average).toFixed(1)
                            : "New"}{" "}
                          | Completed JFleet trips: {booking.driver.completed_trips}
                        </p>
                        <p>
                          {booking.vehicle.make || ""} {booking.vehicle.model || ""} -{" "}
                          {booking.vehicle.plate_number}
                        </p>
                      </div>
                    ) : active ? (
                      <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">
                        Vehicle and driver assignment will appear after the reservation is confirmed by the owner.
                      </div>
                    ) : null}

                    {(booking.addons ?? []).length ? (
                      <div className="mt-4 space-y-3">
                        {(booking.addons ?? []).map((addon) => {
                          const routeLabel =
                            addon.additional_route &&
                            typeof addon.additional_route === "object" &&
                            "label" in addon.additional_route
                              ? String((addon.additional_route as { label?: string }).label || "")
                              : "";
                          return (
                            <div key={addon.id} className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div>
                                  <strong>Additional route / side trip</strong>
                                  <p className="mt-1">{addon.description}</p>
                                  {routeLabel ? <p className="mt-1"><strong>Route:</strong> {routeLabel}</p> : null}
                                </div>
                                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                                  {readable(addon.status)}
                                </span>
                              </div>
                              <div className="mt-3 grid gap-1 sm:grid-cols-2">
                                <p>Fuel / vehicle: <strong>{money(addon.fuel_vehicle_fee)}</strong></p>
                                <p>Driver / time: <strong>{money(addon.driver_fee)}</strong></p>
                                <p>Other: <strong>{money(addon.other_fee)}</strong></p>
                                <p>Total additional fee: <strong>{money(addon.total_amount)}</strong></p>
                              </div>
                              {addon.status === "proposed" ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    disabled={actionBusy.startsWith("addon:" + addon.id)}
                                    onClick={() => void respondAddon(addon.id, "accept")}
                                    className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50"
                                  >
                                    Accept Additional Charge
                                  </button>
                                  <button
                                    type="button"
                                    disabled={actionBusy.startsWith("addon:" + addon.id)}
                                    onClick={() => void respondAddon(addon.id, "decline")}
                                    className="rounded-lg border border-violet-300 bg-white px-4 py-2 font-bold disabled:opacity-50"
                                  >
                                    Keep Original Itinerary
                                  </button>
                                </div>
                              ) : addon.status === "accepted" ? (
                                <p className="mt-3 font-semibold">
                                  Accepted - awaiting payment confirmation from the transport owner.
                                </p>
                              ) : addon.status === "paid" ? (
                                <p className="mt-3 font-semibold">
                                  Paid and approved. This amount is included in the current trip value.
                                </p>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}

                    {active ? (
                      <div className="mt-4 rounded-xl border border-slate-200 p-3">
                        <label className="text-sm font-medium text-slate-700">
                          Cancellation reason (optional)
                          <input
                            value={cancelReasons[booking.id] || ""}
                            onChange={(event) =>
                              setCancelReasons((current) => ({
                                ...current,
                                [booking.id]: event.target.value,
                              }))
                            }
                            maxLength={1000}
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                          />
                        </label>
                        <button
                          type="button"
                          disabled={actionBusy === "cancel:" + booking.id}
                          onClick={() => void cancelBooking(booking)}
                          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-800 disabled:opacity-50"
                        >
                          {actionBusy === "cancel:" + booking.id
                            ? "Cancelling..."
                            : "Cancel Booking"}
                        </button>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <button
          type="button"
          onClick={() => router.push("/passenger")}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 font-semibold"
        >
          Back to Passenger Dashboard
        </button>
      </div>
    </main>
  );
}
