"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import React, { useEffect, useMemo, useRef, useState } from "react";

// JRIDE_VENDOR_ACTIVE_ORDER_DETAILS_RENDER_V4

type VendorRow = {
  id?: string | null;
  vendor_id?: string | null;
  name?: string | null;
  display_name?: string | null;
  vendor_name?: string | null;
  email?: string | null;
  town?: string | null;
};

type VendorProfile = {
  id: string;
  vendor_id: string;
  name: string;
  town?: string | null;
  logo_url?: string | null;
  accepting_orders?: boolean;
  premium_packaging_enabled?: boolean;
  premium_packaging_fee?: number | string | null;
  premium_packaging_label?: string | null;
};

type MenuItem = {
  id: string;
  menu_item_id?: string | null;
  name: string;
  description?: string | null;
  packaging_note?: string | null;
  premium_packaging_enabled?: boolean | null;
  premium_packaging_fee?: number | string | null;
  premium_packaging_label?: string | null;
  price: number;
  photo_url?: string | null;
  sort_order?: number | null;
  is_available: boolean;
  sold_out_today: boolean;
  daily_available_quantity?: number | string | null;
  remaining_quantity?: number | string | null;
  last_updated_at?: string | null;
  prep_time_minutes?: number | string | null;
};

type TakeoutOrderItem = {
  menu_item_id?: string | null;
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  packaging_note?: string | null;
};

