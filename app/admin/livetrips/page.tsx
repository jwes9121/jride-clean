"use client";

import LiveDriverMap from "@/components/maps/LiveDriverMap";

export default function AdminLiveTripsPage() {
  return (
    <main className="p-4 space-y-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">JRide Live Trips & Drivers</h1>
        <p className="text-sm text-gray-500">
          Monitor active trips, online drivers, and their latest positions in real-time.
        </p>
      </header>

      <section className="w-full h-[70vh] rounded-xl border">
        <LiveDriverMap />
      </section>
    </main>
  );
}