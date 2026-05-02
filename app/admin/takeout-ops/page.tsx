"use client";

import React, { useEffect, useMemo, useState } from "react";

type TakeoutOrder = {
  id: string | null;
  booking_code: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_status: string | null;
  customer_name: string | null;
  to_label: string | null;
  takeout_items_subtotal: number | null;
  created_at: string | null;
  updated_at: string | null;
  town: string | null;
  age_minutes?: number | null;
  update_age_minutes?: number | null;
  is_stuck?: boolean;
};

type Counts = {
  all: number;
  active: number;
  preparing: number;
  pickup_ready: number;
  completed: number;
  cancelled: number;
  stuck: number;
};

type ApiBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  filter?: string;
  counts?: Counts;
  orders?: TakeoutOrder[];
};

function money(value: any) {
  const n = Number(value || 0);
  return "PHP " + (Number.isFinite(n) ? n : 0).toFixed(2);
}

function statusLabel(status: any) {
  const s = String(status || "").trim();
  if (s === "pickup_ready") return "pickup ready";
  return s || "unknown";
}

function statusClass(status: any, stuck?: boolean) {
  const s = String(status || "").trim().toLowerCase();
  if (stuck) return "border-red-300 bg-red-50 text-red-800";
  if (s === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (s === "cancelled") return "border-rose-200 bg-rose-50 text-rose-800";
  if (s === "pickup_ready") return "border-blue-200 bg-blue-50 text-blue-800";
  if (s === "preparing") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function fmtDate(value: any) {
  const s = String(value || "").trim();
  if (!s) return "-";
  try {
    return new Date(s).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return s;
  }
}

function ageLabel(minutes: any) {
  const m = Number(minutes || 0);
  if (!Number.isFinite(m)) return "-";
  if (m < 60) return Math.floor(m) + " min";
  const h = Math.floor(m / 60);
  const rem = Math.floor(m % 60);
  return h + "h " + rem + "m";
}

const FILTERS = [
  { key: "active", label: "Active" },
  { key: "stuck", label: "Stuck" },
  { key: "preparing", label: "Preparing" },
  { key: "pickup_ready", label: "Pickup ready" },
  { key: "completed", label: "Completed" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

export default function AdminTakeoutOpsPage() {
  const [filter, setFilter] = useState("active");
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastLoaded, setLastLoaded] = useState<string>("");

  async function load(nextFilter?: string) {
    const f = nextFilter || filter;
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/admin/takeout-orders?filter=" + encodeURIComponent(f), {
        cache: "no-store",
      });
      const body: ApiBody = await res.json().catch(() => ({}));

      if (!res.ok || body.ok === false) {
        throw new Error(body.message || body.error || "Failed to load takeout orders.");
      }

      setOrders(Array.isArray(body.orders) ? body.orders : []);
      setCounts(body.counts || null);
      setLastLoaded(new Date().toLocaleString("en-PH", { timeZone: "Asia/Manila" }));
    } catch (e: any) {
      setOrders([]);
      setError(String(e?.message || e || "Failed to load takeout orders."));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    load(filter).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const shownGross = useMemo(() => {
    return orders.reduce((sum, o) => sum + Number(o.takeout_items_subtotal || 0), 0);
  }, [orders]);

  function countFor(key: string) {
    if (!counts) return 0;
    return Number((counts as any)[key] || 0);
  }

  return (
    <div className="mx-auto max-w-7xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">JRIDE TAKEOUT</div>
          <h1 className="text-2xl font-bold text-slate-950">Admin Takeout Ops</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Read-only monitor for takeout orders. Ride dispatch and trip lifecycle stay isolated.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <a href="/admin" className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50">
            Admin home
          </a>
          <a href="/vendor-portal" className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50">
            Vendor portal
          </a>
          <button
            type="button"
            onClick={() => load().catch(() => undefined)}
            disabled={busy}
            className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-7">
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Active</div>
          <div className="mt-1 text-2xl font-bold">{countFor("active")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Stuck</div>
          <div className="mt-1 text-2xl font-bold text-red-700">{countFor("stuck")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Preparing</div>
          <div className="mt-1 text-2xl font-bold">{countFor("preparing")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Pickup ready</div>
          <div className="mt-1 text-2xl font-bold">{countFor("pickup_ready")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Completed</div>
          <div className="mt-1 text-2xl font-bold">{countFor("completed")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Cancelled</div>
          <div className="mt-1 text-2xl font-bold">{countFor("cancelled")}</div>
        </div>
        <div className="rounded-xl border bg-white p-4">
          <div className="text-xs text-slate-500">Shown gross</div>
          <div className="mt-1 text-xl font-bold">{money(shownGross)}</div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
        Stuck rules: preparing for 30 minutes or more, or pickup ready without update for 20 minutes or more.
      </div>

      <div className="mt-4 rounded-2xl border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-950">Order monitor</div>
            <div className="text-xs text-slate-500">
              Last loaded: {lastLoaded || "-"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={[
                  "rounded-full border px-3 py-1 text-sm",
                  filter === f.key
                    ? "border-slate-950 bg-slate-950 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                ].join(" ")}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-auto rounded-xl border">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-3">Order</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Age</th>
                <th className="px-3 py-3">Vendor</th>
                <th className="px-3 py-3">Customer</th>
                <th className="px-3 py-3">Town</th>
                <th className="px-3 py-3">Subtotal</th>
                <th className="px-3 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-slate-500">
                    {busy ? "Loading..." : "No takeout orders for this filter."}
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr
                    key={String(o.id || o.booking_code)}
                    className={[
                      "border-t",
                      o.is_stuck ? "bg-red-50/60" : "",
                    ].join(" ")}
                  >
                    <td className="px-3 py-3">
                      <div className="font-semibold text-slate-950">{o.booking_code || o.id || "-"}</div>
                      <div className="text-xs text-slate-500">{o.id || "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className={["rounded-full border px-2 py-1 text-xs font-semibold", statusClass(o.vendor_status, o.is_stuck)].join(" ")}>
                        {o.is_stuck ? "stuck - " : ""}{statusLabel(o.vendor_status)}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium">{ageLabel(o.age_minutes)}</div>
                      <div className="text-xs text-slate-500">updated {ageLabel(o.update_age_minutes)} ago</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900">{o.vendor_name || o.vendor_id || "-"}</div>
                      <div className="text-xs text-slate-500">{o.vendor_id || "-"}</div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-slate-900">{o.customer_name || "-"}</div>
                      <div className="max-w-xs truncate text-xs text-slate-500">{o.to_label || "-"}</div>
                    </td>
                    <td className="px-3 py-3 text-slate-700">{o.town || "-"}</td>
                    <td className="px-3 py-3 font-semibold">{money(o.takeout_items_subtotal)}</td>
                    <td className="px-3 py-3 text-slate-600">{fmtDate(o.created_at)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
