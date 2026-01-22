"use client";

export const dynamic = "force-dynamic";

import * as React from "react";
import { useRouter } from "next/navigation";

type Choice = "ride" | "takeout" | "errand";

type PassengerSession = {
  ok?: boolean;
  user?: any;
  role?: string;
  verified?: boolean;
  [k: string]: any;
};

export default function PassengerDashboardPage() {
  const router = useRouter();

  const [choice, setChoice] = React.useState<Choice>("ride");
  const [loading, setLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [sess, setSess] = React.useState<PassengerSession | null>(null);

  async function loadSession() {
    setLoading(true);
    try {
      const r = await fetch("/api/public/auth/session", { cache: "no-store" });
      const j: PassengerSession = await r.json().catch(() => ({} as any));
      const ok = !!(r.ok && (j?.ok ?? true) && (j?.user || j?.role === "passenger"));
      setAuthed(ok);
      setSess(j || null);
    } catch {
      setAuthed(false);
      setSess(null);
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    loadSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go() {
    if (!authed) {
      router.push("/passenger-login?next=" + encodeURIComponent("/passenger"));
      return;
    }
    if (choice === "ride") router.push("/ride");
    if (choice === "takeout") router.push("/takeout");
    if (choice === "errand") router.push("/errand");
  }

  function Card(props: { id: Choice; title: string; desc: string }) {
    const active = choice === props.id;
  const dbg = {
    note: "TEMP DEBUG",
    time: new Date().toISOString(),
  };

  return (
      <button
        type="button"
        onClick={() => setChoice(props.id)}
        className={
          "text-left rounded-xl border px-4 py-3 transition " +
          (active
            ? "border-blue-500 bg-blue-500/10"
            : "border-black/10 bg-white hover:bg-black/5")
        }
      >
        <div className="font-semibold">{props.title}</div>
        <div className="text-sm opacity-70">{props.desc}</div>
      </button>
    );
  }

  const verified = !!sess?.verified;
  const dbg = {
    note: "TEMP DEBUG",
    time: new Date().toISOString(),
  };

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
            <span className="opacity-70">{" Ãƒâ€šÃ‚Â· "}{loading ? "loading" : authed ? "session" : "no session"}</span>
          </div>
        </div>

        {!authed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <div className="font-semibold">Sign in required</div>
            <div className="opacity-80">To book a ride, takeout, or errand, please sign in first.</div>
          </div>
        ) : null}

        {authed && !verified ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-800">
            <div className="font-semibold">Verification may be required (8PMÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“5AM)</div>
            <div className="opacity-80 text-xs mt-1">
              If booking is blocked at night, your account likely needs approval. Next: add a ÃƒÂ¢Ã¢â€šÂ¬Ã…â€œComplete Profile / VerifyÃƒÂ¢Ã¢â€šÂ¬Ã‚Â flow.
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
          <Card id="ride" title="Book Ride" desc="Go to ride booking" />
          <Card id="takeout" title="Takeout" desc="Food delivery (pilot)" />
          <Card id="errand" title="Errands" desc="Pabili / padala (pilot)" />
        </div>

        <div className="mt-5 rounded-2xl border border-black/10 bg-white p-4">
          <div className="font-semibold text-sm mb-2">What happens next</div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
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
            onClick={() => router.push("/passenger-login?next=" + encodeURIComponent("/passenger"))}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
            title="Use this if you want to switch accounts"
          >
            Switch Account
          </button>

          {authed ? (
            <button
              type="button"
              onClick={loadSession}
              className="rounded-xl border border-black/10 hover:bg-black/5 px-5 py-2 font-semibold"
              title="Refresh session state"
            >
              Refresh
            </button>
          ) : null}
        </div>

        <div className="mt-4 text-xs opacity-70">
          Note: Next step is to connect verification + night rules (8PMÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Å“5AM).
        </div>

        <div className="mt-4 rounded-xl border border-black/10 bg-black/5 p-3 text-xs">
          <div className="font-semibold mb-1">DEBUG: /api/public/auth/session</div>
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(dbg, null, 2)}</pre>
        </div>
      </div>
    </main>
  );
}