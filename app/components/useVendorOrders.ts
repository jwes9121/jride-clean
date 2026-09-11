"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { createVendorOrderFeed, EMPTY_FEED } from "@/lib/vendorOrderFeed";

const feeds = new Map<string, ReturnType<typeof createVendorOrderFeed>>();
const emptySubscribe = () => () => {};
const emptySnapshot = () => EMPTY_FEED;
const emptyRefresh = async () => {};
const emptyDismiss = (_id: string) => {};
const emptyAcknowledge = (_id: string, _status: string) => {};
export const VENDOR_KEYS = ["JRIDE_VENDOR_PORTAL_VENDOR_ID", "jride_vendor_id", "JRIDE_VENDOR_ID", "vendor_id", "JRIDE_TAKEOUT_VENDOR_ID"];

export function readVendorId(): string {
  if (typeof window === "undefined") return "";
  const query = new URLSearchParams(window.location.search).get("vendor_id")?.trim();
  if (query) return query;
  try { for (const key of VENDOR_KEYS) { const value = (window.sessionStorage.getItem(key) || window.localStorage.getItem(key) || "").trim(); if (value) return value; } } catch { /* Server session still controls access. */ }
  return "";
}

export function useVendorIdentity(): string {
  const [id, setId] = useState("");
  useEffect(() => {
    const read = () => setId(readVendorId());
    read();
    window.addEventListener("storage", read);
    window.addEventListener("focus", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("focus", read); };
  }, []);
  return id;
}

export function useVendorOrders(vendorId: string) {
  let feed = vendorId ? feeds.get(vendorId) : undefined;
  if (vendorId && !feed && typeof window !== "undefined") { feed = createVendorOrderFeed(vendorId); feeds.set(vendorId, feed); }
  const snapshot = useSyncExternalStore(feed?.subscribe || emptySubscribe, feed?.getSnapshot || emptySnapshot, emptySnapshot);
  return { ...snapshot, refresh: feed?.refresh || emptyRefresh, dismissNotice: feed?.dismissNotice || emptyDismiss, acknowledge: feed?.acknowledge || emptyAcknowledge };
}

export function useOrderClock(offset = 0): number {
  const [now, setNow] = useState(0);
  useEffect(() => { const tick = () => setNow(Date.now() + offset); tick(); const timer = window.setInterval(tick, 1000); return () => window.clearInterval(timer); }, [offset]);
  return now;
}
