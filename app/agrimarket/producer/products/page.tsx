"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Product = {
  id: string;
  name: string;
  product_group: string;
  selling_unit: string;
  unit_weight_kg?: number | null;
  unit_price: number;
  listed_quantity: number;
  reserved_quantity: number;
  sold_quantity: number;
  remaining_quantity: number;
  availability_mode: string;
  harvest_start_at?: string | null;
  harvest_end_at?: string | null;
  harvest_order_cutoff_at?: string | null;
  default_prep_minutes: number;
  vehicle_requirement: string;
  handling_eligible: boolean;
  is_active: boolean;
};

const SESSION_ACCESS_CODE = "JRIDE_AGRIMARKET_ACCESS_CODE";
const SESSION_PIN = "JRIDE_AGRIMARKET_ACCESS_PIN";

function farmerHeaders(accessCode: string, pin: string, json = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-jride-agrimarket-code": accessCode.trim().toUpperCase(),
    "x-jride-agrimarket-pin": pin.trim(),
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function money(value: unknown): string {
  const n = Number(value || 0);
  return `PHP ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "-";
}

function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const date = new Date(localValue);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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
  unit_weight_kg: "1",
  unit_price: "",
  available_quantity: "",
  availability_mode: "always_available",
  harvest_start_at: "",
  harvest_end_at: "",
  harvest_order_cutoff_at: "",
  default_prep_minutes: "15",
  vehicle_requirement: "either",
  handling_eligible: false,
};

export default function AgrimarketProducerProductsPage() {
  const [accessCode, setAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [connected, setConnected] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(initialForm);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedCode = window.sessionStorage.getItem(SESSION_ACCESS_CODE) || "";
    const savedPin = window.sessionStorage.getItem(SESSION_PIN) || "";
    setAccessCode(savedCode);
    setPin(savedPin);
    if (savedCode && savedPin) void loadProducts(savedCode, savedPin);
  }, []);

  async function loadProducts(code = accessCode, accessPin = pin) {
    if (!code.trim() || !accessPin.trim()) return;
    setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/producer/products", {
      cache: "no-store",
      headers: farmerHeaders(code, accessPin),
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
      setStockDraft(Object.fromEntries(rows.map((row: Product) => [row.id, String(row.remaining_quantity)])));
      setWeightDraft(Object.fromEntries(rows.map((row: Product) => [row.id, row.unit_weight_kg == null ? "" : String(row.unit_weight_kg)])));
      setConnected(true);
      window.sessionStorage.setItem(SESSION_ACCESS_CODE, code.trim().toUpperCase());
      window.sessionStorage.setItem(SESSION_PIN, accessPin.trim());
    }
    setLoading(false);
  }

  async function productAction(body: any, busyKey: string) {
    setBusy(busyKey);
    setError("");
    setMessage("");
    const response = await fetch("/api/agrimarket/producer/products", {
      method: "POST",
      headers: farmerHeaders(accessCode, pin, true),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update the product.");
    } else {
      const rows = Array.isArray(payload?.products) ? payload.products : [];
      setProducts(rows);
      setStockDraft(Object.fromEntries(rows.map((row: Product) => [row.id, String(row.remaining_quantity)])));
      setWeightDraft(Object.fromEntries(rows.map((row: Product) => [row.id, row.unit_weight_kg == null ? "" : String(row.unit_weight_kg)])));
      setMessage("Product list updated.");
    }
    setBusy("");
  }

  async function createProduct(event: React.FormEvent) {
    event.preventDefault();
    const scheduled = form.availability_mode === "scheduled_harvest";
    await productAction({
      action: "create",
      ...form,
      harvest_start_at: scheduled ? toIso(form.harvest_start_at) : null,
      harvest_end_at: scheduled ? toIso(form.harvest_end_at) : null,
      harvest_order_cutoff_at: scheduled ? toIso(form.harvest_order_cutoff_at) : null,
    }, "create");
    setForm(initialForm);
  }

  if (disabled) {
    return <main className="min-h-screen bg-emerald-50 p-8"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8"><h1 className="text-2xl font-bold">Agrimarket product listing is not enabled yet</h1></div></main>;
  }

  if (!connected) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl border bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-2xl font-bold">Farmer product manager</h1>
          {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <input value={accessCode} onChange={(e) => setAccessCode(e.target.value.toUpperCase())} className="mt-5 w-full rounded-xl border px-3 py-3" placeholder="Agrimarket Access Code" />
          <input inputMode="numeric" type="password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-3 w-full rounded-xl border px-3 py-3" placeholder="6-digit PIN" />
          <button onClick={() => loadProducts()} disabled={loading || !accessCode || pin.length !== 6} className="mt-4 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">{loading ? "Checking..." : "Open product manager"}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket Farmer</p><h1 className="text-3xl font-bold">Products and stock</h1><p className="mt-1 text-sm text-slate-600">FREE listing, 0% farmer deduction, no farmer wallet.</p></div>
          <div className="flex gap-2"><Link href="/agrimarket/producer" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Orders</Link><button onClick={() => loadProducts()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button></div>
        </div>
        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <section className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="text-xl font-bold">Add product</h2>
          <form onSubmit={createProduct} className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm font-semibold">Product name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Category<select value={form.product_group} onChange={(e) => setForm({ ...form, product_group: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="produce">Produce</option><option value="grain">Rice / Grain</option><option value="aquatic">Aquatic</option><option value="poultry">Poultry</option><option value="livestock">Livestock</option><option value="meat">Fresh Meat</option><option value="eggs">Eggs</option><option value="other_agri">Other Agri</option></select></label>
            <label className="text-sm font-semibold">Selling unit<input required value={form.selling_unit} onChange={(e) => setForm({ ...form, selling_unit: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="kg / head / sack / tray" /></label>
            <label className="text-sm font-semibold">Estimated weight per selling unit (kg)<input required type="number" min="0.001" step="0.001" value={form.unit_weight_kg} onChange={(e) => setForm({ ...form, unit_weight_kg: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /><span className="mt-1 block text-xs font-normal text-slate-500">Use 1.000 when the selling unit itself is 1 kg.</span></label>
            <label className="text-sm font-semibold">Price per unit<input required type="number" min="0" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">{form.availability_mode === "scheduled_harvest" ? "Expected reservable harvest quantity" : "Available quantity"}<input required type="number" min="0" step="0.01" value={form.available_quantity} onChange={(e) => setForm({ ...form, available_quantity: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Preparation minutes<input type="number" min="0" max="1440" value={form.default_prep_minutes} onChange={(e) => setForm({ ...form, default_prep_minutes: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Species / type<input value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Breed<input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Meat cut<input value={form.meat_cut} onChange={(e) => setForm({ ...form, meat_cut: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Condition<select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="normal">Normal</option><option value="fresh">Fresh</option><option value="chilled">Chilled</option><option value="frozen">Frozen</option><option value="live_at_pickup">Live at pickup</option></select></label>
            <label className="text-sm font-semibold">Cargo class<select value={form.cargo_class} onChange={(e) => setForm({ ...form, cargo_class: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="standard_produce">Standard produce</option><option value="fragile_produce">Fragile produce</option><option value="bulk_sack">Bulk sack</option><option value="crate">Crate</option><option value="live_fish">Live fish</option><option value="live_poultry">Live poultry</option><option value="live_livestock">Live livestock</option><option value="fresh_meat">Fresh meat</option><option value="chilled_meat">Chilled meat</option><option value="frozen_meat">Frozen meat</option><option value="other_agri">Other agri</option></select></label>
            <label className="text-sm font-semibold">Vehicle<select value={form.vehicle_requirement} onChange={(e) => setForm({ ...form, vehicle_requirement: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="either">Motorcycle or Tricycle</option><option value="motorcycle">Motorcycle</option><option value="tricycle">Tricycle</option></select></label>
            <label className="text-sm font-semibold">Availability<select value={form.availability_mode} onChange={(e) => setForm({ ...form, availability_mode: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="always_available">Always Available</option><option value="scheduled_harvest">Scheduled Harvest</option></select></label>
            {form.availability_mode === "scheduled_harvest" ? <>
              <label className="text-sm font-semibold">Reservation cutoff<input required type="datetime-local" value={form.harvest_order_cutoff_at} onChange={(e) => setForm({ ...form, harvest_order_cutoff_at: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
              <label className="text-sm font-semibold">Expected harvest start<input required type="datetime-local" value={form.harvest_start_at} onChange={(e) => setForm({ ...form, harvest_start_at: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
              <label className="text-sm font-semibold">Expected harvest end<input type="datetime-local" value={form.harvest_end_at} onChange={(e) => setForm({ ...form, harvest_end_at: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
              <p className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900 md:col-span-2 lg:col-span-3">Scheduled Harvest is an expected window, not a guarantee. No driver is assigned until you later mark the harvest ready. Shortfall or delay requires customer approval.</p>
            </> : null}
            <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={form.handling_eligible} onChange={(e) => setForm({ ...form, handling_eligible: e.target.checked })} /> Driver loading help may be needed</label>
            <label className="text-sm font-semibold md:col-span-2">Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 min-h-20 w-full rounded-xl border px-3 py-3" /></label>
            <button disabled={busy === "create"} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">{busy === "create" ? "Saving..." : "Add product"}</button>
          </form>
        </section>

        <section className="mt-5 grid gap-4 md:grid-cols-2">
          {products.map((product) => (
            <article key={product.id} className="rounded-2xl border bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{product.name}</h3><p className="text-sm text-slate-500">{product.product_group} - {product.selling_unit}</p><p className="mt-1 text-xs text-slate-500">Estimated unit weight: {product.unit_weight_kg == null ? "Not set" : `${product.unit_weight_kg} kg per ${product.selling_unit}`}</p></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${product.is_active ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{product.is_active ? "Active" : "Paused"}</span></div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div className="rounded-xl bg-slate-50 p-3">Price<br/><strong>{money(product.unit_price)}</strong></div><div className="rounded-xl bg-slate-50 p-3">Reservable now<br/><strong>{product.remaining_quantity}</strong></div><div className="rounded-xl bg-slate-50 p-3">Reserved<br/><strong>{product.reserved_quantity}</strong></div><div className="rounded-xl bg-slate-50 p-3">Sold<br/><strong>{product.sold_quantity}</strong></div></div>
              {product.availability_mode === "scheduled_harvest" ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Scheduled Harvest</strong><br/>Order cutoff: {formatDate(product.harvest_order_cutoff_at)}<br/>Expected: {formatDate(product.harvest_start_at)}{product.harvest_end_at ? ` to ${formatDate(product.harvest_end_at)}` : ""}</div> : null}
              <div className="mt-3 flex flex-wrap items-end gap-2"><label className="text-xs font-semibold">Unit weight (kg)<input type="number" min="0.001" step="0.001" value={weightDraft[product.id] ?? ""} onChange={(e) => setWeightDraft((current) => ({ ...current, [product.id]: e.target.value }))} className="mt-1 block w-32 rounded-xl border px-3 py-2"/></label><button onClick={() => productAction({ action: "set_unit_weight", product_id: product.id, unit_weight_kg: Number(weightDraft[product.id]) }, `weight-${product.id}`)} className="rounded-xl border px-3 py-2 text-sm font-semibold">Update weight</button></div>
              <div className="mt-4 flex flex-wrap gap-2"><input type="number" min="0" step="0.01" value={stockDraft[product.id] ?? ""} onChange={(e) => setStockDraft((current) => ({ ...current, [product.id]: e.target.value }))} className="w-32 rounded-xl border px-3 py-2"/><button onClick={() => productAction({ action: "set_available_quantity", product_id: product.id, available_quantity: Number(stockDraft[product.id]) }, `stock-${product.id}`)} className="rounded-xl border px-3 py-2 text-sm font-semibold">Update quantity</button><button onClick={() => productAction({ action: "set_active", product_id: product.id, is_active: !product.is_active }, `active-${product.id}`)} className="rounded-xl border px-3 py-2 text-sm font-semibold">{product.is_active ? "Pause" : "Reopen"}</button></div>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
