import { isStoreUnavailable, type AvailabilityProduct } from "@/lib/agrimarket/storeAvailability";

export default function StoreAvailabilityNotice({ product, compact = false }: { product: AvailabilityProduct; compact?: boolean }) {
  const unavailable = isStoreUnavailable(product);
  const label = product.store_status_label || (unavailable ? "Temporarily unavailable" : "Accepting orders");
  return <div className="mt-2" role="status">
    <span className={unavailable ? "inline-block rounded-full border border-slate-400 bg-slate-100 px-3 py-1 text-xs font-bold text-slate-800" : "inline-block rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900"}>{label}</span>
    {unavailable && !compact && <p className="mt-2 text-sm text-slate-700">Not accepting orders right now. You can still view this store&apos;s products.</p>}
  </div>;
}
