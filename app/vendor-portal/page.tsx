"use client";

import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { VendorOrderSoundControls } from "../components/VendorOrderSound";
import VendorNavigation from "../components/VendorNavigation";

// JRIDE_VENDOR_ACTIVE_ORDER_DETAILS_RENDER_V5
// JRIDE_VENDOR_REALTIME_OPERATIONS_UI_V3
// JRIDE_VENDOR_TAKEOUT_QUEUE_HIERARCHY_V1

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
  category?: string | null;
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
  variants?: MenuItemVariantOption[] | null;
  addons?: MenuItemAddonOption[] | null;
};

type MenuItemVariantOption = {
  group_name: string;
  option_name: string;
  price: number;
};

type MenuItemAddonOption = {
  addon_name: string;
  price: number;
};

type MenuItemVariantDraft = {
  group_name: string;
  option_name: string;
  price: string;
};

type MenuItemAddonDraft = {
  addon_name: string;
  price: string;
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
  driver_id?: string | null;
  driver_name?: string | null;
  assigned_driver_name?: string | null;
  driver_phone?: string | null;
  assigned_driver_phone?: string | null;
  driver_vehicle_type?: string | null;
  vehicle_type?: string | null;
  assigned_vehicle_type?: string | null;
  created_at: string | null;
  updated_at: string | null;
  takeout_pricing_status?: string | null;
  takeout_fee_proposed_by_driver_id?: string | null;
  takeout_fee_proposed_at?: string | null;
  takeout_customer_confirmed_at?: string | null;
  customer_confirmed_at?: string | null;
  driver_assignment_expires_at?: string | null;
  takeout_driver_accept_expires_at?: string | null;
  driver_accept_expires_at?: string | null;
  takeout_fee_proposal_expires_at?: string | null;
  driver_fee_proposal_expires_at?: string | null;
  takeout_fee_expires_at?: string | null;
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

const MENU_CATEGORIES = ["Meals", "Rice Meals", "Noodles", "Drinks", "Coffee", "Bread", "Desserts", "Snacks", "Add-ons", "Others"] as const;

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


const LS_VENDOR_ID = "JRIDE_VENDOR_PORTAL_VENDOR_ID";
const LEGACY_LS_VENDOR_ID = "jride_vendor_id";
const FOUNDING_PILOT_LAUNCH_AT_MS = new Date("2026-06-15T00:00:00+08:00").getTime();
const FOUNDING_PILOT_DAYS = 182;
const DAY_MS = 24 * 60 * 60 * 1000;

function foundingPilotDaysRemaining(nowMs: number) {
  const displayStartAt = FOUNDING_PILOT_LAUNCH_AT_MS - 2 * DAY_MS;
  const elapsedDays = Math.max(0, Math.floor((nowMs - displayStartAt) / DAY_MS));

  return Math.max(0, FOUNDING_PILOT_DAYS - elapsedDays);
}

function readInitialVendorId() {
  if (typeof window === "undefined") return "";

  return clean(
    window.sessionStorage.getItem(LS_VENDOR_ID) ||
      window.localStorage.getItem(LS_VENDOR_ID) ||
      window.sessionStorage.getItem(LEGACY_LS_VENDOR_ID) ||
      window.localStorage.getItem(LEGACY_LS_VENDOR_ID) ||
      ""
  );
}

function persistPortalVendorId(vendorId: string) {
  if (typeof window === "undefined") return;
  const id = clean(vendorId);
  if (!id) return;
  window.localStorage.setItem(LS_VENDOR_ID, id);
  window.sessionStorage.setItem(LS_VENDOR_ID, id);
  window.localStorage.setItem(LEGACY_LS_VENDOR_ID, id);
  window.sessionStorage.setItem(LEGACY_LS_VENDOR_ID, id);
}


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
  if (x === "vendor_pending") return "NEW ORDER - ACCEPT OR DECLINE";
  if (x === "vendor_accepted") return "ACCEPTED - WAITING FOR DRIVER";
  if (x === "driver_assigned") return "DRIVER SELECTED";
  if (x === "driver_accepted") return "DRIVER ACCEPTED";
  if (x === "pickup_ready") return "READY FOR PICKUP";
  if (x === "preparing") return "PREPARING ORDER";
  if (x === "completed") return "COMPLETED";
  if (x === "vendor_timeout") return "MISSED - ACCEPTANCE TIME EXPIRED";
  if (x === "cancelled") return "CANCELLED";
  if (!x) return "NEW ORDER - ACCEPT OR DECLINE";
  return x.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function orderClass(s: any) {
  const x = normalizeVendorStatus(s);
  if (x === "vendor_pending") return "border-amber-300 bg-amber-50 text-amber-800";
  if (x === "vendor_accepted") return "border-emerald-300 bg-emerald-50 text-emerald-800";
  if (x === "driver_assigned") return "border-blue-300 bg-blue-50 text-blue-800";
  if (x === "driver_accepted") return "border-blue-300 bg-blue-50 text-blue-800";
  if (x === "preparing") return "border-amber-300 bg-amber-50 text-amber-800";
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
  return clean(o.customer_phone) || clean(o.customer_phone) || clean(o.phone) || "No phone provided";
}

function orderDriverName(o: TakeoutOrder) {
  return clean(o.driver_name) || clean(o.assigned_driver_name) || "Assigned rider";
}

function orderDriverPhone(o: TakeoutOrder) {
  return clean(o.driver_phone) || clean(o.assigned_driver_phone) || "No phone provided";
}

function hasNamedAssignedDriver(o: TakeoutOrder) {
  return Boolean(clean(o.driver_name) || clean(o.assigned_driver_name));
}

function customerConfirmedForVendor(o: TakeoutOrder) {
  const s = normalizeVendorStatus(o.vendor_status);

  // Do not trust takeout_pricing_status alone here. In the driver flow, generic
  // values like "accepted" or "confirmed" can mean driver-side acceptance, not
  // customer approval of the proposed delivery fee. The vendor may prepare only
  // after an explicit customer confirmation timestamp exists, or after the order
  // has already moved into a post-confirmation vendor lifecycle state.
  if (["pickup_ready", "rider_arrived_vendor", "arrived_vendor", "picked_up", "delivering", "completed"].includes(s)) return true;
  if (clean(o.takeout_customer_confirmed_at)) return true;
  if (clean(o.customer_confirmed_at)) return true;
  if (clean((o as any).passenger_confirmed_at)) return true;

  return false;
}

function driverAcceptedForVendor(o: TakeoutOrder) {
  const pricing = clean(o.takeout_pricing_status).toLowerCase();
  const vendorStatus = normalizeVendorStatus(o.vendor_status);
  const driverStatus = clean((o as any).driver_status).toLowerCase();

  return (
    ["accepted", "driver_accepted"].includes(pricing) ||
    vendorStatus === "driver_accepted" ||
    driverStatus === "driver_accepted"
  );
}

function fareProposedForVendor(o: TakeoutOrder) {
  const pricing = clean(o.takeout_pricing_status).toLowerCase();
  if (["fare_proposed", "driver_fee_proposed", "fee_proposed"].includes(pricing)) return true;
  if (clean(o.takeout_fee_proposed_by_driver_id)) return true;
  if (clean(o.takeout_fee_proposed_at)) return true;
  return false;
}

function vendorPrepGateTone(o: TakeoutOrder) {
  if (customerConfirmedForVendor(o)) return "ready";
  if (fareProposedForVendor(o)) return "fare";
  if (driverAcceptedForVendor(o)) return "accepted";
  if (hasNamedAssignedDriver(o)) return "assigned";
  return "finding";
}

function driverVendorStatusTitle(o: TakeoutOrder) {
  const tone = vendorPrepGateTone(o);
  if (tone === "ready") return "Customer confirmed - prepare now";
  if (tone === "fare") return "Fare proposed - waiting for customer approval";
  if (tone === "accepted") return "Driver accepted - waiting for fare proposal";
  if (tone === "assigned") return "Waiting for driver confirmation";
  return "Finding driver";
}

function driverVendorStatusNote(o: TakeoutOrder) {
  const tone = vendorPrepGateTone(o);
  if (tone === "ready") return "Customer approved the total payable. Prepare the order now.";
  if (tone === "fare") return "Driver sent the delivery fee. Waiting for customer approval. Do not prepare yet.";
  if (tone === "accepted") return "Driver accepted the job but has not proposed the delivery fee yet. Do not prepare yet.";
  if (tone === "assigned") return "A driver was selected, but has not confirmed yet. Do not prepare yet.";
  return "Dispatch is still attaching a driver. Do not prepare yet.";
}

function vendorPrepGateButtonLabel(o: TakeoutOrder) {
  const tone = vendorPrepGateTone(o);
  if (tone === "ready") return "Mark order ready";
  if (tone === "fare") return "Waiting for customer approval";
  if (tone === "accepted") return "Waiting for driver fare proposal";
  if (tone === "assigned") return "Waiting for driver confirmation";
  return "Waiting for driver assignment";
}

function vendorPrepGateBadgeLabel(o: TakeoutOrder) {
  const tone = vendorPrepGateTone(o);
  if (tone === "ready") return "Prepare now";
  if (tone === "fare") return "Fare proposed";
  if (tone === "accepted") return "Driver accepted";
  if (tone === "assigned") return "Driver selected";
  return statusLabel(o.vendor_status);
}

function vehicleTypeLabel(value: any) {
  const raw = clean(value).toLowerCase();
  if (!raw) return "Vehicle not provided";
  if (raw.includes("motor")) return "Motorcycle";
  if (raw.includes("tricycle") || raw.includes("trike")) return "Tricycle";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function orderVehicleType(o: TakeoutOrder) {
  return vehicleTypeLabel(o.driver_vehicle_type || o.vehicle_type || o.assigned_vehicle_type);
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

  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files are allowed.");
  }

  const maxInputBytes = 5 * 1024 * 1024;
  if (file.size > maxInputBytes) {
    throw new Error("Image is too large. Maximum input size is 5MB.");
  }

  const targetBytes = 700 * 1024;
  const hardMaxOutputBytes = 1024 * 1024;
  const dataUrlPrefix = "data:image/jpeg;base64,";

  let source: CanvasImageSource;
  let sourceWidth = 0;
  let sourceHeight = 0;
  let bitmap: ImageBitmap | null = null;
  let objectUrl = "";

  try {
    try {
      bitmap = await createImageBitmap(file);
      source = bitmap;
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
    } catch {
      objectUrl = URL.createObjectURL(file);

      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();

        img.onload = () => resolve(img);
        img.onerror = () =>
          reject(new Error("The selected image could not be decoded."));
        img.src = objectUrl;
      });

      source = image;
      sourceWidth = image.naturalWidth || image.width;
      sourceHeight = image.naturalHeight || image.height;
    }

    if (
      !Number.isFinite(sourceWidth) ||
      !Number.isFinite(sourceHeight) ||
      sourceWidth <= 0 ||
      sourceHeight <= 0
    ) {
      throw new Error("The selected image has invalid dimensions.");
    }

    const dimensionSteps = [1200, 1000, 900, 800, 700];
    const qualitySteps = [0.82, 0.74, 0.66, 0.58, 0.50];

    let smallestDataUrl = "";
    let smallestBytes = Number.POSITIVE_INFINITY;

    for (const maxSide of dimensionSteps) {
      const scale = Math.min(
        1,
        maxSide / Math.max(sourceWidth, sourceHeight)
      );

      const width = Math.max(1, Math.round(sourceWidth * scale));
      const height = Math.max(1, Math.round(sourceHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) {
        throw new Error("Image compression is not available on this device.");
      }

      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(source, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        if (!dataUrl.startsWith(dataUrlPrefix)) continue;

        const approxBytes = Math.ceil(
          (dataUrl.length - dataUrlPrefix.length) * 3 / 4
        );

        if (approxBytes < smallestBytes) {
          smallestBytes = approxBytes;
          smallestDataUrl = dataUrl;
        }

        if (approxBytes <= targetBytes) {
          return dataUrl;
        }
      }
    }

    if (!smallestDataUrl) {
      throw new Error("The selected image could not be compressed.");
    }

    if (smallestBytes > hardMaxOutputBytes) {
      throw new Error(
        "The image remains too large after compression. Please choose another photo."
      );
    }

    return smallestDataUrl;
  } finally {
    if (bitmap) {
      bitmap.close();
    }

    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
  }
}


