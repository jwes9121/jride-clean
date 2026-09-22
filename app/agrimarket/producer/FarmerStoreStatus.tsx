"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { farmerSessionHeaders } from "@/lib/agrimarket/farmerSessionClient";
import styles from "./farmer.module.css";

type Store = {
  name: string | null;
  town: string;
  ready: boolean;
  open: boolean;
  profile_complete: boolean;
  setup_required: boolean;
};

export default function FarmerStoreStatus({ accountCode }: { accountCode: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [store, setStore] = useState<Store | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const flight = useRef(false);
  const mounted = useRef(false);

  const read = useCallback(async () => {
    if (!accountCode || flight.current) return;
    flight.current = true;
    try {
      const response = await fetch("/api/agrimarket/producer/store", {
        cache: "no-store", headers: farmerSessionHeaders(accountCode), signal: AbortSignal.timeout(8000),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "Store status unavailable. Tap Retry.");
      if (mounted.current) { setStore(body.store); setError(""); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Store status unavailable. Tap Retry.");
    } finally { flight.current = false; }
  }, [accountCode]);

  useEffect(() => {
    if (store?.setup_required && pathname !== "/agrimarket/producer/profile") {
      router.replace("/agrimarket/producer/profile");
    }
  }, [store?.setup_required, pathname, router]);

  useEffect(() => {
    mounted.current = true;
    void read();
    const refresh = () => { if (document.visibilityState === "visible") void read(); };
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("agrimarket-store-updated", refresh);
    return () => { mounted.current = false; window.clearInterval(timer);
      window.removeEventListener("focus", refresh); window.removeEventListener("agrimarket-store-updated", refresh); };
  }, [read]);

  async function toggle() {
    if (!store || flight.current) return;
    flight.current = true;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/agrimarket/producer/store", {
        method: "POST", headers: farmerSessionHeaders(accountCode, true),
        body: JSON.stringify({ open: !store.open }), signal: AbortSignal.timeout(10000),
      });
      const body = await response.json();
      if (!response.ok || !body.ok) throw new Error(body.message || "Store status could not be changed.");
      if (mounted.current) { setStore(body.store); setMessage(body.store.open ? "Your store is open for new orders." : "Your store is closed for new orders. Continue handling existing orders."); }
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : "Store update interrupted. Tap Retry to check its status.");
    } finally { flight.current = false; if (mounted.current) setBusy(false); }
  }

  return <section className={styles.storeStatus} aria-label="Your store status">
    <div className={styles.storeStatusRow}>
      <div><strong>{store?.name || (store ? "Store name required" : "Loading store...")}</strong>
        {store && <p>{store.town} - Signed-in store</p>}
        {store && <p>{!store.ready ? "Awaiting JRide readiness approval" : store.open ? "OPEN - Accepting new orders" : "CLOSED - New orders paused"}</p>}
      </div>
      {store && <div className="flex flex-wrap items-center gap-2">
        <Link href="/agrimarket/producer/profile" className={styles.secondaryButton}>Farm profile</Link>
        <button type="button" role="switch" aria-checked={store.ready && store.open}
          aria-label="Open store for new orders" disabled={busy || !store.ready || !!error}
          onClick={() => void toggle()} className={store.ready && store.open ? styles.primaryButton : styles.secondaryButton}>
          {busy ? "Saving..." : store.ready && store.open ? "Turn off" : "Turn on"}
        </button>
      </div>}
    </div>
    <p className={styles.fieldHint}>Closing pauses new bookings. Existing orders still need your response and fulfillment.</p>
    {message && <p role="status">{message}</p>}
    {error && <p role="alert">{error} <button type="button" onClick={() => void read()} className="underline">Retry</button></p>}
  </section>;
}
