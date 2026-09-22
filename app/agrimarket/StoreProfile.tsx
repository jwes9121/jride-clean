"use client";

import { useEffect, useState } from "react";
import { passengerAuthHeaders } from "@/lib/passenger/browserSession";
import { cartConflict, cargoGroupLabel, deliveryGroupKey, type CartProduct } from "@/lib/agrimarket/cartCompatibility";
import { ProductPhoto } from "./ProductPhoto";
import StoreAvailabilityNotice from "./StoreAvailabilityNotice";
import { CLOSED_CATALOG_VERSION, isStoreUnavailable, productOrderBlocker, orderingButtonLabel, type StoreAvailability } from "@/lib/agrimarket/storeAvailability";

export type StoreIdentity = Partial<StoreAvailability> & { name: string; town: string };
export type StoreListing = CartProduct & Partial<StoreAvailability> & {
  order_blocker?: string | null;
  id: string; selling_unit: string; unit_price: number; remaining_quantity: number;
  can_order_now: boolean; photo_urls?: string[]; vehicle_requirement: string;
};

function schedule(product: CartProduct): string {
  if (product.availability_mode !== "scheduled_harvest") return "Stock listings";
  const format = (value?: string | null) => value ? new Date(value).toLocaleString("en-PH", {
    timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short",
  }) : "Date unavailable";
  return `Scheduled: ${format(product.harvest_start_at)}${product.harvest_end_at ? ` to ${format(product.harvest_end_at)}` : ""} (Philippine time)`;
}

export default function StoreProfile({ productId, products, cartProducts, otherStoreName, busy, onAdd, onClose, onReviewCart }: {
  productId: string; products: StoreListing[]; cartProducts: CartProduct[];
  otherStoreName: string | null; busy: boolean;
  onAdd: (id: string, store: StoreIdentity) => void; onClose: () => void; onReviewCart: () => void;
}) {
  const [store, setStore] = useState<StoreIdentity | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setStore(null); setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/agrimarket/store?product_id=${encodeURIComponent(productId)}&store_visibility=${CLOSED_CATALOG_VERSION}`, {
          cache: "no-store", headers: passengerAuthHeaders(), signal: abort.signal,
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Store profile unavailable.");
        if (!abort.signal.aborted) setStore(payload.store);
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Store profile unavailable.");
      }
    })();
    return () => abort.abort();
  }, [productId, attempt]);

  const groups = new Map<string, StoreListing[]>();
  for (const product of products) {
    const key = deliveryGroupKey(product);
    groups.set(key, [...(groups.get(key) || []), product]);
  }

  return <section id="agrimarket-store" aria-labelledby="store-heading" className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><p className="text-sm font-semibold text-emerald-700">Store profile</p>
        <h2 id="store-heading" className="break-words text-2xl font-bold">{store?.name || "Loading store..."}</h2>
        {store && <p className="mt-1 text-sm text-slate-600">{store.town}</p>}</div>
      <button type="button" onClick={onClose} className="rounded-lg border px-3 py-2 font-semibold">Back to results</button>
      {cartProducts.length > 0 && <button type="button" onClick={onReviewCart} className="rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white">Review cart ({cartProducts.length})</button>}
    </div>
    {error ? <div role="alert" className="mt-4 text-red-700"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-2 rounded-lg border px-3 py-2">Try again</button></div> : !store ? <p className="mt-4" role="status">Loading store profile...</p> : <>
      <StoreAvailabilityNotice product={store} />
      <p className="mt-3 text-sm text-slate-600">All items below belong to this store. Add multiple items from the same delivery group for one order and delivery quote.</p>
      {groups.size > 1 && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Different cargo or preparation schedules are grouped separately under the current delivery rules. Each separate order has its own delivery quote. No extra order is placed automatically.</p>}
      {otherStoreName && <p role="status" className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-950">Your cart belongs to {otherStoreName}. Finish that order or clear the cart before ordering from this store.</p>}
      {[...groups].map(([key, rows], index) => <section key={key} className="mt-5 border-t pt-4" aria-label={`Delivery group ${index + 1}`}>
        <h3 className="font-bold">{cargoGroupLabel(rows[0].cargo_class)}</h3>
        <p className="mt-1 text-sm text-slate-600">{schedule(rows[0])}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">{rows.map(product => {
          const current = { ...product, ...store };
          const reason = store.store_status !== "open"
            ? productOrderBlocker({ ...current, can_order_now: false })
            : productOrderBlocker(product) || (otherStoreName ? `Finish or clear your ${otherStoreName} cart first.` : cartConflict([...cartProducts, product]));
          return <article key={product.id} className={`rounded-xl border p-3 ${isStoreUnavailable(current) ? "border-slate-300 bg-slate-50" : ""}`}>
            <ProductPhoto url={product.photo_urls?.[0]} name={product.name} className={`mb-3 ${isStoreUnavailable(current) ? "grayscale opacity-70" : ""}`} />
            <h4 className="font-bold">{product.name}</h4><StoreAvailabilityNotice product={current} compact />
            <p className="mt-2 text-sm">PHP {product.unit_price.toFixed(2)} / {product.selling_unit}</p>
            <p className="mt-1 text-sm text-slate-600">{product.remaining_quantity} {product.selling_unit} listed</p>
            <p className="mt-1 text-xs text-slate-600">{product.vehicle_requirement === "kolong_kolong" ? "Kolong-Kolong required" : product.vehicle_requirement === "tricycle" ? "Tricycle or Kolong-Kolong required" : "Vehicle depends on the combined cargo"}</p>
            {reason && <p id={`store-blocker-${product.id}`} className="mt-2 text-sm text-amber-900">{reason}</p>}
            <button type="button" disabled={busy || Boolean(reason)} aria-describedby={reason ? `store-blocker-${product.id}` : undefined}
              onClick={() => onAdd(product.id, store)} className="mt-3 w-full rounded-xl bg-emerald-700 px-3 py-3 font-bold text-white disabled:bg-slate-300 disabled:text-slate-700">
              {orderingButtonLabel(current) || (product.availability_mode === "scheduled_harvest" ? "Reserve in cart" : "Add to cart")}
            </button>
          </article>;
        })}</div>
      </section>)}
      {cartProducts.length > 0 && <button type="button" onClick={onReviewCart} className="mt-5 w-full rounded-xl border-2 border-emerald-700 px-4 py-3 font-bold text-emerald-800">Review cart ({cartProducts.length} product lines)</button>}
      <p className="mt-4 text-xs text-slate-600">Order and delivery are managed through JRide. Farmer contact details and the exact pickup location stay private.</p>
    </>}
  </section>;
}
