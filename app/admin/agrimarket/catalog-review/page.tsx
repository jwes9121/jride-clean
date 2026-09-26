"use client";

import { useEffect, useMemo, useState } from "react";
import { ProductPhoto } from "@/app/agrimarket/ProductPhoto";

type Product = {
  id: string;
  name: string;
  description?: string | null;
  product_group: string;
  species?: string | null;
  breed?: string | null;
  meat_cut?: string | null;
  processing_form?: string | null;
  condition: string;
  cargo_class: string;
  selling_unit: string;
  unit_weight_kg?: number | string | null;
  unit_price: number | string;
  listed_quantity: number | string;
  reserved_quantity: number | string;
  sold_quantity: number | string;
  remaining_quantity: number | string;
  availability_mode: string;
  harvest_start_at?: string | null;
  harvest_end_at?: string | null;
  harvest_order_cutoff_at?: string | null;
  default_prep_minutes: number | string;
  vehicle_requirement: string;
  handling_eligible: boolean;
  photo_urls?: string[] | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type Store = {
  id: string;
  vendor_name?: string | null;
  contact_name: string;
  contact_phone?: string | null;
  town: string;
  barangay?: string | null;
  pickup_label?: string | null;
  pickup_motorcycle_accessible?: boolean | null;
  pickup_tricycle_accessible?: boolean | null;
  pickup_roadside_handoff_required?: boolean | null;
  pickup_driver_directions?: string | null;
  status: string;
  accepting_orders: boolean;
  store_open: boolean;
  catalog_approved_at?: string | null;
  credential_status?: string | null;
  credential_last_used_at?: string | null;
  active_available_product_count: number;
  product_count: number;
  products: Product[];
};

type ReviewFilter = "needs_review" | "approved" | "all";

function titleCase(value: unknown): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", {
        timeZone: "Asia/Manila",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "-";
}

function money(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? `PHP ${amount.toFixed(2)}` : "PHP -";
}

function quantity(value: unknown): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? String(amount) : "-";
}

function readinessBlockers(store: Store): string[] {
  const blockers: string[] = [];
  if (store.status !== "active") blockers.push("farmer account is not active");
  if (store.credential_status !== "active") blockers.push("farmer credential is not active");
  if (!String(store.vendor_name || "").trim()) blockers.push("store name is missing");
  if (store.active_available_product_count < 1) blockers.push("no active product with available quantity");
  if (!store.pickup_motorcycle_accessible && !store.pickup_tricycle_accessible) {
    blockers.push("pickup vehicle access is not verified");
  }
  if (String(store.pickup_driver_directions || "").trim().length < 5) {
    blockers.push("driver pickup directions are missing");
  }
  return blockers;
}

function publicState(store: Store): { label: string; detail: string } {
  if (!store.catalog_approved_at) {
    return {
      label: "Needs first catalog approval",
      detail: "Passenger browsing remains hidden until JRide approves readiness.",
    };
  }
  if (!store.accepting_orders) {
    return {
      label: "Approved - orders paused",
      detail: "Catalog approval is retained, but new orders are paused.",
    };
  }
  if (!store.store_open) {
    return {
      label: "Approved - store closed",
      detail: "Passengers may browse the catalog, but ordering is blocked until the farmer turns Store ON.",
    };
  }
  return {
    label: "Live",
    detail: "Catalog is visible and the store is accepting new orders.",
  };
}

export default function AgrimarketCatalogReviewPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [town, setTown] = useState("all");
  const [filter, setFilter] = useState<ReviewFilter>("needs_review");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/agrimarket/admin/catalog-review", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setStores([]);
        setError(payload?.message || payload?.error || "Unable to load AgriMarket catalog review.");
      } else {
        setStores(Array.isArray(payload?.stores) ? payload.stores : []);
      }
    } catch {
      setStores([]);
      setError("Catalog review could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const towns = useMemo(
    () => Array.from(new Set(stores.map((store) => String(store.town || "").trim()).filter(Boolean))).sort(),
    [stores]
  );

  const visibleStores = useMemo(() => {
    const q = query.trim().toLowerCase();
    return stores.filter((store) => {
      if (town !== "all" && store.town !== town) return false;
      if (filter === "needs_review" && store.catalog_approved_at) return false;
      if (filter === "approved" && !store.catalog_approved_at) return false;
      if (!q) return true;
      const haystack = [
        store.vendor_name,
        store.contact_name,
        store.contact_phone,
        store.town,
        store.barangay,
        ...store.products.map((product) => product.name),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [filter, query, stores, town]);

  async function setReadiness(store: Store, ready: boolean) {
    const note = String(notes[store.id] || "").trim();
    if (note.length < 5) {
      setError("Enter a review note of at least 5 characters before changing catalog readiness.");
      return;
    }

    setBusy(store.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/agrimarket/admin/verified-farmers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          action: "set_readiness",
          producer_id: store.id,
          ready,
          note,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setError(payload?.message || payload?.error || "Unable to update catalog readiness.");
        return;
      }
      setNotes((current) => ({ ...current, [store.id]: "" }));
      setMessage(
        ready
          ? `${store.vendor_name || store.contact_name} is approved for catalog visibility. Store ON/OFF still controls whether customers can place new orders.`
          : `New orders are paused for ${store.vendor_name || store.contact_name}.`
      );
      await load();
    } catch {
      setError("The readiness update was interrupted. Refresh before trying again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Admin</p>
            <h1 className="text-3xl font-bold">AgriMarket Catalog Review</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Review the actual products farmers uploaded before first publication. Approval is per farmer catalog, not per product.
              After first approval, Store ON/OFF controls ordering while the approved catalog may remain browsable.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold disabled:text-slate-400"
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>

        <section className="mt-5 grid gap-3 rounded-2xl border bg-white p-4 md:grid-cols-[1fr_auto_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search store, farmer, phone, town, or product"
            className="rounded-xl border px-4 py-3 text-sm"
          />
          <select value={town} onChange={(event) => setTown(event.target.value)} className="rounded-xl border bg-white px-4 py-3 text-sm">
            <option value="all">All towns</option>
            {towns.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
          <select value={filter} onChange={(event) => setFilter(event.target.value as ReviewFilter)} className="rounded-xl border bg-white px-4 py-3 text-sm">
            <option value="needs_review">Needs first approval</option>
            <option value="approved">Already approved</option>
            <option value="all">All uploaded catalogs</option>
          </select>
        </section>

        {error ? <div role="alert" className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <div className="mt-4 text-sm text-slate-600">
          Showing <strong>{visibleStores.length}</strong> farmer catalog(s) with uploaded products.
        </div>

        <section className="mt-4 space-y-5">
          {!loading && visibleStores.length === 0 ? (
            <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">No uploaded catalogs match this view.</div>
          ) : null}

          {visibleStores.map((store) => {
            const blockers = readinessBlockers(store);
            const state = publicState(store);
            const approving = busy === store.id;
            return (
              <article key={store.id} className="overflow-hidden rounded-3xl border bg-white shadow-sm">
                <div className="border-b p-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-emerald-700">{store.town}{store.barangay ? ` - ${store.barangay}` : ""}</p>
                      <h2 className="mt-1 text-2xl font-bold">{store.vendor_name || "Store name not set"}</h2>
                      <p className="mt-1 text-sm text-slate-600">{store.contact_name}{store.contact_phone ? ` - ${store.contact_phone}` : ""}</p>
                    </div>
                    <div className="max-w-sm rounded-2xl bg-slate-100 px-4 py-3 text-sm">
                      <strong>{state.label}</strong>
                      <p className="mt-1 text-xs text-slate-600">{state.detail}</p>
                      <p className="mt-1 text-xs text-slate-500">First approved: {formatDate(store.catalog_approved_at)}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 p-3 text-sm"><span className="block text-xs text-slate-500">Account</span><strong>{titleCase(store.status)}</strong></div>
                    <div className="rounded-xl bg-slate-50 p-3 text-sm"><span className="block text-xs text-slate-500">Credential</span><strong>{titleCase(store.credential_status || "unknown")}</strong></div>
                    <div className="rounded-xl bg-slate-50 p-3 text-sm"><span className="block text-xs text-slate-500">Orders readiness</span><strong>{store.accepting_orders ? "Approved" : "Blocked"}</strong></div>
                    <div className="rounded-xl bg-slate-50 p-3 text-sm"><span className="block text-xs text-slate-500">Farmer Store switch</span><strong>{store.store_open ? "ON" : "OFF"}</strong></div>
                  </div>

                  <div className="mt-3 rounded-2xl bg-blue-50 p-4 text-sm text-blue-950">
                    <strong>Pickup readiness</strong>
                    <p className="mt-1">
                      Motorcycle: {store.pickup_motorcycle_accessible ? "Yes" : "No"}; Tricycle: {store.pickup_tricycle_accessible ? "Yes" : "No"};
                      Roadside handoff: {store.pickup_roadside_handoff_required ? "Yes" : "No"}.
                    </p>
                    <p className="mt-1"><strong>Pickup description:</strong> {store.pickup_label || "Not recorded"}</p>
                    <p className="mt-1"><strong>Driver directions:</strong> {store.pickup_driver_directions || "Not recorded"}</p>
                  </div>

                  {blockers.length ? (
                    <div className="mt-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-950">
                      <strong>Cannot approve yet:</strong> {blockers.join("; ")}.
                    </div>
                  ) : null}
                </div>

                <div className="p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-bold">Uploaded products ({store.product_count})</h3>
                    <span className="text-xs text-slate-500">Active with stock: {store.active_available_product_count}</span>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    {store.products.map((product) => (
                      <div key={product.id} className={`grid gap-4 rounded-2xl border p-4 sm:grid-cols-[150px_1fr] ${product.is_active ? "" : "opacity-60"}`}>
                        <ProductPhoto
                          url={Array.isArray(product.photo_urls) ? product.photo_urls[0] : undefined}
                          name={product.name}
                          className="w-full"
                        />
                        <div>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <h4 className="font-bold">{product.name}</h4>
                              <p className="text-xs text-slate-500">{titleCase(product.product_group)} - {titleCase(product.condition)} - {titleCase(product.cargo_class)}</p>
                            </div>
                            <span className={`rounded-full px-2 py-1 text-xs font-semibold ${product.is_active ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700"}`}>
                              {product.is_active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          {product.description ? <p className="mt-2 text-sm text-slate-700">{product.description}</p> : null}
                          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                            <div><span className="text-xs text-slate-500">Price</span><strong className="block">{money(product.unit_price)} / {product.selling_unit}</strong></div>
                            <div><span className="text-xs text-slate-500">Available now</span><strong className="block">{quantity(product.remaining_quantity)} {product.selling_unit}</strong></div>
                            <div><span className="text-xs text-slate-500">Listed / Reserved / Sold</span><strong className="block">{quantity(product.listed_quantity)} / {quantity(product.reserved_quantity)} / {quantity(product.sold_quantity)}</strong></div>
                            <div><span className="text-xs text-slate-500">Vehicle</span><strong className="block">{titleCase(product.vehicle_requirement)}</strong></div>
                            <div><span className="text-xs text-slate-500">Availability</span><strong className="block">{titleCase(product.availability_mode)}</strong></div>
                            <div><span className="text-xs text-slate-500">Prep time</span><strong className="block">{quantity(product.default_prep_minutes)} min</strong></div>
                          </div>
                          {product.availability_mode === "scheduled_harvest" ? (
                            <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-950">
                              <div>Harvest start: {formatDate(product.harvest_start_at)}</div>
                              <div>Harvest end: {formatDate(product.harvest_end_at)}</div>
                              <div>Reservation cutoff: {formatDate(product.harvest_order_cutoff_at)}</div>
                            </div>
                          ) : null}
                          <p className="mt-2 text-xs text-slate-400">Updated {formatDate(product.updated_at)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t bg-slate-50 p-5">
                  <label className="block text-sm font-semibold">
                    Admin review note
                    <textarea
                      value={notes[store.id] || ""}
                      onChange={(event) => setNotes((current) => ({ ...current, [store.id]: event.target.value }))}
                      className="mt-2 min-h-20 w-full rounded-xl border bg-white px-3 py-3"
                      placeholder="Example: Reviewed uploaded products and pickup readiness."
                      maxLength={500}
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {!store.accepting_orders ? (
                      <button
                        type="button"
                        disabled={approving || blockers.length > 0}
                        onClick={() => void setReadiness(store, true)}
                        className="rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white disabled:bg-slate-400"
                      >
                        {approving ? "Saving..." : store.catalog_approved_at ? "Resume order readiness" : "Approve catalog and readiness"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={approving}
                        onClick={() => void setReadiness(store, false)}
                        className="rounded-xl bg-amber-600 px-4 py-3 font-bold text-white disabled:bg-slate-400"
                      >
                        {approving ? "Saving..." : "Pause new orders"}
                      </button>
                    )}
                    <button type="button" onClick={() => void load()} disabled={loading || approving} className="rounded-xl border bg-white px-4 py-3 font-semibold">
                      Refresh record
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    First approval establishes passenger catalog visibility. The farmer's Store ON/OFF switch remains separate and controls whether new orders can be placed.
                  </p>
                </div>
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
