"use client";

import * as React from "react";

type Tab = "passenger" | "owner" | "driver" | "security";

function money(value: number) {
  return "PHP " + value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function chip(text: string, tone: string) {
  return (
    <span className={"rounded-full px-3 py-1 text-xs font-bold " + tone}>
      {text}
    </span>
  );
}

export default function DemoClient() {
  const [tab, setTab] = React.useState<Tab>("passenger");
  const [driverStatus, setDriverStatus] = React.useState("assigned");
  const [addonStatus, setAddonStatus] = React.useState("proposed");
  const [paymentStatus, setPaymentStatus] = React.useState("reservation_pending");
  const [securityState, setSecurityState] = React.useState("critical");
  const [message, setMessage] = React.useState("");

  const nav = [
    ["passenger", "Passenger"],
    ["owner", "Yakalites Owner"],
    ["driver", "Driver"],
    ["security", "Security"],
  ] as const;

  return (
    <main className="min-h-screen bg-slate-100 p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">
                JRide JFleet
              </p>
              <h1 className="mt-1 text-3xl font-bold">Web UI Test Lab</h1>
              <p className="mt-2 text-sm text-slate-300">
                Yakalites Transport pilot - vans, pickups and trucks for hire
              </p>
            </div>
            {chip("PREVIEW ONLY - NO DATABASE WRITES", "bg-amber-300 text-slate-950")}
          </div>
        </header>

        <nav className="grid grid-cols-2 gap-2 rounded-2xl bg-white p-2 shadow-sm sm:grid-cols-4">
          {nav.map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setTab(value);
                setMessage("");
              }}
              className={
                "rounded-xl px-4 py-3 text-sm font-bold " +
                (tab === value
                  ? "bg-slate-950 text-white"
                  : "bg-slate-50 text-slate-700 hover:bg-slate-100")
              }
            >
              {label}
            </button>
          ))}
        </nav>

        {message ? (
          <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
            {message}
          </p>
        ) : null}

        {tab === "passenger" ? (
          <section className="space-y-5">
            <div className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
              <h2 className="text-3xl font-bold">JFleet</h2>
              <p className="mt-1 text-slate-300">Vans, Pickups & Trucks for Hire</p>
              <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                {[
                  ["1. Send itinerary", "Pin all destinations so Yakalites can price fuel and time."],
                  ["2. Receive quotation", "Target response within 3 hours."],
                  ["3. Reserve after acceptance", "Minimum reservation payment: 20%."],
                ].map(([a, b]) => (
                  <div key={a} className="rounded-xl bg-white/10 p-3">
                    <strong>{a}</strong>
                    <p className="mt-1 text-slate-300">{b}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="text-xl font-bold">Plan a hire or review your quotations</h3>
              <p className="mt-2 text-sm text-slate-600">
                Pin the full itinerary before requesting a quotation. An inquiry is not yet a reservation.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setMessage("Test: opening the pinned itinerary request flow.")}
                  className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white"
                >
                  Request a quote
                </button>
                <button
                  type="button"
                  onClick={() => setMessage("Test: opening quotation and revision history.")}
                  className="rounded-xl border border-slate-300 px-5 py-3 font-semibold"
                >
                  View quotations and revisions
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    JFB-DEMO-001
                  </p>
                  <h3 className="mt-1 text-xl font-bold">Reservation Pending</h3>
                </div>
                {chip(paymentStatus === "fully_paid" ? "Fully Paid" : "Reservation Pending", paymentStatus === "fully_paid" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950")}
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <p><strong>Trip:</strong> Oct 10, 8:00 AM - Oct 11, 8:00 PM</p>
                <p><strong>Original quotation:</strong> {money(12000)}</p>
                <p><strong>Minimum reservation:</strong> {money(2400)}</p>
                <p><strong>Free cancellation until:</strong> Oct 8, 8:00 AM</p>
                <p><strong>Add-ons:</strong> {addonStatus === "paid" ? money(1500) : money(0)}</p>
                <p><strong>Current trip value:</strong> {money(addonStatus === "paid" ? 13500 : 12000)}</p>
              </div>

              <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-950">
                <strong>Assigned driver and vehicle</strong>
                <p className="mt-1">Demo Driver - Rating 4.9 - 27 completed JFleet trips</p>
                <p>Toyota Hiace - YAK-1024</p>
              </div>

              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-950">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <strong>Additional route / side trip</strong>
                    <p className="mt-1">Sagada stop requested during trip</p>
                    <p className="mt-1">Baguio - Sagada - Lagawe</p>
                  </div>
                  {chip(addonStatus === "paid" ? "Paid" : addonStatus === "accepted" ? "Accepted" : "Proposed", "bg-white text-violet-900")}
                </div>
                <p className="mt-3"><strong>Additional total:</strong> {money(1500)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {addonStatus === "proposed" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setAddonStatus("accepted");
                          setMessage("Passenger accepted the additional charge.");
                        }}
                        className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white"
                      >
                        Accept Additional Charge
                      </button>
                      <button
                        type="button"
                        onClick={() => setMessage("Passenger kept the original itinerary.")}
                        className="rounded-lg border bg-white px-4 py-2 font-bold"
                      >
                        Keep Original Itinerary
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {tab === "owner" ? (
          <section className="space-y-5">
            <div className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">JRide</p>
              <h2 className="mt-1 text-3xl font-bold">JFleet Owner Portal</h2>
              <p className="mt-2 text-slate-300">Yakalites Transport</p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {chip("Owner-only account", "bg-white/10 text-white")}
                {chip("Multiple devices allowed", "bg-white/10 text-white")}
                {chip("Priority pilot partner", "bg-emerald-500/20 text-emerald-200")}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["New inquiries", "2"],
                ["Confirmed bookings", "4"],
                ["Eligible vehicles", "6"],
                ["Eligible drivers", "8"],
              ].map(([a, b]) => (
                <div key={a} className="rounded-2xl bg-white p-4 shadow-sm">
                  <p className="text-xs uppercase text-slate-500">{a}</p>
                  <strong className="mt-1 block text-3xl">{b}</strong>
                </div>
              ))}
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">JFQ-DEMO-021</p>
                  <h3 className="mt-1 text-xl font-bold">Van - Round Trip</h3>
                </div>
                {chip("Under Review", "bg-amber-100 text-amber-950")}
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <p><strong>Departure:</strong> Oct 10, 8:00 AM</p>
                <p><strong>Expected end:</strong> Oct 11, 8:00 PM</p>
                <p><strong>Passengers:</strong> 8</p>
                <p><strong>Quote due:</strong> Within 3 hours</p>
              </div>
              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
                <strong>Approved itinerary</strong>
                <p className="mt-2">1. Lagawe, Ifugao - Pickup</p>
                <p>2. Baguio City - Stop</p>
                <p>3. Lagawe, Ifugao - Return</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setMessage("Test: owner opens route review and quotation screen.")}
                  className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white"
                >
                  Review route and prepare quotation
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab("security");
                    setMessage("Opened Yakalites Security Monitoring.");
                  }}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 font-bold text-red-900"
                >
                  Security Monitoring
                </button>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <h3 className="text-xl font-bold">Booking JFB-DEMO-001</h3>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <p><strong>Quote:</strong> {money(12000)}</p>
                <p><strong>Paid:</strong> {paymentStatus === "fully_paid" ? money(12000) : money(2400)}</p>
                <p><strong>Reservation minimum:</strong> {money(2400)}</p>
                <p><strong>Partner net:</strong> {money(addonStatus === "paid" ? 12000 : 10500)}</p>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPaymentStatus("fully_paid");
                    setMessage("Demo: owner confirmed full payment.");
                  }}
                  className="rounded-lg bg-emerald-700 px-4 py-2 font-bold text-white"
                >
                  Confirm Full Payment
                </button>
                {addonStatus === "accepted" ? (
                  <button
                    type="button"
                    onClick={() => {
                      setAddonStatus("paid");
                      setMessage("Demo: side-trip payment confirmed once.");
                    }}
                    className="rounded-lg bg-violet-800 px-4 py-2 font-bold text-white"
                  >
                    Confirm Side-trip Payment
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "driver" ? (
          <section className="space-y-5">
            <div className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">JRide</p>
              <h2 className="mt-1 text-3xl font-bold">JFleet Driver</h2>
              <p className="mt-2 text-slate-300">Demo Driver - Yakalites Transport</p>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">JFB-DEMO-001</p>
                  <h3 className="mt-1 text-2xl font-bold">
                    {driverStatus === "assigned" ? "Assigned" : driverStatus === "driver_en_route" ? "Driver En Route" : driverStatus === "driver_arrived" ? "Driver Arrived" : driverStatus === "on_trip" ? "On Trip" : "Completed"}
                  </h3>
                </div>
                {chip(paymentStatus === "fully_paid" ? "Fully Paid" : "Reservation Paid", paymentStatus === "fully_paid" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-950")}
              </div>

              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <p><strong>Passenger:</strong> Juan Dela Cruz</p>
                <p><strong>Contact:</strong> 09XX-XXX-XXXX</p>
                <p><strong>Departure:</strong> Oct 10, 8:00 AM</p>
                <p><strong>Expected end:</strong> Oct 11, 8:00 PM</p>
              </div>

              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
                <strong>Assigned vehicle</strong>
                <p className="mt-1">YAK-VAN-01 - Toyota Hiace - YAK-1024</p>
              </div>

              <div className="mt-4 rounded-xl border p-3">
                <strong>Approved itinerary</strong>
                <p className="mt-2 text-sm">1. Lagawe - Pickup</p>
                <p className="text-sm">2. Baguio City - Stop</p>
                <p className="text-sm">3. Lagawe - Return</p>
              </div>

              <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
                <strong>GPS security tracking</strong>
                <p className="mt-1">Web test: foreground only. Native background tracking comes later.</p>
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                {driverStatus === "assigned" ? (
                  <button type="button" onClick={() => setDriverStatus("driver_en_route")} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
                    Start Driving to Pickup
                  </button>
                ) : null}
                {driverStatus === "driver_en_route" ? (
                  <button type="button" onClick={() => setDriverStatus("driver_arrived")} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
                    Mark Arrived
                  </button>
                ) : null}
                {driverStatus === "driver_arrived" ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (paymentStatus !== "fully_paid") {
                        setMessage("Blocked: owner must confirm full payment before Start Trip.");
                      } else {
                        setDriverStatus("on_trip");
                      }
                    }}
                    className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white"
                  >
                    Start Trip
                  </button>
                ) : null}
                {driverStatus === "on_trip" ? (
                  <button type="button" onClick={() => setDriverStatus("completed")} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">
                    Complete Trip
                  </button>
                ) : null}
              </div>
            </div>
          </section>
        ) : null}

        {tab === "security" ? (
          <section className="space-y-5">
            <div className="rounded-2xl bg-slate-950 p-6 text-white shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">JFleet Security</p>
              <h2 className="mt-1 text-3xl font-bold">Yakalites Transport</h2>
              <p className="mt-2 text-slate-300">Approved-route and GPS continuity monitoring</p>
            </div>

            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <strong>Demo thresholds only.</strong>
              <p className="mt-1 text-sm">
                Production Yakalites thresholds are still disabled until we finish web testing.
              </p>
            </div>

            <article className={"rounded-2xl border p-5 " + (securityState === "critical" ? "border-red-300 bg-red-50" : "border-emerald-300 bg-emerald-50")}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase text-slate-500">JFB-DEMO-001</p>
                  <h3 className="mt-1 text-xl font-bold">
                    {securityState === "critical" ? "Route Deviation" : "Resolved"}
                  </h3>
                </div>
                {chip(securityState === "critical" ? "Critical - Open" : "Resolved", securityState === "critical" ? "bg-white text-red-900" : "bg-white text-emerald-900")}
              </div>
              <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <p><strong>Driver:</strong> Demo Driver</p>
                <p><strong>Vehicle:</strong> YAK-VAN-01 / YAK-1024</p>
                <p><strong>GPS age:</strong> 12 sec</p>
                <p><strong>Distance from approved route:</strong> 1,240 m</p>
                <p><strong>Occurrences:</strong> 3</p>
                <p><strong>Last observed:</strong> 10:24 AM</p>
              </div>
              {securityState === "critical" ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setMessage("Security alert acknowledged.")} className="rounded-lg border bg-white px-4 py-2 font-bold">
                    Acknowledge
                  </button>
                  <button type="button" onClick={() => setSecurityState("resolved")} className="rounded-lg bg-slate-950 px-4 py-2 font-bold text-white">
                    Resolve with reason
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setSecurityState("critical")} className="mt-4 rounded-lg border bg-white px-4 py-2 font-bold">
                  Re-open demo alert
                </button>
              )}
            </article>
          </section>
        ) : null}

        <footer className="rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">
          This lab is for visual and interaction review only. It does not authenticate,
          quote, assign drivers, move money, write GPS, or change production data.
        </footer>
      </div>
    </main>
  );
}
