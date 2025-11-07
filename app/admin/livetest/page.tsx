"use client";

import LiveDriverMap from "@/components/maps/LiveDriverMap";

export default function AdminLiveTestPage() {
  return (
    <main className="p-4 space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">JRide Live Driver Map — Test</h1>
        <p className="text-sm text-gray-500">
          Internal test page for validating live driver locations and clusters.
        </p>
      </header>

      <section className="w-full h-[70vh] rounded-xl border">
        <LiveDriverMap drivers={[]} />
      </section>
    </main>
  );
}