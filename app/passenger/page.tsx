"use client";

export const dynamic = "force-dynamic";

import * as React from "react";
import { useRouter } from "next/navigation";

export default function PassengerDashboardPage() {
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [verified, setVerified] = React.useState(false);
  const [nightAllowed, setNightAllowed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", { cache: "no-store" });
        const j: any = await r.json().catch(() => ({}));
        if (!alive) return;
        const ok = !!j?.authed;
        setAuthed(ok);
        setVerified(!!j?.user?.verified);
        setNightAllowed(!!j?.user?.night_allowed);
      } catch {
        if (!alive) return;
        setAuthed(false);
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function gotoLogin() {
    router.push("/passenger-login");
  }

  function goBookRide() {
    if (!authed) return gotoLogin();
    router.push("/ride");
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
            <span className="opacity-70">{" - "}{loading ? "loading" : authed ? "session ok" : "no session"}</span>
          </div>
        </div>

        {!authed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <div className="font-semibold">Sign in required</div>
            <div className="opacity-80">To book a ride, please sign in first.</div>
          </div>
        ) : null}

        {authed && !verified ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
            <div className="font-semibold">Verification may be required (8PM-5AM)</div>
            <div className="opacity-80 text-xs mt-1">
              Verified: {String(verified)} | Night allowed: {String(nightAllowed)}
            </div>
            <div className="opacity-80 text-xs mt-1">
              Next: add Complete Profile / Submit for approval.
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <button
            type="button"
            onClick={goBookRide}
            className="text-left rounded-xl border border-blue-500 bg-blue-500/10 px-4 py-3"
          >
            <div className="font-semibold">Book Ride</div>
            <div className="text-sm opacity-70">Go to ride booking</div>
          </button>

          <button
            type="button"
            onClick={() => (authed ? router.push("/takeout") : gotoLogin())}
            className="text-left rounded-xl border border-black/10 bg-white hover:bg-black/5 px-4 py-3"
          >
            <div className="font-semibold">Takeout</div>
            <div className="text-sm opacity-70">Food delivery (pilot)</div>
          </button>

          <button
            type="button"
            onClick={() => (authed ? router.push("/errand") : gotoLogin())}
            className="text-left rounded-xl border border-black/10 bg-white hover:bg-black/5 px-4 py-3"
          >
            <div className="font-semibold">Errands</div>
            <div className="text-sm opacity-70">Pabili / padala (pilot)</div>
          </button>
        </div>

        <div className="mt-5 flex gap-3">
          <button
            type="button"
            onClick={() => (authed ? router.push("/ride") : gotoLogin())}
            disabled={loading}
            className={
              "rounded-xl px-5 py-2 font-semibold text-white " +
              (loading ? "bg-blue-600/60 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-500")
            }
          >
            {loading ? "Loading..." : authed ? "Continue" : "Sign in to continue"}
          </button>

          <button
            type="button"
            onClick={gotoLogin}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
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