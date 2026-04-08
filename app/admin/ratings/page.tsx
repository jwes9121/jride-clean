"use client";

import React, { useEffect, useMemo, useState } from "react";

type RatingRow = {
  id?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  rating?: number | null;
  feedback?: string | null;
  created_at?: string | null;
  driver_id?: string | null;
  passenger_id?: string | null;
};

type RatingsResponse = {
  ok?: boolean;
  error?: string;
  stats?: {
    total_ratings?: number | null;
    average_rating?: number | null;
    with_feedback?: number | null;
    stars_5?: number | null;
    stars_4?: number | null;
    stars_3?: number | null;
    stars_2?: number | null;
    stars_1?: number | null;
    five_star_share?: number | null;
  };
  rows?: RatingRow[];
};

function asNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return String(value);
  return d.toLocaleString();
}

function formatRatioAsPercent(value?: number | null): string {
  if (value == null) return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return String(Math.round(n * 100)) + "%";
}

function repeatStar(rating?: number | null): string {
  const n = Math.max(0, Math.min(5, asNumber(rating, 0)));
  return n > 0 ? "*".repeat(n) : "-";
}

function StatCard(props: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{props.label}</div>
      <div className="mt-2 text-4xl font-semibold leading-none text-slate-900">{props.value}</div>
    </div>
  );
}

export default function AdminRatingsPage() {
  const [rows, setRows] = useState<RatingRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [lastRefresh, setLastRefresh] = useState<string>("");
  const [ratingFilter, setRatingFilter] = useState<string>("");

  async function loadData(nextRatingFilter?: string) {
    try {
      setLoading(true);
      setError("");

      const selectedRating = typeof nextRatingFilter === "string" ? nextRatingFilter : ratingFilter;
      const url = new URL("/api/admin/ratings", window.location.origin);
      url.searchParams.set("limit", "100");
      if (selectedRating) {
        url.searchParams.set("rating", selectedRating);
      }

      const response = await fetch(url.toString(), {
        cache: "no-store",
        credentials: "same-origin",
      });

      const json: RatingsResponse = await response.json().catch(() => ({}));

      if (!response.ok || !json?.ok) {
        throw new Error(json?.error || "Failed to load admin ratings.");
      }

      const apiRows = Array.isArray(json.rows) ? json.rows : [];
      setRows(apiRows);
      setLastRefresh(new Date().toLocaleString());
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to load admin ratings.";
      setRows([]);
      setError(message);
      setLastRefresh(new Date().toLocaleString());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData("");
  }, []);

  const stats = useMemo(() => {
    const totalRatings = rows.length;
    const averageRating =
      totalRatings > 0
        ? rows.reduce((sum, row) => sum + asNumber(row.rating, 0), 0) / totalRatings
        : 0;
    const withFeedback = rows.filter((row) => String(row.feedback || "").trim().length > 0).length;
    const stars5 = rows.filter((row) => asNumber(row.rating, 0) === 5).length;
    const stars4 = rows.filter((row) => asNumber(row.rating, 0) === 4).length;
    const stars3 = rows.filter((row) => asNumber(row.rating, 0) === 3).length;
    const stars2 = rows.filter((row) => asNumber(row.rating, 0) === 2).length;
    const stars1 = rows.filter((row) => asNumber(row.rating, 0) === 1).length;
    const fiveStarShare = totalRatings > 0 ? stars5 / totalRatings : null;

    return {
      totalRatings,
      averageRating,
      withFeedback,
      stars5,
      stars4,
      stars3,
      stars2,
      stars1,
      fiveStarShare,
    };
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-4 md:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Admin Ratings</h1>
            <p className="mt-1 text-sm text-slate-600">
              Completed-trip feedback analytics. Read-only layer only.
              {lastRefresh ? "  Last refresh: " + lastRefresh : ""}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={ratingFilter}
              onChange={(e) => {
                const next = e.target.value;
                setRatingFilter(next);
                void loadData(next);
              }}
            >
              <option value="">All ratings</option>
              <option value="5">5 stars</option>
              <option value="4">4 stars</option>
              <option value="3">3 stars</option>
              <option value="2">2 stars</option>
              <option value="1">1 star</option>
            </select>

            <button
              type="button"
              onClick={() => void loadData()}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-100"
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <StatCard label="Total ratings" value={stats.totalRatings} />
          <StatCard label="Average rating" value={stats.averageRating.toFixed(2)} />
          <StatCard label="With feedback" value={stats.withFeedback} />
          <StatCard label="5-star share" value={formatRatioAsPercent(stats.fiveStarShare)} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatCard label="5 stars" value={stats.stars5} />
          <StatCard label="4 stars" value={stats.stars4} />
          <StatCard label="3 stars" value={stats.stars3} />
          <StatCard label="2 stars" value={stats.stars2} />
          <StatCard label="1 star" value={stats.stars1} />
        </div>

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
            Latest trip ratings
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-700">
                <tr>
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Booking code</th>
                  <th className="px-4 py-3 font-medium">Rating</th>
                  <th className="px-4 py-3 font-medium">Stars</th>
                  <th className="px-4 py-3 font-medium">Feedback</th>
                  <th className="px-4 py-3 font-medium">Driver ID</th>
                  <th className="px-4 py-3 font-medium">Passenger ID</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={7}>Loading ratings...</td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-4 text-slate-500" colSpan={7}>No trip ratings found.</td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={String(row.id || row.booking_id || row.booking_code || Math.random())} className="border-t border-slate-100 align-top">
                      <td className="px-4 py-4 text-slate-700">{formatDateTime(row.created_at)}</td>
                      <td className="px-4 py-4 font-medium text-slate-900">{row.booking_code || "-"}</td>
                      <td className="px-4 py-4 text-slate-900">{asNumber(row.rating, 0)}</td>
                      <td className="px-4 py-4 text-slate-700">{repeatStar(row.rating)}</td>
                      <td className="px-4 py-4 text-slate-700">{String(row.feedback || "-")}</td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">{row.driver_id || "-"}</td>
                      <td className="px-4 py-4 font-mono text-xs text-slate-600">{row.passenger_id || "-"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}