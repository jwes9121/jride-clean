"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { philippinesTime } from "@/lib/jfleet/routeReview";
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

function readable(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  return philippinesTime(value);
}

function money(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "PHP 0.00";
  return "PHP " + amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function JFleetPage() {
  const router = useRouter();
  const [status, setStatus] = React.useState<JFleetStatus | null>(null);
  const [authed, setAuthed] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [bookings, setBookings] = React.useState<JFleetBooking[]>([]);
  const [reading, setReading] = React.useState(false);
  const [bookingsLoaded, setBookingsLoaded] = React.useState(false);
  const [actionBusy, setActionBusy] = React.useState("");
  const [cancelReasons, setCancelReasons] = React.useState<Record<string, string>>({});
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  const loadBookings = React.useCallback(async () => {
    setReading(true);
    setError("");
    try {
      const response = await fetch("/api/jfleet/bookings", {
        cache: "no-store",
        headers: passengerAuthHeaders(),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok || !Array.isArray(body.bookings)) {
        throw new Error(body?.message || "Could not load your JFleet bookings. Please retry.");
      }
      setBookings(body.bookings);
      setBookingsLoaded(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not load your JFleet bookings. Please retry.");
    } finally {
      setReading(false);
    }
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
          await loadBookings();
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
  }, [loadBookings]);

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
      await loadBookings();
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

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-label="JFleet quote actions">
          <h2 className="text-xl font-bold">Plan a hire or review your quotations</h2>
          <p className="mt-2 text-sm text-slate-600">
            Pin the complete itinerary before requesting a price. Review the full quotation,
            inclusions, exclusions and payment terms before accepting. An inquiry is not a reservation.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/jfleet/request" className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
              Request a quote
            </Link>
            <Link href="/jfleet/inquiries" className="rounded-xl border border-slate-300 px-5 py-3 font-semibold">
              View quotations and revisions
            </Link>
          </div>
        </section>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : null}
        {success ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">{success}</p> : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Your JFleet Bookings</h2>
              <p className="mt-1 text-sm text-slate-600">
                Accepted quotations appear here as reservation pending. A vehicle is reserved only after the required payment is confirmed.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadBookings()}
              disabled={reading}
              className="rounded-xl border px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {reading ? "Refreshing..." : "Refresh bookings"}
            </button>
          </div>

          {!bookingsLoaded ? (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              {reading ? "Loading bookings..." : "Bookings could not be loaded. Use Refresh bookings to retry."}
            </p>
          ) : bookings.length === 0 ? (
            <p className="mt-5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              No accepted quotations or bookings yet. Your canvassing requests are under Quotations and revisions.
            </p>
          ) : (
            <div className="mt-5 space-y-4">
              {bookings.map((booking) => {
                const active = ![
                  "completed",
                  "cancelled_customer",
                  "cancelled_operator",
                ].includes(booking.status);
                const canCancel = active && booking.status !== "on_trip" && Date.parse(booking.scheduled_start_at) > Date.now();
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

                    <Link href={"/jfleet/inquiries/" + encodeURIComponent(booking.inquiry_id)} className="mt-4 inline-block text-sm font-semibold underline">
                      View accepted quotation and itinerary history
                    </Link>

                    {canCancel ? (
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
