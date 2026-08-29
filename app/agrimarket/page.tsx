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
  approximate_road_distance_km?: number | null;
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
  availability_mode: string;
  preparation_minutes: number;
  vehicle_requirement: string;
  handling_eligible: boolean;
  photo_urls: string[];
  can_order_now: boolean;
  order_blocker?: string | null;
};

type Quote = {
  product_subtotal: number;
  cash_collection: { required: boolean; amount: number; threshold_php: number };
  route_plan: string;
  delivery: {
    base_fee: number;
    distance_fee: number;
    delivery_fee: number;
    service_route_distance_km: number;
  };
  pickup_distance_surcharge: {
    status: string;
    current_fee: number;
    first_km_free: number;
    normal_max_fee: number;
  };
  handling_eligible: boolean;
  total_before_driver_pickup_surcharge: number;
  final_total_status: string;
  preferred_vehicle_type: string;
  required_vehicle_type: string;
};

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

async function apiJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
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

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "00000000-0000-4000-8000-" + Math.random().toString(16).slice(2, 14).padEnd(12, "0");
}

export default function AgrimarketPage() {
  const [disabled, setDisabled] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [loadingAddresses, setLoadingAddresses] = useState(true);
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [addressId, setAddressId] = useState("");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selected, setSelected] = useState<ProductRow | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [vehicle, setVehicle] = useState<"motorcycle" | "tricycle">("motorcycle");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [orderCode, setOrderCode] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selectedAddress = useMemo(
    () => addresses.find((row) => row.id === addressId) || null,
    [addresses, addressId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingAddresses(true);
      const { response, payload } = await apiJson("/api/agrimarket/addresses", {
        headers: authHeaders(),
      });
      if (cancelled) return;

      if (payload?.error === "AGRIMARKET_DISABLED") {
        setDisabled(true);
        setLoadingAddresses(false);
        return;
      }
      if (response.status === 401) {
        setAuthRequired(true);
        setLoadingAddresses(false);
        return;
      }
      if (!response.ok || payload?.ok === false) {
        setError(payload?.message || payload?.error || "Unable to load delivery addresses.");
        setLoadingAddresses(false);
        return;
      }

      const rows = Array.isArray(payload?.addresses) ? payload.addresses : [];
      setAddresses(rows);
      const primary = rows.find((row: AddressRow) => row.is_primary && row.has_valid_pin);
      const firstPinned = rows.find((row: AddressRow) => row.has_valid_pin);
      setAddressId(primary?.id || firstPinned?.id || "");
      setLoadingAddresses(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!addressId || disabled || authRequired) {
      setProducts([]);
      return;
    }

    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      setError("");
      setSelected(null);
      setQuote(null);
      setOrderCode("");
      const params = new URLSearchParams({ address_id: addressId });
      const { response, payload } = await apiJson(`/api/agrimarket/catalog?${params.toString()}`, {
        headers: authHeaders(),
      });
      if (cancelled) return;
      if (payload?.error === "AGRIMARKET_DISABLED") {
        setDisabled(true);
      } else if (response.status === 401) {
        setAuthRequired(true);
      } else if (!response.ok || payload?.ok === false) {
        setError(payload?.message || payload?.error || "Unable to load Agrimarket products.");
      } else {
        setProducts(Array.isArray(payload?.products) ? payload.products : []);
      }
      setCatalogLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [addressId, disabled, authRequired]);

  function chooseProduct(product: ProductRow) {
    setSelected(product);
    setQuantity(1);
    setQuote(null);
    setOrderCode("");
    setMessage("");
    setError("");
    setVehicle(product.vehicle_requirement === "tricycle" ? "tricycle" : "motorcycle");
  }

  async function requestQuote() {
    if (!selected || !addressId) return;
    setQuoteLoading(true);
    setQuote(null);
    setError("");
    setMessage("");

    const { response, payload } = await apiJson("/api/agrimarket/quote", {
      method: "POST",
      headers: authHeaders(true),
      body: JSON.stringify({
        delivery_address_id: addressId,
        items: [{ product_id: selected.id, quantity }],
        preferred_vehicle_type: vehicle,
      }),
    });

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to calculate the delivery quote.");
    } else {
      setQuote(payload as Quote);
    }
    setQuoteLoading(false);
  }

  async function placeOrder() {
    if (!selected || !addressId || !quote) return;
    setPlacing(true);
    setError("");
    setMessage("");
    const requestId = uuid();
    const { response, payload } = await apiJson("/api/agrimarket/orders", {
      method: "POST",
      headers: { ...authHeaders(true), "x-idempotency-key": requestId },
      body: JSON.stringify({
        request_id: requestId,
        delivery_address_id: addressId,
        items: [{ product_id: selected.id, quantity }],
        preferred_vehicle_type: vehicle,
      }),
    });

    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to place the Agrimarket order.");
    } else {
      const code = String(payload?.order?.order_code || "");
      setOrderCode(code);
      setMessage("Order sent to the farmer. Inventory is reserved while the farmer confirms availability.");
    }
    setPlacing(false);
  }

  if (disabled) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-3 text-3xl font-bold">Farmer-direct marketplace is being prepared</h1>
          <p className="mt-4 text-slate-600">
            Agrimarket is not open yet. JRide is preparing farmer listings, delivery pricing, pickup verification,
            and protected farmer locations before public launch.
          </p>
          <Link href="/passenger" className="mt-6 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">
            Back to JRide
          </Link>
        </div>
      </main>
    );
  }

  if (authRequired) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-3xl bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Sign in to use Agrimarket</h1>
          <p className="mt-3 text-slate-600">Your JRide passenger account is required for delivery-address protection and order tracking.</p>
          <Link href="/login" className="mt-6 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">
            Passenger sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
            <h1 className="text-3xl font-bold">Buy directly from local farmers</h1>
            <p className="mt-1 text-sm text-slate-600">Farmer identity and exact pickup location stay private. JRide handles delivery.</p>
          </div>
          <Link href="/passenger" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Back</Link>
        </div>

        <section className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold">Deliver to</label>
          {loadingAddresses ? (
            <p className="mt-2 text-sm text-slate-500">Loading saved addresses...</p>
          ) : addresses.length === 0 ? (
            <div className="mt-2 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
              Add a saved JRide address with a valid map pin before using Agrimarket.
            </div>
          ) : (
            <select
              value={addressId}
              onChange={(event) => setAddressId(event.target.value)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3"
            >
              <option value="">Select a delivery address</option>
              {addresses.map((address) => (
                <option key={address.id} value={address.id} disabled={!address.has_valid_pin}>
                  {address.label}{address.is_primary ? " - Primary" : ""}{!address.has_valid_pin ? " - Pin required" : ""}
                </option>
              ))}
            </select>
          )}
          {selectedAddress ? <p className="mt-2 text-xs text-slate-500">{selectedAddress.address_text}</p> : null}
        </section>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <section className="mt-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-bold">Available products</h2>
            <span className="text-xs text-slate-500">Farmer numbers change with your delivery location.</span>
          </div>

          {catalogLoading ? (
            <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">Finding nearby farmers...</div>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">
              No Agrimarket products are available for this address yet.
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((product) => (
                <article key={product.id} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
                  {product.photo_urls?.[0] ? (
                    <img src={product.photo_urls[0]} alt={product.name} className="h-40 w-full object-cover" />
                  ) : (
                    <div className="flex h-28 items-center justify-center bg-emerald-50 text-sm font-semibold text-emerald-800">Local farm product</div>
                  )}
                  <div className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{product.producer_alias}</p>
                    <h3 className="mt-1 text-lg font-bold">{product.name}</h3>
                    {product.approximate_road_distance_km != null ? (
                      <p className="mt-1 text-sm text-slate-500">Approx. {product.approximate_road_distance_km.toFixed(1)} km by road</p>
                    ) : null}
                    <div className="mt-3 space-y-1 text-sm text-slate-600">
                      {product.species ? <p>Type: {product.species}{product.breed ? ` - ${product.breed}` : ""}</p> : null}
                      {product.meat_cut ? <p>Cut: {product.meat_cut}</p> : null}
                      <p>Condition: {titleCase(product.condition)}</p>
                      <p>Available: {product.remaining_quantity} {product.selling_unit}</p>
                      <p>Vehicle: {titleCase(product.vehicle_requirement)}</p>
                    </div>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div>
                        <p className="text-xl font-bold text-emerald-800">{money(product.unit_price)}</p>
                        <p className="text-xs text-slate-500">per {product.selling_unit}</p>
                      </div>
                      <button
                        type="button"
                        disabled={!product.can_order_now}
                        onClick={() => chooseProduct(product)}
                        className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {product.can_order_now ? "Order" : "Scheduled"}
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {selected ? (
          <section className="mt-6 rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{selected.producer_alias}</p>
                <h2 className="text-2xl font-bold">Order {selected.name}</h2>
              </div>
              <button type="button" onClick={() => { setSelected(null); setQuote(null); }} className="rounded-lg border px-3 py-2 text-sm">Close</button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold">
                Quantity ({selected.selling_unit})
                <input
                  type="number"
                  min="1"
                  max={selected.remaining_quantity}
                  step="1"
                  value={quantity}
                  onChange={(event) => setQuantity(Math.max(1, Math.min(selected.remaining_quantity, Number(event.target.value) || 1)))}
                  className="mt-2 w-full rounded-xl border px-3 py-3"
                />
              </label>
              <label className="text-sm font-semibold">
                Preferred vehicle
                <select
                  value={vehicle}
                  onChange={(event) => { setVehicle(event.target.value as "motorcycle" | "tricycle"); setQuote(null); }}
                  className="mt-2 w-full rounded-xl border bg-white px-3 py-3"
                >
                  {selected.vehicle_requirement !== "tricycle" ? <option value="motorcycle">Motorcycle</option> : null}
                  <option value="tricycle">Tricycle</option>
                </select>
              </label>
            </div>

            {selected.handling_eligible ? (
              <div className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
                Driver handling may add PHP 10 to PHP 50 when physical loading help is actually required. The driver selects and locks it before pickup.
              </div>
            ) : null}

            <button
              type="button"
              onClick={requestQuote}
              disabled={quoteLoading || !addressId}
              className="mt-4 rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white disabled:bg-slate-400"
            >
              {quoteLoading ? "Calculating..." : "Calculate delivery"}
            </button>

            {quote ? (
              <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
                <h3 className="font-bold">Order estimate</h3>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between"><span>Products</span><strong>{money(quote.product_subtotal)}</strong></div>
                  <div className="flex justify-between"><span>JRide delivery</span><strong>{money(quote.delivery.delivery_fee)}</strong></div>
                  <div className="flex justify-between"><span>Service route</span><strong>{quote.delivery.service_route_distance_km.toFixed(1)} km</strong></div>
                  <div className="flex justify-between"><span>Driver pickup surcharge</span><strong>Pending assignment</strong></div>
                  {quote.handling_eligible ? <div className="flex justify-between"><span>Possible handling</span><strong>PHP 0 to PHP 50</strong></div> : null}
                  <div className="border-t pt-2 flex justify-between text-base"><span>Current total</span><strong>{money(quote.total_before_driver_pickup_surcharge)}</strong></div>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  The driver-to-first-pickup road surcharge becomes final after assignment. You will see the updated order total in JRide.
                </p>
                {quote.cash_collection.required ? (
                  <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">
                    Product amount over PHP {quote.cash_collection.threshold_php.toFixed(0)}: the assigned driver will first collect {money(quote.cash_collection.amount)} from you before going to the farmer.
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
                    Product amount is PHP {quote.cash_collection.threshold_php.toFixed(0)} or below: the assigned driver goes to the farmer first.
                  </div>
                )}

                {!orderCode ? (
                  <button
                    type="button"
                    onClick={placeOrder}
                    disabled={placing}
                    className="mt-4 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400"
                  >
                    {placing ? "Sending order..." : "Place Agrimarket order"}
                  </button>
                ) : (
                  <div className="mt-4 rounded-xl bg-emerald-100 p-4">
                    <p className="text-sm font-semibold text-emerald-900">Order code</p>
                    <p className="mt-1 text-xl font-bold text-emerald-950">{orderCode}</p>
                  </div>
                )}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}
