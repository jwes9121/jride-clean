"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

type Sess = {
  ok?: boolean;
  authed?: boolean;
  role?: string;
  user?: any;
};

export default function PassengerVerificationPage() {
  const router = useRouter();

  const [sess, setSess] = React.useState<Sess>({ ok: false, authed: false });
  const [loading, setLoading] = React.useState<boolean>(true);

  // Your existing form state can remain server-side later; for now we just fix session detection.
  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const r = await fetch("/api/public/auth/session", { cache: "no-store" });
        const j = (await r.json().catch(() => ({}))) as Sess;
        if (!alive) return;
        setSess(j || { ok: false, authed: false });
      } catch {
        if (!alive) return;
        setSess({ ok: false, authed: false });
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const authed = !!sess?.authed;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-black/10 p-6 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-lg font-semibold">Passenger Verification</div>
            <div className="text-xs opacity-70 mt-1">
              Verification is required to unlock night booking (8PM-5AM) and free ride promo.
            </div>
          </div>
          <button
            className="rounded-xl border border-black/10 px-3 py-2 text-sm"
            onClick={() => router.back()}
          >
            Back
          </button>
        </div>

        <div className="mt-4 rounded-xl border border-black/10 bg-slate-50 p-3 text-sm">
          {loading ? (
            <div>Checking sessionâ€¦</div>
          ) : authed ? (
            <div>
              Signed in as: <span className="font-mono">{String(sess?.user?.id || "")}</span>
            </div>
          ) : (
            <div className="text-red-600">Please sign in first.</div>
          )}
        </div>

        <div className="mt-4 text-sm opacity-70">
          This patch only fixes session detection on this page (so it stops saying youâ€™re not signed in).
          Your existing verification upload logic can remain as-is.
        </div>
      </div>
    </div>
  );
}
