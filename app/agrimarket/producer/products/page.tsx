"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Bird, Egg, Fish, Leaf, Package, Pause, Plus, Search, Sprout, Wheat, X } from "lucide-react";
import { FarmerFeedback, FarmerLogin, FarmerUnavailable, FarmerWorkspace } from "../FarmerWorkspace";
import styles from "../farmer.module.css";
import { ProductPhoto } from "../../ProductPhoto";
import { PhotoPicker } from "./PhotoPicker";

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
  photo_urls?: string[];
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
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number.isFinite(n) ? n : 0);
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
  unit_weight_kg: "",
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
  const [vendorName, setVendorName] = useState("");
  const [vendorNameDraft, setVendorNameDraft] = useState("");
  const [form, setForm] = useState(initialForm);
  const [stockDraft, setStockDraft] = useState<Record<string, string>>({});
  const [weightDraft, setWeightDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState("");
  const [preparingPhoto, setPreparingPhoto] = useState(false);
  const createPanel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!newPhoto) { setNewPhotoPreview(""); return; }
    const url = URL.createObjectURL(newPhoto); setNewPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [newPhoto]);

  async function savePhoto(productId: string, file: File | null) {
    const body = new FormData(); body.append("product_id", productId);
    if (file) body.append("file", file);
    const response = await fetch("/api/agrimarket/producer/products/photo", {
      method: file ? "POST" : "DELETE",
      headers: farmerHeaders(accessCode, pin, !file),
      body: file ? body : JSON.stringify({ product_id: productId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.message || "Photo could not be saved. Refresh to check the current photo.");
    setProducts(current => current.map(product => product.id === productId ? { ...product, photo_urls: payload.product.photo_urls } : product));
  }

  async function changePhoto(productId: string, file: File | null) {
    setBusy(`photo-${productId}`); setError(""); setMessage("");
    try { await savePhoto(productId, file); setMessage(file ? "Product photo saved." : "Product photo removed."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Photo update interrupted. Refresh to check what was saved."); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    if (showCreate) createPanel.current?.scrollIntoView({ block: "start" });
  }, [showCreate]);

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
    try {
    const response = await fetch("/api/agrimarket/producer/products", {
      cache: "no-store",
      headers: farmerHeaders(code, accessPin),
    });
    const payload = await response.json().catch(() => ({}));
    if (["AGRIMARKET_DISABLED", "AGRIMARKET_FARMER_PORTAL_DISABLED"].includes(payload?.error)) {
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
      setVendorName(payload.vendor_name || ""); setVendorNameDraft(payload.vendor_name || "");
      setStockDraft(Object.fromEntries(rows.map((row: Product) => [row.id, String(row.remaining_quantity)])));
      setWeightDraft(Object.fromEntries(rows.map((row: Product) => [row.id, row.unit_weight_kg == null ? "" : String(row.unit_weight_kg)])));
      setConnected(true);
      window.sessionStorage.setItem(SESSION_ACCESS_CODE, code.trim().toUpperCase());
      window.sessionStorage.setItem(SESSION_PIN, accessPin.trim());
    }
    } catch {
      setError("We couldn’t refresh your products. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function productAction(body: any, busyKey: string) {
    setBusy(busyKey);
    setError("");
    setMessage("");
    try {
    const response = await fetch("/api/agrimarket/producer/products", {
      method: "POST",
      headers: farmerHeaders(accessCode, pin, true),
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update the product.");
      return false;
    } else {
      const rows = Array.isArray(payload?.products) ? payload.products : [];
      setProducts(rows);
      setVendorName(payload.vendor_name || ""); setVendorNameDraft(payload.vendor_name || "");
      setStockDraft(Object.fromEntries(rows.map((row: Product) => [row.id, String(row.remaining_quantity)])));
      setWeightDraft(Object.fromEntries(rows.map((row: Product) => [row.id, row.unit_weight_kg == null ? "" : String(row.unit_weight_kg)])));
      setMessage(busyKey === "vendor-name" ? "Your private vendor name is saved." : "Product list updated.");
      if (busyKey === "create" && newPhoto) {
        if (payload.created_product_id) {
          try { await savePhoto(payload.created_product_id, newPhoto); setMessage("Product and photo saved."); }
          catch (reason) { setMessage(""); setError(`Product saved, but its photo needs another try. Use Add photo on the product card. ${reason instanceof Error ? reason.message : ""}`); }
        } else { setMessage(""); setError("Product saved. Use Add photo on its card to upload the photo."); }
      }
      return true;
    }
    } catch {
      setError("The update was interrupted. Refresh your products to check what was saved before trying again.");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function createProduct(event: React.FormEvent) {
    event.preventDefault();
    const scheduled = form.availability_mode === "scheduled_harvest";
    const saved = await productAction({
      action: "create",
      ...form,
      harvest_start_at: scheduled ? toIso(form.harvest_start_at) : null,
      harvest_end_at: scheduled ? toIso(form.harvest_end_at) : null,
      harvest_order_cutoff_at: scheduled ? toIso(form.harvest_order_cutoff_at) : null,
    }, "create");
    if (saved) {
      setForm(initialForm);
      setNewPhoto(null);
      setShowCreate(false);
    }
  }

  if (disabled) {
    return <FarmerUnavailable section="products" />;
  }

  if (!connected) {
    return <FarmerLogin section="products" accessCode={accessCode} pin={pin} onCodeChange={setAccessCode} onPinChange={setPin} onSubmit={() => void loadProducts()} loading={loading} error={error} />;
  }

  const activeCount = products.filter((product) => product.is_active).length;
  const visibleProducts = products.filter((product) =>
    (filter === "all" || (filter === "active" ? product.is_active : !product.is_active)) &&
    product.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  const productIcons: Record<string, typeof Leaf> = { produce: Leaf, grain: Wheat, eggs: Egg, aquatic: Fish, poultry: Bird };
  const groupNames: Record<string, string> = { produce: "Fresh produce", grain: "Rice & grain", eggs: "Eggs", aquatic: "Fish & seafood", poultry: "Poultry", livestock: "Livestock", meat: "Fresh meat", other_agri: "Farm products" };

  return (
    <FarmerWorkspace section="products" onRefresh={() => void loadProducts()} loading={loading || Boolean(busy)}>
        <div className={styles.productHeading}>
          <div><span className={styles.eyebrow}>YOUR PRIVATE VENDOR SPACE</span><h1 className="break-words">{vendorName || "Your farm shelf."}</h1><p>Your products, photos and stock, together in one place.</p></div>
          <button type="button" className={styles.addButton} aria-label="Add product" aria-expanded={showCreate} aria-controls="new-product" onClick={() => setShowCreate(!showCreate)}>{showCreate ? <X size={23} /> : <Plus size={23} />}</button>
        </div>
        <form className="mb-6 rounded-2xl border border-[#dfe5d7] bg-white p-5" onSubmit={event => { event.preventDefault(); void productAction({ action: "set_vendor_name", vendor_name: vendorNameDraft }, "vendor-name"); }}>
          <label htmlFor="vendor-name" className="text-sm font-semibold">Vendor name</label>
          <div className="mt-2 flex flex-wrap gap-3"><input id="vendor-name" required minLength={2} maxLength={60} value={vendorNameDraft} onChange={event => setVendorNameDraft(event.target.value)} placeholder="Enter your vendor or farm name" className="min-w-0 flex-1 rounded-xl border px-3 py-3" /><button type="submit" disabled={!!busy || vendorNameDraft.trim().length < 2} className={styles.secondaryButton}>{busy === "vendor-name" ? "Saving…" : "Save vendor name"}</button></div>
          <p className="mt-2 text-xs text-slate-600">Hidden from passengers. Visible to you, Admin and the driver assigned to your order.</p>
        </form>
        <div className={styles.stats} aria-label="Product overview"><div className={styles.stat}><strong>{products.length}</strong><span>Total products</span></div><div className={styles.stat}><strong>{activeCount}</strong><span>Active listings</span></div><div className={styles.stat}><strong>{products.length - activeCount}</strong><span>Paused listings</span></div></div>
        <FarmerFeedback error={showCreate ? undefined : error} message={message} />

        {showCreate && <section ref={createPanel} id="new-product" className={styles.createPanel}>
          <div className={styles.sectionHeading}><div><h2>A new addition to your farm.</h2><p>Add the product details, then check its pickup needs.</p></div><button type="button" className={styles.quietButton} aria-label="Close add product" onClick={() => setShowCreate(false)}><X size={20} /></button></div>
          <FarmerFeedback error={error} />
          <form onSubmit={createProduct}>
            <fieldset className={styles.formSection}><legend>Product photo <span className="text-xs font-normal">(optional)</span></legend>
              <div className="flex flex-wrap items-start gap-4">
                {newPhotoPreview && <img src={newPhotoPreview} alt="New product photo preview" className="h-36 w-48 rounded-2xl object-cover" />}
                <div><PhotoPicker label={newPhoto ? "Change selected photo" : "Choose product photo"} disabled={!!busy} onBusy={setPreparingPhoto} onSelect={file => setNewPhoto(file)} />
                  <p className="mt-2 max-w-sm text-xs text-slate-600">Choose a clear photo of this product. JPG, PNG or WebP; phone photos are resized automatically. Customers will see this photo.</p>
                  {newPhoto && <button type="button" disabled={!!busy || preparingPhoto} className="mt-2 text-sm text-red-800 underline" onClick={() => setNewPhoto(null)}>Remove selected photo</button>}
                </div>
              </div>
            </fieldset>
          <fieldset className={styles.formSection}><legend><span>01</span> Product & pricing</legend><div className={styles.formGrid}>
            <label className="text-sm font-semibold">Product name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Category<select value={form.product_group} onChange={(e) => setForm({ ...form, product_group: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="produce">Produce</option><option value="grain">Rice / Grain</option><option value="aquatic">Aquatic</option><option value="poultry">Poultry</option><option value="livestock">Livestock</option><option value="meat">Fresh Meat</option><option value="eggs">Eggs</option><option value="other_agri">Other Agri</option></select></label>
            <label className="text-sm font-semibold">How is this product priced?<input required value={form.selling_unit} onChange={(e) => setForm({ ...form, selling_unit: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" placeholder="kg / head (standing price) / sack / tray / bundle" /><span className="mt-1 block text-xs font-normal text-slate-500">For livestock, use "head" when selling the whole animal at a standing price. Use "kg" only when pricing by measured weight.</span></label>
            <label className="text-sm font-semibold">Price per unit<input required type="number" min="0" step="0.01" value={form.unit_price} onChange={(e) => setForm({ ...form, unit_price: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">{form.availability_mode === "scheduled_harvest" ? "Expected reservable harvest quantity" : "Available quantity"}<input required type="number" min="0" step="0.01" value={form.available_quantity} onChange={(e) => setForm({ ...form, available_quantity: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className={styles.fullWidth}>Description<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} placeholder="Tell customers a little about your product." /></label>
            <label className="text-sm font-semibold">Species / type<input value={form.species} onChange={(e) => setForm({ ...form, species: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Breed<input value={form.breed} onChange={(e) => setForm({ ...form, breed: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
            <label className="text-sm font-semibold">Meat cut<input value={form.meat_cut} onChange={(e) => setForm({ ...form, meat_cut: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
          </div></fieldset>
          <fieldset className={styles.formSection}><legend><span>02</span> Pickup & delivery</legend><div className={styles.formGrid}>
            <label>Weight per selling unit (kg)<input type="number" min="0.001" step="0.001" value={form.unit_weight_kg} onChange={(e) => setForm({ ...form, unit_weight_kg: e.target.value })} placeholder="Optional" /><span className={styles.fieldHint}>Leave blank if unknown. Products sold by kg can use 1 kg per unit.</span></label>
            <label>Preparation time (minutes)<input type="number" min="0" max="1440" value={form.default_prep_minutes} onChange={(e) => setForm({ ...form, default_prep_minutes: e.target.value })} /></label>
            <label className="text-sm font-semibold">Condition<select value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="normal">Normal</option><option value="fresh">Fresh</option><option value="chilled">Chilled</option><option value="frozen">Frozen</option><option value="live_at_pickup">Live at pickup</option></select></label>
            <label className="text-sm font-semibold">Cargo class<select value={form.cargo_class} onChange={(e) => setForm({ ...form, cargo_class: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="standard_produce">Standard produce</option><option value="fragile_produce">Fragile produce</option><option value="bulk_sack">Bulk sack</option><option value="crate">Crate</option><option value="live_fish">Live fish</option><option value="live_poultry">Live poultry</option><option value="live_livestock">Live livestock</option><option value="fresh_meat">Fresh meat</option><option value="chilled_meat">Chilled meat</option><option value="frozen_meat">Frozen meat</option><option value="other_agri">Other agri</option></select></label>
            <label className="text-sm font-semibold">Vehicle<select value={form.vehicle_requirement} onChange={(e) => setForm({ ...form, vehicle_requirement: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="either">Motorcycle or Tricycle</option><option value="motorcycle">Motorcycle</option><option value="tricycle">Tricycle</option></select></label>
            <label className={styles.checkLabel}><input type="checkbox" checked={form.handling_eligible} onChange={(e) => setForm({ ...form, handling_eligible: e.target.checked })} /> Driver loading help may be needed</label>
          </div></fieldset>
          <fieldset className={styles.formSection}><legend><span>03</span> Availability</legend><div className={styles.formGrid}>
            <label className="text-sm font-semibold">Availability<select value={form.availability_mode} onChange={(e) => setForm({ ...form, availability_mode: e.target.value })} className="mt-1 w-full rounded-xl border bg-white px-3 py-3"><option value="always_available">Always Available</option><option value="scheduled_harvest">Scheduled Harvest</option></select></label>
            {form.availability_mode === "scheduled_harvest" ? <>
              <label className="text-sm font-semibold">Reservation cutoff<input required type="datetime-local" value={form.harvest_order_cutoff_at} onChange={(e) => setForm({ ...form, harvest_order_cutoff_at: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
              <label className="text-sm font-semibold">Expected harvest start<input required type="datetime-local" value={form.harvest_start_at} onChange={(e) => setForm({ ...form, harvest_start_at: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
              <label className="text-sm font-semibold">Expected harvest end<input type="datetime-local" value={form.harvest_end_at} onChange={(e) => setForm({ ...form, harvest_end_at: e.target.value })} className="mt-1 w-full rounded-xl border px-3 py-3" /></label>
              <p className={`${styles.scheduleNote} ${styles.fullWidth}`}>Scheduled Harvest is an expected window, not a guarantee. No driver is assigned until you later mark the harvest ready. Shortfall or delay requires customer approval.</p>
            </> : null}
          </div></fieldset>
            <div className={styles.formActions}><button type="button" disabled={!!busy || preparingPhoto} className={styles.quietButton} onClick={() => { setShowCreate(false); setNewPhoto(null); }}>Cancel</button><button disabled={!!busy || preparingPhoto} className={styles.primaryButton}>{busy === "create" ? "Saving…" : "Add product"}<ArrowUpRight size={17} /></button></div>
          </form>
        </section>}

        <div className={styles.productToolbar}>
          <label className={styles.search}><Search size={18} /><input aria-label="Search your products" type="search" placeholder="Find a product on your shelf" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className={styles.filters} aria-label="Filter products">{[{ id: "all", label: "All products", count: products.length }, { id: "active", label: "Active", count: activeCount }, { id: "paused", label: "Paused", count: products.length - activeCount }].map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`${styles.filter} ${filter === item.id ? styles.filterActive : ""}`}>{item.label}<span className={styles.filterCount}>{item.count}</span></button>)}</div>
        </div>
        {!visibleProducts.length && <div className={styles.emptyCard}><span className={styles.emptyIcon}><Sprout size={40} /></span><h2>{products.length ? "No products in this view." : "Let’s fill your farm shelf."}</h2><p>{products.length ? "Try another name or switch filters to find your products." : "Add your first product with its price, stock and pickup details."}</p>{products.length ? <button className={styles.secondaryButton} onClick={() => { setQuery(""); setFilter("all"); }}>Show all products</button> : <button className={styles.primaryButton} onClick={() => setShowCreate(true)}>Add my first product <Plus size={17} /></button>}</div>}
        <section className={styles.productGrid} aria-label="Your products" aria-busy={loading}>
          {visibleProducts.map((product) => {
            const ProductIcon = productIcons[product.product_group] || Package;
            return <article key={product.id} className={styles.productCard}>
              <div className={styles.productBody}>
                <ProductPhoto url={product.photo_urls?.[0]} name={product.name} className="mb-4" />
                <div className="mb-4 flex flex-wrap items-center gap-3" aria-busy={busy === `photo-${product.id}`}>
                  <PhotoPicker label={product.photo_urls?.length ? "Change photo" : "Add photo"} disabled={!!busy} onSelect={file => changePhoto(product.id, file)} />
                  {!!product.photo_urls?.length && <button type="button" disabled={!!busy} className="text-sm text-red-800 underline disabled:opacity-50" onClick={() => void changePhoto(product.id, null)}>Remove photo</button>}
                  {busy === `photo-${product.id}` && <span role="status" className="text-xs text-slate-600">Saving photo…</span>}
                </div>
                <div className={styles.productTop}><span className={styles.productGlyph} data-group={product.product_group}><ProductIcon size={29} strokeWidth={1.4} /></span><div className={styles.productName}><h2>{product.name}</h2><p>{groupNames[product.product_group] || "Farm products"} · {product.unit_weight_kg == null ? "Weight not set" : `${product.unit_weight_kg} kg / ${product.selling_unit}`}</p></div></div>
                <div className={styles.productPriceRow}><strong>{money(product.unit_price)}<small>/ {product.selling_unit}</small></strong><span className={`${styles.badge} ${product.is_active ? styles.activeBadge : ""}`}>{!product.is_active && <Pause size={10} />}{product.is_active ? "Active" : "Paused"}</span></div>
                <div className={styles.stockStats}><div><strong>{product.remaining_quantity}</strong><span>Available to reserve</span></div><div><strong>{product.reserved_quantity}</strong><span>Reserved</span></div><div><strong>{product.sold_quantity}</strong><span>Sold</span></div></div>
                {product.availability_mode === "scheduled_harvest" && <div className={styles.scheduleNote}><strong>Scheduled harvest</strong><br />Order cutoff: {formatDate(product.harvest_order_cutoff_at)}<br />Expected: {formatDate(product.harvest_start_at)}{product.harvest_end_at ? ` to ${formatDate(product.harvest_end_at)}` : ""}</div>}
              </div>
              <details className={styles.editDetails}>
                <summary>Edit stock & weight<span className="sr-only"> for {product.name}</span></summary>
                <div className={styles.editGrid}>
                  <form className={styles.editRow} onSubmit={(event) => { event.preventDefault(); void productAction({ action: "set_available_quantity", product_id: product.id, available_quantity: Number(stockDraft[product.id]) }, `stock-${product.id}`); }}><label>Available quantity<input required type="number" min="0" step="0.01" value={stockDraft[product.id] ?? ""} onChange={(event) => setStockDraft((current) => ({ ...current, [product.id]: event.target.value }))} /></label><button disabled={Boolean(busy)} className={styles.secondaryButton}>{busy === `stock-${product.id}` ? "Saving…" : "Save stock"}</button></form>
                  <form className={styles.editRow} onSubmit={(event) => { event.preventDefault(); void productAction({ action: "set_unit_weight", product_id: product.id, unit_weight_kg: (weightDraft[product.id] || "").trim() ? Number(weightDraft[product.id]) : null }, `weight-${product.id}`); }}><label>Weight per unit (kg)<input type="number" min="0.001" step="0.001" value={weightDraft[product.id] ?? ""} onChange={(event) => setWeightDraft((current) => ({ ...current, [product.id]: event.target.value }))} /></label><button disabled={Boolean(busy)} className={styles.secondaryButton}>{busy === `weight-${product.id}` ? "Saving…" : "Save weight"}</button></form>
                  <button type="button" disabled={Boolean(busy)} onClick={() => void productAction({ action: "set_active", product_id: product.id, is_active: !product.is_active }, `active-${product.id}`)} className={styles.secondaryButton}>{busy === `active-${product.id}` ? "Updating…" : product.is_active ? "Pause listing" : "Reopen listing"}</button>
                </div>
              </details>
            </article>;
          })}
        </section>
    </FarmerWorkspace>
  );
}
