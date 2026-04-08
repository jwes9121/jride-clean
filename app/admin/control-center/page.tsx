"use client";

import * as React from "react";

type AnyObj = Record<string, any>;

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function Tile({
  title,
  desc,
  href,
  badge,
  disabled,
  right,
}: {
  title: string;
  desc?: string;
  href?: string;
  badge?: string | number | null;
  disabled?: boolean;
  right?: React.ReactNode;
}) {
  const body = (
    <div className={cn("rounded-2xl border border-black/10 p-4 bg-white", disabled && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{title}</div>
          {desc ? <div className="text-xs opacity-70 mt-1">{desc}</div> : null}
        </div>

        <div className="flex items-center gap-2">
          {badge !== null && badge !== undefined ? (
            <div className="rounded-full border border-black/10 bg-black/5 px-2.5 py-1 text-xs font-semibold">
              {badge}
            </div>
          ) : null}
          {right}
        </div>
      </div>

      {href ? (
        <div className="mt-3">
          <a
            href={href}
            className={cn(
              "inline-flex rounded-xl px-4 py-2 font-semibold border border-black/10",
              disabled ? "bg-slate-100 text-slate-500 pointer-events-none" : "hover:bg-black/5"
            )}
          >
            Open
          </a>
        </div>
      ) : null}
    </div>
  );

  return body;
}

async function safeJson(url: string): Promise<AnyObj | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => null);
    if (!r.ok) return null;
    return j || null;
  } catch {
    return null;
  }
}

