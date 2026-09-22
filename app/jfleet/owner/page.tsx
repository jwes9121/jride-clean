"use client";

import * as React from "react";
import Link from "next/link";
import { philippinesTime } from "@/lib/jfleet/routeReview";

type Inquiry = {
  id: string;
  inquiry_code: string;
  purpose: string;
  requested_vehicle_type: string;
  trip_mode: string;
  pickup_label: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  passenger_count?: number | null;
  cargo_description?: string | null;
  cargo_weight_kg?: number | string | null;
  luggage_notes?: string | null;
  special_notes?: string | null;
  status: string;
  submitted_at: string;
  quote_due_at: string;
};

type Itinerary = {
  id: string;
  inquiry_id: string;
  version_no: number;
  source: string;
  status: string;
};

type Stop = {
  itinerary_id: string;
  sequence_no: number;
  stop_type: string;
  location_label: string;
};

type Quote = {
  id: string;
  inquiry_id: string;
  version_no: number;
  status: string;
  total_amount: number | string;
  valid_until: string;
  sent_at: string;
};

type Booking = {
  id: string;
  booking_code: string;
  inquiry_id: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  original_quote_amount: number | string;
  addon_total: number | string;
  reservation_required_amount: number | string;
  cancellation_free_until: string;
  final_trip_value: number | string;
  jride_commission_amount: number | string;
  partner_net_amount: number | string;
  status: string;
  payment_status: string;
  assigned_vehicle_id?: string | null;
  assigned_driver_id?: string | null;
};

type Payment = {
  id: string;
  booking_id: string;
  payment_kind: string;
  amount: number | string;
  status: string;
  payment_channel?: string | null;
  payment_reference?: string | null;
  confirmed_at?: string | null;
};

type Addon = {
  id: string;
  booking_id: string;
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
};

type Vehicle = {
  id: string;
  unit_code: string;
  vehicle_type: string;
  make?: string | null;
  model?: string | null;
  model_year?: number | null;
  plate_number: string;
  passenger_capacity?: number | null;
  cargo_capacity_kg?: number | string | null;
  status: string;
  documents_verified: boolean;
};

type Driver = {
  id: string;
  driver_code: string;
  full_name: string;
  phone?: string | null;
  status: string;
  documents_verified: boolean;
  rating_average: number | string;
  rating_count: number;
  completed_trips: number;
};

type Dashboard = {
  ok: boolean;
  partner?: {
    id: string;
    partner_code: string;
    legal_name: string;
    display_name: string;
    status: string;
    is_priority_pilot: boolean;
  };
  inquiries?: Inquiry[];
  itineraries?: Itinerary[];
  itinerary_stops?: Stop[];
  quotes?: Quote[];
  bookings?: Booking[];
  payments?: Payment[];
  addons?: Addon[];
  vehicles?: Vehicle[];
  drivers?: Driver[];
  message?: string;
};

type PaymentDraft = {
  payment_kind: "reservation" | "balance" | "full_payment";
  amount: string;
  payment_channel: string;
  payment_reference: string;
  notes: string;
};

type AssignmentDraft = {
  vehicle_id: string;
  driver_id: string;
};

type AddonDraft = {
  requested_by: "customer" | "driver" | "owner";
  description: string;
  route_label: string;
  fuel_vehicle_fee: string;
  driver_fee: string;
  other_fee: string;
  notes: string;
};

type AddonPaymentDraft = {
  payment_channel: string;
  payment_reference: string;
  notes: string;
};

function money(value: unknown): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "PHP 0.00";
  return "PHP " + amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function dateTime(value?: string | null): string {
  return value ? philippinesTime(value) : "-";
}

