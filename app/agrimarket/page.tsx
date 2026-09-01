"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AddressRow = {
  id: string;
  label: string;
  address_text: string;
  landmark?: string | null;
  has_valid_pin: boolean;
  is_primary: boolean;
};

type ProductRow = {
  id: string;
  name: string;
  producer_alias: string;
  proximity_rank: number;
  cart_group_key: string;
  harvest_window_key: string;
  approximate_road_distance_km?: number | null;
  approximate_road_duration_minutes?: number | null;
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
  remaining_quantity: number;
  availability_mode: "always_available" | "scheduled_harvest";
  harvest_start_at?: string | null;
  harvest_end_at?: string | null;
  harvest_order_cutoff_at?: string | null;
  preparation_minutes: number;
  vehicle_requirement: string;
  handling_eligible: boolean;
  can_order_now: boolean;
  order_action?: string | null;
  order_blocker?: string | null;
};

type CartLine = { product: ProductRow; quantity: number };

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  if (typeof window === "undefined") return headers;
  const token =
    window.localStorage.getItem("jride_passenger_token") ||
    window.localStorage.getItem("jride_access_token") ||
    window.sessionStorage.getItem("jride_passenger_token") ||
    window.sessionStorage.getItem("jride_access_token") ||
    "";
  const deviceId =
    window.localStorage.getItem("jride_native_device_id") ||
    window.sessionStorage.getItem("jride_native_device_id") ||
    "";
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  if (deviceId.trim()) headers["x-device-id"] = deviceId.trim();
  return headers;
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
    : "-";
}

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AgrimarketPage() {
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [addressId, setAddressId] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [preferredVehicle, setPreferredVehicle] = useState<"motorcycle" | "tricycle">("motorcycle");
  const [quote, setQuote] = useState<any>(null);
  const [placed, setPlaced] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [quoting, setQuoting] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [error, setError] = useState("");
  const [cartMessage, setCartMessage] = useState("");

  useEffect(() => { void initialize(); }, []);

  async function initialize() {
    setLoading(true);
    setError("");
    const statusRes = await fetch("/api/agrimarket/status", { cache: "no-store" });
    const status = await statusRes.json().catch(() => ({}));
    if (!status?.enabled) {
      setDisabled(true);
      setLoading(false);
      return;
    }

    const addressRes = await fetch("/api/agrimarket/addresses", { cache: "no-store", headers: authHeaders() });
    const addressPayload = await addressRes.json().catch(() => ({}));
    if (!addressRes.ok || addressPayload?.ok === false) {
      setError(addressPayload?.message || addressPayload?.error || "Unable to load delivery addresses.");
      setLoading(false);
      return;
    }
    const rows: AddressRow[] = Array.isArray(addressPayload?.addresses) ? addressPayload.addresses : [];
    setAddresses(rows);
    const selected = rows.find((row) => row.is_primary && row.has_valid_pin) || rows.find((row) => row.has_valid_pin);
    if (selected) {
      setAddressId(selected.id);
      await loadCatalog(selected.id);
    }
    setLoading(false);
  }

  async function loadCatalog(nextAddressId: string) {
    setError("");
    setQuote(null);
    setPlaced(null);
    setCart([]);
    setCartMessage("");
    setSelectedProductId(null);
    if (!nextAddressId) return setProducts([]);
    const params = new URLSearchParams({ address_id: nextAddressId });
    const response = await fetch(`/api/agrimarket/catalog?${params.toString()}`, { cache: "no-store", headers: authHeaders() });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setProducts([]);
      setError(payload?.message || payload?.error || "Unable to load Agrimarket products.");
      return;
    }
    setProducts(Array.isArray(payload?.products) ? payload.products : []);
  }

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((product) => {
      if (category !== "all" && product.product_group !== category) return false;
      if (!q) return true;
      return `${product.name} ${product.species || ""} ${product.breed || ""} ${product.producer_alias}`.toLowerCase().includes(q);
    });
  }, [products, query, category]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) || null,
    [products, selectedProductId]
  );

  const moreFromSelectedFarmer = useMemo(() => {
    if (!selectedProduct) return [];
    return products
      .filter(
        (product) =>
          product.id !== selectedProduct.id &&
          product.cart_group_key === selectedProduct.cart_group_key
      )
      .sort((a, b) => {
        const byName = a.name.localeCompare(b.name);
        if (byName !== 0) return byName;
        if (a.proximity_rank !== b.proximity_rank) return a.proximity_rank - b.proximity_rank;
        return a.unit_price - b.unit_price;
      });
  }, [products, selectedProduct]);

  const cartSubtotal = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.unit_price * line.quantity, 0),
    [cart]
  );
  const requiresTricycle = cart.some((line) => line.product.vehicle_requirement === "tricycle");
  const cartMode = cart[0]?.product.availability_mode || null;
  const cartHarvest = cartMode === "scheduled_harvest" ? cart[0]?.product : null;

  useEffect(() => {
    if (requiresTricycle && preferredVehicle !== "tricycle") setPreferredVehicle("tricycle");
  }, [requiresTricycle, preferredVehicle]);

  function openProduct(product: ProductRow) {
    setSelectedProductId(product.id);
  }

  function addToCart(product: ProductRow) {
    setCartMessage("");
    setQuote(null);
    setPlaced(null);
    if (!product.can_order_now) {
      setCartMessage("This harvest is no longer accepting reservations.");
      return;
    }
    if (cart.length) {
      const first = cart[0].product;
      if (first.cart_group_key !== product.cart_group_key) {
        setCartMessage("This product is from another farmer. Finish this farmer's order or clear the cart first.");
        return;
      }
      if (first.availability_mode !== product.availability_mode) {
        setCartMessage("Always Available and Scheduled Harvest products cannot be combined in one order.");
        return;
      }
      if (product.availability_mode === "scheduled_harvest" && first.harvest_window_key !== product.harvest_window_key) {
        setCartMessage("Scheduled Harvest products can share one cart only when they have the same harvest window.");
        return;
      }
    }

    setCart((current) => {
      const existing = current.find((line) => line.product.id === product.id);
      if (existing) {
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: Math.min(line.quantity + 1, product.remaining_quantity) }
            : line
        );
      }
      return [...current, { product, quantity: Math.min(1, product.remaining_quantity) }];
    });
  }

  function updateQuantity(productId: string, value: number) {
    setQuote(null);
    setPlaced(null);
    setCart((current) => current
      .map((line) => line.product.id === productId
        ? { ...line, quantity: Math.min(Math.max(value, 0), line.product.remaining_quantity) }
        : line)
      .filter((line) => line.quantity > 0));
  }

  function clearCart() {
    setCart([]);
    setQuote(null);
    setPlaced(null);
    setCartMessage("");
  }

  function cartPayload() {
    return cart.map((line) => ({ product_id: line.product.id, quantity: line.quantity }));
  }

  async function getQuote() {
    if (!addressId || !cart.length) return;
    setQuoting(true);
    setError("");
    const response = await fetch("/api/agrimarket/quote", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({ address_id: addressId, items: cartPayload(), preferred_vehicle_type: preferredVehicle }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setQuote(null);
      setError(payload?.message || payload?.error || "Unable to calculate this Agrimarket quote.");
    } else {
      setQuote(payload);
    }
    setQuoting(false);
  }

  async function placeOrder() {
    if (!quote || !addressId || !cart.length) return;
    setOrdering(true);
    setError("");
    const requestId = crypto.randomUUID();
    const response = await fetch("/api/agrimarket/orders", {
      method: "POST",
      headers: { ...authHeaders(true), "x-idempotency-key": requestId },
      body: JSON.stringify({ address_id: addressId, items: cartPayload(), preferred_vehicle_type: preferredVehicle }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to place the Agrimarket order.");
    } else {
      setPlaced(payload.order);
      setQuote(null);
      setCart([]);
    }
    setOrdering(false);
  }

  if (disabled) {
    return <main className="min-h-screen bg-emerald-50 px-4 py-10"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm"><h1 className="text-3xl font-bold">Agrimarket is still in pre-launch</h1><p className="mt-3 text-slate-600">The marketplace will appear here when JRide enables it.</p><Link href="/passenger" className="mt-5 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Back to Passenger</Link></div></main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p><h1 className="text-3xl font-bold">Buy directly from local farmers</h1><p className="mt-1 text-sm text-slate-600">Farmer identities and exact source locations stay protected. Farmer numbers are based on road distance from your delivery address.</p></div>
          <div className="flex gap-2"><Link href="/agrimarket/order" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Track order</Link><Link href="/passenger" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Passenger home</Link></div>
        </header>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {cartMessage ? <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{cartMessage}</div> : null}
        {placed ? <div className="mt-4 rounded-2xl bg-emerald-50 p-5 text-emerald-950"><p className="font-bold">Order placed: {placed.order_code}</p><p className="mt-1 text-sm">{placed.fulfillment_mode === "scheduled_harvest" ? "Waiting for the farmer to confirm your harvest reservation." : "Waiting for farmer confirmation."}</p><Link href={`/agrimarket/order?code=${encodeURIComponent(placed.order_code)}`} className="mt-3 inline-flex rounded-xl bg-emerald-700 px-4 py-2 font-semibold text-white">Track this order</Link></div> : null}

        <section className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold">Deliver to<select value={addressId} onChange={(e) => { setAddressId(e.target.value); void loadCatalog(e.target.value); }} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="">Select delivery address</option>{addresses.filter((row) => row.has_valid_pin).map((address) => <option key={address.id} value={address.id}>{address.label || address.address_text}{address.is_primary ? " (Primary)" : ""}</option>)}</select></label>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><input value={query} onChange={(e) => setQuery(e.target.value)} className="rounded-xl border px-3 py-3" placeholder="Search products"/><select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-xl border bg-white px-3 py-3"><option value="all">All categories</option><option value="produce">Produce</option><option value="grain">Rice / Grain</option><option value="aquatic">Aquatic</option><option value="poultry">Poultry</option><option value="livestock">Livestock</option><option value="meat">Meat</option><option value="eggs">Eggs</option><option value="other_agri">Other</option></select></div>
          <p className="mt-2 text-xs text-slate-500">Browse by product first. Open a listing to see other current products from that same farmer.</p>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="min-w-0">
            {selectedProduct ? (
              <section id="agrimarket-product-detail" className="mb-5 rounded-3xl border border-emerald-200 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{selectedProduct.producer_alias}</p>
                    <h2 className="mt-1 text-2xl font-bold">{selectedProduct.name}</h2>
                    <p className="mt-1 text-sm text-slate-500">Approximately {selectedProduct.approximate_road_distance_km ?? "?"} km by road from your selected delivery address.</p>
                  </div>
                  <button type="button" onClick={() => setSelectedProductId(null)} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold text-slate-700">Close</button>
                </div>

                <p className="mt-4 text-sm text-slate-700">{selectedProduct.description || `${titleCase(selectedProduct.condition)} - ${titleCase(selectedProduct.cargo_class)}`}</p>
                <div className="mt-4 grid gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-3">
                  <div><p className="text-xs uppercase text-slate-500">Price</p><p className="font-bold">{money(selectedProduct.unit_price)} / {selectedProduct.selling_unit}</p></div>
                  <div><p className="text-xs uppercase text-slate-500">Available</p><p className="font-bold">{selectedProduct.remaining_quantity} reservable</p></div>
                  <div><p className="text-xs uppercase text-slate-500">Cargo</p><p className="font-bold">{titleCase(selectedProduct.cargo_class)}</p></div>
                </div>
                {selectedProduct.availability_mode === "scheduled_harvest" ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>Scheduled Harvest</strong><br/>Expected: {formatDate(selectedProduct.harvest_start_at)}{selectedProduct.harvest_end_at ? ` to ${formatDate(selectedProduct.harvest_end_at)}` : ""}<br/>Reserve by: {formatDate(selectedProduct.harvest_order_cutoff_at)}</div> : null}
                {selectedProduct.vehicle_requirement === "tricycle" ? <p className="mt-3 text-xs font-semibold text-blue-800">Tricycle required</p> : null}
                <button disabled={!selectedProduct.can_order_now} onClick={() => addToCart(selectedProduct)} className="mt-4 rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-300">{selectedProduct.can_order_now ? (selectedProduct.availability_mode === "scheduled_harvest" ? "Reserve in cart" : "Add to cart") : "Reservation closed"}</button>

                {moreFromSelectedFarmer.length ? (
                  <div className="mt-6 border-t pt-5">
                    <div>
                      <h3 className="text-lg font-bold">More from this farmer</h3>
                      <p className="mt-1 text-sm text-slate-600">Other current listings from this same farmer. The farmer's real identity and exact pickup location remain private.</p>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {moreFromSelectedFarmer.map((product) => (
                        <article key={product.id} className="rounded-2xl border bg-slate-50 p-4">
                          <p className="text-xs font-semibold uppercase text-emerald-700">{product.producer_alias}</p>
                          <h4 className="mt-1 font-bold">{product.name}</h4>
                          <p className="mt-2 text-sm text-slate-600">{money(product.unit_price)} / {product.selling_unit}</p>
                          <p className="mt-1 text-xs text-slate-500">{product.approximate_road_distance_km ?? "?"} km - {product.remaining_quantity} reservable</p>
                          <button type="button" onClick={() => openProduct(product)} className="mt-3 w-full rounded-xl border border-emerald-700 bg-white px-3 py-2 text-sm font-bold text-emerald-800">View product</button>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-5 border-t pt-4 text-sm text-slate-500">No other current listings from this farmer.</p>
                )}
              </section>
            ) : null}

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {loading ? <div className="rounded-2xl border bg-white p-6">Loading Agrimarket...</div> : null}
              {!loading && !filteredProducts.length ? <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">No products match your search.</div> : null}
              {!loading && filteredProducts.map((product) => (
                <article key={product.id} className="rounded-2xl border bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-2"><div><p className="text-xs font-semibold uppercase text-emerald-700">{product.producer_alias}</p><h2 className="mt-1 text-xl font-bold">{product.name}</h2></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{product.approximate_road_distance_km ?? "?"} km</span></div>
                  <p className="mt-2 text-sm text-slate-600">{product.description || `${titleCase(product.condition)} - ${titleCase(product.cargo_class)}`}</p>
                  <div className="mt-3 flex items-end justify-between"><div><strong className="text-lg">{money(product.unit_price)}</strong><span className="text-sm text-slate-500"> / {product.selling_unit}</span></div><span className="text-xs text-slate-500">{product.remaining_quantity} reservable</span></div>
                  {product.availability_mode === "scheduled_harvest" ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900"><strong>Scheduled Harvest</strong><br/>Expected: {formatDate(product.harvest_start_at)}{product.harvest_end_at ? ` to ${formatDate(product.harvest_end_at)}` : ""}<br/>Reserve by: {formatDate(product.harvest_order_cutoff_at)}</div> : null}
                  {product.vehicle_requirement === "tricycle" ? <p className="mt-2 text-xs font-semibold text-blue-800">Tricycle required</p> : null}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => openProduct(product)} className="rounded-xl border border-emerald-700 bg-white px-3 py-3 font-bold text-emerald-800">View product</button>
                    <button disabled={!product.can_order_now} onClick={() => addToCart(product)} className="rounded-xl bg-emerald-700 px-3 py-3 font-bold text-white disabled:bg-slate-300">{product.can_order_now ? (product.availability_mode === "scheduled_harvest" ? "Reserve" : "Add to cart") : "Closed"}</button>
                  </div>
                </article>
              ))}
            </section>
          </div>

          <aside className="h-fit rounded-3xl border bg-white p-5 shadow-sm xl:sticky xl:top-4">
            <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Cart</h2>{cart.length ? <button onClick={clearCart} className="text-sm font-semibold text-red-700">Clear</button> : null}</div>
            {!cart.length ? <p className="mt-4 text-sm text-slate-500">Add products from one farmer. Multiple products from that same farmer share one delivery charge.</p> : <>
              <p className="mt-2 text-xs text-slate-500">{cartMode === "scheduled_harvest" ? "Scheduled Harvest cart" : "Always Available cart"} - one farmer only</p>
              {cartHarvest ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">Expected harvest: {formatDate(cartHarvest.harvest_start_at)}{cartHarvest.harvest_end_at ? ` to ${formatDate(cartHarvest.harvest_end_at)}` : ""}</div> : null}
              <div className="mt-4 space-y-3">{cart.map((line) => <div key={line.product.id} className="rounded-xl border p-3"><div className="flex justify-between gap-2"><div><strong>{line.product.name}</strong><p className="text-xs text-slate-500">{line.product.producer_alias}</p></div><strong>{money(line.product.unit_price * line.quantity)}</strong></div><div className="mt-2 flex items-center gap-2"><input type="number" min="0" max={line.product.remaining_quantity} step="0.01" value={line.quantity} onChange={(e) => updateQuantity(line.product.id, Number(e.target.value))} className="w-28 rounded-lg border px-2 py-2"/><span className="text-xs text-slate-500">{line.product.selling_unit}</span></div></div>)}</div>
              <div className="mt-4 flex justify-between border-t pt-3"><span>Products</span><strong>{money(cartSubtotal)}</strong></div>
              <label className="mt-4 block text-sm font-semibold">Preferred eligible vehicle<select value={requiresTricycle ? "tricycle" : preferredVehicle} disabled={requiresTricycle} onChange={(e) => { setPreferredVehicle(e.target.value as "motorcycle" | "tricycle"); setQuote(null); }} className="mt-2 w-full rounded-xl border bg-white px-3 py-3"><option value="motorcycle">Motorcycle</option><option value="tricycle">Tricycle</option></select></label>
              {requiresTricycle ? <p className="mt-1 text-xs text-blue-800">This cart requires a tricycle because of its cargo.</p> : null}
              <button onClick={getQuote} disabled={quoting || !addressId} className="mt-4 w-full rounded-xl border-2 border-emerald-700 px-4 py-3 font-bold text-emerald-800 disabled:border-slate-300 disabled:text-slate-400">{quoting ? "Calculating..." : "Review delivery quote"}</button>
            </>}

            {quote ? (
              <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm">
                <h3 className="font-bold">Order quote</h3>
                <p className="mt-1 text-xs text-slate-600">Delivery is calculated now. Heavy Load and Special Handling are confirmed by the farmer before dispatch. Driver Approach is finalized only after an actual driver is assigned.</p>
                <div className="mt-3 space-y-2">
                  <div className="flex justify-between"><span>Products</span><strong>{money(quote.product_subtotal)}</strong></div>
                  <div className="flex justify-between"><span>Delivery</span><strong>{money(quote.delivery?.delivery_fee)}</strong></div>
                  {quote.estimated_cargo_weight_kg == null ? (
                    <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Estimated cargo weight unavailable - farmer will confirm the load before dispatch.</p>
                  ) : (
                    <div className="flex justify-between"><span>Estimated cargo weight</span><strong>{quote.estimated_cargo_weight_kg} kg</strong></div>
                  )}
                  <div className="flex justify-between gap-3"><span>Heavy Load Fee</span><strong className="text-right">{quote.heavy_load_fee?.estimate_exceeds_v1_limit ? "Farmer confirmation required" : quote.heavy_load_fee?.estimated_fee == null ? "Pending farmer confirmation" : `${money(quote.heavy_load_fee.estimated_fee)} estimated`}</strong></div>
                  <div className="flex justify-between gap-3"><span>Special Handling Fee</span><strong className="text-right">Pending farmer confirmation</strong></div>
                  <div className="flex justify-between gap-3"><span>Driver Approach Fee</span><strong className="text-right">Pending driver assignment</strong></div>
                  <div className="flex justify-between border-t pt-2 text-base"><span>Initial approved amount</span><strong>{money(quote.initial_approved_total ?? quote.total_before_driver_pickup_surcharge)}</strong></div>
                </div>
                {quote.heavy_load_fee?.estimate_exceeds_v1_limit ? <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs text-red-800">The listing-based weight estimate is above the V1 100 kg limit. The farmer must confirm the actual load; orders above 100 kg are not supported in V1.</p> : null}
                {Array.isArray(quote.heavy_load_fee?.tiers) ? <p className="mt-3 text-xs text-slate-600">Heavy Load tiers: {quote.heavy_load_fee.tiers.map((tier: any) => `up to ${tier.max_kg} kg = ${money(tier.fee)}`).join(" / ")}. The farmer's exact weight or selected weight band is authoritative.</p> : null}
                {quote.special_handling_fee?.tiers ? <p className="mt-2 text-xs text-slate-600">Special Handling tiers: {Object.entries(quote.special_handling_fee.tiers).map(([tier, fee]) => `${titleCase(tier)} = ${money(fee)}`).join(" / ")}.</p> : null}
                <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">If the farmer confirmation increases your total or changes the required vehicle to Tricycle, JRide pauses the order and asks you to accept the revised charges before dispatch.</p>
                <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">Driver Approach Fee: first {quote.driver_approach_fee?.first_km_free ?? 2} km free, then {money(quote.driver_approach_fee?.fee_per_started_km ?? 0)} per started km, capped at {money(quote.driver_approach_fee?.normal_max_fee ?? 0)}. Only drivers within {quote.driver_approach_fee?.normal_assignment_max_km ?? 10} km on the applicable approach route are eligible for normal assignment.</p>
                {quote.fulfillment?.is_scheduled_harvest ? <p className="mt-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">This reserves expected harvest quantity. No driver is assigned until the farmer marks the harvest ready. Delay or shortfall needs your approval.</p> : null}
                {quote.cash_collection?.required ? <p className="mt-3 rounded-xl bg-blue-50 p-3 text-xs text-blue-900">Product subtotal is above PHP 500. The assigned driver will collect {money(quote.cash_collection.amount)} product cash from you before going to the farmer.</p> : null}
                <button onClick={placeOrder} disabled={ordering} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 font-bold text-white">{ordering ? "Placing..." : quote.fulfillment?.is_scheduled_harvest ? "Reserve harvest order" : "Place order"}</button>
              </div>
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}
