"use client";

import * as React from "react";

type RatingRow = {
  id?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  driver_id?: string | null;
  passenger_id?: string | null;
  rating?: number | null;
  feedback?: string | null;
  created_at?: string | null;
};

type RatingsResponse = {
  ok?: boolean;
  rows?: RatingRow[];
  stats?: {
    total?: number;
    average_rating?: number;
    with_feedback?: number;
    by_star?: {
      star_5?: number;
      star_4?: number;
      star_3?: number;
      star_2?: number;
      star_1?: number;
    };
  };
  error?: string;
  message?: string;
  details?: string;
};

function statCard(label: string, value: string | number) {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function asText(v: unknown) {
  return String(v ?? "").trim();
}

function formatDate(v?: string | null) {
  const s = asText(v);
  if (!s) return "-";
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return s;
  return d.toLocaleString();
}

function starText(v?: number | null) {
  const n = Number(v || 0);
  if (!Number.isFinite(n) || n < 1) return "-";
  return "â˜…".repeat(Math.max(1, Math.min(5, Math.round(n))));
}

export default function AdminRatingsPage() {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [rows, setRows] = React.useState<RatingRow[]>([]);
  const [stats, setStats] = React.useState<RatingsResponse["stats"]>({});
  const [lastRefresh, setLastRefresh] = React.useState("");
  const [ratingFilter, setRatingFilter] = React.useState("all");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const qs = new URLSearchParams();
      qs.set("limit", "200");
      if (ratingFilter !== "all") qs.set("rating", ratingFilter);
      const r = await fetch("/api/admin/ratings?" + qs.toString(), { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as RatingsResponse;
      if (!r.ok || !j?.ok) {
        throw new Error(j?.message || j?.error || j?.details || "Failed to load ratings.");
      }
      setRows(Array.isArray(j.rows) ? j.rows : []);
      setStats(j.stats || {});
      setLastRefresh(new Date().toLocaleString());
    } catch (e: any) {
      setRows([]);
      setStats({});
      setError(String(e?.message || e || "Failed to load ratings."));
    } finally {
      setLoading(false);
    }
  }, [ratingFilter]);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <main className="min-h-screen bg-white p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-2xl font-bold text-slate-900">Admin Ratings</div>
            <div className="mt-1 text-sm text-slate-600">
              Completed-trip feedback analytics. Read-only layer only.
              {lastRefresh ? <span className="ml-2">Last refresh: {lastRefresh}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm"
              value={ratingFilter}
              onChange={(e) => setRatingFilter(e.target.value)}
            >
              <option value="all">All ratings</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars</option>
              <option value="3">3 stars</option>
              <option value="2">2 stars</option>
              <option value="1">1 star</option>
            </select>
            <button
              type="button"
              onClick={load}
              className="rounded-xl border border-black/10 px-4 py-2 font-semibold hover:bg-black/5"
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {statCard("Total ratings", loading ? "-" : Number(stats?.total || 0))}
          {statCard("Average rating", loading ? "-" : Number(stats?.average_rating || 0).toFixed(2))}
          {statCard("With feedback", loading ? "-" : Number(stats?.with_feedback || 0))}
          {statCard(
            "5-star share",
            loading || !Number(stats?.total || 0)
              ? "-"
              : (((Number(stats?.by_star?.star_5 || 0) / Number(stats?.total || 1)) * 100).toFixed(1) + "%")
          )}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-5">
          {statCard("5 stars", loading ? "-" : Number(stats?.by_star?.star_5 || 0))}
          {statCard("4 stars", loading ? "-" : Number(stats?.by_star?.star_4 || 0))}
          {statCard("3 stars", loading ? "-" : Number(stats?.by_star?.star_3 || 0))}
          {statCard("2 stars", loading ? "-" : Number(stats?.by_star?.star_2 || 0))}
          {statCard("1 star", loading ? "-" : Number(stats?.by_star?.star_1 || 0))}
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-black/10 bg-white">
          <div className="border-b border-black/10 px-4 py-3 text-sm font-semibold text-slate-900">
            Latest trip ratings
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-600">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Booking code</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Feedback</th>
                  <th className="px-4 py-3">Driver ID</th>
                  <th className="px-4 py-3">Passenger ID</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={6}>Loading ratings...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-slate-500" colSpan={6}>No trip ratings found.</td>
                  </tr>
                ) : (
                  rows.map((row, index) => (
                    <tr key={asText(row.id) || String(index)} className="border-t border-black/5 align-top">
                      <td className="px-4 py-3 text-slate-700">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{asText(row.booking_code) || "-"}</td>
                      <td className="px-4 py-3 text-slate-900">
                        <div className="font-semibold">{Number(row.rating || 0) || "-"}</div>
                        <div className="text-amber-600">{starText(row.rating)}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{asText(row.feedback) || "-"}</td>
                      <td className="px-4 py-3 text-slate-500">{asText(row.driver_id) || "-"}</td>
                      <td className="px-4 py-3 text-slate-500">{asText(row.passenger_id) || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
