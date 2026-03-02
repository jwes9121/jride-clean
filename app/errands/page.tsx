"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function ErrandPage() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [town, setTown] = React.useState("");
  const [submitted, setSubmitted] = React.useState(false);

  function submitInterest(e: React.FormEvent) {
    e.preventDefault();
    // Teaser only: no backend yet (safe, no assumptions about tables/functions).
    setSubmitted(true);
    setTimeout(() => {
      setOpen(false);
      setSubmitted(false);
      setName("");
      setPhone("");
      setTown("");
    }, 1200);
  }

  return (
    <main className="min-h-screen relative overflow-hidden bg-[#05070b] text-white">
      {/* Background */}
      <div className="absolute inset-0">
        <div className="absolute inset-0 opacity-60 bg-[radial-gradient(1000px_600px_at_50%_30%,rgba(56,189,248,0.18),transparent_55%),radial-gradient(900px_600px_at_20%_80%,rgba(34,197,94,0.14),transparent_55%),radial-gradient(900px_600px_at_80%_75%,rgba(249,115,22,0.14),transparent_55%)]" />
        <div className="absolute inset-0 opacity-[0.08] bg-[linear-gradient(to_bottom,transparent,rgba(255,255,255,0.06),transparent)]" />
        <div className="absolute inset-0 opacity-[0.06] bg-[linear-gradient(to_right,rgba(255,255,255,0.06)_1px,transparent_1px)] bg-[length:42px_42px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 p-6">
        <div className="max-w-5xl mx-auto">
          {/* Top bar */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-2xl bg-white/10 border border-white/10 flex items-center justify-center">
                <span className="text-sm font-bold">JR</span>
              </div>
              <div className="leading-tight">
                <div className="text-sm opacity-70">J-RIDE</div>
                <div className="text-base font-semibold">Errands</div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => router.push("/passenger")}
              className="rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 px-4 py-2 text-sm font-semibold"
            >
              Back to Passenger
            </button>
          </div>

          {/* Hero */}
          <div className="mt-10">
            <div className="inline-flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-200">
              <span className="h-2 w-2 rounded-full bg-orange-300 animate-pulse" />
              Coming Soon (Soft Launch Teaser)
            </div>

            <h1 className="mt-4 text-4xl md:text-5xl font-extrabold tracking-tight">
              We run it, you relax.
            </h1>
            <p className="mt-3 max-w-2xl text-sm md:text-base text-white/70">
              JRide Errands will let you request grocery pickup, pharmacy runs, document delivery,
              and quick store purchases — handled by available riders in your town.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="rounded-2xl px-5 py-3 font-semibold bg-orange-500/20 border border-orange-400/30 hover:bg-orange-500/25"
              >
                Notify me when Errands launches
              </button>

              <button
                type="button"
                disabled
                className="rounded-2xl px-5 py-3 font-semibold bg-white/5 border border-white/10 text-white/50 cursor-not-allowed"
                title="Booking flow not enabled yet."
              >
                Start an Errand (disabled)
              </button>
            </div>

            <div className="mt-3 text-xs text-white/55">
              Status: <span className="text-white/80 font-semibold">In Development</span> •
              Initial rollout planned per town (Ifugao).
            </div>
          </div>

          {/* Feature cards */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <TeaserCard title="Grocery pickup" desc="Palengke runs, store purchases, quick refills." icon="🛒" accent="blue" />
            <TeaserCard title="Pharmacy runs" desc="Medicine pickup & delivery for your family." icon="💊" accent="green" />
            <TeaserCard title="Documents" desc="Forms, IDs, envelopes — delivered fast." icon="📄" accent="cyan" />
            <TeaserCard title="Parcel drop-off" desc="Send or receive small packages safely." icon="📦" accent="orange" />
          </div>

          {/* How it will work */}
          <div className="mt-10 grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 rounded-3xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">How it will work</h2>
              <ol className="mt-3 space-y-2 text-sm text-white/70 list-decimal list-inside">
                <li>Choose errand type (grocery, pharmacy, documents, parcel).</li>
                <li>Add details + pickup/drop-off location.</li>
                <li>We match an available rider. You’ll see status updates.</li>
                <li>Pay via wallet/cash (final mode depends on rollout rules).</li>
              </ol>

              <div className="mt-4 text-xs text-white/55">
                Note: This page is intentionally a teaser so it won’t affect ride booking priority.
              </div>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <h2 className="text-lg font-semibold">Rollout plan</h2>
              <div className="mt-3 space-y-2 text-sm text-white/70">
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="font-semibold text-white/85">Phase 1</div>
                  <div className="text-white/65">Manual approval + basic request form</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="font-semibold text-white/85">Phase 2</div>
                  <div className="text-white/65">Auto-assignment + pricing presets</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
                  <div className="font-semibold text-white/85">Phase 3</div>
                  <div className="text-white/65">Wallet + receipts + audit trail</div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-10 pb-8 text-xs text-white/45">
            J-RIDE • Ride. Eat. Repeat. • Errands Teaser Page
          </div>
        </div>
      </div>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
          />
          <div className="relative w-full max-w-lg rounded-3xl border border-white/10 bg-[#0a0f18] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">Get notified for Errands</div>
                <div className="mt-1 text-sm text-white/65">
                  Optional details. This is local-only for now (no backend yet).
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-sm"
              >
                Close
              </button>
            </div>

            <form onSubmit={submitInterest} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <div className="text-xs text-white/60">Name (optional)</div>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400/40"
                    placeholder="Juan D."
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs text-white/60">Phone (optional)</div>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400/40"
                    placeholder="09xx..."
                  />
                </label>
              </div>

              <label className="space-y-1 block">
                <div className="text-xs text-white/60">Town / Barangay (optional)</div>
                <input
                  value={town}
                  onChange={(e) => setTown(e.target.value)}
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400/40"
                  placeholder="Lagawe / Hingyon / Banaue..."
                />
              </label>

              <button
                type="submit"
                className="w-full rounded-2xl px-5 py-3 font-semibold bg-orange-500/20 border border-orange-400/30 hover:bg-orange-500/25"
              >
                {submitted ? "Saved (local) ✓" : "Notify Me"}
              </button>

              <div className="text-[11px] text-white/45">
                When you’re ready, we’ll wire this to Supabase (errand_interest table) with zero impact on ride booking.
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

function TeaserCard(props: {
  title: string;
  desc: string;
  icon: string;
  accent: "blue" | "green" | "cyan" | "orange";
}) {
  const accentMap: Record<string, string> = {
    blue: "border-sky-400/25 bg-sky-500/10",
    green: "border-emerald-400/25 bg-emerald-500/10",
    cyan: "border-cyan-400/25 bg-cyan-500/10",
    orange: "border-orange-400/25 bg-orange-500/10",
  };

  return (
    <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
      <div className={"inline-flex items-center gap-2 rounded-2xl px-3 py-1.5 text-xs border " + accentMap[props.accent]}>
        <span className="text-base">{props.icon}</span>
        <span className="font-semibold">{props.title}</span>
      </div>
      <div className="mt-3 text-sm text-white/70">{props.desc}</div>
    </div>
  );
}