function title(value: string): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function JFleetOwnerPage() {
  const [data, setData] = React.useState<Dashboard | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busyKey, setBusyKey] = React.useState("");
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [paymentDrafts, setPaymentDrafts] = React.useState<Record<string, PaymentDraft>>({});
  const [assignmentDrafts, setAssignmentDrafts] = React.useState<Record<string, AssignmentDraft>>({});
  const [addonDrafts, setAddonDrafts] = React.useState<Record<string, AddonDraft>>({});
  const [addonPaymentDrafts, setAddonPaymentDrafts] = React.useState<Record<string, AddonPaymentDraft>>({});

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/jfleet/owner/dashboard", {
        cache: "no-store",
        credentials: "include",
      });
      const body = (await response.json().catch(() => ({}))) as Dashboard;
      if (!response.ok || !body.ok) {
        throw new Error(body.message || "Could not load the JFleet owner dashboard.");
      }
      setData(body);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Could not load the JFleet owner dashboard."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function itineraryFor(inquiryId: string) {
    const current = (data?.itineraries ?? [])
      .filter((row) => row.inquiry_id === inquiryId)
      .sort((a, b) => b.version_no - a.version_no)
      .find((row) => row.status === "current");
    if (!current) return [];
    return (data?.itinerary_stops ?? [])
      .filter((stop) => stop.itinerary_id === current.id)
      .sort((a, b) => a.sequence_no - b.sequence_no);
  }

  function latestQuote(inquiryId: string) {
    return (data?.quotes ?? [])
      .filter((quote) => quote.inquiry_id === inquiryId)
      .sort((a, b) => b.version_no - a.version_no)[0];
  }

  function paidAmount(bookingId: string) {
    return (data?.payments ?? [])
      .filter((payment) => payment.booking_id === bookingId && payment.status === "confirmed")
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
  }

  function paymentDraft(bookingId: string): PaymentDraft {
    return (
      paymentDrafts[bookingId] ?? {
        payment_kind: "reservation",
        amount: "",
        payment_channel: "",
        payment_reference: "",
        notes: "",
      }
    );
  }

  function assignmentDraft(bookingId: string): AssignmentDraft {
    return assignmentDrafts[bookingId] ?? { vehicle_id: "", driver_id: "" };
  }

  function addonsFor(bookingId: string) {
    return (data?.addons ?? []).filter((addon) => addon.booking_id === bookingId);
  }

  function addonDraft(bookingId: string): AddonDraft {
    return (
      addonDrafts[bookingId] ?? {
        requested_by: "customer",
        description: "",
        route_label: "",
        fuel_vehicle_fee: "",
        driver_fee: "",
        other_fee: "",
        notes: "",
      }
    );
  }

  function addonPaymentDraft(addonId: string): AddonPaymentDraft {
    return (
      addonPaymentDrafts[addonId] ?? {
        payment_channel: "",
        payment_reference: "",
        notes: "",
      }
    );
  }

  async function confirmPayment(booking: Booking) {
    const draft = paymentDraft(booking.id);
    setBusyKey("payment:" + booking.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jfleet/owner/payments", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: booking.id,
          payment_kind: draft.payment_kind,
          amount: Number(draft.amount),
          payment_channel: draft.payment_channel,
          payment_reference: draft.payment_reference,
          notes: draft.notes,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) throw new Error(body?.message || "Payment confirmation failed.");
      setMessage(
        booking.booking_code +
          " payment confirmed. Total original-quote payments: " +
          money(body.confirmed_original_payments)
      );
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "Payment confirmation failed."
      );
    } finally {
      setBusyKey("");
    }
  }

  async function assign(booking: Booking) {
    const draft = assignmentDraft(booking.id);
    setBusyKey("assign:" + booking.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jfleet/owner/assign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: booking.id,
          vehicle_id: draft.vehicle_id,
          driver_id: draft.driver_id,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) throw new Error(body?.message || "Assignment failed.");
      setMessage(
        booking.booking_code +
          " assigned to " +
          body.driver_name +
          " / " +
          body.plate_number
      );
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Assignment failed.");
    } finally {
      setBusyKey("");
    }
  }

  async function proposeAddon(booking: Booking) {
    const draft = addonDraft(booking.id);
    setBusyKey("addon-propose:" + booking.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jfleet/owner/addons/propose", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: booking.id,
          requested_by: draft.requested_by,
          description: draft.description,
          route_label: draft.route_label,
          fuel_vehicle_fee: Number(draft.fuel_vehicle_fee || 0),
          driver_fee: Number(draft.driver_fee || 0),
          other_fee: Number(draft.other_fee || 0),
          notes: draft.notes || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "Additional trip charge could not be proposed.");
      }
      setMessage(
        booking.booking_code +
          " additional charge proposed: " +
          money(body.total_amount) +
          ". Waiting for customer approval."
      );
      setAddonDrafts((current) => ({ ...current, [booking.id]: {
        requested_by: "customer",
        description: "",
        route_label: "",
        fuel_vehicle_fee: "",
        driver_fee: "",
        other_fee: "",
        notes: "",
      }}));
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Additional trip charge could not be proposed."
      );
    } finally {
      setBusyKey("");
    }
  }

  async function confirmAddonPayment(addon: Addon) {
    const draft = addonPaymentDraft(addon.id);
    setBusyKey("addon-pay:" + addon.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/jfleet/owner/addons/confirm-payment", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          addon_id: addon.id,
          payment_channel: draft.payment_channel,
          payment_reference: draft.payment_reference,
          notes: draft.notes || null,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message || "Additional-charge payment could not be confirmed.");
      }
      setMessage(
        "Additional charge paid. Current trip value: " +
          money(body.final_trip_value) +
          " | JRide commission: " +
          money(body.jride_commission_amount)
      );
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Additional-charge payment could not be confirmed."
      );
    } finally {
      setBusyKey("");
    }
  }

  if (loading && !data) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-6xl rounded-2xl bg-white p-6">Loading JFleet owner portal...</div>
      </main>
    );
  }

  if (!data?.ok) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <div className="mx-auto max-w-2xl rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold">JFleet Owner Portal</h1>
          <p className="mt-3 text-red-700">{error || "Owner access is not available for this account yet."}</p>
          <p className="mt-3 text-sm text-slate-600">
            The final pilot owner account can be linked later. Development can continue before company documents are uploaded.
          </p>
        </div>
      </main>
    );
  }

  const eligibleVehicles = (data.vehicles ?? []).filter(
    (vehicle) => vehicle.status === "active" && vehicle.documents_verified
  );
  const eligibleDrivers = (data.drivers ?? []).filter(
    (driver) => driver.status === "active" && driver.documents_verified
  );

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">JRide</p>
          <h1 className="mt-1 text-3xl font-bold">JFleet Owner Portal</h1>
          <p className="mt-2 text-slate-300">{data.partner?.display_name}</p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-3 py-1">Owner-only account</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Multiple devices allowed</span>
            {data.partner?.is_priority_pilot ? (
              <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-emerald-200">Priority pilot partner</span>
            ) : null}
          </div>
        </header>

        {error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</p> : null}
        {message ? <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">{message}</p> : null}

        <section className="grid gap-4 md:grid-cols-4">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-500">Inquiries</p>
            <strong className="mt-1 block text-3xl">{data.inquiries?.length ?? 0}</strong>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-500">Bookings</p>
            <strong className="mt-1 block text-3xl">{data.bookings?.length ?? 0}</strong>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-500">Eligible vehicles</p>
            <strong className="mt-1 block text-3xl">{eligibleVehicles.length}</strong>
            <p className="mt-1 text-xs text-slate-500">{data.vehicles?.length ?? 0} total records</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-xs uppercase text-slate-500">Eligible drivers</p>
            <strong className="mt-1 block text-3xl">{eligibleDrivers.length}</strong>
            <p className="mt-1 text-xs text-slate-500">{data.drivers?.length ?? 0} total records</p>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">Quote Requests</h2>
              <p className="text-sm text-slate-600">Open Route Review for the exact inquiry, approve its itinerary, then send the quotation within the 3-hour response window.</p>
            </div>
            <button type="button" onClick={() => void load()} className="rounded-xl border px-4 py-2 text-sm font-semibold">
              Refresh
            </button>
          </div>

          <div className="mt-5 space-y-5">
            {(data.inquiries ?? []).map((inquiry) => {
              const stops = itineraryFor(inquiry.id);
              const quote = latestQuote(inquiry.id);
              const closed = ["declined", "expired", "cancelled", "converted"].includes(inquiry.status);
              return (
                <article key={inquiry.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-500">{inquiry.inquiry_code}</p>
                      <h3 className="mt-1 font-bold">{title(inquiry.requested_vehicle_type)} - {title(inquiry.trip_mode)}</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{title(inquiry.status)}</span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <p><strong>Departure:</strong> {dateTime(inquiry.scheduled_start_at)}</p>
                    <p><strong>Expected end:</strong> {dateTime(inquiry.scheduled_end_at)}</p>
                    <p><strong>Passengers:</strong> {inquiry.passenger_count ?? "-"}</p>
                    <p><strong>Quote due:</strong> {dateTime(inquiry.quote_due_at)}</p>
                  </div>

                  <div className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">
                    <strong>Itinerary:</strong>
                    <div className="mt-2 space-y-1">
                      {stops.map((stop) => (
                        <p key={stop.sequence_no}>
                          {stop.sequence_no}. {stop.location_label} ({title(stop.stop_type)})
                        </p>
                      ))}
                    </div>
                  </div>

                  {inquiry.cargo_description ? (
                    <p className="mt-3 text-sm"><strong>Cargo:</strong> {inquiry.cargo_description} {inquiry.cargo_weight_kg ? "(" + inquiry.cargo_weight_kg + " kg)" : ""}</p>
                  ) : null}
                  {inquiry.special_notes ? (
                    <p className="mt-2 text-sm"><strong>Customer notes:</strong> {inquiry.special_notes}</p>
                  ) : null}

                  {quote ? (
                    <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">
                      Latest quote v{quote.version_no}: <strong>{money(quote.total_amount)}</strong> - {title(quote.status)} - valid until {dateTime(quote.valid_until)}
                    </div>
                  ) : null}

                  {!closed ? (
                    <Link
                      href={"/jfleet/owner/routes?inquiry_id=" + encodeURIComponent(inquiry.id)}
                      className="mt-4 inline-block rounded-xl bg-slate-950 px-4 py-3 font-bold text-white"
                    >
                      Review route and prepare quotation
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Confirmed and Pending Bookings</h2>
          <p className="mt-1 text-sm text-slate-600">Confirm payments received, then assign the actual vehicle and driver.</p>

          <div className="mt-5 space-y-5">
            {(data.bookings ?? []).map((booking) => {
              const payment = paymentDraft(booking.id);
              const assignment = assignmentDraft(booking.id);
              const totalPaid = paidAmount(booking.id);
              const bookingAddons = addonsFor(booking.id);
              const addon = addonDraft(booking.id);
              const closed = ["completed", "cancelled_customer", "cancelled_operator"].includes(booking.status);
              return (
                <article key={booking.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase text-slate-500">{booking.booking_code}</p>
                      <h3 className="mt-1 font-bold">{title(booking.status)}</h3>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold">{title(booking.payment_status)}</span>
                  </div>

                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <p><strong>Quote:</strong> {money(booking.original_quote_amount)}</p>
                    <p><strong>Paid:</strong> {money(totalPaid)}</p>
                    <p><strong>Reservation minimum:</strong> {money(booking.reservation_required_amount)}</p>
                    <p><strong>Free cancel until:</strong> {dateTime(booking.cancellation_free_until)}</p>
                    <p><strong>Final value:</strong> {money(booking.final_trip_value)}</p>
                    <p><strong>JRide commission:</strong> {money(booking.jride_commission_amount)}</p>
                    <p><strong>Partner net:</strong> {money(booking.partner_net_amount)}</p>
                    <p><strong>Trip:</strong> {dateTime(booking.scheduled_start_at)} to {dateTime(booking.scheduled_end_at)}</p>
                  </div>

                  {bookingAddons.length ? (
                    <div className="mt-4 space-y-3">
                      {bookingAddons.map((item) => {
                        const routeLabel =
                          item.additional_route &&
                          typeof item.additional_route === "object" &&
                          "label" in item.additional_route
                            ? String((item.additional_route as { label?: string }).label || "")
                            : "";
                        const payDraft = addonPaymentDraft(item.id);
                        return (
                          <div key={item.id} className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <strong>{item.description}</strong>
                                {routeLabel ? <p className="mt-1">Route: {routeLabel}</p> : null}
                              </div>
                              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                                {title(item.status)}
                              </span>
                            </div>
                            <div className="mt-2 grid gap-1 sm:grid-cols-4">
                              <p>Fuel/vehicle: {money(item.fuel_vehicle_fee)}</p>
                              <p>Driver/time: {money(item.driver_fee)}</p>
                              <p>Other: {money(item.other_fee)}</p>
                              <p><strong>Total: {money(item.total_amount)}</strong></p>
                            </div>
                            {item.status === "proposed" ? (
                              <p className="mt-2 font-semibold">Waiting for customer approval.</p>
                            ) : item.status === "accepted" ? (
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                <input
                                  placeholder="Payment channel"
                                  value={payDraft.payment_channel}
                                  onChange={(event) =>
                                    setAddonPaymentDrafts((current) => ({
                                      ...current,
                                      [item.id]: { ...payDraft, payment_channel: event.target.value },
                                    }))
                                  }
                                  className="rounded-lg border bg-white px-3 py-2"
                                />
                                <input
                                  placeholder="Reference number, if any"
                                  value={payDraft.payment_reference}
                                  onChange={(event) =>
                                    setAddonPaymentDrafts((current) => ({
                                      ...current,
                                      [item.id]: { ...payDraft, payment_reference: event.target.value },
                                    }))
                                  }
                                  className="rounded-lg border bg-white px-3 py-2"
                                />
                                <button
                                  type="button"
                                  disabled={busyKey === "addon-pay:" + item.id}
                                  onClick={() => void confirmAddonPayment(item)}
                                  className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50 sm:col-span-2"
                                >
                                  {busyKey === "addon-pay:" + item.id
                                    ? "Saving..."
                                    : "Confirm Additional Fee Paid"}
                                </button>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {booking.status === "on_trip" ? (
                    <div className="mt-4 rounded-xl border border-violet-200 p-3">
                      <h4 className="font-bold">Additional route / side trip</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        Quote the added fuel/vehicle cost and any driver/time fee. The customer must approve it before the side trip is treated as authorized.
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <select
                          value={addon.requested_by}
                          onChange={(event) =>
                            setAddonDrafts((current) => ({
                              ...current,
                              [booking.id]: {
                                ...addon,
                                requested_by: event.target.value as AddonDraft["requested_by"],
                              },
                            }))
                          }
                          className="rounded-lg border bg-white px-3 py-2"
                        >
                          <option value="customer">Requested by customer</option>
                          <option value="driver">Reported by driver</option>
                          <option value="owner">Initiated by owner</option>
                        </select>
                        <input
                          placeholder="Side-trip description"
                          value={addon.description}
                          onChange={(event) =>
                            setAddonDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...addon, description: event.target.value },
                            }))
                          }
                          className="rounded-lg border px-3 py-2"
                        />
                        <input
                          placeholder="Additional route / destination"
                          value={addon.route_label}
                          onChange={(event) =>
                            setAddonDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...addon, route_label: event.target.value },
                            }))
                          }
                          className="rounded-lg border px-3 py-2 sm:col-span-2"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Fuel / vehicle fee"
                          value={addon.fuel_vehicle_fee}
                          onChange={(event) =>
                            setAddonDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...addon, fuel_vehicle_fee: event.target.value },
                            }))
                          }
                          className="rounded-lg border px-3 py-2"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Driver / time fee"
                          value={addon.driver_fee}
                          onChange={(event) =>
                            setAddonDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...addon, driver_fee: event.target.value },
                            }))
                          }
                          className="rounded-lg border px-3 py-2"
                        />
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Other fee"
                          value={addon.other_fee}
                          onChange={(event) =>
                            setAddonDrafts((current) => ({
                              ...current,
                              [booking.id]: { ...addon, other_fee: event.target.value },
                            }))
                          }
                          className="rounded-lg border px-3 py-2"
                        />
                        <button
                          type="button"
                          disabled={
                            busyKey === "addon-propose:" + booking.id ||
                            !addon.description.trim() ||
                            !addon.route_label.trim()
                          }
                          onClick={() => void proposeAddon(booking)}
                          className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white disabled:opacity-50"
                        >
                          {busyKey === "addon-propose:" + booking.id
                            ? "Sending..."
                            : "Send Additional Charge"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {!closed ? (
                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <h4 className="font-bold">Confirm payment received</h4>
                        <div className="mt-3 grid gap-2">
                          <select
                            value={payment.payment_kind}
                            onChange={(event) =>
                              setPaymentDrafts((current) => ({
                                ...current,
                                [booking.id]: {
                                  ...payment,
                                  payment_kind: event.target.value as PaymentDraft["payment_kind"],
                                },
                              }))
                            }
                            className="rounded-lg border bg-white px-3 py-2"
                          >
                            <option value="reservation">Reservation</option>
                            <option value="balance">Balance</option>
                            <option value="full_payment">Full payment</option>
                          </select>
                          <input
                            type="number"
                            min="0.01"
                            step="0.01"
                            placeholder="Amount received"
                            value={payment.amount}
                            onChange={(event) =>
                              setPaymentDrafts((current) => ({
                                ...current,
                                [booking.id]: { ...payment, amount: event.target.value },
                              }))
                            }
                            className="rounded-lg border bg-white px-3 py-2"
                          />
                          <input
                            placeholder="Channel: cash, bank, GCash, etc."
                            value={payment.payment_channel}
                            onChange={(event) =>
                              setPaymentDrafts((current) => ({
                                ...current,
                                [booking.id]: { ...payment, payment_channel: event.target.value },
                              }))
                            }
                            className="rounded-lg border bg-white px-3 py-2"
                          />
                          <input
                            placeholder="Reference number, if any"
                            value={payment.payment_reference}
                            onChange={(event) =>
                              setPaymentDrafts((current) => ({
                                ...current,
                                [booking.id]: { ...payment, payment_reference: event.target.value },
                              }))
                            }
                            className="rounded-lg border bg-white px-3 py-2"
                          />
                          <button
                            type="button"
                            disabled={busyKey === "payment:" + booking.id || !payment.amount}
                            onClick={() => void confirmPayment(booking)}
                            className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white disabled:opacity-50"
                          >
                            {busyKey === "payment:" + booking.id ? "Saving..." : "Confirm Payment"}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl bg-slate-50 p-3">
                        <h4 className="font-bold">Assign vehicle and driver</h4>
                        <p className="mt-1 text-xs text-slate-500">Only active, document-verified records can be assigned.</p>
                        <div className="mt-3 grid gap-2">
                          <select
                            value={assignment.vehicle_id}
                            onChange={(event) =>
                              setAssignmentDrafts((current) => ({
                                ...current,
                                [booking.id]: { ...assignment, vehicle_id: event.target.value },
                              }))
                            }
                            className="rounded-lg border bg-white px-3 py-2"
                          >
                            <option value="">Choose vehicle</option>
                            {eligibleVehicles.map((vehicle) => (
                              <option key={vehicle.id} value={vehicle.id}>
                                {vehicle.unit_code} - {title(vehicle.vehicle_type)} - {vehicle.plate_number}
                              </option>
                            ))}
                          </select>

                          <select
                            value={assignment.driver_id}
                            onChange={(event) =>
                              setAssignmentDrafts((current) => ({
                                ...current,
                                [booking.id]: { ...assignment, driver_id: event.target.value },
                              }))
                            }
                            className="rounded-lg border bg-white px-3 py-2"
                          >
                            <option value="">Choose driver</option>
                            {eligibleDrivers.map((driver) => (
                              <option key={driver.id} value={driver.id}>
                                {driver.full_name} - {driver.rating_count ? Number(driver.rating_average).toFixed(1) + " rating" : "New"}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            disabled={
                              busyKey === "assign:" + booking.id ||
                              !assignment.vehicle_id ||
                              !assignment.driver_id
                            }
                            onClick={() => void assign(booking)}
                            className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white disabled:opacity-50"
                          >
                            {busyKey === "assign:" + booking.id ? "Assigning..." : "Confirm Assignment"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Fleet</h2>
            <div className="mt-4 space-y-2">
              {(data.vehicles ?? []).map((vehicle) => (
                <div key={vehicle.id} className="rounded-xl border p-3 text-sm">
                  <strong>{vehicle.unit_code} - {vehicle.plate_number}</strong>
                  <p className="mt-1 text-slate-600">
                    {title(vehicle.vehicle_type)} | {title(vehicle.status)} | Documents: {vehicle.documents_verified ? "Verified" : "Pending"}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="text-xl font-bold">Drivers</h2>
            <div className="mt-4 space-y-2">
              {(data.drivers ?? []).map((driver) => (
                <div key={driver.id} className="rounded-xl border p-3 text-sm">
                  <strong>{driver.full_name}</strong>
                  <p className="mt-1 text-slate-600">
                    {title(driver.status)} | Documents: {driver.documents_verified ? "Verified" : "Pending"} | Completed: {driver.completed_trips}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
