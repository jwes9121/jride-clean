"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
  unit_price: number;
  listed_quantity: number;
  reserved_quantity: number;
  sold_quantity: number;
  remaining_quantity: number;
  availability_mode: string;
  harvest_start_at?: string | null;
  harvest_end_at?: string | null;
  default_prep_minutes: number;
  vehicle_requirement: string;
  handling_eligible: boolean;
  is_active: boolean;
};

const SESSION_VENDOR_ID = "JRIDE_AGRIMARKET_VENDOR_ID";
const SESSION_VENDOR_PIN = "JRIDE_AGRIMARKET_VENDOR_PIN";

function farmerHeaders(vendorId: string, pin: string, json = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-jride-vendor-id": vendorId.trim(),
    "x-jride-vendor-pin": pin.trim(),
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function titleCase(value: unknown): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const initialForm = {
  name: "",
  description: "",
  product_group: "produce",
  species: "",
  breed: "",
  meat_cut: "",
  processing_form: "",
  condition: "normal",
  cargo_class: "standard_produce",
  selling_unit: "kg",
  unit_price: "",
  available_quantity: "",
  availability_mode: "always_available",
  harvest_start_at: "",
  harvest_end_at: "",
  default_prep_minutes: "15",
  vehicle_requirement: "either",
  handling_eligible: false,
};

export default function AgrimarketProducerProductsPage() {
  const [vendorId, setVendorId] = useState("");
  const [pin, setPin] = useState("");
  const [connected, setConnected] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(initialForm);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedId = window.sessionStorage.getItem(SESSION_VENDOR_ID) || "";
    const savedPin = window.sessionStorage.getItem(SESSION_VENDOR_PIN) || "";
    setVendorId(savedId);
    setPin(savedPin);
    if (savedId && savedPin) void loadProducts(savedId, savedPin);
  }, []);

  async function loadProducts(id = vendorId, accessPin = pin) {
    if (!id.trim() || !accessPin.trim()) return;
    setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/producer/products", {
      cache: "no-store",
      headers: farmerHeaders(id, accessPin),
    });
    const payload = await response.json().catch(() => ({}));

    if (payload?.error === "AGRIMARKET_DISABLED") {
      setDisabled(true);
      setConnected(false);
    } else if (response.status === 401 || response.status === 403) {
      setConnected(false);
      setError(payload?.message || "Farmer credentials were not accepted.");
    } else if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load products.");
    } else {
      const rows = Array.isArray(payload?.products) ? payload.products : [];
      setProducts(rows);
      setConnected(true);
      setStockDraft(Object.fromEntries(rows.map((row: Product) => [row.id, String(row.remaining_quantity)])));
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(SESSION_VENDOR_ID, id.trim());
        window.sessionStorage.setItem(SESSION_VENDOR_PIN, accessPin.trim());
      }
    }
    setLoading(false);
  }

  async function productAction(body: any, busyKey: string) {
    setBusy(busyKey);
    setError("");
    setMessage("");
    const response = await fetch("/api/agrimarket/producer/products", {
      method: "POST",
      headers: farmerHeaders(vendorId, pin, true),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update the product listing.");
    } else {
      const rows = Array.isArray(payload?.products) ? payload.products : [];
      setProducts(rows);
      setStockDraft(Object.fromEntries(rows.map((row: Product) => [row.id, String(row.remaining_quantity)])));
      setMessage("Agrimarket product listing updated.");
    }
    setBusy("");
  }

  async function createProduct() {
    await productAction({ action: "create", ...form }, "create");
    if (!error) setForm(initialForm);
  }

  if (disabled) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-3xl border bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Agrimarket product listings are in pre-launch</h1>
          <p className="mt-3 text-slate-600">The farmer product manager is ready but remains disabled with the rest of Agrimarket.</p>
          <Link href="/agrimarket/producer" className="mt-5 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Farmer console</Link>
        </div>
      </main>
    );
  }

  if (!connected) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl border bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-2xl font-bold">Farmer products</h1>
          <p className="mt-2 text-sm text-slate-600">Use your farmer/vendor credentials. Agrimarket listing is free.</p>
          {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <input value={vendorId} onChange={(event) => setVendorId(event.target.value)} placeholder="Vendor ID" className="mt-5 w-full rounded-xl border px-3 py-3" />
          <input type="password" value={pin} onChange={(event) => setPin(event.target.value)} placeholder="Access PIN" className="mt-3 w-full rounded-xl border px-3 py-3" />
          <button type="button" onClick={() => loadProducts()} disabled={loading || !vendorId.trim() || !pin.trim()} className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
            {loading ? "Checking..." : "Manage products"}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket Farmer</p>
            <h1 className="text-3xl font-bold">Product listings</h1>
            <p className="mt-1 text-sm text-slate-600">Joining, listing, and selling are free during launch. No farmer wallet is used.</p>
          </div>
          <div className="flex gap-2">
            <Link href="/agrimarket/producer" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Orders</Link>
            <button type="button" onClick={() => loadProducts()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button>
          </div>
        </div>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <section className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Add a product</h2>
          <p className="mt-1 text-sm text-slate-500">Use clear product details so customers do not need to contact you directly.</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold">Product name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="Tilapia, Native Chicken, Palay" /></label>
            <label className="text-sm font-semibold">Category<select value={form.product_group} onChange={(event) => setForm({ ...form, product_group: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="produce">Vegetables / Fruits</option><option value="grain">Rice / Corn / Grain</option><option value="aquatic">Fish / Aquatic</option><option value="poultry">Chicken / Poultry</option><option value="livestock">Livestock</option><option value="meat">Fresh Meat</option><option value="eggs">Eggs</option><option value="other_agri">Other Agri</option></select></label>
            <label className="text-sm font-semibold">Species / type<input value={form.species} onChange={(event) => setForm({ ...form, species: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="Tilapia, Piglet, Goat" /></label>
            <label className="text-sm font-semibold">Breed / variety<input value={form.breed} onChange={(event) => setForm({ ...form, breed: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="Native, Western breed, variety" /></label>
            <label className="text-sm font-semibold">Meat cut / part<input value={form.meat_cut} onChange={(event) => setForm({ ...form, meat_cut: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="Liempo, foreleg, ribs" /></label>
            <label className="text-sm font-semibold">Form<select value={form.processing_form} onChange={(event) => setForm({ ...form, processing_form: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="">Not applicable</option><option value="whole">Whole</option><option value="chopped">Chopped</option><option value="sliced">Sliced</option><option value="ground">Ground</option><option value="other">Other</option></select></label>
            <label className="text-sm font-semibold">Condition<select value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="normal">Normal</option><option value="fresh">Fresh</option><option value="chilled">Chilled</option><option value="frozen">Frozen</option><option value="live_at_pickup">Live at pickup</option></select></label>
            <label className="text-sm font-semibold">Cargo type<select value={form.cargo_class} onChange={(event) => setForm({ ...form, cargo_class: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="standard_produce">Standard produce</option><option value="fragile_produce">Fragile produce</option><option value="bulk_sack">Sack / bulk</option><option value="crate">Crate</option><option value="live_fish">Live fish</option><option value="live_poultry">Live poultry</option><option value="live_livestock">Live livestock</option><option value="fresh_meat">Fresh meat</option><option value="chilled_meat">Chilled meat</option><option value="frozen_meat">Frozen meat</option><option value="other_agri">Other agri</option></select></label>
            <label className="text-sm font-semibold">Selling unit<input value={form.selling_unit} onChange={(event) => setForm({ ...form, selling_unit: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="kg, sack, head, tray" /></label>
            <label className="text-sm font-semibold">Price per unit<input type="number" min="0" step="0.01" value={form.unit_price} onChange={(event) => setForm({ ...form, unit_price: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="0.00" /></label>
            <label className="text-sm font-semibold">Available quantity<input type="number" min="0" step="0.01" value={form.available_quantity} onChange={(event) => setForm({ ...form, available_quantity: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="0" /></label>
            <label className="text-sm font-semibold">Preparation time<select value={form.default_prep_minutes} onChange={(event) => setForm({ ...form, default_prep_minutes: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="0">Ready now</option><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option><option value="45">45 minutes</option><option value="60">60 minutes</option><option value="90">90 minutes</option><option value="120">120 minutes</option></select></label>
            <label className="text-sm font-semibold">Vehicle requirement<select value={form.vehicle_requirement} onChange={(event) => setForm({ ...form, vehicle_requirement: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="either">Motorcycle or tricycle</option><option value="motorcycle">Motorcycle only</option><option value="tricycle">Tricycle only</option></select></label>
            <label className="text-sm font-semibold">Availability<select value={form.availability_mode} onChange={(event) => setForm({ ...form, availability_mode: event.target.value })} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="always_available">Always available</option><option value="scheduled_harvest">Scheduled harvest</option></select></label>
            <label className="flex items-center gap-3 rounded-xl border p-3 text-sm font-semibold"><input type="checkbox" checked={form.handling_eligible} onChange={(event) => setForm({ ...form, handling_eligible: event.target.checked })} />Driver loading assistance may be needed</label>
          </div>

          {form.availability_mode === "scheduled_harvest" ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">Expected harvest start<input type="datetime-local" value={form.harvest_start_at} onChange={(event) => setForm({ ...form, harvest_start_at: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" /></label>
              <label className="text-sm font-semibold">Expected harvest end<input type="datetime-local" value={form.harvest_end_at} onChange={(event) => setForm({ ...form, harvest_end_at: event.target.value })} className="mt-2 w-full rounded-xl border px-3 py-3" /></label>
            </div>
          ) : null}

          <label className="mt-4 block text-sm font-semibold">Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} className="mt-2 min-h-24 w-full rounded-xl border px-3 py-3" placeholder="Grade, size, packaging, or other useful details" /></label>

          <button type="button" onClick={createProduct} disabled={busy === "create" || !form.name.trim() || !form.unit_price || !form.available_quantity} className="mt-5 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
            {busy === "create" ? "Saving..." : "Publish product"}
          </button>
          {form.product_group === "livestock" || form.cargo_class === "live_livestock" ? <p className="mt-2 text-xs text-amber-700">Live livestock is automatically restricted to tricycle delivery while larger vehicles are not yet available.</p> : null}
        </section>

        <section className="mt-6">
          <h2 className="text-xl font-bold">Your products</h2>
          {products.length === 0 ? (
            <div className="mt-3 rounded-2xl border bg-white p-8 text-center text-slate-500">No product listings yet.</div>
          ) : (
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              {products.map((product) => (
                <article key={product.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{titleCase(product.product_group)}</p>
                      <h3 className="text-lg font-bold">{product.name}</h3>
                      <p className="text-sm text-slate-500">{money(product.unit_price)} per {product.selling_unit}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${product.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{product.is_active ? "Live" : "Paused"}</span>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                    <div className="rounded-xl bg-slate-50 p-2"><p className="text-xs text-slate-500">Available</p><p className="font-bold">{product.remaining_quantity}</p></div>
                    <div className="rounded-xl bg-slate-50 p-2"><p className="text-xs text-slate-500">Reserved</p><p className="font-bold">{product.reserved_quantity}</p></div>
                    <div className="rounded-xl bg-slate-50 p-2"><p className="text-xs text-slate-500">Sold</p><p className="font-bold">{product.sold_quantity}</p></div>
                  </div>
                  <p className="mt-3 text-xs text-slate-500">{titleCase(product.condition)} | {titleCase(product.cargo_class)} | {titleCase(product.vehicle_requirement)}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <input type="number" min="0" step="0.01" value={stockDraft[product.id] ?? String(product.remaining_quantity)} onChange={(event) => setStockDraft({ ...stockDraft, [product.id]: event.target.value })} className="w-28 rounded-xl border px-3 py-2 text-sm" />
                    <button type="button" disabled={busy === product.id + "-stock"} onClick={() => productAction({ action: "set_available_quantity", product_id: product.id, available_quantity: Number(stockDraft[product.id] || 0) }, product.id + "-stock")} className="rounded-xl border px-3 py-2 text-sm font-semibold">Set available</button>
                    <button type="button" disabled={busy === product.id + "-active"} onClick={() => productAction({ action: "set_active", product_id: product.id, is_active: !product.is_active }, product.id + "-active")} className="rounded-xl border px-3 py-2 text-sm font-semibold">{product.is_active ? "Pause listing" : "Reopen listing"}</button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
