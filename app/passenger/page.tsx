"use client";

import * as React from "react";

export default function PassengerDashboardPage() {
  // Pilot dashboard: keep it simple + stable.
  // We avoid assuming auth/session APIs here; this is just a landing.
  const rideHref = "/ride";
  const takeoutHref = "/passenger";
  const errandsHref = "/errand";

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Passenger Dashboard</h1>
        <p className="text-sm opacity-80 mb-6">
          Welcome! Choose what you want to do.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <a
            className="rounded-xl border px-4 py-3 hover:bg-black/5"
            href={rideHref}
          >
            <div className="font-semibold">Book Ride</div>
            <div className="text-xs opacity-70">Go to ride booking</div>
          </a>

          <a
            className="rounded-xl border px-4 py-3 hover:bg-black/5"
            href={takeoutHref}
          >
            <div className="font-semibold">Takeout</div>
            <div className="text-xs opacity-70">Food delivery (pilot)</div>
          </a>

          <a
            className="rounded-xl border px-4 py-3 hover:bg-black/5"
            href={errandsHref}
          >
            <div className="font-semibold">Errands</div>
            <div className="text-xs opacity-70">Pabili / padala (pilot)</div>
          </a>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row gap-3">
          <a
            className="inline-flex items-center justify-center rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 font-semibold"
            href={rideHref}
          >
            Continue
          </a>
</div>

        <div className="mt-6 text-xs opacity-70">
          Note: This is the passenger landing page. Next step is to connect verification + night rules (8PM-5AM).
        </div>
      </div>
    </main>
  );
}
