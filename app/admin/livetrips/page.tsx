"use client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

import React from "react";
import LiveDriverMap from "@/components/maps/LiveDriverMap";

export default function Page() {
  // keep this simple for now; we can re-add realtime later
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold mb-4">Live Driver Map</h1>
      <div className="h-[520px] rounded-2xl overflow-hidden bg-white shadow">
        <LiveDriverMap drivers={[]} />
      </div>
    </main>
  );
}
