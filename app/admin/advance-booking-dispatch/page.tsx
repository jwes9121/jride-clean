"use client";

import React, { useEffect, useMemo, useState } from "react";

type QueueRow = {
  id: string | null;
  driver_id: string | null;
  status: string | null;
  joined_at: string | null;
  removed_at: string | null;
  removal_reason: string | null;
  stagger_position: number | null;
  offer_sent_at: string | null;
  offer_expires_at: string | null;
  offer_minutes_remaining: number | null;
  fare_preparation_expires_at: string | null;
  fare_preparation_minutes_remaining: number | null;
  departure_option: string | null;
  departure_distance_km: number | null;
  pickup_fee_computed: number | null;
  fare_locked_total: number | null;
  commitment_confirmed: boolean;
};

type AdvanceBookingRow = {
  id: string;
  passenger_id: string | null;
  passenger_name: string | null;
  passenger_phone: string | null;
  passenger_email: string | null;
  passenger_town_origin: string | null;
  pickup_town: string | null;
  pickup_address: string | null;
  destination_address: string | null;
  distance_km: number | null;
  vehicle_type: string | null;
  passenger_count: number | null;
  notes: string | null;
  scheduled_pickup_at: string | null;
  booking_created_at: string | null;
  booking_expires_at: string | null;
  updated_at: string | null;
  booking_mode: string | null;
  fare_bracket: string | null;
  status: string | null;
  estimated_fare_min: number | null;
  estimated_fare_max: number | null;
  estimated_pickup_fee: number | null;
  estimated_total: number | null;
  proposed_ride_fare: number | null;
  proposed_platform_fee: number | null;
  pickup_fee: number | null;
  total_fare: number | null;
  committed_driver_id: string | null;
  current_driver_id: string | null;
  current_driver_name: string | null;
  current_driver_status: string | null;
  current_offer_queue_id: string | null;
  queue: QueueRow | null;
  passenger_response_expires_at: string | null;
  passenger_response_minutes_remaining: number | null;
  escalation_level: number;
  dispatcher_alerted_at: string | null;
  total_offers_sent: number;
  total_passenger_declines: number;
  committed_at: string | null;
  driver_reserved_at: string | null;
  driver_locked_at: string | null;
  departure_option_used: string | null;
  live_booking_id: string | null;
  converted_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  is_active: boolean;
};

type PageData = {
  ok?: boolean;
  error?: string;
  message?: string;
  bookings?: AdvanceBookingRow[];
};

const FILTERS = [
  "active",
  "open",
  "fare_proposed",
  "fare_accepted",
  "pickup_fee_pending",
  "pickup_fee_proposed",
  "confirmed",
  "dispatcher_intervention",
  "converting",
  "live",
  "completed",
  "cancelled",
  "all",
];

const ACTIVE = new Set([
  "open",
  "fare_proposed",
  "fare_accepted",
  "pickup_fee_pending",
  "pickup_fee_proposed",
  "confirmed",
  "converting",
  "live",
  "dispatcher_intervention",
]);

const DISPATCHER_CANCELLABLE = new Set([
  "open",
  "fare_proposed",
  "fare_accepted",
  "pickup_fee_pending",
  "pickup_fee_proposed",
  "dispatcher_intervention",
]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normStatus(value: unknown): string {
  return text(value).toLowerCase();
}

function titleCase(value: unknown): string {
  return text(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function money(value: unknown): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP",
  });
}