function parseVariantLines(value: string): MenuItemVariantOption[] {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const groupName = parts[0] || "Option";
      const optionName = parts[1] || "";
      const price = toNum(parts[2] || 0);
      return { group_name: groupName, option_name: optionName, price };
    })
    .filter((row) => row.option_name && row.price >= 0);
}

function parseAddonLines(value: string): MenuItemAddonOption[] {
  return value
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("|").map((part) => part.trim());
      const addonName = parts[0] || "";
      const price = toNum(parts[1] || 0);
      return { addon_name: addonName, price };
    })
    .filter((row) => row.addon_name && row.price >= 0);
}

function variantLines(rows: MenuItemVariantOption[] | null | undefined): string {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => [row.group_name || "Option", row.option_name || "", String(row.price ?? 0)].join(" | "))
    .join("\n");
}

function addonLines(rows: MenuItemAddonOption[] | null | undefined): string {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => [row.addon_name || "", String(row.price ?? 0)].join(" | "))
    .join("\n");
}

function defaultVariantDrafts(): MenuItemVariantDraft[] {
  return [{ group_name: "Size", option_name: "", price: "" }];
}

function defaultAddonDrafts(): MenuItemAddonDraft[] {
  return [{ addon_name: "", price: "" }];
}

function variantDraftsFromRows(rows: MenuItemVariantOption[] | null | undefined): MenuItemVariantDraft[] {
  const next = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      group_name: clean(row.group_name || "Size"),
      option_name: clean(row.option_name || ""),
      price: clean(row.price ?? ""),
    }))
    .filter((row) => row.group_name || row.option_name || row.price);
  return next.length ? next : defaultVariantDrafts();
}

