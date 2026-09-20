"use client";

import { useEffect, useRef, useState } from "react";
import { passengerAuthHeaders } from "@/lib/passenger/browserSession";

export default function StoreProfile({ productId, onClose }: { productId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [store, setStore] = useState<{ name: string; town: string } | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const abort = new AbortController();
    setStore(null); setError("");
    void (async () => {
      try {
        const response = await fetch(`/api/agrimarket/store?product_id=${encodeURIComponent(productId)}`, { cache: "no-store", headers: passengerAuthHeaders(), signal: abort.signal });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw new Error(payload.message || "Store profile unavailable.");
        setStore(payload.store);
      } catch (cause) {
        if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Store profile unavailable.");
      }
    })();
    return () => abort.abort();
  }, [productId, attempt]);
  return <dialog ref={dialog} onClose={onClose} aria-labelledby="store-heading" className="w-[calc(100%_-_1.5rem)] max-w-md rounded-2xl p-5 text-slate-900 backdrop:bg-slate-950/50">
    <div className="flex items-start justify-between gap-4"><h2 id="store-heading" className="text-xl font-bold">Store profile</h2><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2">Close</button></div>
    {error ? <div role="alert" className="mt-4 text-red-700"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)} className="mt-2 rounded-lg border px-3 py-2">Try again</button></div> : store ? <div className="mt-4"><h3 className="break-words text-2xl font-bold text-emerald-800">{store.name}</h3><p className="mt-2">{store.town}</p><p className="mt-4 text-sm text-slate-600">Order and delivery are managed through JRide. Return to the product to add it to your cart.</p></div> : <p className="mt-4" role="status">Loading store profile...</p>}
  </dialog>;
}
