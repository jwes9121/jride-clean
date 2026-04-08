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
{/* === DRIVER PERFORMANCE === */}
<div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold text-slate-700">Driver Performance</h2>
    <span className="text-xs text-slate-400">Completed trips, payout, platform revenue, ratings</span>
  </div>

  <DriverPerformanceAnalytics />
</div>


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


{/* === TRIP ANALYTICS === */}
<div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold text-slate-700">Trip Analytics</h2>
  </div>

  <TripAnalytics />
</div>



{/* === LOW-RATED DRIVER WATCHLIST === */}
<div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold text-slate-700">Low-rated Driver Watchlist</h2>
    <span className="text-xs text-slate-400">Drivers needing coaching or quality review</span>
  </div>

  <LowRatedDriverWatchlist />
</div>


{/* === RATING COVERAGE GAPS === */}
<div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold text-slate-700">Zero-rating Completed-trip Gap Checker</h2>
    <span className="text-xs text-slate-400">Completed trips with missing passenger rating records</span>
  </div>

  <RatingCoverageGapChecker />
</div>


{/* === RATING CAPTURE AUDIT === */}
<div className="mt-6 rounded-2xl border bg-white p-4 shadow-sm">
  <div className="mb-3 flex items-center justify-between">
    <h2 className="text-sm font-semibold text-slate-700">Rating Capture Audit</h2>
    <span className="text-xs text-slate-400">Trace missing or delayed passenger ratings</span>
  </div>

  <RatingCaptureAuditPanel />
</div>

</main>
  );
}


type RatingsSnapshotResponse = {
  ok?: boolean;
  stats?: {
    total_ratings?: number | null;
    average_rating?: number | null;
    with_feedback?: number | null;
    five_star_share?: number | null;
  };
};