export default function AdminControlCenter() {
  const [role, setRole] = React.useState<string>("admin");
  const isDispatcher = role === "dispatcher";

  const [loading, setLoading] = React.useState(true);
  const [msg, setMsg] = React.useState<string>("");
  const [pendingVerifications, setPendingVerifications] = React.useState<number>(0);
  const [ratingsCount, setRatingsCount] = React.useState<number>(0);
  const [ratingsAverage, setRatingsAverage] = React.useState<number>(0);
  const [lastRefresh, setLastRefresh] = React.useState<string>("");

  React.useEffect(() => {
    try {
      const qs = new URLSearchParams(window.location.search);
      const r = (qs.get("role") || "admin").toLowerCase();
      setRole(r);
    } catch {
      setRole("admin");
    }
  }, []);

  async function load() {
    setLoading(true);
    setMsg("");

    try {
      const verification = await safeJson("/api/admin/verification/pending");
      if (verification?.ok && Array.isArray(verification.rows)) {
        setPendingVerifications(verification.rows.length);
      } else {
        setPendingVerifications(0);
      }

      const ratings = await safeJson("/api/admin/ratings?limit=1");
      if (ratings?.ok && ratings.stats) {
        setRatingsCount(Number(ratings.stats.total || 0));
        setRatingsAverage(Number(ratings.stats.average_rating || 0));
      } else {
        setRatingsCount(0);
        setRatingsAverage(0);
      }

      setLastRefresh(new Date().toLocaleString());
    } catch (e: any) {
      setMsg(e?.message || "Failed to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    let alive = true;

    const safeLoad = () => {
      if (!alive) return;
      load();
    };

    safeLoad();

    const onFocus = () => safeLoad();
    const onVis = () => {
      if (document.visibilityState === "visible") safeLoad();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVis);

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== "undefined" && "BroadcastChannel" in window) {
        bc = new BroadcastChannel("jride_verification");
        bc.onmessage = (ev: any) => {
          if (ev?.data?.type === "pending_changed") safeLoad();
        };
      }
    } catch {}

    const onStorage = (e: StorageEvent) => {
      if (e.key === "jride_verification_pending_changed") safeLoad();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
      try {
        bc?.close();
      } catch {}
    };
  }, []);

  return (
    <main className="min-h-screen p-6 bg-white">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-2xl font-bold">Admin Control Center</div>
            <div className="text-sm opacity-70 mt-1">
              Operations dashboard (counts are live). Role: {role}
              {lastRefresh ? <span className="ml-2">Last refresh: {lastRefresh}</span> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="rounded-xl border border-black/10 hover:bg-black/5 px-4 py-2 font-semibold"
          >
            Refresh
          </button>
        </div>

        {msg ? <div className="mt-4 text-sm text-amber-700">{msg}</div> : null}

        <div className="mt-6">
          <div className="text-sm font-semibold mb-2">Operations</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="LiveTrips"
              desc="Live map + active trips monitoring."
              href="/admin/livetrips"
            />
            <Tile
              title="Dispatch"
              desc="Manual assign & trip actions dashboard."
              href="/admin/dispatch"
            />
            <Tile
              title="Passenger Ride"
              desc="Passenger booking UI (for quick checks)."
              href="/ride"
            />
          </div>
        </div>

        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">Queues</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Passenger Verifications (Admin)"
              desc="Approve / reject verification requests (final authority)."
              href="/admin/verification"
              badge={loading ? "-" : pendingVerifications}
              disabled={isDispatcher}
              right={
                isDispatcher ? (
                  <div className="text-xs rounded-full bg-slate-100 border border-black/10 px-2 py-1">
                    admin-only
                  </div>
                ) : null
              }
            />
            <Tile
              title="Passenger Verifications (Dispatcher)"
              desc="Read-only pre-screen queue view."
              href="/admin/dispatcher-verifications"
              badge={loading ? "-" : pendingVerifications}
            />
            <Tile
              title="Wallet Adjust"
              desc="Manual wallet adjustments / admin tools."
              href="/admin/wallet-adjust"
            />
          </div>
        </div>

        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">Finance</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Finance Summary"
              desc="High-level finance dashboards."
              href="/admin/finance/summary"
            />
            <Tile
              title="Driver Payouts"
              desc="Approve/track driver payout requests."
              href="/admin/driver-payouts"
            />
            <Tile
              title="Vendor Payouts"
              desc="Approve/track vendor payout requests."
              href="/admin/vendor-payouts"
            />
          </div>
          <div className="text-xs opacity-60 mt-2">
            Note: Some pages may be work-in-progress depending on your current branch.
          </div>
        </div>

        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">Quality</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Trip Ratings"
              desc="Read-only completed-trip passenger feedback analytics."
              href="/admin/ratings"
              badge={loading ? "-" : ratingsCount}
              right={
                <div className="text-xs rounded-full bg-slate-100 border border-black/10 px-2 py-1">
                  avg {loading ? "-" : ratingsAverage.toFixed(2)}
                </div>
              }
            />
          </div>
        </div>

        <div className="mt-8">
          <div className="text-sm font-semibold mb-2">System</div>
          <div className="grid gap-4 md:grid-cols-3">
            <Tile
              title="Admin Profile / Auth Check"
              desc="Quick auth sanity checks."
              href="/api/auth/session"
            />
            <Tile
              title="Verification API (pending)"
              desc="Raw JSON view (debug)."
              href="/api/admin/verification/pending"
            />
            <Tile
              title="Notes"
              desc="Dispatcher gating is still UI-only until we enforce server checks in decide route."
              badge={null}
            />
          </div>
        </div>

        {isDispatcher ? (
          <div className="mt-8 text-xs text-slate-600">
            Dispatcher mode: Admin approve/reject tiles are disabled here (UI). Next step is server enforcement in decide route.
          </div>
        ) : null}
      </div>
    
{/* === RATINGS SNAPSHOT === */}
<div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold text-slate-700">Ratings Snapshot</h2>
    <a href="/admin/ratings" className="text-xs text-emerald-600 hover:underline">
      View full
    </a>
  </div>

  <RatingsSnapshot />
</div>

</main>
  );
}


function RatingsSnapshot() {
  const [data, setData] = React.useState(null)

  React.useEffect(() => {
    fetch("/api/admin/ratings?limit=5")
      .then(r => r.json())
      .then(setData)
      .catch(() => {})
  }, [])

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>
  }

  const stats = data.stats || {}

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
      <div className="rounded border p-2">
        <div className="text-slate-400">Total</div>
        <div className="font-semibold">{stats.total_ratings || 0}</div>
      </div>

      <div className="rounded border p-2">
        <div className="text-slate-400">Avg</div>
        <div className="font-semibold">{stats.average_rating || 0}</div>
      </div>

      <div className="rounded border p-2">
        <div className="text-slate-400">With Feedback</div>
        <div className="font-semibold">{stats.with_feedback || 0}</div>
      </div>

      <div className="rounded border p-2">
        <div className="text-slate-400">5â˜… Share</div>
        <div className="font-semibold">
          {stats.five_star_share ? Math.round(stats.five_star_share * 100) + "%" : "-"}
        </div>
      </div>
    </div>
  )
}

