"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function PassengerDashboardPage() {
  const router = useRouter();
  const [choice, setChoice] = React.useState<"ride" | "takeout" | "errand">("ride");

  function go() {
    if (choice === "ride") router.push("/ride");
    if (choice === "takeout") router.push("/takeout");
    if (choice === "errand") router.push("/errand");
  }

  function Card(props: { id: "ride" | "takeout" | "errand"; title: string; desc: string }) {
    const active = choice === props.id;
    return (
      <button
        type="button"
        onClick={() => setChoice(props.id)}
        className={
          "text-left rounded-xl border px-4 py-3 transition " +
          (active ? "border-blue-500 bg-blue-500/10" : "border-black/10 bg-white hover:bg-black/5")
        }
      >
        <div className="font-semibold">{props.title}</div>
        <div className="text-sm opacity-70">{props.desc}</div>
      </button>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-white">
      <div className="w-full max-w-2xl rounded-2xl border border-black/10 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-1">Passenger Dashboard</h1>
        <p className="text-sm opacity-70 mb-5">Choose what you want to do.</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card id="ride" title="Book Ride" desc="Go to ride booking" />
          <Card id="takeout" title="Takeout" desc="Food delivery (pilot)" />
          <Card id="errand" title="Errands" desc="Pabili / padala (pilot)" />
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={go}
            className="rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 font-semibold"
          >
            Continue
          </button>

          <button
            type="button"
            onClick={() => router.push("/passenger-login")}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
            title="Use this if you want to switch accounts"
          >
            Switch Account
          </button>
        </div>

        <div className="mt-4 text-xs opacity-70">
          Note: Next step is to connect verification + night rules (8PM-5AM).
        </div>
      </div>
    </main>
  );
}