function formatDateTime(value: unknown): string {
  const raw = text(value);
  if (!raw) return "--";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "--";
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

function pillClass(active: boolean): string {
  return [
    "rounded-full border px-3 py-1 text-xs font-semibold transition",
    active
      ? "border-slate-900 bg-slate-900 text-white"
      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

function statusClass(status: unknown): string {
  const value = normStatus(status);
  if (value === "open") return "border-amber-300 bg-amber-50 text-amber-800";
  if (value === "fare_proposed") return "border-orange-300 bg-orange-50 text-orange-800";
  if (value === "fare_accepted") return "border-cyan-300 bg-cyan-50 text-cyan-800";
  if (value === "pickup_fee_pending" || value === "pickup_fee_proposed") return "border-indigo-300 bg-indigo-50 text-indigo-800";
  if (value === "confirmed") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (value === "dispatcher_intervention") return "border-red-300 bg-red-50 text-red-800";
  if (value === "converting" || value === "live") return "border-purple-300 bg-purple-50 text-purple-800";
  if (value === "completed") return "border-slate-300 bg-slate-50 text-slate-700";
  if (value.startsWith("cancelled")) return "border-zinc-300 bg-zinc-50 text-zinc-700";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function timerClass(minutes: number | null): string {
  if (minutes == null) return "border-slate-200 bg-slate-50 text-slate-600";
  if (minutes <= 0) return "border-red-300 bg-red-50 text-red-800";
  if (minutes <= 5) return "border-orange-300 bg-orange-50 text-orange-800";
  if (minutes <= 15) return "border-amber-300 bg-amber-50 text-amber-800";
  return "border-emerald-300 bg-emerald-50 text-emerald-800";
}

function timerText(minutes: number | null): string {
  if (minutes == null) return "Not running";
  if (minutes <= 0) return "Expired";
  if (minutes === 1) return "1 minute left";
  return `${minutes} minutes left`;
}

function fareSummary(booking: AdvanceBookingRow): string {
  if (booking.total_fare != null) return money(booking.total_fare);
  if (booking.estimated_total != null) return `${money(booking.estimated_total)} estimated`;
  if (booking.estimated_fare_min != null && booking.estimated_fare_max != null) {
    return `${money(booking.estimated_fare_min)} - ${money(booking.estimated_fare_max)}`;
  }
  if (booking.proposed_ride_fare != null) return `${money(booking.proposed_ride_fare)} proposed`;
  return "--";
}

export default function AdvanceBookingDispatchPage() {
  const [filter, setFilter] = useState("active");
  const [bookings, setBookings] = useState<AdvanceBookingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [lastLoadedAt, setLastLoadedAt] = useState<Date | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/advance-booking-dispatch?filter=all", { cache: "no-store" });
      const data: PageData = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || data.error || "ADVANCE_BOOKING_DISPATCH_LOAD_FAILED");
      }
      setBookings(Array.isArray(data.bookings) ? data.bookings : []);
      setLastLoadedAt(new Date());
      setMessage("");
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(timer);
  }, []);

  async function cancelBooking(booking: AdvanceBookingRow) {
    const status = normStatus(booking.status);

    if (!DISPATCHER_CANCELLABLE.has(status)) {
      setMessage(
        `Advance booking cannot be dispatcher-cancelled while status is ${titleCase(status)}.`
      );
      return;
    }

    const reasonInput = window.prompt(
      `Enter the dispatcher cancellation reason for ${booking.id}.`
    );

    if (reasonInput === null) return;

    const cancellationReason = reasonInput.trim();

    if (!cancellationReason) {
      setMessage("A cancellation reason is required.");
      return;
    }

    const confirmed = window.confirm(
      `Cancel advance booking ${booking.id}?\n\nPassenger: ${
        booking.passenger_name || "Unknown Passenger"
      }\nPickup: ${booking.pickup_address || "Not provided"}\nReason: ${
        cancellationReason
      }\n\nThis action is terminal and will release active driver offers.`
    );

    if (!confirmed) return;

    setCancellingId(booking.id);
    setMessage("Cancelling advance booking...");

    try {
      const response = await fetch(
        "/api/admin/advance-booking-dispatch",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "cancel_booking",
            advanceBookingId: booking.id,
            cancellationReason,
          }),
        }
      );

      const data: PageData & {
        previousStatus?: string | null;
        cancelledStatus?: string | null;
        releasedQueueCount?: number;
      } = await response.json().catch(() => ({}));

      if (!response.ok || !data.ok) {
        throw new Error(
          data.message ||
            data.error ||
            "ADVANCE_BOOKING_CANCELLATION_FAILED"
        );
      }

      setMessage(
        `Advance booking cancelled. Released queue entries: ${Number(
          data.releasedQueueCount ?? 0
        )}.`
      );

      await load();
      setFilter("cancelled");
    } catch (error: unknown) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Advance booking cancellation failed."
      );
    } finally {
      setCancellingId(null);
    }
  }

  const counts = useMemo(() => {
    const next: Record<string, number> = {};
    for (const name of FILTERS) next[name] = 0;
    for (const booking of bookings) {
      const status = normStatus(booking.status);
      next.all += 1;
      if (ACTIVE.has(status)) next.active += 1;
      if (status.startsWith("cancelled")) next.cancelled += 1;
      else if (Object.prototype.hasOwnProperty.call(next, status)) next[status] += 1;
    }
    return next;
  }, [bookings]);

  const visibleBookings = useMemo(() => {
    return bookings
      .filter((booking) => {
        const status = normStatus(booking.status);
        if (filter === "all") return true;
        if (filter === "active") return ACTIVE.has(status);
        if (filter === "cancelled") return status.startsWith("cancelled");
        return status === filter;
      })
      .sort((a, b) => {
        const interventionA = normStatus(a.status) === "dispatcher_intervention" ? 0 : 1;
        const interventionB = normStatus(b.status) === "dispatcher_intervention" ? 0 : 1;
        if (interventionA !== interventionB) return interventionA - interventionB;
        if ((a.escalation_level || 0) !== (b.escalation_level || 0)) {
          return (b.escalation_level || 0) - (a.escalation_level || 0);
        }
        return new Date(a.scheduled_pickup_at || "9999-12-31").getTime() - new Date(b.scheduled_pickup_at || "9999-12-31").getTime();
      });
  }, [bookings, filter]);

  const summary = useMemo(() => ({
    withDriver: bookings.filter((b) => !!b.current_driver_id).length,
    waitingDriver: bookings.filter((b) => b.is_active && !b.current_driver_id && normStatus(b.status) === "open").length,
    intervention: bookings.filter((b) => normStatus(b.status) === "dispatcher_intervention").length,
  }), [bookings]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Advance Booking Dispatch</h1>
              <p className="mt-1 text-sm text-slate-600">Read-only monitoring board for scheduled rides, driver offers, fare progress, and dispatcher intervention.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded-full border bg-slate-50 px-3 py-1">With driver: {summary.withDriver}</span>
              <span className="rounded-full border bg-slate-50 px-3 py-1">Waiting for driver: {summary.waitingDriver}</span>
              <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">Intervention: {summary.intervention}</span>
              <button type="button" className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50" onClick={() => void load()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((name) => (
              <button key={name} type="button" className={pillClass(filter === name)} onClick={() => setFilter(name)}>
                {titleCase(name)} <span className="opacity-75">{counts[name] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Dispatcher cancellation is enabled only for Open, Fare Proposed, Fare Accepted, Pickup Fee Pending, Pickup Fee Proposed, and Dispatcher Intervention. Confirmed, Converting, Live, Completed, and already-cancelled bookings remain protected.
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>Automatic refresh: every 8 seconds</span>
            <span>Last refreshed: {lastLoadedAt ? lastLoadedAt.toLocaleTimeString("en-PH") : "Not loaded"}</span>
          </div>

          {message ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</div> : null}
        </section>

        <section className="space-y-3">
          {visibleBookings.length === 0 ? (
            <div className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-500">No advance bookings in this view.</div>
          ) : (
            visibleBookings.map((booking) => {
              const status = normStatus(booking.status);
              const queue = booking.queue;
              return (
                <article key={booking.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0 flex-1 space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="break-all text-lg font-bold">{booking.id}</h2>
                        <span className={["rounded-full border px-2 py-1 text-xs font-semibold", statusClass(status)].join(" ")}>{titleCase(status || "unknown")}</span>
                        {booking.escalation_level > 0 ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-800">Escalation {booking.escalation_level}</span> : null}
                      </div>

                      <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
                        <div><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Passenger</div><div className="mt-1 font-semibold">{booking.passenger_name || "Unknown Passenger"}</div><div className="text-xs text-slate-500">{booking.passenger_phone || "No phone"}</div></div>
                        <div><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Scheduled pickup</div><div className="mt-1 font-semibold">{formatDateTime(booking.scheduled_pickup_at)}</div></div>
                        <div><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Ride details</div><div className="mt-1 font-semibold">{titleCase(booking.vehicle_type || "unknown")} - {booking.passenger_count == null ? "Passenger count unavailable" : `${booking.passenger_count} passenger${booking.passenger_count === 1 ? "" : "s"}`}</div><div className="text-xs text-slate-500">{booking.distance_km == null ? "Distance unavailable" : `${Number(booking.distance_km).toFixed(2)} km`}</div></div>
                        <div className="md:col-span-2 xl:col-span-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Pickup</div><div className="mt-1">{booking.pickup_address || "Not provided"}</div><div className="text-xs text-slate-500">{booking.pickup_town || booking.passenger_town_origin || "Town unavailable"}</div></div>
                        <div className="md:col-span-2 xl:col-span-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Destination</div><div className="mt-1">{booking.destination_address || "Not provided"}</div></div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Current driver</div><div className="mt-1 text-sm font-semibold">{booking.current_driver_name || "No driver"}</div><div className="mt-1 text-xs text-slate-500">{booking.current_driver_status ? titleCase(booking.current_driver_status) : "Status unavailable"}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Queue</div><div className="mt-1 text-sm font-semibold">{queue ? `${titleCase(queue.status || "unknown")} - Position ${queue.stagger_position ?? "?"}` : "No current queue offer"}</div><div className="mt-1 text-xs text-slate-500">Offers sent: {booking.total_offers_sent || 0} - Passenger declines: {booking.total_passenger_declines || 0}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Fare</div><div className="mt-1 text-sm font-semibold">{fareSummary(booking)}</div><div className="mt-1 text-xs text-slate-500">{titleCase(booking.fare_bracket || booking.booking_mode || "not classified")}</div></div>
                        <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs font-bold uppercase tracking-wide text-slate-500">Departure</div><div className="mt-1 text-sm font-semibold">{titleCase(queue?.departure_option || booking.departure_option_used || "not set")}</div></div>
                      </div>
                    </div>

                    <aside className="w-full space-y-3 xl:w-[330px]">
                      <div className={["rounded-xl border p-3", timerClass(queue?.offer_minutes_remaining ?? null)].join(" ")}><div className="text-xs font-bold uppercase tracking-wide">Driver offer timer</div><div className="mt-1 text-lg font-bold">{timerText(queue?.offer_minutes_remaining ?? null)}</div><div className="mt-1 text-xs">Expires: {formatDateTime(queue?.offer_expires_at)}</div></div>
                      <div className={["rounded-xl border p-3", timerClass(queue?.fare_preparation_minutes_remaining ?? null)].join(" ")}><div className="text-xs font-bold uppercase tracking-wide">Fare preparation timer</div><div className="mt-1 text-lg font-bold">{timerText(queue?.fare_preparation_minutes_remaining ?? null)}</div><div className="mt-1 text-xs">Expires: {formatDateTime(queue?.fare_preparation_expires_at)}</div></div>
                      <div className={["rounded-xl border p-3", timerClass(booking.passenger_response_minutes_remaining)].join(" ")}><div className="text-xs font-bold uppercase tracking-wide">Passenger response timer</div><div className="mt-1 text-lg font-bold">{timerText(booking.passenger_response_minutes_remaining)}</div><div className="mt-1 text-xs">Expires: {formatDateTime(booking.passenger_response_expires_at)}</div></div>

                      {DISPATCHER_CANCELLABLE.has(status) ? (
                        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                          <div className="text-xs font-bold uppercase tracking-wide text-red-700">
                            Dispatcher cancellation
                          </div>
                          <button
                            type="button"
                            className="mt-2 w-full rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                            onClick={() => void cancelBooking(booking)}
                            disabled={cancellingId === booking.id}
                          >
                            {cancellingId === booking.id
                              ? "Cancelling..."
                              : "Cancel Advance Booking"}
                          </button>
                          <div className="mt-2 text-xs text-red-700">
                            A reason and final confirmation are required. This releases active driver offers and is terminal.
                          </div>
                        </div>
                      ) : null}

                      {status === "confirmed" ||
                      status === "converting" ||
                      status === "live" ||
                      status === "completed" ? (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                          Dispatcher cancellation is locked for this status.
                        </div>
                      ) : null}

                      {status.startsWith("cancelled") ? <div className="rounded-xl border border-zinc-300 bg-zinc-50 p-3 text-xs text-zinc-700"><div className="font-bold uppercase tracking-wide">Cancellation</div><div className="mt-1">{booking.cancellation_reason || "No reason recorded"}</div><div className="mt-1">By: {booking.cancelled_by || "Unknown"}</div><div className="mt-1">{formatDateTime(booking.cancelled_at)}</div></div> : null}
                    </aside>
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