type TakeoutOrder = {
  id: string | null;
  booking_code: string | null;
  vendor_id: string | null;
  vendor_name?: string | null;
  vendor_status: string | null;
  customer_name: string | null;
  customer_phone?: string | null;
  passenger_phone?: string | null;
  phone?: string | null;
  default_address?: string | null;
  saved_address?: string | null;
  to_label: string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;
  delivery_pin_lat?: number | string | null;
  delivery_pin_lng?: number | string | null;
  delivery_pin_label?: string | null;
  delivery_pin_coordinates?: string | null;
  note?: string | null;
  items?: TakeoutOrderItem[] | null;
  item_count?: number | null;
  items_text?: string | null;
  takeout_items_subtotal: number | null;
  items_subtotal?: number | null;
  total_bill?: number | null;
  premium_packaging_selected?: boolean;
  premium_packaging_fee?: number | string | null;
  premium_packaging_label?: string | null;
  receipt_requested?: boolean;
  request_vendor_receipt?: boolean;
  order_preferences?: any;
  status?: string | null;
  service_type?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

type VendorAnalyticsRange = "today" | "week" | "month" | "all";

const VENDOR_PORTAL_MAPBOX_TOKEN =
  process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
  "";
if (VENDOR_PORTAL_MAPBOX_TOKEN) {
  mapboxgl.accessToken = VENDOR_PORTAL_MAPBOX_TOKEN;
}

type VendorLngLat = [number, number];

function parseCoordValue(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function townFallbackCenter(town: string): VendorLngLat {
  const key = String(town || "").trim().toLowerCase();
  if (key === "lagawe") return [121.0998, 16.7996];
  if (key === "hingyon") return [121.1025, 16.8330];
  if (key === "banaue") return [121.0609, 16.9186];
  if (key === "lamut") return [121.2236, 16.6494];
  if (key === "kiangan") return [121.0834, 16.7750];
  return [121.1000, 16.8330];
}

const MENU_ITEMS_UNLIMITED = true;
const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;

function cls(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function clean(v: any) {
  return String(v ?? "").trim();
}

function normalizeTakeoutTown(value: any): string {
  const raw = clean(value).toLowerCase();
  return CANONICAL_TAKEOUT_TOWNS.find((town) => town.toLowerCase() === raw) || "";
}

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(v: any) {
  return "PHP " + toNum(v).toFixed(2);
}

function formatPhilippineDateTime(v: any): string {
  const raw = clean(v);
  if (!raw) return "-";

  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

const VENDOR_ACCEPT_WINDOW_MS = 5 * 60 * 1000;

function vendorAcceptCreatedMs(order: TakeoutOrder): number | null {
  const raw = String(order?.created_at || "").trim();
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function vendorAcceptTimer(order: TakeoutOrder, nowMs: number) {
  const createdMs = vendorAcceptCreatedMs(order);
  if (createdMs === null) {
    return {
      remainingMs: VENDOR_ACCEPT_WINDOW_MS,
      expired: false,
      label: "5:00",
      tone: "slate",
    };
  }

  const elapsedMs = Math.max(0, nowMs - createdMs);
  const remainingMs = Math.max(0, VENDOR_ACCEPT_WINDOW_MS - elapsedMs);
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const label = String(minutes) + ":" + String(seconds).padStart(2, "0");
  const expired = remainingMs <= 0;

  let tone = "emerald";
  if (expired) tone = "rose";
  else if (remainingMs <= 60 * 1000) tone = "rose";
  else if (remainingMs <= 2 * 60 * 1000) tone = "amber";

  return { remainingMs, expired, label, tone };
}

function vendorAcceptTimerClass(tone: string): string {
  if (tone === "rose") return "border-rose-300 bg-rose-50 text-rose-800";
  if (tone === "amber") return "border-amber-300 bg-amber-50 text-amber-800";
  if (tone === "emerald") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function isActivePendingVendorOrder(order: TakeoutOrder, nowMs: number): boolean {
  const status = normalizeVendorStatus(order.vendor_status);
  if (status !== "vendor_pending") return false;
  return !vendorAcceptTimer(order, nowMs).expired;
}

function positiveInt(v: any) {
  const n = Math.floor(toNum(v));
  return n > 0 ? n : 0;
}

function hasPositiveJrideStock(daily: any, remaining: any) {
  return positiveInt(daily) > 0 && positiveInt(remaining) > 0;
}
const PREP_TIME_OPTIONS = [15, 20, 30, 45, 60];

const VENDOR_CANCEL_REASONS = [
  "Item sold out",
  "Vendor too busy",
  "Store closing soon",
  "Cannot prepare on time",
  "Wrong or unavailable menu item",
  "Other reason",
] as const;

const VENDOR_ACCEPT_RING_INTERVAL_MS = 30 * 1000;
const VENDOR_ACCEPT_RING_WINDOW_MS = 5 * 60 * 1000;
function prepMinutes(value: any) {
  const n = Number(value);
  return PREP_TIME_OPTIONS.includes(n) ? n : 15;
}

function vendorKey(v: VendorRow) {
  return clean(v.id || v.vendor_id || v.email || "");
}

function vendorLabel(v: VendorRow) {
  return clean(v.display_name || v.vendor_name || v.name || v.email || vendorKey(v) || "Vendor");
}

const VENDOR_PORTAL_ALERT_SOUND_URL = "/sounds/vendor-order-alert.mp3";

function normalizeVendorStatus(s: any) {
  const x = clean(s).toLowerCase();
  if (!x || x === "requested") return "vendor_pending";
  if (x === "accepted") return "vendor_accepted";
  if (x === "canceled") return "cancelled";
  if (x === "vendor_timeout") return "vendor_timeout";
  return x;
}

function statusLabel(s: any) {
  const x = normalizeVendorStatus(s);
  if (x === "vendor_pending") return "Waiting for vendor confirmation";
  if (x === "vendor_accepted") return "Vendor accepted";
  if (x === "driver_assigned") return "Driver assigned";
  if (x === "pickup_ready") return "Order ready";
  if (x === "preparing") return "Preparing";
  if (x === "completed") return "Completed";
  if (x === "vendor_timeout") return "Vendor timeout";
  if (x === "cancelled") return "Cancelled";
  return x || "Waiting for vendor confirmation";
}

function orderClass(s: any) {
  const x = normalizeVendorStatus(s);
  if (x === "vendor_pending") return "border-blue-300 bg-blue-50 text-blue-800";
  if (x === "vendor_accepted") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (x === "driver_assigned") return "border-blue-300 bg-blue-50 text-blue-800";
  if (x === "pickup_ready") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (x === "completed") return "border-slate-300 bg-slate-50 text-slate-700";
  if (x === "vendor_timeout") return "border-rose-300 bg-rose-50 text-rose-700";
  if (x === "cancelled") return "border-rose-300 bg-rose-50 text-rose-700";
  return "border-amber-300 bg-amber-50 text-amber-800";
}

function orderSubtotal(o: TakeoutOrder) {
  return o.takeout_items_subtotal ?? o.items_subtotal ?? o.total_bill ?? 0;
}

function orderItems(o: TakeoutOrder): TakeoutOrderItem[] {
  if (Array.isArray(o.items) && o.items.length) {
    return o.items.filter((it) => clean(it?.name));
  }

  const text = clean(o.items_text);
  if (!text) return [];
return text
    .split(/\r?\n|,|;/)
    .map((part) => clean(part))
    .filter(Boolean)
    .map((part) => {
      const qtyMatch = part.match(/^(\d+)\s*x?\s+(.+)$/i);
      if (qtyMatch) {
        return {
          name: clean(qtyMatch[2]),
          quantity: Math.max(1, parseInt(qtyMatch[1], 10) || 1),
          price: null,
          packaging_note: null,
        };
      }
      return { name: part, quantity: 1, price: null, packaging_note: null };
    });
}

function orderReceiptRequested(o: TakeoutOrder): boolean {
  const note = clean(o.note).toLowerCase();
  return Boolean(
    o.receipt_requested ||
    o.request_vendor_receipt ||
    o.order_preferences?.receipt_requested ||
    note.includes("vendor receipt requested")
  );
}

function orderPremiumPackagingSelected(o: TakeoutOrder): boolean {
  return Boolean(o.premium_packaging_selected || o.order_preferences?.premium_packaging_selected);
}

function orderOptionLabel(o: TakeoutOrder) {
  const label = clean(o.premium_packaging_label) || "Premium packaging";
  const fee = toNum(o.premium_packaging_fee);
  return fee > 0 ? `${label} (${money(fee)})` : label;
}

function orderPackagingInstruction(o: TakeoutOrder): string {
  if (!orderPremiumPackagingSelected(o)) return "Standard item packaging";
  return "Premium packaging requested: " + orderOptionLabel(o);
}

function orderCustomerNoteOnly(o: TakeoutOrder): string {
  let note = clean(o.note);
  if (!note) return "";

  note = note
    .replace(/\s*Premium packaging requested:\s*Premium packaging\s*\([^)]*\)\s*/gi, " ")
    .replace(/\s*Premium packaging requested:\s*Premium packaging\s*/gi, " ")
    .replace(/\s*Premium packaging requested:\s*[^.\n]+\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  return note;
}

function orderCustomerName(o: TakeoutOrder) {
  return clean(o.customer_name) || "Customer";
}

function orderCustomerPhone(o: TakeoutOrder) {
  return clean(o.customer_phone) || clean(o.passenger_phone) || clean(o.phone) || "No phone provided";
}

function looksLikeRawPinnedAddress(v: string) {
  const s = clean(v).toLowerCase();
  return s.startsWith("pinned delivery spot (") || s === "delivery spot marked on map";
}

function hasDeliveryPin(o: TakeoutOrder) {
  return Boolean(clean(o.delivery_pin_label) || clean(o.delivery_pin_coordinates) || clean(o.delivery_pin_lat) || clean(o.delivery_pin_lng) || clean(o.dropoff_lat) || clean(o.dropoff_lng));
}

function orderDeliveryAddress(o: TakeoutOrder) {
  const preferred = clean(o.default_address) || clean(o.saved_address);
  if (preferred) return preferred;

  const label = clean(o.to_label);
  if (label && !looksLikeRawPinnedAddress(label)) return label;

  if (hasDeliveryPin(o)) return "Delivery spot marked on map. Use the saved pin for exact location.";

  return "No saved/default address shown";
}

function orderCreatedMs(o: TakeoutOrder) {
  const raw = clean(o.created_at) || clean(o.updated_at);
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeekMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.getTime();
}

function startOfMonthMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}

function inAnalyticsRange(o: TakeoutOrder, range: VendorAnalyticsRange) {
  if (range === "all") return true;
  const t = orderCreatedMs(o);
  if (!t) return false;
  if (range === "today") return t >= startOfTodayMs();
  if (range === "week") return t >= startOfWeekMs();
  if (range === "month") return t >= startOfMonthMs();
  return true;
}

function premiumPackagingAmount(o: TakeoutOrder) {
  const selected = orderPremiumPackagingSelected(o);
  if (!selected) return 0;
  return toNum(o.premium_packaging_fee || o.order_preferences?.premium_packaging_fee || 0);
}

async function getJson(url: string) {
  const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || "REQUEST_FAILED");
  return j;
}

async function postJson(url: string, body: any) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.error || "REQUEST_FAILED");
  return j;
}

async function fileToDataUrl(file: File | null): Promise<string | null> {
  if (!file) return null;
  if (!file.type.startsWith("image/")) throw new Error("Only image files are allowed.");
  if (file.size > 3 * 1024 * 1024) throw new Error("Image is too large. Maximum is 3MB.");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

export default function VendorPortalPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const vendorOrdersHref = vendorId ? "/vendor-orders?vendor_id=" + encodeURIComponent(vendorId) : "/vendor-orders";
  const vendorAnalyticsHref = vendorId ? "/vendor-analytics?vendor_id=" + encodeURIComponent(vendorId) : "/vendor-analytics";

  function handleVendorLogout() {
    try {
      const keysToClear = [
        "jride_vendor_session",
        "jride_vendor_token",
        "jride_vendor_id",
        "JRIDE_VENDOR_ID",
        "vendor_id",
      ];

      for (const key of keysToClear) {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // ignore storage cleanup failures
    }

    window.location.href = "/vendor-login";
  }

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  const [cancelTargetOrder, setCancelTargetOrder] = useState<TakeoutOrder | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOtherReason, setCancelOtherReason] = useState("");
  const [cancelNote, setCancelNote] = useState("");

  const [profileName, setProfileName] = useState("");
  const [profileTown, setProfileTown] = useState("");
  const [vendorLat, setVendorLat] = useState("");
  const [vendorLng, setVendorLng] = useState("");
  const [vendorLocationLabel, setVendorLocationLabel] = useState("");
  const [vendorLocationOpen, setVendorLocationOpen] = useState(false);
  const vendorMapContainerRef = useRef<HTMLDivElement | null>(null);
  const vendorMapRef = useRef<mapboxgl.Map | null>(null);
  const vendorMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const [vendorMapReady, setVendorMapReady] = useState(false);
  const [vendorMapMessage, setVendorMapMessage] = useState("");
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const itemInputRef = useRef<HTMLInputElement | null>(null);

  const [editingId, setEditingId] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemPackagingNote, setItemPackagingNote] = useState("");
  const [itemPremiumPackagingEnabled, setItemPremiumPackagingEnabled] = useState(false);
  const [itemPremiumPackagingFee, setItemPremiumPackagingFee] = useState("");
  const [itemPremiumPackagingLabel, setItemPremiumPackagingLabel] = useState("Premium packaging");
  const [itemPrice, setItemPrice] = useState("");
  const [itemPrepTimeMinutes, setItemPrepTimeMinutes] = useState(15);
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemSoldOut, setItemSoldOut] = useState(false);
  const [itemDailyAvailableQuantity, setItemDailyAvailableQuantity] = useState("0");
  const [itemRemainingQuantity, setItemRemainingQuantity] = useState("0");
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemPreview, setItemPreview] = useState("");
  const vendorAlertAudioRef = useRef<HTMLAudioElement | null>(null);
  const lastVendorAlertRingRef = useRef(0);
  const vendorAlertAudioUnlockedRef = useRef(false);
  const [vendorAlertSoundEnabled, setVendorAlertSoundEnabled] = useState(false);
  const [vendorAlertDebug, setVendorAlertDebug] = useState({
    audioUnlocked: false,
    pendingCount: 0,
    loopState: "stopped",
    lastAttempt: "none",
    lastResult: "not started",
  });
  const [analyticsRange, setAnalyticsRange] = useState<VendorAnalyticsRange>("today");

  const selectedVendor = useMemo(() => {
    return vendors.find((v) => vendorKey(v) === vendorId) || null;
  }, [vendors, vendorId]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) => {
      const status = normalizeVendorStatus(o.vendor_status);
      if (status === "vendor_pending") return !vendorAcceptTimer(o, nowMs).expired;
      return ["vendor_accepted", "driver_assigned", "pickup_ready"].includes(status);
    });
  }, [orders, nowMs]);

  const pendingVendorOrdersForAlert = useMemo(() => {
    return orders.filter((o) => isActivePendingVendorOrder(o, nowMs));
  }, [orders, nowMs]);


  const markVendorPortalAudioUnlocked = React.useCallback(() => {
    vendorAlertAudioUnlockedRef.current = true;
    setVendorAlertDebug((prev) => ({ ...prev, audioUnlocked: true }));
  }, []);

  const playVendorPortalAlert = React.useCallback(async (source: string) => {
    const attempt = new Date().toLocaleTimeString();
    setVendorAlertDebug((prev) => ({
      ...prev,
      lastAttempt: source + " @ " + attempt,
      lastResult: "attempting",
    }));

    if (!vendorAlertAudioUnlockedRef.current) {
      setVendorAlertDebug((prev) => ({ ...prev, lastResult: "blocked: audio not unlocked" }));
      return false;
    }

    const audio = vendorAlertAudioRef.current;
    if (!audio) {
      setVendorAlertDebug((prev) => ({ ...prev, lastResult: "failed: audio element missing" }));
      return false;
    }

    try {
      audio.pause();
      audio.currentTime = 0;
      audio.volume = 1;
      audio.muted = false;
      audio.src = VENDOR_PORTAL_ALERT_SOUND_URL;
      await audio.play();
      setVendorAlertDebug((prev) => ({ ...prev, lastResult: "played" }));
      return true;
    } catch (e: any) {
      const msg = String(e?.name || e?.message || e || "play failed");
      setVendorAlertDebug((prev) => ({ ...prev, lastResult: "failed: " + msg }));
      return false;
    }
  }, []);

  function enableVendorPortalSound() {
    vendorAlertAudioUnlockedRef.current = true;
    setVendorAlertSoundEnabled(true);
    setVendorAlertDebug((prev) => ({
      ...prev,
      audioUnlocked: true,
      lastAttempt: "enable click",
      lastResult: "enabled",
    }));
    void playVendorPortalAlert("enable test");
  }

  function disableVendorPortalSound() {
    vendorAlertAudioUnlockedRef.current = false;
    setVendorAlertSoundEnabled(false);
    setVendorAlertDebug((prev) => ({
      ...prev,
      audioUnlocked: false,
      loopState: "stopped",
      lastAttempt: "disable click",
      lastResult: "disabled",
    }));
  }

  useEffect(() => {
    const pendingCount = pendingVendorOrdersForAlert.length;
    setVendorAlertDebug((prev) => ({
      ...prev,
      pendingCount,
      audioUnlocked: vendorAlertAudioUnlockedRef.current,
      loopState: vendorAlertSoundEnabled && vendorAlertAudioUnlockedRef.current && pendingCount > 0 ? "starting" : "stopped",
    }));

    if (!vendorAlertSoundEnabled || !vendorAlertAudioUnlockedRef.current || pendingCount === 0) {
      return;
    }

    let cancelled = false;

    const ring = () => {
      if (cancelled) return;
      const now = Date.now();
      if (now - lastVendorAlertRingRef.current < VENDOR_ACCEPT_RING_INTERVAL_MS - 1000) return;
      lastVendorAlertRingRef.current = now;
      setVendorAlertDebug((prev) => ({ ...prev, loopState: "running" }));
      void playVendorPortalAlert("loop");
    };

    ring();
    const t = window.setInterval(ring, VENDOR_ACCEPT_RING_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [pendingVendorOrdersForAlert.length, playVendorPortalAlert, vendorAlertSoundEnabled]);

  const historyOrders = useMemo(() => {
    return orders.filter((o) => ["completed", "cancelled", "vendor_timeout"].includes(normalizeVendorStatus(o.vendor_status)));
  }, [orders]);

  const analyticsOrders = useMemo(() => {
    return orders.filter((o) => inAnalyticsRange(o, analyticsRange));
  }, [orders, analyticsRange]);

  const vendorAnalytics = useMemo(() => {
    const completed = analyticsOrders.filter((o) => normalizeVendorStatus(o.vendor_status) === "completed");
    const cancelled = analyticsOrders.filter((o) => ["cancelled", "vendor_timeout"].includes(normalizeVendorStatus(o.vendor_status)));
    const active = analyticsOrders.filter((o) => !["completed", "cancelled", "vendor_timeout"].includes(normalizeVendorStatus(o.vendor_status)));

    const grossFoodSales = completed.reduce((sum, o) => sum + toNum(orderSubtotal(o)), 0);
    const packagingSales = completed.reduce((sum, o) => sum + premiumPackagingAmount(o), 0);
    const completedSales = grossFoodSales + packagingSales;
    const estimatedCommission = completedSales * 0.1;
    const averageOrderValue = completed.length ? completedSales / completed.length : 0;

    const itemMap = new Map<string, { name: string; qty: number; sales: number }>();
    completed.forEach((order) => {
      orderItems(order).forEach((item) => {
        const name = clean(item.name) || "Unnamed item";
        const qty = Math.max(1, parseInt(String(item.quantity ?? 1), 10) || 1);
        const price = item.price == null || item.price === "" ? 0 : toNum(item.price);
        const current = itemMap.get(name) || { name, qty: 0, sales: 0 };
        current.qty += qty;
        current.sales += price * qty;
        itemMap.set(name, current);
      });
    });

    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.qty - a.qty || b.sales - a.sales)
      .slice(0, 5);

    return {
      receivedCount: analyticsOrders.length,
      completedCount: completed.length,
      cancelledCount: cancelled.length,
      activeCount: active.length,
      grossFoodSales,
      packagingSales,
      completedSales,
      estimatedCommission,
      averageOrderValue,
      topItems,
    };
  }, [analyticsOrders]);

  const usedCount = menu.length;
  const limitReached = false;

  async function loadVendors() {
    const j = await getJson("/api/admin/vendors");
    const rows = Array.isArray(j?.vendors) ? j.vendors : Array.isArray(j?.data) ? j.data : [];
    setVendors(rows);
    if (!vendorId && rows.length) setVendorId(vendorKey(rows[0]));
  }

  async function loadVendorData(id?: string, silent = false) {
    const vid = clean(id || vendorId);
    if (!vid) return;
    if (!silent) setBusy(true);
    setError("");
    try {
      const j = await getJson("/api/vendor-menu/manage?vendor_id=" + encodeURIComponent(vid));
      const v = j?.vendor || null;
      const items = Array.isArray(j?.items) ? j.items : [];
      const vendorRowForTown = vendors.find((row) => vendorKey(row) === vid) || selectedVendor;
      setProfile(v);
      setProfileName(clean(v?.name || (vendorRowForTown ? vendorLabel(vendorRowForTown as any) : vid)));
      setProfileTown(normalizeTakeoutTown(v?.town || vendorRowForTown?.town));
      setVendorLat(v?.vendor_lat == null ? "" : String(v.vendor_lat));
      setVendorLng(v?.vendor_lng == null ? "" : String(v.vendor_lng));
      setVendorLocationLabel(clean(v?.vendor_location_label || ""));
      setAcceptingOrders(v?.accepting_orders !== false);
      setLogoPreview(clean(v?.logo_url || ""));
      setMenu(items);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendor menu"));
      setProfile(null);
      setVendorLat("");
      setVendorLng("");
      setVendorLocationLabel("");
      setMenu([]);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function loadOrders(id?: string, silent = false) {
    const vid = clean(id || vendorId);
    if (!vid) return;
    if (!silent) setBusy(true);
    setError("");
    try {
      const j = await getJson("/api/vendor-orders?vendor_id=" + encodeURIComponent(vid));
      const rows = Array.isArray(j?.orders) ? j.orders : [];
      setOrders(rows);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendor orders"));
      setOrders([]);
    } finally {
      if (!silent) setBusy(false);
    }
  }

  async function refreshAll(id?: string, silent = false) {
    const vid = clean(id || vendorId);
    if (!vid) return;
    await Promise.all([loadVendorData(vid, silent), loadOrders(vid, silent)]);
  }

  useEffect(() => {
    loadVendors().catch((e) => setError(String(e?.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!vendorId) return;
    refreshAll(vendorId).catch((e) => setError(String(e?.message || e)));
    const t = setInterval(() => {
      loadOrders(vendorId, true).catch(() => undefined);
    }, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);
  useEffect(() => {
    const town = normalizeTakeoutTown(profile?.town || selectedVendor?.town);
    if (town && profileTown !== town) {
      setProfileTown(town);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.town, selectedVendor?.town]);

  useEffect(() => {
    let retryTimer: number | null = null;

    if (!vendorLocationOpen) {
      return;
    }

    if (!vendorMapContainerRef.current) {
      retryTimer = window.setTimeout(() => {
        setVendorMapMessage("Preparing vendor map picker...");
      }, 200);
      return () => {
        if (retryTimer !== null) window.clearTimeout(retryTimer);
      };
    }

    if (vendorMapRef.current) {
      window.setTimeout(() => {
        try {
          vendorMapRef.current?.resize();
        } catch (_) {}
      }, 200);
      return;
    }

    if (!VENDOR_PORTAL_MAPBOX_TOKEN) {
      setVendorMapMessage("Mapbox token is missing. Use manual latitude and longitude fields for now.");
      return;
    }

    const lat = parseCoordValue(vendorLat);
    const lng = parseCoordValue(vendorLng);
    const center = lat !== null && lng !== null ? ([lng, lat] as VendorLngLat) : townFallbackCenter(profileTown);

    const map = new mapboxgl.Map({
      container: vendorMapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center,
      zoom: lat !== null && lng !== null ? 16 : 13,
    });

    vendorMapRef.current = map;

    window.setTimeout(() => {
      try {
        map.resize();
      } catch (_) {}
    }, 200);

    const placeMarker = (coord: VendorLngLat) => {
      if (!vendorMarkerRef.current) {
        const marker = new mapboxgl.Marker({ draggable: true })
          .setLngLat(coord)
          .addTo(map);

        vendorMarkerRef.current = marker;

        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          if (!pos) return;
          setVendorLat(pos.lat.toFixed(6));
          setVendorLng(pos.lng.toFixed(6));
          if (!vendorLocationLabel.trim()) {
            setVendorLocationLabel("Pinned vendor pickup location");
          }
          setVendorMapMessage("Pickup pin updated. Click Save profile details to store it.");
        });
      } else {
        vendorMarkerRef.current.setLngLat(coord);
      }
    };

    map.on("load", () => {
      setVendorMapReady(true);
      placeMarker(center);
      setVendorMapMessage("Click the map or drag the pin to set the exact pickup point.");
      window.setTimeout(() => {
        try {
          map.resize();
        } catch (_) {}
      }, 200);
    });

    map.on("error", (ev: mapboxgl.ErrorEvent) => {
      const msg = String((ev as any)?.error?.message || "Mapbox failed to load vendor map.");
      setVendorMapMessage(msg + " Manual latitude and longitude fields remain available.");
    });

    map.on("click", (ev: mapboxgl.MapMouseEvent) => {
      const coord: VendorLngLat = [ev.lngLat.lng, ev.lngLat.lat];
      placeMarker(coord);
      setVendorLat(ev.lngLat.lat.toFixed(6));
      setVendorLng(ev.lngLat.lng.toFixed(6));
      if (!vendorLocationLabel.trim()) {
        setVendorLocationLabel("Pinned vendor pickup location");
      }
      setVendorMapMessage("Pickup pin updated. Click Save profile details to store it.");
    });

    return () => {
      vendorMarkerRef.current = null;
      vendorMapRef.current = null;
      setVendorMapReady(false);
      map.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorLocationOpen, profileTown]);

  useEffect(() => {
    const map = vendorMapRef.current;
    if (!map) return;
    const lat = parseCoordValue(vendorLat);
    const lng = parseCoordValue(vendorLng);
    if (lat === null || lng === null) return;
    const coord: VendorLngLat = [lng, lat];
    if (!vendorMarkerRef.current) {
      vendorMarkerRef.current = new mapboxgl.Marker({ draggable: true }).setLngLat(coord).addTo(map);
    } else {
      vendorMarkerRef.current.setLngLat(coord);
    }
    map.easeTo({ center: coord, zoom: Math.max(map.getZoom(), 15) });
  }, [vendorLat, vendorLng]);

  useEffect(() => {
    const map = vendorMapRef.current;
    if (!map) return;
    const lat = parseCoordValue(vendorLat);
    const lng = parseCoordValue(vendorLng);
    if (lat !== null && lng !== null) return;
    map.easeTo({ center: townFallbackCenter(profileTown), zoom: 13 });
  }, [profileTown, vendorLat, vendorLng]);

  function resetItemForm() {
    setEditingId("");
    setItemName("");
    setItemDescription("");
    setItemPackagingNote("");
    setItemPrepTimeMinutes(15);
    setItemPremiumPackagingEnabled(false);
    setItemPremiumPackagingFee("");
    setItemPremiumPackagingLabel("Premium packaging");
    setItemPrice("");
    setItemAvailable(true);
    setItemSoldOut(false);
    setItemDailyAvailableQuantity("0");
    setItemRemainingQuantity("0");
    setItemFile(null);
    setItemPreview("");
    if (itemInputRef.current) itemInputRef.current.value = "";
  }

  function editItem(m: MenuItem) {
    setEditingId(clean(m.id || m.menu_item_id));
    setItemName(m.name || "");
    setItemDescription(m.description || "");
    setItemPackagingNote(m.packaging_note || "");
    setItemPrepTimeMinutes(prepMinutes(m.prep_time_minutes));
    setItemPremiumPackagingEnabled(m.premium_packaging_enabled === true);
    setItemPremiumPackagingFee(clean(m.premium_packaging_fee || ""));
    setItemPremiumPackagingLabel(clean(m.premium_packaging_label || "Premium packaging") || "Premium packaging");
    setItemPrice(String(m.price || ""));
    setItemAvailable(m.is_available !== false);
    setItemSoldOut(m.sold_out_today === true);
    setItemDailyAvailableQuantity(clean(m.daily_available_quantity ?? "0"));
    setItemRemainingQuantity(clean(m.remaining_quantity ?? m.daily_available_quantity ?? "0"));
    setItemFile(null);
    setItemPreview(clean(m.photo_url || ""));
  }

  async function saveProfile() {
    const vid = clean(vendorId);
    if (!vid) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const logoDataUrl = await fileToDataUrl(logoFile);
      const j = await postJson("/api/vendor-menu/manage", {
        action: "profile",
        vendor_id: vid,
        name: profileName,
        town: profileTown,
        accepting_orders: acceptingOrders,
        vendor_lat: vendorLat,
        vendor_lng: vendorLng,
        vendor_location_label: vendorLocationLabel,
        logo_data_url: logoDataUrl,
      });
      setMessage(j?.warning ? "Profile saved, but image warning: " + j.warning : "Vendor profile saved.");
      setLogoFile(null);
      if (logoInputRef.current) logoInputRef.current.value = "";
      await loadVendorData(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }


  async function setVendorOpenState(nextOpen: boolean) {
    const vid = clean(vendorId);
    if (!vid) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const j = await postJson("/api/vendor-menu/manage", {
        action: "profile",
        vendor_id: vid,
        name: profileName,
        town: profileTown,
        accepting_orders: nextOpen,
        vendor_lat: vendorLat,
        vendor_lng: vendorLng,
        vendor_location_label: vendorLocationLabel,
      });
      setAcceptingOrders(nextOpen);
      setMessage(j?.warning ? "Vendor status saved, but image warning: " + j.warning : nextOpen ? "Vendor is now open for orders." : "Vendor is now closed for new orders.");
      await loadVendorData(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
      await loadVendorData(vid, true).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function saveItem() {
    const vid = clean(vendorId);
    if (!vid) return;
        setBusy(true);
    setError("");
    setMessage("");
    try {
      const photoDataUrl = await fileToDataUrl(itemFile);
      const stockIsPositive = hasPositiveJrideStock(itemDailyAvailableQuantity, itemRemainingQuantity);
      const nextAvailable = stockIsPositive ? true : itemAvailable;
      const nextSoldOut = stockIsPositive ? false : itemSoldOut;

      const j = await postJson("/api/vendor-menu/manage", {
        action: "save_item",
        vendor_id: vid,
        id: editingId || null,
        name: itemName,
        description: itemDescription,
        packaging_note: itemPackagingNote,
        prep_time_minutes: itemPrepTimeMinutes,
        premium_packaging_enabled: itemPremiumPackagingEnabled,
        premium_packaging_fee: itemPremiumPackagingFee,
        premium_packaging_label: itemPremiumPackagingLabel,
        price: itemPrice,
        is_available: nextAvailable,
        sold_out_today: nextSoldOut,
        daily_available_quantity: itemDailyAvailableQuantity,
        remaining_quantity: itemRemainingQuantity,
        photo_data_url: photoDataUrl,
      });
      setMessage(j?.warning ? "Menu saved, but image warning: " + j.warning : editingId ? "Menu item updated." : "Menu item added.");
      resetItemForm();
      await loadVendorData(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleItem(m: MenuItem, next: Partial<MenuItem>) {
    const vid = clean(vendorId);
    if (!vid) return;

    const nextAvailable = next.is_available ?? m.is_available;
    const nextSoldOut = next.sold_out_today ?? m.sold_out_today;

    const actionText =
      nextSoldOut === true
        ? "mark this item as sold out"
        : nextAvailable === false
          ? "make this item unavailable"
          : "make this item available";

    if ((nextSoldOut === true || nextAvailable === false) && !window.confirm("Confirm: " + actionText + "?")) return;

    setBusy(true);
    setError("");
    try {
      await postJson("/api/vendor-menu/manage", {
        action: "toggle_item",
        vendor_id: vid,
        id: m.id || m.menu_item_id,
        is_available: nextAvailable,
        sold_out_today: nextSoldOut,
      });
      await loadVendorData(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function makeItemOrderable(m: MenuItem) {
    await toggleItem(m, { is_available: true, sold_out_today: false });
  }

  async function markItemUnavailable(m: MenuItem) {
    await toggleItem(m, { is_available: false, sold_out_today: m.sold_out_today });
  }

  async function markItemSoldOut(m: MenuItem) {
    await toggleItem(m, { is_available: false, sold_out_today: true });
  }

  function openCancelOrderDialog(order: TakeoutOrder) {
    setCancelTargetOrder(order);
    setCancelReason("");
    setCancelOtherReason("");
    setCancelNote("");
    setError("");
    setMessage("");
  }

  function closeCancelOrderDialog() {
    if (busy) return;
    setCancelTargetOrder(null);
    setCancelReason("");
    setCancelOtherReason("");
    setCancelNote("");
  }

  async function moveOrder(
    order: TakeoutOrder,
    nextStatus: string,
    options?: { cancelReason?: string; cancelNote?: string }
  ) {
    const vid = clean(vendorId);
    const oid = clean(order.id);
    if (!vid || !oid) return;

    const finalCancelReason = clean(options?.cancelReason);
    const finalCancelNote = clean(options?.cancelNote);

    if (nextStatus === "cancelled" && !finalCancelReason) {
      setError("Cancellation reason is required before cancelling an order.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");
    try {
      await postJson("/api/vendor-orders", {
        vendor_id: vid,
        order_id: oid,
        vendor_status: nextStatus,
        cancel_reason: finalCancelReason || null,
        cancellation_reason: finalCancelReason || null,
        vendor_cancel_reason: finalCancelReason || null,
        cancel_note: finalCancelNote || null,
        cancellation_note: finalCancelNote || null,
        vendor_cancel_note: finalCancelNote || null,
        cancelled_by: nextStatus === "cancelled" ? "vendor" : null,
      });
      setMessage(
        nextStatus === "cancelled"
          ? "Order cancelled. Reason saved: " + finalCancelReason
          : "Order updated to " + statusLabel(nextStatus) + "."
      );
      if (nextStatus === "cancelled") closeCancelOrderDialog();
      await loadOrders(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmCancelOrder() {
    if (!cancelTargetOrder) return;
    const selected = clean(cancelReason);
    const other = clean(cancelOtherReason);
    const finalReason = selected === "Other reason" ? other : selected;

    if (!selected) {
      setError("Select a cancellation reason before proceeding.");
      return;
    }

    if (selected === "Other reason" && !other) {
      setError("Type the cancellation reason before proceeding.");
      return;
    }

    await moveOrder(cancelTargetOrder, "cancelled", {
      cancelReason: finalReason,
      cancelNote,
    });
  }

  return (
    <main className="jride-vendor-premium-shell min-h-screen p-3 text-slate-100 sm:p-4">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          <div>
            <h1 className="text-2xl font-semibold">Vendor Portal</h1>
            <p className="mt-1 text-sm text-slate-600">
              Manage profile, logo, menu items, packaging options, and takeout orders.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="min-w-72 rounded-xl border px-3 py-2 text-sm"
              value={vendorId}
              onChange={(e) => {
                setVendorId(e.target.value);
                resetItemForm();
                setMessage("");
                setError("");
              }}
            >
              <option value="">Select vendor</option>
              {vendors.map((v) => {
                const id = vendorKey(v);
                return (
                  <option key={id} value={id}>
                    {vendorLabel(v)}{normalizeTakeoutTown(v.town) ? " - " + normalizeTakeoutTown(v.town) : ""}
                  </option>
                );
              })}
            </select>

            <a
              href={vendorOrdersHref}
              className={["rounded-xl border px-4 py-2 text-sm hover:bg-slate-50", !vendorId ? "pointer-events-none opacity-50" : ""].join(" ")}
              aria-disabled={!vendorId}
            >
              Orders
            </a>

            <a
              href={vendorAnalyticsHref}
              className={["rounded-xl border px-4 py-2 text-sm hover:bg-slate-50", !vendorId ? "pointer-events-none opacity-50" : ""].join(" ")}
              aria-disabled={!vendorId}
            >
              Analytics
            </a>

            <button
              type="button"
              onClick={() => refreshAll().catch((e) => setError(String(e?.message || e)))}
              className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
              disabled={!vendorId || busy}
            >
              Refresh
            </button>

            <button
              type="button"
              onClick={handleVendorLogout}
              className="rounded-xl border border-rose-200 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
            >
              Logout
            </button>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {message ? <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

        {cancelTargetOrder ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Cancel takeout order</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Cancelling this order will notify the passenger and JRide admin. A reason is required.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCancelOrderDialog}
                  disabled={busy}
                  className="rounded-lg border px-3 py-2 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Close
                </button>
              </div>

              <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-xs text-slate-700">
                <div className="font-semibold text-slate-900">Order</div>
                <div className="mt-1">
                  {clean(cancelTargetOrder.booking_code) || clean(cancelTargetOrder.id) || "Selected order"}
                </div>
                <div className="mt-1">{orderCustomerName(cancelTargetOrder)}</div>
              </div>

              <div className="mt-4">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Reason for cancellation
                </label>
                <select
                  value={cancelReason}
                  onChange={(e) => {
                    setCancelReason(e.target.value);
                    if (e.target.value !== "Other reason") setCancelOtherReason("");
                  }}
                  className="mt-1 w-full rounded-xl border px-3 py-3 text-sm"
                  disabled={busy}
                >
                  <option value="">Select reason</option>
                  {VENDOR_CANCEL_REASONS.map((reason) => (
                    <option key={reason} value={reason}>{reason}</option>
                  ))}
                </select>
              </div>

              {cancelReason === "Other reason" ? (
                <div className="mt-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Type the reason
                  </label>
                  <input
                    value={cancelOtherReason}
                    onChange={(e) => setCancelOtherReason(e.target.value)}
                    className="mt-1 w-full rounded-xl border px-3 py-3 text-sm"
                    placeholder="Enter the cancellation reason"
                    disabled={busy}
                  />
                </div>
              ) : null}

              <div className="mt-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Note to passenger/admin (optional)
                </label>
                <textarea
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-3 text-sm"
                  rows={3}
                  placeholder="Add details if needed"
                  disabled={busy}
                />
              </div>

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={closeCancelOrderDialog}
                  disabled={busy}
                  className="rounded-xl border px-4 py-3 text-sm font-semibold hover:bg-slate-50 disabled:opacity-50"
                >
                  Keep order
                </button>
                <button
                  type="button"
                  onClick={() => confirmCancelOrder().catch((e) => setError(String(e?.message || e)))}
                  disabled={
                    busy ||
                    !cancelReason ||
                    (cancelReason === "Other reason" && !clean(cancelOtherReason))
                  }
                  className="rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white hover:bg-rose-800 disabled:bg-slate-400"
                >
                  {busy ? "Cancelling..." : "Confirm cancellation"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {!vendorId ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">Select a vendor to continue.</div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <section className={cls("self-start rounded-2xl border bg-white p-4 shadow-sm", acceptingOrders ? "border-emerald-200" : "border-rose-200")}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Vendor profile</h2>
                  <p className="text-xs text-slate-500">Store identity and live order availability.</p>
                </div>
                <span
                  className={cls(
                    "inline-flex min-w-24 items-center justify-center rounded-2xl border px-3 py-2 text-xs font-bold uppercase tracking-wide",
                    acceptingOrders ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-700",
                  )}
                >
                  <span className={cls("mr-2 h-2.5 w-2.5 rounded-full", acceptingOrders ? "bg-emerald-600" : "bg-rose-600")} />
                  {acceptingOrders ? "Open" : "Closed"}
                </span>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <div className={cls("h-20 w-20 overflow-hidden rounded-2xl border", acceptingOrders ? "bg-emerald-50" : "bg-rose-50")}>
                  {logoPreview ? <img src={logoPreview} alt="Vendor logo" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">Logo</div>}
                </div>
                <div className="min-w-0 text-sm">
                  <div className="font-semibold">{profile?.name || profileName || (selectedVendor ? vendorLabel(selectedVendor as any) : "Vendor")}</div>
                  <div className="text-xs text-slate-500">{profileTown || "Town not set"}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Logo is optional, but recommended for passenger trust.</div>
                </div>
              </div>

              <div className={cls("mt-4 rounded-2xl border p-3", acceptingOrders ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Order availability</div>
                    <div className="text-xs text-slate-600">This control saves immediately and controls passenger ordering.</div>
                  </div>
                  <span className={cls("rounded-full border px-2.5 py-1 text-[11px] font-semibold", acceptingOrders ? "border-emerald-300 bg-white text-emerald-800" : "border-rose-300 bg-white text-rose-700")}>
                    {busy ? "Saving" : "Auto-saved"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 overflow-hidden rounded-2xl border bg-white">
                  <button
                    type="button"
                    disabled={busy || acceptingOrders}
                    onClick={() => setVendorOpenState(true)}
                    className={cls(
                      "min-h-16 px-3 py-3 text-left text-sm font-bold transition disabled:cursor-not-allowed",
                      acceptingOrders ? "bg-emerald-600 text-white" : "bg-white text-slate-700 hover:bg-emerald-50",
                      busy && !acceptingOrders ? "opacity-60" : "",
                    )}
                  >
                    <span className="block">OPEN FOR ORDERS</span>
                    <span className={cls("block text-[11px] font-medium", acceptingOrders ? "text-emerald-50" : "text-slate-500")}>Customers can place orders.</span>
                  </button>
                  <button
                    type="button"
                    disabled={busy || !acceptingOrders}
                    onClick={() => setVendorOpenState(false)}
                    className={cls(
                      "min-h-16 border-l px-3 py-3 text-left text-sm font-bold transition disabled:cursor-not-allowed",
                      !acceptingOrders ? "bg-rose-600 text-white" : "bg-white text-slate-700 hover:bg-rose-50",
                      busy && acceptingOrders ? "opacity-60" : "",
                    )}
                  >
                    <span className="block">CLOSED</span>
                    <span className={cls("block text-[11px] font-medium", !acceptingOrders ? "text-rose-50" : "text-slate-500")}>No new orders accepted.</span>
                  </button>
                </div>

                <div className={cls("mt-3 rounded-xl border px-3 py-2 text-xs font-medium", acceptingOrders ? "border-emerald-200 bg-white text-emerald-800" : "border-rose-200 bg-white text-rose-700")}>
                  {busy ? "Saving vendor availability..." : acceptingOrders ? "Vendor is open. Customers can place takeout orders." : "Vendor is closed. New passenger orders are blocked until reopened."}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">General profile details</div>
                <div className="text-xs text-slate-500">Use Save profile only for vendor name, town, and logo changes.</div>

                <label className="mt-3 block text-xs font-medium text-slate-700">Vendor name</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Vendor name" />

                <label className="mt-3 block text-xs font-medium text-slate-700">Town location</label>
                <select
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  value={profileTown}
                  onChange={(e) => setProfileTown(e.target.value)}
                >
                  <option value="">Select town</option>
                  {CANONICAL_TAKEOUT_TOWNS.map((town) => (
                    <option key={town} value={town}>{town}</option>
                  ))}
                </select>
                <div className="mt-1 text-[11px] text-slate-500">Used to group this vendor under the correct passenger store location.</div>

                <div className="mt-4 rounded-2xl border bg-white p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Exact vendor pickup pin</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {vendorLat && vendorLng
                          ? `Saved pin: ${vendorLat}, ${vendorLng}`
                          : "No exact pickup pin saved yet."}
                      </div>
                      {vendorLocationLabel ? (
                        <div className="mt-1 text-[11px] text-slate-500">{vendorLocationLabel}</div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="rounded-xl border px-3 py-2 text-xs font-semibold hover:bg-slate-50"
                      onClick={() => setVendorLocationOpen((prev) => !prev)}
                    >
                      {vendorLocationOpen ? "Hide map" : vendorLat && vendorLng ? "Edit pickup pin" : "Set pickup pin"}
                    </button>
                  </div>

                  {vendorLocationOpen ? (
                    <div className="mt-3 rounded-2xl border bg-slate-50 p-3">
                      <div className="text-[11px] text-slate-500">
                        Set the real store pickup coordinates. Click the map or drag the pin, then click Save profile details.
                      </div>

                      <label className="mt-3 block text-xs font-medium text-slate-700">Location label</label>
                      <input
                        className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                        value={vendorLocationLabel}
                        onChange={(e) => setVendorLocationLabel(e.target.value)}
                        placeholder="Example: Beside municipal hall, front of main entrance"
                      />

                      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <div>
                          <label className="block text-xs font-medium text-slate-700">Latitude</label>
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            value={vendorLat}
                            onChange={(e) => setVendorLat(e.target.value)}
                            placeholder="16.833000"
                            inputMode="decimal"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-slate-700">Longitude</label>
                          <input
                            className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                            value={vendorLng}
                            onChange={(e) => setVendorLng(e.target.value)}
                            placeholder="121.100000"
                            inputMode="decimal"
                          />
                        </div>
                      </div>

                      <div className="mt-3 overflow-hidden rounded-2xl border bg-white">
                        <div ref={vendorMapContainerRef} className="h-64 w-full" />
                      </div>

                      <div className="mt-2 text-[11px] text-slate-500">
                        {vendorMapMessage || (vendorMapReady ? "Click the map or drag the pin to set the exact vendor pickup point." : "Loading vendor map picker...")}
                      </div>
                      <div className="mt-1 text-[11px] text-slate-500">Manual latitude and longitude fields remain available as fallback.</div>
                    </div>
                  ) : null}
                </div>

                <label className="mt-3 block text-xs font-medium text-slate-700">Vendor logo</label>
                <input
                  className="mt-1 w-full rounded-2xl border bg-white shadow-sm px-3 py-2 text-sm"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setLogoFile(f);
                    if (f) setLogoPreview(URL.createObjectURL(f));
                  }}
                />
              </div>

              <button type="button" onClick={saveProfile} disabled={busy} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400">
                {busy ? "Saving..." : "Save profile details"}
              </button>
            </section>

            <section className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Menu manager</h2>
                  <p className="text-xs text-slate-500">Menu catalog with unlimited menu items.</p>
                </div>
                <span className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
  Unlimited menu items
</span>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border bg-slate-50 p-3 shadow-inner md:grid-cols-6">
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Menu name</label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={itemName} onChange={(e) => setItemName(e.target.value)} disabled={limitReached} placeholder="Example: Chicken adobo" />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Price</label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={itemPrice} onChange={(e) => setItemPrice(e.target.value.replace(/[^0-9.]/g, ""))} disabled={limitReached} inputMode="decimal" placeholder="0.00" />
                </div>
                <div className="md:col-span-3">
                  <label className="text-xs font-medium text-slate-700">Photo</label>
                  <input
                    ref={itemInputRef}
                    className="mt-1 w-full rounded-2xl border bg-white shadow-sm px-3 py-2 text-sm"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={limitReached}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setItemFile(f);
                      if (f) setItemPreview(URL.createObjectURL(f));
                    }}
                  />
                </div>
                <div className="md:col-span-6">
                  <label className="text-xs font-medium text-slate-700">Description</label>
                  <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={2} value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} disabled={limitReached} placeholder="Optional item details" />
                </div>
                <div className="md:col-span-6">                <div>
                  <label className="text-xs font-medium text-slate-700">Preparation time</label>
                  <select className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={itemPrepTimeMinutes} onChange={(e) => setItemPrepTimeMinutes(prepMinutes(e.target.value))}>
                    {PREP_TIME_OPTIONS.map((mins) => <option key={mins} value={mins}>{mins} minutes</option>)}
                  </select>
                </div>
                  <label className="text-xs font-medium text-slate-700">Packaging note</label>
                  <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={2} value={itemPackagingNote} onChange={(e) => setItemPackagingNote(e.target.value)} disabled={limitReached} placeholder="Example: Packed in standard takeaway packaging." />
                  <div className="mt-1 text-[11px] text-slate-500">This explains the default packaging included with the item.</div>
                </div>
                <div className="rounded-2xl border bg-white p-3 md:col-span-6">
                  <label className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="block font-semibold">Premium packaging available</span>
                      <span className="block text-xs text-slate-500">Shown on the passenger menu as Premium packaging available (+PHP fee).</span>
                    </span>
                    <input type="checkbox" checked={itemPremiumPackagingEnabled} onChange={(e) => setItemPremiumPackagingEnabled(e.target.checked)} disabled={limitReached} />
                  </label>
                  <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                    <label className="text-xs text-slate-600">
                      Label
                      <input className="mt-1 w-full rounded-2xl border bg-white shadow-sm px-3 py-2 text-sm" value={itemPremiumPackagingLabel} onChange={(e) => setItemPremiumPackagingLabel(e.target.value)} disabled={limitReached || !itemPremiumPackagingEnabled} placeholder="Premium packaging" />
                    </label>
                    <label className="text-xs text-slate-600">
                      Fee
                      <input className="mt-1 w-full rounded-2xl border bg-white shadow-sm px-3 py-2 text-sm" value={itemPremiumPackagingFee} onChange={(e) => setItemPremiumPackagingFee(e.target.value.replace(/[^0-9.]/g, ""))} disabled={limitReached || !itemPremiumPackagingEnabled} inputMode="decimal" placeholder="10.00" />
                    </label>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 md:col-span-6">
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={itemAvailable} onChange={(e) => setItemAvailable(e.target.checked)} disabled={limitReached} /> Available</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-700">Available for JRide orders
                      <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min="0" value={itemDailyAvailableQuantity} onChange={(e) => setItemDailyAvailableQuantity(e.target.value)} disabled={limitReached} />
                    </label>
                    <label className="text-xs font-medium text-slate-700">Remaining today (auto-calculated)
                      <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min="0" value={itemRemainingQuantity} onChange={(e) => setItemRemainingQuantity(e.target.value)} disabled={limitReached} />
                    </label>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={itemSoldOut} onChange={(e) => setItemSoldOut(e.target.checked)} disabled={limitReached} /> Sold out today</label>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800 md:col-span-2">
                    Set how many items are available for JRide customers. Keep a buffer for walk-in and in-store customers. Update availability throughout the day as items are sold or restocked.
                  </div>
                  {itemPreview ? <img src={itemPreview} alt="Item preview" className="h-12 w-12 rounded-xl border object-cover" /> : null}
                  <button type="button" onClick={saveItem} disabled={busy || limitReached} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400">{editingId ? "Update item" : "Add item"}</button>
                  <button type="button" onClick={resetItemForm} className="rounded-2xl border bg-white shadow-sm px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Clear</button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
                {menu.length === 0 ? (
                  <div className="rounded-2xl border bg-white shadow-sm p-4 text-sm text-slate-600">No menu items yet.</div>
                ) : (
                  menu.map((m) => (
                    <div key={m.id || m.menu_item_id || m.name} className="group overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="h-44 bg-slate-100">
                        {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>}
                      </div>
                      <div className="space-y-3 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="line-clamp-2 text-lg font-extrabold leading-tight tracking-tight text-slate-900">{m.name}</div>
                            <div className="mt-2 text-xl font-black tracking-tight text-slate-900">{money(m.price)}</div>
                          </div>
                          <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={() => editItem(m)}>Edit</button>
                        </div>
                        {m.description ? <div className="text-sm leading-relaxed text-slate-600">{m.description}</div> : null}
                        <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">Prep time: {prepMinutes(m.prep_time_minutes)} min</div>
                        <div className="text-[11px] font-semibold text-emerald-700">Remaining today: {Number(m.remaining_quantity || 0)} / {Number(m.daily_available_quantity || 0)}</div>
                        {m.packaging_note ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium text-amber-800">Packaging: {m.packaging_note}</div> : null}
                        {m.premium_packaging_enabled ? (
                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[11px] font-medium text-emerald-800">
                            Premium packaging available (+{money(toNum(m.premium_packaging_fee))})
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className={cls("rounded-full border px-2 py-1", m.is_available ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-50 text-slate-600")}>{m.is_available ? "Available" : "Unavailable"}</span>
                          {m.sold_out_today ? <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-rose-700">Sold out</span> : null}
                        </div>
                        {m.sold_out_today || !m.is_available ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium text-amber-800">
                            This item is blocked from passenger ordering until it is made available and sold-out status is cleared.
                          </div>
                        ) : null}
                        <div className="grid grid-cols-2 gap-2">
                          {m.is_available && !m.sold_out_today ? (
                            <button
                              type="button"
                              className="rounded-lg border bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              onClick={() => markItemUnavailable(m)}
                            >
                              Make unavailable
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                              onClick={() => makeItemOrderable(m)}
                            >
                              Make available
                            </button>
                          )}
                          {m.sold_out_today ? (
                            <button
                              type="button"
                              className="rounded-lg border bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              onClick={() => makeItemOrderable(m)}
                            >
                              Clear sold out
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100"
                              onClick={() => markItemSoldOut(m)}
                            >
                              Mark sold out
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Vendor summary</h2>
                  <p className="text-xs text-slate-500">Read-only sales and order overview based on loaded vendor orders.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(["today", "week", "month", "all"] as VendorAnalyticsRange[]).map((range) => (
                    <button
                      key={range}
                      type="button"
                      onClick={() => setAnalyticsRange(range)}
                      className={cls(
                        "rounded-full border px-3 py-1 text-xs font-semibold",
                        analyticsRange === range ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                      )}
                    >
                      {range === "today" ? "Today" : range === "week" ? "This week" : range === "month" ? "This month" : "All time"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="rounded-2xl border bg-slate-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Orders received</div>
                  <div className="mt-1 text-2xl font-black text-slate-900">{vendorAnalytics.receivedCount}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Active: {vendorAnalytics.activeCount}</div>
                </div>
                <div className="rounded-2xl border bg-emerald-50 p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">Completed</div>
                  <div className="mt-1 text-2xl font-black text-emerald-800">{vendorAnalytics.completedCount}</div>
                  <div className="mt-1 text-[11px] text-emerald-700">Cancelled: {vendorAnalytics.cancelledCount}</div>
                </div>
                <div className="rounded-2xl border bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Food sales</div>
                  <div className="mt-1 text-xl font-black text-slate-900">{money(vendorAnalytics.grossFoodSales)}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Completed food only</div>
                </div>
                <div className="rounded-2xl border bg-white p-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Avg order value</div>
                  <div className="mt-1 text-xl font-black text-slate-900">{money(vendorAnalytics.averageOrderValue)}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Completed orders</div>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div className="rounded-2xl border bg-white p-3">
                  <div className="text-sm font-semibold text-slate-900">Sales breakdown</div>
                  <div className="mt-2 space-y-1 text-xs text-slate-600">
                    <div className="flex justify-between gap-3">
                      <span>Food/item sales</span>
                      <span className="font-semibold text-slate-900">{money(vendorAnalytics.grossFoodSales)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Packaging/add-ons</span>
                      <span className="font-semibold text-slate-900">{money(vendorAnalytics.packagingSales)}</span>
                    </div>
                    <div className="flex justify-between gap-3 border-t pt-1">
                      <span>Total vendor sales shown</span>
                      <span className="font-bold text-slate-900">{money(vendorAnalytics.completedSales)}</span>
                    </div>
                    <div className="flex justify-between gap-3 text-amber-700">
                      <span>Estimated JRide commission</span>
                      <span className="font-semibold">{money(vendorAnalytics.estimatedCommission)}</span>
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border bg-white p-3 lg:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">Top-selling items</div>
                    <div className="text-[11px] text-slate-500">By completed quantity</div>
                  </div>
                  {vendorAnalytics.topItems.length === 0 ? (
                    <div className="mt-2 rounded-xl border bg-slate-50 p-3 text-xs text-slate-500">No completed item sales in this period.</div>
                  ) : (
                    <div className="mt-2 grid gap-2">
                      {vendorAnalytics.topItems.map((item) => (
                        <div key={item.name} className="flex items-center justify-between gap-3 rounded-xl border bg-slate-50 px-3 py-2 text-xs">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="text-right">
                            <div className="font-bold text-slate-900">{item.qty} sold</div>
                            <div className="text-slate-500">{money(item.sales)}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800">
                Vendor analytics show food/item sales and packaging/add-ons from completed orders only. Driver delivery fees are not counted as vendor sales.
              </div>
            </section>

            <section className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Order queue</h2>
                  <p className="text-xs text-slate-500">Large simple controls for vendor processing.</p>
                </div>
                <div className="text-xs text-slate-500">Active: {activeOrders.length} | History: {historyOrders.length}</div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-1 hover:bg-slate-50"
                    onClick={vendorAlertSoundEnabled ? disableVendorPortalSound : enableVendorPortalSound}
                  >
                    {vendorAlertSoundEnabled ? "Disable vendor sound" : "Enable vendor sound"}
                  </button>
                  <button
                    type="button"
                    className="rounded-xl border px-3 py-1 hover:bg-slate-50"
                    onClick={() => {
                      markVendorPortalAudioUnlocked();
                      setVendorAlertSoundEnabled(true);
                      void playVendorPortalAlert("manual test");
                    }}
                  >
                    Test sound
                  </button>
                  <span>Vendor alert sound: {vendorAlertSoundEnabled ? "on" : "off"}</span>
                  {pendingVendorOrdersForAlert.length > 0 ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">Pending accept: {pendingVendorOrdersForAlert.length}</span> : null}
                  <span className={vendorAlertSoundEnabled && vendorAlertDebug.audioUnlocked ? "text-emerald-700" : "text-slate-500"}>
                    {vendorAlertSoundEnabled && vendorAlertDebug.audioUnlocked ? "Sound ready" : "Sound off"}
                  </span>
                </div>
                <audio ref={vendorAlertAudioRef} src={VENDOR_PORTAL_ALERT_SOUND_URL} preload="auto" className="hidden" />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Active vendor workflow</h3>
                  <div className="mb-2 text-[11px] text-slate-500">Shows passenger, address, items, receipt request, packaging, and notes.</div>
                  <div className="space-y-2">
                    {activeOrders.length === 0 ? <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">No active orders.</div> : null}
                    {activeOrders.map((o) => {
                      const s = normalizeVendorStatus(o.vendor_status);
                      const acceptDeadline = vendorAcceptTimer(o, nowMs);
                      return (
                        <div key={o.id || o.booking_code || Math.random()} className="rounded-2xl border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold">{o.booking_code || o.id}</div>
                              <div className="mt-1 grid gap-0.5 text-xs text-slate-600">
                                <div><span className="font-semibold text-slate-700">Passenger:</span> {orderCustomerName(o)}</div>
                                <div><span className="font-semibold text-slate-700">Phone:</span> {orderCustomerPhone(o)}</div>
                                <div><span className="font-semibold text-slate-700">Delivery address:</span> {orderDeliveryAddress(o)}</div>
                                {hasDeliveryPin(o) ? <div><span className="font-semibold text-slate-700">Map pin:</span> Saved for driver navigation</div> : null}
                              </div>
                            </div>
                            <span className={cls("rounded-full border px-2 py-1 text-xs font-semibold", orderClass(s))}>{statusLabel(s)}</span>
                          </div>
                          {s === "vendor_pending" ? (
                            <div className={"mt-2 inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold " + vendorAcceptTimerClass(acceptDeadline.tone)}>
                              Accept within: {acceptDeadline.label}
                              {acceptDeadline.expired ? " - overdue" : ""}
                            </div>
                          ) : null}
                          <div className="mt-3 rounded-xl border bg-slate-50 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                              <span>Order details</span>
                              <span>{orderItems(o).length} item{orderItems(o).length === 1 ? "" : "s"}</span>
                            </div>
                            {orderItems(o).length ? (
                              <div className="space-y-2">
                                {orderItems(o).map((it, idx) => {
                                  const qty = Math.max(1, parseInt(String(it.quantity ?? 1), 10) || 1);
                                  const unitPrice = it.price == null || it.price === "" ? null : toNum(it.price);
                                  const lineTotal = unitPrice == null ? null : unitPrice * qty;
                                  return (
                                    <div key={`${clean(it.menu_item_id) || clean(it.name) || idx}-${idx}`} className="rounded-lg bg-white px-3 py-2 text-sm">
                                      <div className="flex items-start justify-between gap-3">
                                        <div>
                                          <div className="font-semibold text-slate-900">{qty} x {clean(it.name)}</div>
                                          {clean(it.packaging_note) ? <div className="mt-1 text-xs text-slate-500">Packaging: {clean(it.packaging_note)}</div> : null}
                                        </div>
                                        <div className="shrink-0 font-semibold text-slate-900">{lineTotal == null ? "--" : money(lineTotal)}</div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="rounded-lg bg-white px-3 py-2 text-xs text-rose-700">No item details returned. Refresh the queue before preparing this order.</div>
                            )}
                          </div>
                          <div className="mt-2 text-sm font-medium">Subtotal: {money(orderSubtotal(o))}</div>
                          <div className="mt-2 rounded-xl border bg-amber-50 p-2 text-xs text-amber-900">
                            <div className="font-semibold">Order instructions</div>
                            <div className="mt-1">Receipt requested: {orderReceiptRequested(o) ? "YES" : "NO"}</div>
                            <div className="mt-1">Packaging: {orderPackagingInstruction(o)}</div>
                            <div className="mt-1">Customer note: {orderCustomerNoteOnly(o) || "none"}</div>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {s === "vendor_pending" ? (
                              <>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "vendor_accepted")} title={acceptDeadline.expired ? "This order is past the 5-minute vendor accept target." : "Accept this order within the 5-minute target."} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Accept order</button>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "cancelled")} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject order</button>
                              </>
                            ) : null}
                            {s === "vendor_accepted" ? (
                              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">Vendor accepted. Dispatch can proceed. No second vendor action is required. Wait for driver assignment and mark Wait for driver assignment and mark the order ready only when food preparation is complete.</div>
                            ) : null}
                            {s === "driver_assigned" ? (
                              <>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "pickup_ready")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Mark order ready</button>
                                <button type="button" disabled={busy} onClick={() => openCancelOrderDialog(o)} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Cancel</button>
                              </>
                            ) : null}
                                                      </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-semibold">Completed and cancelled history</h3>
                  <div className="max-h-[520px] space-y-2 overflow-auto pr-1">
                    {historyOrders.length === 0 ? <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">No completed or cancelled orders.</div> : null}
                    {historyOrders.map((o) => (
                      <div key={o.id || o.booking_code || Math.random()} className="rounded-xl border bg-slate-50 p-3 text-sm">
                        <div className="flex justify-between gap-2">
                          <span className="font-semibold">{o.booking_code || o.id}</span>
                          <span className={cls("rounded-full border px-2 py-0.5 text-xs", orderClass(o.vendor_status))}>{statusLabel(o.vendor_status)}</span>
                        </div>
                        <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                          <div>{orderCustomerName(o)} | {money(orderSubtotal(o))}</div>
                          <div>Phone: {orderCustomerPhone(o)}</div>
                          <div>Delivery address: {orderDeliveryAddress(o)}</div>
                          {hasDeliveryPin(o) ? <div>Map pin: Saved</div> : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
      <style jsx global>{`
        /* JRIDE_VENDOR_PORTAL_PREMIUM_MOBILE_UI_V1 */
        .jride-vendor-premium-shell {
          min-height: 100vh;
          background:
            radial-gradient(circle at 20% 0%, rgba(34, 197, 94, 0.18), transparent 28%),
            radial-gradient(circle at 90% 8%, rgba(16, 185, 129, 0.13), transparent 25%),
            linear-gradient(180deg, #061014 0%, #08131b 48%, #050b10 100%);
          color: #e8fff2;
        }
        .jride-vendor-premium-shell .mx-auto.max-w-7xl {
          max-width: 1120px;
        }
        .jride-vendor-premium-shell .bg-white,
        .jride-vendor-premium-shell .bg-slate-50 {
          background: rgba(8, 20, 29, 0.88) !important;
          border-color: rgba(34, 197, 94, 0.24) !important;
          color: #e8fff2 !important;
          box-shadow: 0 18px 45px rgba(0, 0, 0, 0.26);
          backdrop-filter: blur(10px);
        }
        .jride-vendor-premium-shell .border {
          border-color: rgba(34, 197, 94, 0.20) !important;
        }
        .jride-vendor-premium-shell h1,
        .jride-vendor-premium-shell h2,
        .jride-vendor-premium-shell h3,
        .jride-vendor-premium-shell .text-slate-900,
        .jride-vendor-premium-shell .font-semibold,
        .jride-vendor-premium-shell .font-bold {
          color: #f3fff7 !important;
        }
        .jride-vendor-premium-shell .text-slate-600,
        .jride-vendor-premium-shell .text-slate-500,
        .jride-vendor-premium-shell .text-slate-400,
        .jride-vendor-premium-shell .text-xs {
          color: #9fb3c8 !important;
        }
        .jride-vendor-premium-shell input,
        .jride-vendor-premium-shell select,
        .jride-vendor-premium-shell textarea {
          background: rgba(4, 12, 20, 0.82) !important;
          color: #f3fff7 !important;
          border-color: rgba(148, 163, 184, 0.26) !important;
          outline: none;
        }
        .jride-vendor-premium-shell input:focus,
        .jride-vendor-premium-shell select:focus,
        .jride-vendor-premium-shell textarea:focus {
          border-color: #22c55e !important;
          box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
        }
        .jride-vendor-premium-shell button {
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }
        .jride-vendor-premium-shell button:not(:disabled):active {
          transform: scale(0.98);
        }
        .jride-vendor-premium-shell .bg-black,
        .jride-vendor-premium-shell .bg-emerald-600,
        .jride-vendor-premium-shell .bg-emerald-700 {
          background: linear-gradient(135deg, #22c55e, #16a34a) !important;
          color: #04110a !important;
          box-shadow: 0 12px 24px rgba(34, 197, 94, 0.22);
        }
        .jride-vendor-premium-shell .bg-emerald-50 {
          background: rgba(16, 185, 129, 0.14) !important;
          border-color: rgba(52, 211, 153, 0.36) !important;
          color: #bbf7d0 !important;
        }
        .jride-vendor-premium-shell .bg-blue-50 {
          background: rgba(59, 130, 246, 0.12) !important;
          border-color: rgba(96, 165, 250, 0.30) !important;
          color: #bfdbfe !important;
        }
        .jride-vendor-premium-shell .bg-amber-50 {
          background: rgba(245, 158, 11, 0.14) !important;
          border-color: rgba(251, 191, 36, 0.34) !important;
          color: #fde68a !important;
        }
        .jride-vendor-premium-shell .bg-rose-50 {
          background: rgba(244, 63, 94, 0.12) !important;
          border-color: rgba(251, 113, 133, 0.32) !important;
          color: #fecdd3 !important;
        }
        .jride-vendor-premium-shell .rounded-2xl,
        .jride-vendor-premium-shell .rounded-xl {
          border-radius: 18px;
        }
        .jride-vendor-premium-shell img {
          border-color: rgba(34, 197, 94, 0.22);
        }
        .jride-vendor-premium-shell table,
        .jride-vendor-premium-shell thead,
        .jride-vendor-premium-shell tbody,
        .jride-vendor-premium-shell tr,
        .jride-vendor-premium-shell td,
        .jride-vendor-premium-shell th {
          border-color: rgba(34, 197, 94, 0.16) !important;
        }
        .jride-vendor-premium-shell ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        .jride-vendor-premium-shell ::-webkit-scrollbar-thumb {
          background: rgba(34, 197, 94, 0.45);
          border-radius: 999px;
        }
        @media (max-width: 760px) {
          .jride-vendor-premium-shell {
            padding: 10px !important;
          }
          .jride-vendor-premium-shell .flex.flex-wrap.items-start.justify-between.gap-3.rounded-2xl {
            position: sticky;
            top: 0;
            z-index: 30;
            margin: -10px -10px 10px;
            border-radius: 0 0 22px 22px;
            padding: 14px 12px !important;
          }
          .jride-vendor-premium-shell h1 {
            font-size: 1.25rem !important;
          }
          .jride-vendor-premium-shell .lg\\:grid-cols-3 {
            grid-template-columns: 1fr !important;
          }
          .jride-vendor-premium-shell .lg\\:col-span-2 {
            grid-column: auto !important;
          }
          .jride-vendor-premium-shell .min-w-72 {
            min-width: 0 !important;
            width: 100% !important;
          }
          .jride-vendor-premium-shell .grid {
            gap: 12px !important;
          }
          .jride-vendor-premium-shell .p-6 {
            padding: 14px !important;
          }
          .jride-vendor-premium-shell .p-4,
          .jride-vendor-premium-shell .p-5 {
            padding: 12px !important;
          }
          .jride-vendor-premium-shell .px-4.py-2,
          .jride-vendor-premium-shell .px-4.py-3 {
            padding: 10px 12px !important;
          }
          .jride-vendor-premium-shell .max-h-\[520px\] {
            max-height: 360px !important;
          }
        }
      `}</style>
    </main>
  );
}















