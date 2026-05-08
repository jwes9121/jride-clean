"use client";

import React, { useEffect, useMemo, useState } from "react";

type TakeoutOrder = {
  id: string;
  booking_code: string | null;
  vendor_name: string | null;
  vendor_status: string | null;
  customer_name: string | null;
  to_label: string | null;
  takeout_items_subtotal: number | null;
  cash_required: boolean;
  assigned_driver_id: string | null;
  assigned_driver_name: string | null;
  assigned_driver_phone: string | null;
  town: string | null;
  age_minutes: number;
  update_age_minutes: number;
  is_stuck: boolean;
  priority: number;
};

type DriverRow = {
  driver_id: string;
  name: string | null;
  phone: string | null;
  town: string | null;
  status: string | null;
  effective_status: string | null;
  age_minutes: number | null;
  assign_eligible: boolean;
};

type PageData = {
  ok?: boolean;
  error?: string;
  message?: string;
  counts?: Record<string, number>;
  orders?: TakeoutOrder[];
  drivers?: DriverRow[];
};

const FILTERS = [
  "active",
  "unassigned",
  "requested",
  "preparing",
  "pickup_ready",
  "driver_assigned",
  "picked_up",
  "cash",
  "stuck",
  "completed",
  "cancelled",
  "all",
];

const NEXT_ACTIONS = [
  { label: "Preparing", status: "preparing" },
  { label: "Pickup ready", status: "pickup_ready" },
  { label: "Driver assigned", status: "driver_assigned" },
  { label: "Arrived vendor", status: "rider_arrived_vendor" },
  { label: "Picked up", status: "picked_up" },
  { label: "Delivering", status: "delivering" },
  { label: "Completed", status: "completed" },
  { label: "Cancelled", status: "cancelled" },
];

function money(v: any) {
  const n = Number(v || 0);
  return n.toLocaleString("en-PH", { style: "currency", currency: "PHP" });
}

