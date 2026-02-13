"use client";

export const dynamic = "force-dynamic";

import * as React from "react";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function PassengerDashboardPage() {
  // JRIDE_BFCACHE_GUARD_BEGIN
  React.useEffect(() => {
    const onShow = () => {
      fetch("/api/auth/session", { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (!j) window.location.reload();
        })
        .catch(() => {});
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  // JRIDE_BFCACHE_GUARD_END

  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [authed, setAuthed] = React.useState(false);
  const [verified, setVerified] = React.useState(false);
  const [nightAllowed, setNightAllowed] = React.useState(false);

  const [freeRideStatus, setFreeRideStatus] = React.useState<string>("unknown");
  const [freeRideMsg, setFreeRideMsg] = React.useState<string>("");
React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/public/auth/session", { cache: "no-store" });
        const j: any = await r.json().catch(() => ({}));
        if (!alive) return;
        const ok = !!j?.authed;
        setAuthed(ok);
                // JRIDE: derive verified/nightGate from can-book (source of truth)
        try {
          const cr = await fetch("/api/public/passenger/can-book", { cache: "no-store" });
          const cj = await cr.json();
          setVerified(!!cj?.verified);
          // "night_allowed" means "night booking allowed now" (i.e., gate OFF or verified)
          setNightAllowed(!cj?.nightGate || !!cj?.verified);
        } catch {
          // fallback (do not hard-fail dashboard)
          setVerified(false);
          setNightAllowed(false);
        }
        

        // Free ride promo status (audit-backed)
        try {
          if (!!j?.authed) {
            const rr = await fetch("/api/public/passenger/free-ride", { cache: "no-store" });
            const jj: any = await rr.json().catch(() => ({}));
            const st = String(jj?.free_ride?.status || jj?.free_ride?.status === 0 ? jj?.free_ride?.status : jj?.free_ride?.status || jj?.free_ride?.status || jj?.free_ride?.status).trim();
            const status = st && st !== "undefined" ? st : String(jj?.free_ride?.status || jj?.free_ride?.status || "none");
            setFreeRideStatus(String(jj?.free_ride?.status || "none"));

            const disc = Number(jj?.free_ride?.discount_php ?? 35);
            if (!jj?.authed) {
              setFreeRideMsg("");
            } else if (!jj?.verified) {
              setFreeRideMsg("Verify your account to unlock the free ride (PHP " + disc + ") and to book from 8PM-5AM.");
            } else {
              const s2 = String(jj?.free_ride?.status || "none");
              if (s2 === "eligible") setFreeRideMsg("You have a free ride (PHP " + disc + "). Use it now.");
              else if (s2 === "used") setFreeRideMsg("Free ride already used.");
              else if (s2 === "forfeited") setFreeRideMsg("Free ride forfeited (booked while unverified).");
              else setFreeRideMsg("Free ride available after verification (first ride only).");
            }
          }
        } catch {
          // ignore
        }
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

  function goVerify() {
    if (!authed) return gotoLogin();
    router.push("/verification");
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
{/* JRIDE_SIGNOUT_BUTTON_BEGIN */}
<button
  type="button"
  className="ml-2 rounded border px-3 py-1 text-xs hover:bg-gray-50"
  onClick={async () => {
    await signOut({ redirect: false });
    window.location.href = "/auth/signin";
  }}
>
  Sign out
</button>
{/* JRIDE_SIGNOUT_BUTTON_END */}
          </div>
        </div>

        {!authed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">
            <div className="font-semibold">Sign in required</div>
            <div className="opacity-80">To book a ride, please sign in first.</div>
          </div>
        ) : null}

        {authed ? (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-slate-800">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold">{verified ? "Account verified" : (nightAllowed ? "Verification recommended" : "Verification required (night booking)")}</div>
                <div className="opacity-80 text-xs mt-1">
                  Verified: {String(verified)} | Night allowed: {String(nightAllowed)}
                </div>
                <div className="opacity-80 text-xs mt-2">
                  {freeRideMsg || (verified ? "First ride promo status will appear here." : "Verification unlocks free ride promo. Night booking (8PMÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€¦Ã¢â‚¬Å“5AM) requires verification.")}
                </div>
              </div>
              <button
                type="button"
                onClick={goVerify}
                disabled={verified}
                className={
                  "rounded-xl px-4 py-2 font-semibold " +
                  (verified ? "bg-black/5 text-black/40 cursor-not-allowed" : "bg-emerald-600 text-white hover:bg-emerald-500")
                }
              >
                {verified ? "Verified" : "Verify account"}
              </button>
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

          {authed && !verified ? (
            <button
              type="button"
              onClick={goVerify}
              className="rounded-xl border border-emerald-600 text-emerald-700 hover:bg-emerald-50 px-5 py-2 font-semibold"
            >
              Verify now
            </button>
          ) : null}
        </div>

        <div className="mt-4 text-xs opacity-70">
          Note: Next step is to connect verification + night rules (8PM-5AM).
        </div>
      </div>
    </main>
  );
}