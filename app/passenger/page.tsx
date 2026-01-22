"use client";

export const dynamic = "force-dynamic";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

type Choice = "ride" | "takeout" | "errand";

export default function PassengerDashboardPage() {
  const router = useRouter();
    const _sess: any = (useSession as any)?.() ?? {};
  const session = _sess?.data;
  const status = _sess?.status ?? "unknown";

  const authed = !!session?.user;
  const [choice, setChoice] = React.useState<Choice>("ride");

  function go() {
    // Safe gating: ONLY redirect on action (no JSX guard blocks)
    if (!authed) {
      const cb = encodeURIComponent("/passenger");
      window.location.href = "/passenger-login" + cb;
      return;
    }

    if (choice === "ride") router.push("/ride");
    if (choice === "takeout") router.push("/takeout");
    if (choice === "errand") router.push("/errand");
  }

  function Card(props: { id: Choice; title: string; desc: string }) {
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold mb-1">Passenger Dashboard</h1>
            <p className="text-sm opacity-70 mb-5">Choose what you want to do.</p>
          </div>

          <div className="text-xs rounded-full border border-black/10 px-3 py-1">
                        <span className="font-semibold">{authed ? "Signed in" : "Guest"}</span>
                                    <span className="opacity-70">
              {" · "}
              {status === "authenticated" ? "authenticated" : status === "unauthenticated" ? "unauthenticated" : "loading"}
            </span>          </div>
        </div>

<div className="mt-2 text-xs">
  {/* P7A_GUEST_HINT */}
  {!authed ? (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
      <div className="font-semibold">Sign in required</div>
      <div className="opacity-80">To book a ride, takeout, or errand, please sign in first.</div>
    </div>
  ) : null}
</div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card id="ride" title="Book Ride" desc="Go to ride booking" />
          <Card id="takeout" title="Takeout" desc="Food delivery (pilot)" />
          <Card id="errand" title="Errands" desc="Pabili / padala (pilot)" />
        </div>

{/* P7A_STEPPER */}
<div className="mt-5 rounded-2xl border border-black/10 bg-white p-4">
  <div className="flex items-start justify-between gap-3">
    <div>
      <div className="text-sm font-semibold">What happens next</div>
      <div className="text-xs opacity-70">A quick guide so the flow feels predictable.</div>
    </div>
    <div className="text-[11px] rounded-full border border-black/10 px-2 py-1 opacity-70">Passenger UX</div>
  </div>

  <div className="mt-3 grid grid-cols-1 md:grid-cols-4 gap-2">
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">1) Choose</div>
      <div className="text-xs opacity-70 mt-1">Pick Ride, Takeout, or Errand.</div>
    </div>
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">2) Confirm</div>
      <div className="text-xs opacity-70 mt-1">Review pickup fee + platform fee.</div>
    </div>
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">3) Match</div>
      <div className="text-xs opacity-70 mt-1">We look for the nearest available driver.</div>
    </div>
    <div className="rounded-xl border border-black/10 p-3">
      <div className="text-xs font-semibold">4) Track</div>
      <div className="text-xs opacity-70 mt-1">See driver status until completion.</div>
    </div>
  </div>
</div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={go}
            disabled={status === "loading"}
            title={
              status === "loading"
                ? "Loading sessionâ€¦"
                : authed
                ? "Continue"
                : "Sign in to continue"
            }
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (status === "loading"
                ? "bg-blue-600/60 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {status === "loading" ? "Loadingâ€¦" : authed ? "Continue" : "Sign in to continue"}
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