function titleCase(value: any) {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function pillClass(active: boolean) {
  return [
    "rounded-full border px-3 py-1 text-xs font-semibold",
    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

function statusClass(status: string | null, stuck: boolean) {
  if (stuck) return "border-red-300 bg-red-50 text-red-700";
  const s = String(status || "").toLowerCase();
  if (s === "pickup_ready") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (s === "driver_assigned" || s === "rider_arrived_vendor") return "border-blue-300 bg-blue-50 text-blue-800";
  if (s === "picked_up" || s === "delivering") return "border-purple-300 bg-purple-50 text-purple-800";
  if (s === "completed") return "border-slate-300 bg-slate-50 text-slate-700";
  if (s === "cancelled") return "border-zinc-300 bg-zinc-50 text-zinc-700";
  return "border-amber-300 bg-amber-50 text-amber-800";
}

export default function TakeoutDispatchPage() {
  const [filter, setFilter] = useState("active");
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [lastAction, setLastAction] = useState("");
  const [selectedDrivers, setSelectedDrivers] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/takeout-dispatch?filter=${encodeURIComponent(filter)}`, { cache: "no-store" });
      const j: PageData = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.message || j.error || "TAKEOUT_DISPATCH_LOAD_FAILED");
      setOrders(Array.isArray(j.orders) ? j.orders : []);
      setDrivers(Array.isArray(j.drivers) ? j.drivers : []);
      setCounts(j.counts || {});
    } catch (err: any) {
      setLastAction(err?.message || "Load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(() => load(), 8000);
    return () => clearInterval(t);
  }, [filter]);

  async function postJson(url: string, body: any) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error(j.message || j.error || "REQUEST_FAILED");
    return j;
  }

  async function assign(orderId: string) {
    const driverId = selectedDrivers[orderId] || "";
    if (!driverId) {
      setLastAction("Select a driver first.");
      return;
    }
    setLastAction("Assigning takeout order...");
    try {
      await postJson("/api/admin/takeout-dispatch/assign", { order_id: orderId, driver_id: driverId });
      setLastAction("Takeout order assigned.");
      await load();
    } catch (err: any) {
      setLastAction(err?.message || "Assign failed");
    }
  }

  async function setStatus(orderId: string, status: string) {
    const destructive = status === "cancelled" || status === "completed";
    if (destructive && !window.confirm(`Confirm ${titleCase(status)} for this takeout order?`)) return;
    setLastAction(`Setting ${status}...`);
    try {
      await postJson("/api/admin/takeout-dispatch/status", { order_id: orderId, status });
      setLastAction("Takeout status updated.");
      await load();
    } catch (err: any) {
      setLastAction(err?.message || "Status update failed");
    }
  }

  const eligibleDrivers = useMemo(() => drivers.filter((d) => d.assign_eligible), [drivers]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-bold">Takeout Dispatch</h1>
              <p className="mt-1 text-sm text-slate-600">
                Manual takeout assignment board. This page is isolated from ride LiveTrips, ride lifecycle, fare, and wallet flows.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <span className="rounded-full border bg-slate-50 px-3 py-1">Drivers available: {eligibleDrivers.length}</span>
              <button className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50" onClick={() => load()} disabled={loading}>
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button key={f} type="button" className={pillClass(filter === f)} onClick={() => setFilter(f)}>
                {titleCase(f)} <span className="opacity-75">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Rule lock: this board only writes takeout fields on service_type=takeout orders. It must not be used for ride dispatch.
          </div>

          {lastAction ? <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">{lastAction}</div> : null}
        </section>

        <section className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            {orders.length === 0 ? (
              <div className="rounded-2xl border bg-white p-6 text-center text-sm text-slate-500">No takeout orders in this view.</div>
            ) : (
              orders.map((o) => {
                const status = String(o.vendor_status || "requested");
                return (
                  <article key={o.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-lg font-bold">{o.booking_code || o.id}</h2>
                          <span className={["rounded-full border px-2 py-1 text-xs font-semibold", statusClass(status, o.is_stuck)].join(" ")}>{o.is_stuck ? "STUCK - " : ""}{titleCase(status)}</span>
                          {o.cash_required ? <span className="rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Cash required</span> : null}
                        </div>
                        <div className="grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                          <div><span className="font-semibold">Vendor:</span> {o.vendor_name || "Unknown"}</div>
                          <div><span className="font-semibold">Customer:</span> {o.customer_name || "Customer"}</div>
                          <div><span className="font-semibold">Town:</span> {o.town || "Unknown"}</div>
                          <div><span className="font-semibold">Subtotal:</span> {money(o.takeout_items_subtotal)}</div>
                          <div><span className="font-semibold">Age:</span> {o.age_minutes} min</div>
                          <div><span className="font-semibold">Updated:</span> {o.update_age_minutes} min ago</div>
                          <div className="md:col-span-2"><span className="font-semibold">Dropoff:</span> {o.to_label || "Not provided"}</div>
                          <div className="md:col-span-2"><span className="font-semibold">Assigned driver:</span> {o.assigned_driver_name || "None"}{o.assigned_driver_phone ? ` (${o.assigned_driver_phone})` : ""}</div>
                        </div>
                      </div>

                      <div className="w-full space-y-3 xl:w-[360px]">
                        <div className="rounded-xl border bg-slate-50 p-3">
                          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Manual assignment</div>
                          <div className="flex gap-2">
                            <select
                              className="min-w-0 flex-1 rounded-lg border bg-white px-2 py-2 text-sm"
                              value={selectedDrivers[o.id] || ""}
                              onChange={(e) => setSelectedDrivers((prev) => ({ ...prev, [o.id]: e.target.value }))}
                            >
                              <option value="">Select driver</option>
                              {eligibleDrivers.map((d) => (
                                <option key={d.driver_id} value={d.driver_id}>
                                  {d.name || d.driver_id} - {d.town || "No town"} - {d.effective_status || d.status || "online"}
                                </option>
                              ))}
                            </select>
                            <button className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => assign(o.id)} disabled={!selectedDrivers[o.id]}>
                              Assign
                            </button>
                          </div>
                        </div>

                        <div className="rounded-xl border bg-slate-50 p-3">
                          <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Takeout status</div>
                          <div className="grid grid-cols-2 gap-2">
                            {NEXT_ACTIONS.map((a) => (
                              <button key={a.status} type="button" className="rounded-lg border bg-white px-2 py-2 text-xs font-semibold hover:bg-slate-100" onClick={() => setStatus(o.id, a.status)}>
                                {a.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>

          <aside className="space-y-3">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <h3 className="font-bold">Driver pool</h3>
              <p className="mt-1 text-xs text-slate-500">Eligible drivers from the latest driver_locations read. Drivers already assigned to active takeout orders are hidden from this pool.</p>
              <div className="mt-3 space-y-2">
                {eligibleDrivers.length === 0 ? (
                  <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-500">No eligible drivers available.</div>
                ) : (
                  eligibleDrivers.slice(0, 20).map((d) => (
                    <div key={d.driver_id} className="rounded-xl border p-3 text-sm">
                      <div className="font-semibold">{d.name || d.driver_id}</div>
                      <div className="text-xs text-slate-500">{d.town || "No town"} - {d.effective_status || d.status || "online"} - {d.age_minutes ?? "?"} min</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