function addonDraftsFromRows(rows: MenuItemAddonOption[] | null | undefined): MenuItemAddonDraft[] {
  const next = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ addon_name: clean(row.addon_name || ""), price: clean(row.price ?? "") }))
    .filter((row) => row.addon_name || row.price);
  return next.length ? next : defaultAddonDrafts();
}

function normalizeVariantDrafts(rows: MenuItemVariantDraft[]): MenuItemVariantOption[] {
  return rows
    .map((row) => ({
      group_name: clean(row.group_name || "Size"),
      option_name: clean(row.option_name),
      price: toNum(row.price),
    }))
    .filter((row) => row.group_name && row.option_name && row.price >= 0);
}

function normalizeAddonDrafts(rows: MenuItemAddonDraft[]): MenuItemAddonOption[] {
  return rows
    .map((row) => ({ addon_name: clean(row.addon_name), price: toNum(row.price) }))
    .filter((row) => row.addon_name && row.price >= 0);
}


export default function VendorPortalPage() {
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorId, setVendorId] = useState(() => readInitialVendorId());
  const [profile, setProfile] = useState<VendorProfile | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [menuLoaded, setMenuLoaded] = useState(false);
  const [menuLoading, setMenuLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [portalView, setPortalView] = useState<"menu" | "profile" | "operations">("menu");
  const [editorOpen, setEditorOpen] = useState(false);
  const [menuSearch, setMenuSearch] = useState("");
  const [menuCategoryFilter, setMenuCategoryFilter] = useState("");
  const [customCategory, setCustomCategory] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const readView = () => {
      const hash = window.location.hash;
      setPortalView(hash === "#profile" ? "profile" : hash === "#operations" ? "operations" : "menu");
    };
    readView();
    const onHashChange = () => {
      readView();
      window.requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: "start" }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (portalView === "profile") vendorMapRef.current?.resize();
  }, [portalView]);

  const vendorOrdersHref = vendorId ? "/vendor-orders?vendor_id=" + encodeURIComponent(vendorId) : "/vendor-orders";
  const vendorAnalyticsHref = vendorId ? "/vendor-analytics?vendor_id=" + encodeURIComponent(vendorId) : "/vendor-analytics";

  async function handleVendorLogout() {
    try { await fetch("/api/vendor/logout", { method: "POST", credentials: "same-origin" }); }
    catch { /* Native registration is also cleared on the login screen. */ }
    try {
      const keysToClear = [
        "jride_vendor_session",
        "jride_vendor_token",
        LEGACY_LS_VENDOR_ID,
        LS_VENDOR_ID,
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
    if (!readInitialVendorId()) {
      window.location.replace("/vendor-login");
      return;
    }

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
  const [profileTagline, setProfileTagline] = useState("");
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
  const [itemCategory, setItemCategory] = useState("Meals");
  const [itemPackagingNote, setItemPackagingNote] = useState("");
  const [itemVariantText, setItemVariantText] = useState("");
  const [itemAddonText, setItemAddonText] = useState("");
  const [itemVariantDrafts, setItemVariantDrafts] = useState<MenuItemVariantDraft[]>(() => defaultVariantDrafts());
  const [itemAddonDrafts, setItemAddonDrafts] = useState<MenuItemAddonDraft[]>(() => defaultAddonDrafts());
  const [itemSaveNotice, setItemSaveNotice] = useState("");
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
  const vendorNotificationLastCountRef = useRef(0);
  const [vendorNotificationPermission, setVendorNotificationPermission] = useState<string>("unknown");
  const [analyticsRange, setAnalyticsRange] = useState<VendorAnalyticsRange>("today");

  useEffect(() => {
    if (editorOpen) editorRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [editorOpen, editingId]);

  const menuCategories = useMemo(() => Array.from(new Set(menu.map((item) => item.category || "Others"))).sort(), [menu]);
  const filteredMenu = useMemo(() => {
    const query = menuSearch.trim().toLowerCase();
    return menu.filter((item) =>
      (!menuCategoryFilter || (item.category || "Others") === menuCategoryFilter) &&
      (!query || [item.name, item.category, item.description].some((value) => String(value || "").toLowerCase().includes(query)))
    );
  }, [menu, menuSearch, menuCategoryFilter]);

  const selectedVendor = useMemo(() => {
    return vendors.find((v) => vendorKey(v) === vendorId) || null;
  }, [vendors, vendorId]);

  const newOrders = useMemo(() => {
    return orders
      .filter((o) => isActivePendingVendorOrder(o, nowMs))
      .sort(
        (a, b) =>
          vendorAcceptTimer(a, nowMs).remainingMs -
          vendorAcceptTimer(b, nowMs).remainingMs
      );
  }, [orders, nowMs]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) => {
      const status = normalizeVendorStatus(o.vendor_status);
      return ["vendor_accepted", "driver_assigned", "driver_accepted", "preparing", "pickup_ready"].includes(status);
    });
  }, [orders]);

  const pendingVendorOrdersForAlert = newOrders;


  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setVendorNotificationPermission("unsupported");
      return;
    }
    setVendorNotificationPermission(Notification.permission);
  }, []);

  async function requestVendorNotifications() {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setVendorNotificationPermission("unsupported");
      return "unsupported";
    }

    if (Notification.permission === "granted") {
      setVendorNotificationPermission("granted");
      return "granted";
    }

    if (Notification.permission === "denied") {
      setVendorNotificationPermission("denied");
      return "denied";
    }

    const permission = await Notification.requestPermission();
    setVendorNotificationPermission(permission);
    return permission;
  }
  function urlBase64ToUint8Array(base64String: string) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function subscribeVendorPushNotifications() {
    const vid = clean(vendorId);
    if (!vid) return;

    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (!("PushManager" in window)) return;

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!publicKey) return;

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));

    await fetch("/api/vendor-push/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        vendor_id: vid,
        subscription,
      }),
    });
  }
  async function enableVendorNotifications() {
    try {
      const permission = await requestVendorNotifications();
      if (permission === "granted") await subscribeVendorPushNotifications();
    } catch {
      setVendorNotificationPermission("unavailable");
    }
  }

  useEffect(() => {
    const count = pendingVendorOrdersForAlert.length;

    if (count <= 0) {
      vendorNotificationLastCountRef.current = 0;
      return;
    }

    if (count <= vendorNotificationLastCountRef.current) return;
    vendorNotificationLastCountRef.current = count;

    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    try {
      new Notification("JRide Takeout", {
        body: count === 1 ? "New order waiting for acceptance." : String(count) + " new orders waiting for acceptance.",
        icon: "/icon-192.png",
        tag: "jride-vendor-new-order",      });
    } catch {
    }
  }, [pendingVendorOrdersForAlert.length]);

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
    const authenticatedVendorId = readInitialVendorId();

    if (!authenticatedVendorId) {
      setVendors([]);
      setVendorId("");
      window.location.replace("/vendor-login");
      return;
    }

    const j = await getJson("/api/admin/vendors");
    const rows = Array.isArray(j?.vendors) ? j.vendors : Array.isArray(j?.data) ? j.data : [];
    const authenticatedVendorRows = rows.filter((row: VendorRow) => vendorKey(row) === authenticatedVendorId);

    setVendors(authenticatedVendorRows);
    setVendorId(authenticatedVendorId);
    persistPortalVendorId(authenticatedVendorId);
  }

  async function loadVendorData(id?: string, silent = false) {
    const vid = clean(id || vendorId);
    if (!vid) return;
    setMenuLoading(true);
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
      setProfileTagline(clean(v?.tagline || ""));
      setVendorLat(v?.vendor_lat == null ? "" : String(v.vendor_lat));
      setVendorLng(v?.vendor_lng == null ? "" : String(v.vendor_lng));
      setVendorLocationLabel(clean(v?.vendor_location_label || ""));
      setAcceptingOrders(v?.accepting_orders !== false);
      setLogoPreview(clean(v?.logo_url || ""));
      setMenu(items);
      setMenuLoaded(true);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendor menu"));
    } finally {
      setMenuLoading(false);
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
    loadVendors().catch((e) => { setError(String(e?.message || e)); setMenuLoading(false); });
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
    setEditorOpen(false);
    setCustomCategory(false);
    setEditingId("");
    setItemName("");
    setItemDescription("");
    setItemCategory("Meals");
    setItemPackagingNote("");
    setItemVariantText("");
    setItemAddonText("");
    setItemVariantDrafts(defaultVariantDrafts());
    setItemAddonDrafts(defaultAddonDrafts());
    setItemSaveNotice("");
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
    setEditorOpen(true);
    setCustomCategory(!MENU_CATEGORIES.some((category) => category === (m.category || "Others")));
    setEditingId(clean(m.id || m.menu_item_id));
    setItemName(m.name || "");
    setItemDescription(m.description || "");
    setItemCategory(String(m.category || "Others"));
    setItemPackagingNote(m.packaging_note || "");
    setItemVariantText(variantLines(m.variants));
    setItemAddonText(addonLines(m.addons));
    setItemVariantDrafts(variantDraftsFromRows(m.variants));
    setItemAddonDrafts(addonDraftsFromRows(m.addons));
    setItemSaveNotice("Editing existing menu item. Save to apply changes.");
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
        tagline: profileTagline,
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
        tagline: profileTagline,
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
    setItemSaveNotice(editingId ? "Updating menu item..." : "Adding menu item...");
    try {
      const photoDataUrl = await fileToDataUrl(itemFile);
      // Editing details must preserve the vendor's explicit availability choices.
      const nextAvailable = itemAvailable;
      const nextSoldOut = itemSoldOut;

      const j = await postJson("/api/vendor-menu/manage", {
        action: "save_item",
        vendor_id: vid,
        id: editingId || null,
        name: itemName,
        description: itemDescription,
        category: itemCategory,
        packaging_note: itemPackagingNote,
        prep_time_minutes: itemPrepTimeMinutes,
        premium_packaging_enabled: itemPremiumPackagingEnabled,
        premium_packaging_fee: itemPremiumPackagingFee,
        premium_packaging_label: itemPremiumPackagingLabel,
        price: itemPrice,
        variants: normalizeVariantDrafts(itemVariantDrafts),
        addons: normalizeAddonDrafts(itemAddonDrafts),
        is_available: nextAvailable,
        sold_out_today: nextSoldOut,
        daily_available_quantity: itemDailyAvailableQuantity,
        remaining_quantity: itemRemainingQuantity,
        photo_data_url: photoDataUrl,
      });
      const savedMessage = j?.warning ? "Menu saved, but image warning: " + j.warning : editingId ? "Menu item updated." : "Menu item added.";
      setMessage(savedMessage);
      resetItemForm();
      setItemSaveNotice(savedMessage);
      await loadVendorData(vid, true);
      window.requestAnimationFrame(() => contentRef.current?.scrollIntoView({ block: "start" }));
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
    <main className="jride-vendor-premium-shell vendor-workspace">
      <VendorNavigation active={portalView === "operations" ? "orders" : portalView} vendorId={vendorId} />
      <div className="vendor-workspace-content" ref={contentRef}>
        <header className="vendor-identity">
          <div className="vendor-identity-name">
            <span className="vendor-eyebrow">JRIDE VENDOR</span>
            <h1>{profile?.name || profileName || (selectedVendor ? vendorLabel(selectedVendor) : "Your store")}</h1>
            <p>{profileTown || normalizeTakeoutTown(selectedVendor?.town) || "Loading store details..."}</p>
          </div>
          <button type="button" className="vendor-button" disabled={!vendorId || busy}
            onClick={() => refreshAll().catch((e) => setError(String(e?.message || e)))}>
            {busy ? "Please wait..." : "Refresh"}
          </button>
        </header>

        {newOrders.length + activeOrders.length > 0 && portalView !== "operations" ? (
          <a className={"vendor-queue-link " + (newOrders.length > 0 ? "vendor-queue-urgent" : "")} href="#operations">
            <span><strong>{newOrders.length > 0 ? `${newOrders.length} new order${newOrders.length === 1 ? "" : "s"} waiting` : `${activeOrders.length} order${activeOrders.length === 1 ? "" : "s"} in progress`}</strong>
              <small>{newOrders.length > 0 ? "Accept or decline within 5 minutes." : "View driver, preparation, and pickup updates."}</small></span>
            <span>Open queue</span>
          </a>
        ) : null}

        {error ? <div role="alert" className="vendor-notice vendor-notice-error">{error}</div> : null}
        {message ? <div role="status" className="vendor-notice vendor-notice-success">{message}</div> : null}

        {cancelTargetOrder ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <div className="w-full max-w-lg rounded-2xl border bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Cancel takeout order</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Cancelling this order will notify the customer and JRide admin. A reason is required.
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
                  Note to customer/admin (optional)
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

        {!vendorId || !menuLoaded ? (
          <div className="vendor-loading-panel" role="status" aria-busy={menuLoading}>
            <strong>{menuLoading ? "Loading your store..." : "Store details could not be loaded. Please retry."}</strong>
            {menuLoading ? <><span className="vendor-skeleton-line" /><span className="vendor-skeleton-line" /></> : (
              <button type="button" className="vendor-button" onClick={() => window.location.reload()}>Retry</button>
            )}
          </div>
        ) : (
          <div className="vendor-panels">
            <section data-vendor-panel hidden={portalView !== "profile"} className="vendor-panel vendor-profile-panel">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Vendor profile</h2>
                  <p className="text-xs text-slate-500">Your store details, logo, and pickup location.</p>
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
                </div>
              </div>

              <div className={cls("mt-4 rounded-2xl border p-3", acceptingOrders ? "border-emerald-200 bg-emerald-50/50" : "border-rose-200 bg-rose-50/50")}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">Order availability</div>
                    <div className="text-xs text-slate-600">This control saves immediately and controls customer ordering.</div>
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
                  {busy ? "Saving vendor availability..." : acceptingOrders ? "Vendor is open. Customers can place takeout orders." : "Vendor is closed. New customer orders are blocked until reopened."}
                </div>
              </div>

              <div className="mt-4 rounded-2xl border bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-900">General profile details</div>
                <div className="text-xs text-slate-500">Use Save profile for vendor name, tagline, town, logo, and pickup location changes.</div>

                <label className="mt-3 block text-xs font-medium text-slate-700">Vendor name</label>
                <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Vendor name" />

               <label className="mt-3 block text-xs font-medium text-slate-700">
               Store tagline
               </label>

               <textarea
               className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
               rows={2}
               value={profileTagline}
               onChange={(e) => setProfileTagline(e.target.value)}
               placeholder="Tell customers what makes your store special."
               />

               <div className="mt-1 text-[11px] text-slate-500">
               Appears below your logo in the customer marketplace.
               </div>

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
                <div className="mt-1 text-[11px] text-slate-500">Used to group this vendor under the correct customer store location.</div>

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

                <label htmlFor="vendor-logo-photo" className="mt-3 block text-xs font-medium text-slate-700">Vendor logo</label>
                <div className="vendor-photo-picker">
                  {logoPreview ? <img src={logoPreview} alt="Store logo preview" /> : <span className="vendor-photo-placeholder">No logo</span>}
                  <button type="button" className="vendor-button" disabled={busy} onClick={() => logoInputRef.current?.click()}>{logoPreview ? "Change logo" : "Add logo"}</button>
                </div>
                <input
                  id="vendor-logo-photo"
                  ref={logoInputRef}
                  hidden
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setLogoFile(f);
                    if (f) setLogoPreview(URL.createObjectURL(f));
                  }}
                />
              </div>

              {error ? <div role="alert" className="vendor-notice vendor-notice-error mt-4">{error}</div> : null}
              <button type="button" onClick={saveProfile} disabled={busy} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400">
                {busy ? "Saving..." : "Save profile details"}
              </button>
              <div className="vendor-profile-footer">
                <a href="/vendor-faq" className="vendor-button">Help and FAQ</a>
                <button type="button" onClick={handleVendorLogout} className="vendor-button vendor-button-danger">Log out</button>
              </div>
            </section>

            <section data-vendor-panel hidden={portalView !== "menu"} className="vendor-panel vendor-menu-panel">
              <div className="vendor-section-heading">
                <div>
                  <h2 className="text-lg font-semibold">Menu manager</h2>
                  <p className="text-xs text-slate-500">{menu.length} item{menu.length === 1 ? "" : "s"}</p>
                </div>
                <button type="button" disabled={busy} className="vendor-button vendor-button-primary"
                  onClick={() => { resetItemForm(); setEditorOpen(true); }}>
                  + Add item
                </button>
              </div>

              <div hidden={!editorOpen} ref={editorRef} className="vendor-item-editor mt-4 grid grid-cols-1 gap-3 rounded-2xl border bg-slate-50 p-3 md:grid-cols-6">
                <div className="vendor-editor-heading md:col-span-6">
                  <div><h3>{editingId ? "Edit menu item" : "Add menu item"}</h3><p>{editingId ? itemName : "Add an item customers can order."}</p></div>
                  <div className="vendor-editor-heading-actions">
                    <button type="button" onClick={saveItem} disabled={busy || limitReached || !itemCategory.trim()} className="vendor-button vendor-button-primary">{busy ? "Saving..." : "Save"}</button>
                    <button type="button" disabled={busy} className="vendor-button" onClick={resetItemForm}>Cancel</button>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Menu name</label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={itemName} onChange={(e) => setItemName(e.target.value)} disabled={limitReached} placeholder="Example: Chicken adobo" />
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="vendor-item-category" className="text-xs font-medium text-slate-700">Category</label>
                  <select id="vendor-item-category" className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    value={customCategory ? "__custom" : itemCategory} disabled={limitReached || busy}
                    onChange={(e) => {
                      const custom = e.target.value === "__custom";
                      setCustomCategory(custom);
                      setItemCategory(custom ? "" : e.target.value);
                    }}>
                    {MENU_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
                    <option value="__custom">Custom category...</option>
                  </select>
                  {customCategory ? (
                    <label className="mt-2 block text-xs text-slate-600">Category name
                      <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={itemCategory}
                        onChange={(e) => setItemCategory(e.target.value)} disabled={limitReached || busy} placeholder="Example: Milk Tea" />
                    </label>
                  ) : null}
                  <p className="mt-1 text-xs text-slate-500">Choose a category, then save your changes.</p>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-medium text-slate-700">Price</label>
                  <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={itemPrice} onChange={(e) => setItemPrice(e.target.value.replace(/[^0-9.]/g, ""))} disabled={limitReached} inputMode="decimal" placeholder="0.00" />
                </div>
                <div className="md:col-span-3">
                  <label htmlFor="vendor-item-photo" className="text-xs font-medium text-slate-700">Photo</label>
                  <div className="vendor-photo-picker">
                    {itemPreview ? <img src={itemPreview} alt="Item photo preview" /> : <span className="vendor-photo-placeholder">No photo</span>}
                    <button type="button" className="vendor-button" disabled={busy || limitReached} onClick={() => itemInputRef.current?.click()}>{itemPreview ? "Change photo" : "Add photo"}</button>
                  </div>
                  <input
                    id="vendor-item-photo"
                    ref={itemInputRef}
                    hidden
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={limitReached}
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setItemFile(f);
                      if (f) setItemPreview(URL.createObjectURL(f));
                    }}
                  />
                  <div className="mt-1 text-[11px] text-slate-500">JPG, PNG or WebP. Up to 5 MB.</div>
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
                </div>
                <details className="vendor-editor-options md:col-span-6">
                  <summary>Packaging and pricing help</summary>
                  <label className="text-xs font-medium text-slate-700">Packaging note</label>
                  <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={2} value={itemPackagingNote} onChange={(e) => setItemPackagingNote(e.target.value)} disabled={limitReached} placeholder="Example: Packed in standard takeaway packaging." />
                  <div className="mt-1 text-[11px] text-slate-500">This explains the default packaging included with the item.</div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 md:col-span-6">
                  <div className="text-sm font-semibold text-slate-900">Pilot menu pricing rule</div>
                  <div className="mt-1 text-xs leading-relaxed text-slate-600">
                    For the pilot rollout, use one delivery-ready price per menu item. If a flavor or size has a different price, create it as a separate menu item.
                  </div>
                  <div className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 p-2 text-xs font-semibold text-emerald-800">
                    Example: Milk Tea - Wintermelon Large, Milk Tea - Matcha Large, Milk Tea - Okinawa Large.
                  </div>
                </div>
                <div className="rounded-2xl border bg-white p-3 md:col-span-6">
                  <label className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      <span className="block font-semibold">Premium packaging available</span>
                      <span className="block text-xs text-slate-500">Shown on the customer menu as Premium packaging available (+PHP fee).</span>
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
                </details>
                <div className="flex flex-wrap items-center gap-4 md:col-span-6">
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={itemAvailable} onChange={(e) => setItemAvailable(e.target.checked)} disabled={limitReached} /> Available</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="text-xs font-medium text-slate-700">Available for JRide orders
                      <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min="0" value={itemDailyAvailableQuantity} onChange={(e) => setItemDailyAvailableQuantity(e.target.value)} disabled={limitReached} />
                    </label>
                    <label className="text-xs font-medium text-slate-700">Remaining today
                      <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" type="number" min="0" value={itemRemainingQuantity} onChange={(e) => setItemRemainingQuantity(e.target.value)} disabled={limitReached} />
                    </label>
                  </div>
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={itemSoldOut} onChange={(e) => setItemSoldOut(e.target.checked)} disabled={limitReached} /> Sold out today</label>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-2 text-[11px] text-blue-800 md:col-span-2">
                    Set how many items are available for JRide customers. Keep a buffer for walk-in and in-store customers. Update availability throughout the day as items are sold or restocked.
                  </div>
                </div>
                <div className="vendor-editor-actions md:col-span-6">
                  <button type="button" onClick={saveItem} disabled={busy || limitReached || !itemCategory.trim()} className="vendor-button vendor-button-primary vendor-save-item">{busy ? "Saving..." : editingId ? "Save changes" : "Save new item"}</button>
                  <button type="button" onClick={resetItemForm} disabled={busy} className="vendor-button">Cancel</button>
                  {error ? <div role="alert" className="vendor-notice vendor-notice-error basis-full">{error}</div> : null}
                  {itemSaveNotice ? <div className="basis-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">{itemSaveNotice}</div> : null}
                </div>
              </div>

              <div className="vendor-menu-filters">
                <label>Search menu
                  <input type="search" value={menuSearch} onChange={(e) => setMenuSearch(e.target.value)} placeholder="Search items..." />
                </label>
                <label>Filter category
                  <select value={menuCategoryFilter} onChange={(e) => setMenuCategoryFilter(e.target.value)}>
                    <option value="">All categories</option>
                    {menuCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              </div>
              <div className="vendor-results-count" aria-live="polite">Showing {filteredMenu.length} of {menu.length} items</div>
              <div className="vendor-menu-grid">
                {menu.length === 0 ? (
                  <div className="rounded-2xl border bg-white shadow-sm p-4 text-sm text-slate-600">No menu items yet.</div>
                ) : (
                  filteredMenu.map((m) => (
                    <article key={m.id || m.menu_item_id || m.name} className="vendor-menu-card">
                      <div className="vendor-menu-photo">
                        {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>}
                      </div>
                      <div className="vendor-menu-description">
                        <span className="vendor-category-label">{m.category || "Others"}</span>
                        <h3>{m.name}</h3>
                        <strong className="vendor-menu-price">{money(m.price)}</strong>
                      </div>
                      <button type="button" disabled={busy} className="vendor-button vendor-item-edit" aria-label={"Edit " + m.name} onClick={() => editItem(m)}>Edit</button>
                      <div className="vendor-menu-meta">
                        <span className={"vendor-item-state " + (m.sold_out_today ? "is-sold-out" : m.is_available ? "is-available" : "is-unavailable")}>{m.sold_out_today ? "Sold out" : m.is_available ? "Available" : "Unavailable"}</span>
                        <span>{prepMinutes(m.prep_time_minutes)} min prep</span>
                        <span><strong>{Number(m.remaining_quantity || 0)}</strong> / {Number(m.daily_available_quantity || 0)} left</span>
                      </div>
                        <div className="vendor-menu-actions">
                          {m.is_available && !m.sold_out_today ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="vendor-button"
                              onClick={() => markItemUnavailable(m)}
                            >
                              Make unavailable
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              className="vendor-button vendor-button-success"
                              onClick={() => makeItemOrderable(m)}
                            >
                              Make available
                            </button>
                          )}
                          {m.sold_out_today ? (
                            <button
                              type="button"
                              disabled={busy}
                              className="vendor-button"
                              onClick={() => makeItemOrderable(m)}
                            >
                              Clear sold out
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              className="vendor-button vendor-button-warning"
                              onClick={() => markItemSoldOut(m)}
                            >
                              Mark sold out
                            </button>
                          )}
                        </div>
                    </article>
                  ))
                )}
                {menu.length > 0 && filteredMenu.length === 0 ? (
                  <div className="vendor-empty-state"><h3>No matching items</h3><p>Try another name or category.</p>
                    <button type="button" className="vendor-button" onClick={() => { setMenuSearch(""); setMenuCategoryFilter(""); }}>Clear filters</button>
                  </div>
                ) : null}
              </div>
            </section>

            <section data-vendor-panel hidden={portalView !== "operations"} className="vendor-panel vendor-operations-panel">
<details className="vendor-pilot-details">
<summary>Pilot program details</summary>
<div className="mb-4 rounded-2xl border border-amber-300 bg-amber-50 p-4">
  <div className="flex items-start gap-3">
    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-2xl">
      
    </div>
    <div className="flex-1">
      <div className="text-xs font-bold uppercase tracking-wider text-amber-700">
        Founding Pilot Vendor Program
      </div>
      <div className="mt-1 text-3xl font-extrabold text-amber-900">
        {foundingPilotDaysRemaining(nowMs)} Days Remaining
      </div>
      <p className="mt-2 text-sm text-slate-700">
        As one of JRide&apos;s founding vendor partners in Lagawe, you enjoy premium vendor benefits at no cost during the official pilot launch period.
      </p>
    </div>
  </div>
</div>
</details>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Live order queue</h2>
                  <p className="text-xs text-slate-500">Live orders first. Keep sound on and watch this panel during service hours.</p>
                </div>
                <a href={vendorOrdersHref} className="vendor-button">Order history</a>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                  <VendorOrderSoundControls />
                  <button type="button" className="vendor-browser-notifications rounded-xl border px-3 py-1 hover:bg-slate-50"
                    onClick={() => void enableVendorNotifications()}>Enable browser notifications</button>
                  <span className="vendor-browser-notifications">Notifications: {vendorNotificationPermission}</span>
                  {pendingVendorOrdersForAlert.length > 0 ? <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">Pending accept: {pendingVendorOrdersForAlert.length}</span> : null}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3">
                <div>
                  <div className="mb-3 rounded-2xl border border-emerald-500/40 bg-emerald-950/30 p-3 shadow-[0_0_18px_rgba(16,185,129,0.10)]">
  <div className="flex flex-wrap items-center justify-between gap-2">
    <div>
      <div className="text-xs font-bold uppercase tracking-wide text-emerald-300">Live operations</div>
      <div className="mt-1 text-sm font-semibold text-slate-100">{newOrders.length + activeOrders.length} live order{newOrders.length + activeOrders.length === 1 ? "" : "s"}</div>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-[11px]">
      {pendingVendorOrdersForAlert.length > 0 ? (
        <span className="animate-pulse rounded-full border border-amber-300 bg-amber-400/20 px-3 py-1 font-bold text-amber-100">New order: {pendingVendorOrdersForAlert.length}</span>
      ) : (
        <span className="rounded-full border border-emerald-400/40 bg-emerald-500/10 px-3 py-1 font-semibold text-emerald-200">Queue clear</span>
      )}
    </div>
  </div>
</div>
<div className="mb-5 rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 shadow-sm ring-1 ring-amber-200">
  <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div className="text-xs font-black uppercase tracking-wider text-amber-800">{newOrders.length > 0 ? "New orders - action required" : "Ready for new orders"}</div>
      <div className="mt-1 text-xs text-amber-900">Accept or decline each order within 5 minutes. The most urgent order appears first.</div>
    </div>
    <span className="rounded-full border border-amber-400 bg-white px-3 py-1 text-xs font-black text-amber-900">
      {newOrders.length} waiting
    </span>
  </div>

  <div className="mt-3 space-y-3">
    {newOrders.length === 0 ? (
      <div className="rounded-xl border border-emerald-200 bg-white p-3 text-sm text-emerald-800">No new orders waiting for action.</div>
    ) : null}

    {newOrders.map((o) => {
      const acceptDeadline = vendorAcceptTimer(o, nowMs);
      const items = orderItems(o);
      return (
        <div key={o.id || o.booking_code || Math.random()} className="rounded-2xl border border-amber-300 bg-white p-3 shadow-sm ring-1 ring-amber-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-wide text-amber-700">NEW ORDER - ACCEPT OR DECLINE</div>
              <div className="mt-1 text-base font-black text-slate-900">{o.booking_code || o.id}</div>
            </div>
            <div className={"inline-flex items-center rounded-full border px-3 py-1 text-xs font-black " + vendorAcceptTimerClass(acceptDeadline.tone)}>
              Accept within: {acceptDeadline.label}
            </div>
          </div>

          <div className="mt-3 grid gap-1 rounded-xl border bg-slate-50 p-3 text-xs text-slate-700">
            <div><span className="font-semibold text-slate-900">Customer:</span> {orderCustomerName(o)}</div>
            <div><span className="font-semibold text-slate-900">Phone:</span> {orderCustomerPhone(o)}</div>
            <div><span className="font-semibold text-slate-900">Delivery address:</span> {orderDeliveryAddress(o)}</div>
            {hasDeliveryPin(o) ? <div><span className="font-semibold text-slate-900">Map pin:</span> Saved for driver navigation</div> : null}
          </div>

          <div className="mt-3 rounded-xl border bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
              <span>Order details</span>
              <span>{items.length} item{items.length === 1 ? "" : "s"}</span>
            </div>
            {items.length ? (
              <div className="mt-2 space-y-1">
                {items.map((it, idx) => {
                  const qty = Math.max(1, parseInt(String(it.quantity ?? 1), 10) || 1);
                  return (
                    <div key={`${clean(it.menu_item_id) || clean(it.name) || idx}-${idx}`} className="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-slate-900">
                      {qty} x {clean(it.name)}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 rounded-lg bg-white px-3 py-2 text-xs text-rose-700">No item details returned. Refresh the queue before accepting this order.</div>
            )}
          </div>

          <div className="mt-2 text-sm font-bold text-slate-900">Subtotal: {money(orderSubtotal(o))}</div>

          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
            <div className="font-semibold">Order instructions</div>
            <div className="mt-1">Receipt requested: {orderReceiptRequested(o) ? "YES" : "NO"}</div>
            <div className="mt-1">Packaging: {orderPackagingInstruction(o)}</div>
            <div className="mt-1">Customer note: {orderCustomerNoteOnly(o) || "none"}</div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" disabled={busy} onClick={() => moveOrder(o, "vendor_accepted")} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-black text-white hover:bg-emerald-700 disabled:bg-slate-300">
              ACCEPT ORDER
            </button>
            <button type="button" disabled={busy} onClick={() => openCancelOrderDialog(o)} className="rounded-xl border border-rose-300 bg-white px-4 py-3 text-sm font-black text-rose-700 hover:bg-rose-50 disabled:opacity-50">
              DECLINE ORDER
            </button>
          </div>
        </div>
      );
    })}
  </div>
</div>

<h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-200">ACTIVE ORDERS</h3>
                  <div className="mb-2 text-[11px] text-slate-500">Accepted and in-progress orders stay here until completed or cancelled. Customer details remain visible throughout.</div>
                  <div className="space-y-2">
                    {activeOrders.length === 0 ? <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">No active orders.</div> : null}
                    {activeOrders.map((o) => {
                      const s = normalizeVendorStatus(o.vendor_status);
                      const acceptDeadline = vendorAcceptTimer(o, nowMs);
                      return (
                        <div key={o.id || o.booking_code || Math.random()} className={cls("rounded-2xl border p-3 shadow-[0_0_18px_rgba(16,185,129,0.08)]", s === "vendor_pending" ? "border-amber-300/70 bg-amber-950/20" : "border-emerald-500/30 bg-slate-950/20")}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold">{o.booking_code || o.id}</div>
                              <div className="mt-1 grid gap-0.5 text-xs text-slate-600">
                                <div><span className="font-semibold text-slate-700">Customer:</span> {orderCustomerName(o)}</div>
                                <div><span className="font-semibold text-slate-700">Phone:</span> {orderCustomerPhone(o)}</div>
                                <div><span className="font-semibold text-slate-700">Delivery address:</span> {orderDeliveryAddress(o)}</div>
                                {hasDeliveryPin(o) ? <div><span className="font-semibold text-slate-700">Map pin:</span> Saved for driver navigation</div> : null}
                              </div>
                            </div>
                            <span className={cls("rounded-full border px-2 py-1 text-xs font-semibold", orderClass(s))}>{["driver_assigned", "driver_accepted", "pickup_ready"].includes(s) ? vendorPrepGateBadgeLabel(o) : statusLabel(s)}</span>
                          </div>
                          {s === "vendor_pending" ? (
                            <div className={"mt-2 inline-flex items-center rounded-full border px-2 py-1 text-xs font-semibold " + vendorAcceptTimerClass(acceptDeadline.tone)}>
                              Accept within: {acceptDeadline.label}
                              {acceptDeadline.expired ? " - overdue" : ""}
                            </div>
                          ) : null}
                          {["driver_assigned", "driver_accepted", "pickup_ready"].includes(s) ? (
                            <div className={cls("mt-3 rounded-xl border p-3 text-xs", customerConfirmedForVendor(o) ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-amber-300 bg-amber-50 text-amber-950")}>
                              <div className={cls("font-semibold uppercase tracking-wide", customerConfirmedForVendor(o) ? "text-emerald-700" : "text-amber-800")}>
                                {driverVendorStatusTitle(o)}
                              </div>
                              <div className="mt-1 grid gap-0.5">
                                <div><span className="font-semibold">Name:</span> {orderDriverName(o)}</div>
                                <div><span className="font-semibold">Vehicle:</span> {orderVehicleType(o)}</div>
                                <div><span className="font-semibold">Phone:</span> {orderDriverPhone(o)}</div>
                              </div>
                              <div className={cls("mt-3 rounded-xl border px-3 py-2 text-xs font-semibold", customerConfirmedForVendor(o) ? "border-emerald-700 bg-emerald-950/40 text-emerald-50" : "border-amber-700 bg-amber-950/50 text-amber-50")}>
                                {driverVendorStatusNote(o)}
                              </div>
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
                                <button type="button" disabled={busy} onClick={() => openCancelOrderDialog(o)} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject order</button>
                              </>
                            ) : null}
                            {s === "vendor_accepted" ? (
                              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">Vendor accepted. Dispatch can proceed. No second vendor action is required. Wait for driver assignment, driver fee proposal, and customer confirmation before preparing.</div>
                            ) : null}
                            {["driver_assigned", "driver_accepted", "preparing"].includes(s) ? (
                              <>
                                <button type="button" disabled={busy || !customerConfirmedForVendor(o)} title={!customerConfirmedForVendor(o) ? "Waiting for customer approval of the proposed delivery fee before the vendor can prepare." : "Mark this order ready for pickup."} onClick={() => moveOrder(o, "pickup_ready")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">{vendorPrepGateButtonLabel(o)}</button>
                                <button type="button" disabled={true} title="Cancellation is locked after rider assignment. Contact dispatch if this order must be stopped." className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-500 opacity-50 cursor-not-allowed">Cancel</button>
                              </>
                            ) : null}
                                                      </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-300">COMPLETED / HISTORY <span className="ml-2 text-[11px] font-normal normal-case tracking-normal text-slate-500">Reference only</span></h3>
                  <div className="max-h-[340px] space-y-2 overflow-auto pr-1 opacity-90">
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
    </main>
  );
}