function RatingsSnapshot() {
  const [data, setData] = React.useState<RatingsSnapshotResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/ratings?limit=5", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({} as RatingsSnapshotResponse));
        if (!cancelled) {
          setData(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ ok: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>;
  }

  const stats = data.stats || {};

  return (
    <div className="grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
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
        <div className="text-slate-400">5-star Share</div>
        <div className="font-semibold">
          {stats.five_star_share != null ? Math.round(stats.five_star_share * 100) + "%" : "-"}
        </div>
      </div>
    </div>
  );
}


type TripAnalyticsRow = {
  town: string;
  total_trips: number;
  total_revenue: number;
};

type TripAnalyticsResponse = {
  ok?: boolean;
  rows?: TripAnalyticsRow[];
};

function TripAnalytics() {
  const [data, setData] = React.useState<TripAnalyticsResponse | null>(null);

  React.useEffect(() => {
    fetch("/api/admin/analytics/trips", { cache: "no-store" })
      .then(r => r.json())
      .then(setData)
      .catch(() => setData({ ok: false }));
  }, []);

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>;
  }

  const rows = data.rows || [];

  return (
    <div className="text-xs">
      <table className="w-full border text-left">
        <thead>
          <tr className="bg-slate-50">
            <th className="p-2 border">Town</th>
            <th className="p-2 border">Trips</th>
            <th className="p-2 border">Revenue</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="p-2 border">{r.town}</td>
              <td className="p-2 border">{r.total_trips}</td>
              <td className="p-2 border">
                PHP {Number(r.total_revenue || 0).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


type DriverPerformanceRow = {
  driver_id?: string;
  driver_name?: string;
  municipality?: string;
  completed_trips?: number;
  total_driver_payout?: number;
  total_platform_revenue?: number;
  ratings_count?: number;
  average_rating?: number | null;
};

type DriverPerformanceResponse = {
  ok?: boolean;
  rows?: DriverPerformanceRow[];
};

function DriverPerformanceAnalytics() {
  const [data, setData] = React.useState<DriverPerformanceResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/analytics/drivers?limit=8", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({} as DriverPerformanceResponse));
        if (!cancelled) {
          setData(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ ok: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];

  if (rows.length === 0) {
    return <div className="text-xs text-slate-400">No completed-trip driver analytics found.</div>;
  }

  return (
    <div className="overflow-x-auto text-xs">
      <table className="w-full border text-left">
        <thead>
          <tr className="bg-slate-50">
            <th className="border p-2">Driver</th>
            <th className="border p-2">Town</th>
            <th className="border p-2">Completed</th>
            <th className="border p-2">Driver payout</th>
            <th className="border p-2">Platform revenue</th>
            <th className="border p-2">Avg rating</th>
            <th className="border p-2">Ratings</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.driver_id || r.driver_name || Math.random())}>
              <td className="border p-2">{r.driver_name || "Unknown Driver"}</td>
              <td className="border p-2">{r.municipality || "-"}</td>
              <td className="border p-2">{Number(r.completed_trips || 0)}</td>
              <td className="border p-2">PHP {Number(r.total_driver_payout || 0).toFixed(2)}</td>
              <td className="border p-2">PHP {Number(r.total_platform_revenue || 0).toFixed(2)}</td>
              <td className="border p-2">
                {r.average_rating != null ? Number(r.average_rating).toFixed(2) : "-"}
              </td>
              <td className="border p-2">{Number(r.ratings_count || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type DriverWatchlistRow = {
  driver_id?: string;
  driver_name?: string;
  municipality?: string;
  completed_trips?: number;
  ratings_count?: number;
  average_rating?: number | null;
  low_ratings_count?: number;
  latest_feedback?: string | null;
  latest_rating_at?: string | null;
};

type DriverWatchlistResponse = {
  ok?: boolean;
  rows?: DriverWatchlistRow[];
};

function LowRatedDriverWatchlist() {
  const [data, setData] = React.useState<DriverWatchlistResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/analytics/driver-watchlist?limit=6&max_average=4", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({} as DriverWatchlistResponse));
        if (!cancelled) {
          setData(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ ok: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>;
  }

  const rows = Array.isArray(data.rows) ? data.rows : [];

  if (rows.length === 0) {
    return <div className="text-xs text-slate-400">No drivers currently meet the watchlist threshold.</div>;
  }

  return (
    <div className="overflow-x-auto text-xs">
      <table className="w-full border text-left">
        <thead>
          <tr className="bg-slate-50">
            <th className="border p-2">Driver</th>
            <th className="border p-2">Town</th>
            <th className="border p-2">Avg rating</th>
            <th className="border p-2">Ratings</th>
            <th className="border p-2">Low ratings</th>
            <th className="border p-2">Completed</th>
            <th className="border p-2">Latest feedback</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.driver_id || r.driver_name || Math.random())}>
              <td className="border p-2">{r.driver_name || "Unknown Driver"}</td>
              <td className="border p-2">{r.municipality || "-"}</td>
              <td className="border p-2">
                {r.average_rating != null ? Number(r.average_rating).toFixed(2) : "-"}
              </td>
              <td className="border p-2">{Number(r.ratings_count || 0)}</td>
              <td className="border p-2">{Number(r.low_ratings_count || 0)}</td>
              <td className="border p-2">{Number(r.completed_trips || 0)}</td>
              <td className="border p-2">{r.latest_feedback || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
type RatingCoverageGapRow = {
  booking_id?: string | null;
  booking_code?: string | null;
  town?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  passenger_name?: string | null;
  completed_at?: string | null;
};

type RatingCoverageGapTownRow = {
  town?: string | null;
  completed_trips?: number;
  rated_trips?: number;
  missing_ratings?: number;
  coverage_pct?: number;
};

type RatingCoverageGapResponse = {
  ok?: boolean;
  summary?: {
    completed_trips?: number;
    rated_trips?: number;
    missing_ratings?: number;
  };
  summary_by_town?: RatingCoverageGapTownRow[];
  rows?: RatingCoverageGapRow[];
};

function RatingCoverageGapChecker() {
  const [data, setData] = React.useState<RatingCoverageGapResponse | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/analytics/rating-coverage-gaps?limit=8", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (r) => {
        const j = await r.json().catch(() => ({} as RatingCoverageGapResponse));
        if (!cancelled) {
          setData(j);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setData({ ok: false });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>;
  }

  const summary = data.summary || {};
  const rows = Array.isArray(data.rows) ? data.rows : [];
  const townRows = Array.isArray(data.summary_by_town) ? data.summary_by_town.slice(0, 5) : [];

  return (
    <div className="space-y-3 text-xs">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border p-3">
          <div className="text-slate-400">Completed trips checked</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{Number(summary.completed_trips || 0)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-slate-400">Trips with ratings</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{Number(summary.rated_trips || 0)}</div>
        </div>
        <div className="rounded border p-3">
          <div className="text-slate-400">Missing rating records</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{Number(summary.missing_ratings || 0)}</div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border text-left">
          <thead>
            <tr className="bg-slate-50">
              <th className="border p-2">Town</th>
              <th className="border p-2">Completed</th>
              <th className="border p-2">Rated</th>
              <th className="border p-2">Missing</th>
              <th className="border p-2">Coverage</th>
            </tr>
          </thead>
          <tbody>
            {townRows.map((r, i) => (
              <tr key={String(r.town || i)}>
                <td className="border p-2">{r.town || "Unknown"}</td>
                <td className="border p-2">{Number(r.completed_trips || 0)}</td>
                <td className="border p-2">{Number(r.rated_trips || 0)}</td>
                <td className="border p-2">{Number(r.missing_ratings || 0)}</td>
                <td className="border p-2">
                  {r.coverage_pct != null ? Math.round(Number(r.coverage_pct) * 100) + "%" : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border text-left">
          <thead>
            <tr className="bg-slate-50">
              <th className="border p-2">Booking code</th>
              <th className="border p-2">Town</th>
              <th className="border p-2">Driver</th>
              <th className="border p-2">Passenger</th>
              <th className="border p-2">Completed at</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="border p-2 text-slate-400" colSpan={5}>No completed-trip rating gaps found.</td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={String(r.booking_id || r.booking_code || Math.random())}>
                  <td className="border p-2">{r.booking_code || "-"}</td>
                  <td className="border p-2">{r.town || "-"}</td>
                  <td className="border p-2">{r.driver_name || "Unknown Driver"}</td>
                  <td className="border p-2">{r.passenger_name || "Unknown Passenger"}</td>
                  <td className="border p-2">{r.completed_at || "-"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
type RatingAuditRow = {
  booking_code?: string;
  town?: string;
  driver_name?: string;
  passenger_name?: string;
  completed_at?: string;
  rated_at?: string | null;
  rating_delay_minutes?: number | null;
};

type RatingAuditResponse = {
  ok?: boolean;
  stats?: {
    total_completed?: number;
    total_rated?: number;
    missing?: number;
  };
  rows?: RatingAuditRow[];
};

function RatingCaptureAuditPanel() {
  const [data, setData] = React.useState<RatingAuditResponse | null>(null);

  React.useEffect(() => {
    fetch("/api/admin/analytics/rating-capture-audit?limit=10", {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ ok: false }));
  }, []);

  if (!data || !data.ok) {
    return <div className="text-xs text-slate-400">Loading...</div>;
  }

  const stats = data.stats || {};
  const rows = data.rows || [];

  return (
    <div className="text-xs space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <div className="border p-2 rounded">Completed: {stats.total_completed || 0}</div>
        <div className="border p-2 rounded">Rated: {stats.total_rated || 0}</div>
        <div className="border p-2 rounded">Missing: {stats.missing || 0}</div>
      </div>

      <table className="w-full border">
        <thead>
          <tr className="bg-slate-50">
            <th className="p-2 border">Code</th>
            <th className="p-2 border">Town</th>
            <th className="p-2 border">Driver</th>
            <th className="p-2 border">Passenger</th>
            <th className="p-2 border">Completed</th>
            <th className="p-2 border">Rated</th>
            <th className="p-2 border">Delay(min)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="p-2 border">{r.booking_code}</td>
              <td className="p-2 border">{r.town}</td>
              <td className="p-2 border">{r.driver_name}</td>
              <td className="p-2 border">{r.passenger_name}</td>
              <td className="p-2 border">{r.completed_at}</td>
              <td className="p-2 border">{r.rated_at || "-"}</td>
              <td className="p-2 border">{r.rating_delay_minutes ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}