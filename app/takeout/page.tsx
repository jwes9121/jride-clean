"use client";

// JRIDE_TAKEOUT_STICKY_MENU_CONTROLS_V24

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

const passengerToken =
  typeof window !== "undefined"
    ? localStorage.getItem("jride_passenger_token") || localStorage.getItem("jride_access_token")
    : null;

const authHeaders: HeadersInit = {
  "Content-Type": "application/json",
};

if (passengerToken) {
  authHeaders.Authorization = `Bearer ${passengerToken}`;
}

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

type ApiResp = any;

function cls(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

type AddressRow = {
  id: string;
  label?: string | null;
  address_text: string;
  lat?: number | string | null;
  lng?: number | string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;
  is_primary: boolean;
  is_active?: boolean | null;
  updated_at?: string | null;
};

type MenuItem = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  packaging_note?: string | null;
  premium_packaging_enabled?: boolean | null;
  premium_packaging_fee?: number | string | null;
  premium_packaging_label?: string | null;
  photo_url?: string | null;
  price: number;
  sort_order?: number | null;
  is_available: boolean | null;
  sold_out_today: boolean | null;
  daily_available_quantity?: number | string | null;
  remaining_quantity?: number | string | null;
  last_updated_at?: string | null;
  prep_time_minutes?: number | string | null;
};

type VendorRow = {
  id?: string | null;
  vendor_id?: string | null;
  name?: string | null;
  display_name?: string | null;
  vendor_name?: string | null;
  email?: string | null;
  town?: string | null;
  municipality?: string | null;
  vendor_town?: string | null;
  service_town?: string | null;
  location_town?: string | null;
  home_town?: string | null;
  city?: string | null;
  premium_packaging_enabled?: boolean | null;
  premium_packaging_fee?: number | string | null;
  premium_packaging_label?: string | null;
};


type TakeoutPricingOrder = {
  
  customer_status?: string | null;
  vendor_status?: string | null;id?: string | null;
  booking_code?: string | null;
  code?: string | null;
  takeout_pricing_status?: string | null;
  takeout_delivery_fee?: number | string | null;
  takeout_service_fee?: number | string | null;
  takeout_total_payable?: number | string | null;
  takeout_cash_collection_required?: boolean | null;
  takeout_fee_proposed_at?: string | null;
  takeout_fee_expires_at?: string | null;
  takeout_customer_confirmed_at?: string | null;
  total_bill?: number | string | null;
  takeout_items_subtotal?: number | string | null;
  premium_packaging_fee?: number | string | null;
  order_preferences?: {
    premium_packaging_fee?: number | string | null;
    [key: string]: any;
  } | null;
  takeout_pricing_snapshot?: {
    packaging_subtotal?: number | string | null;
    takeout_packaging_subtotal?: number | string | null;
    premium_packaging_fee?: number | string | null;
    [key: string]: any;
  } | null;
  driver_status?: string | null;
  takeout_route_plan?: string | null;
  driver_lat?: number | string | null;
  driver_lng?: number | string | null;
  vendor_lat?: number | string | null;
  vendor_lng?: number | string | null;
  customer_lat?: number | string | null;
  customer_lng?: number | string | null;
  pickup_lat?: number | string | null;
  pickup_lng?: number | string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;
};

function normText(v: any): string {
  return String(v ?? "").trim();
}

function takeoutOrderId(o: TakeoutPricingOrder | null | undefined): string {
  return normText(o?.id || o?.booking_code || o?.code);
}

type TakeoutMapPoint = {
  lat: number;
  lng: number;
};

function takeoutMapNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function takeoutMapPoint(lat: any, lng: any): TakeoutMapPoint | null {
  const y = takeoutMapNum(lat);
  const x = takeoutMapNum(lng);
  if (y === null || x === null) return null;
  return { lat: y, lng: x };
}

function takeoutMapsDirectionsUrl(origin: TakeoutMapPoint, destination: TakeoutMapPoint): string {
  const params = new URLSearchParams({
    api: "1",
    origin: String(origin.lat) + "," + String(origin.lng),
    destination: String(destination.lat) + "," + String(destination.lng),
    travelmode: "driving",
  });
  return "https://maps.google.com/maps?saddr=" + encodeURIComponent(String(origin.lat) + "," + String(origin.lng)) + "&daddr=" + encodeURIComponent(String(destination.lat) + "," + String(destination.lng)) + "&dirflg=d";
}

function secondsUntil(value: any): number | null {
  const raw = normText(value);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}


const LS_DEVICE_KEY = "JRIDE_PAX_DEVICE_KEY";
const LS_TAKEOUT_CUSTOMER_NAME = "JRIDE_TAKEOUT_CUSTOMER_NAME";
const LS_TAKEOUT_CUSTOMER_PHONE = "JRIDE_TAKEOUT_CUSTOMER_PHONE";

const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;


type LocalTakeoutLandmark = {
  town: string;
  label: string;
  aliases?: string[];
  lat?: number;
  lng?: number;
};

// JRIDE_TAKEOUT_LOCAL_LANDMARKS_V1
// Rural address helper: local landmarks are prioritized before generic free-text addresses.
// Coordinates are optional. Only entries with coordinates will move the map pin automatically.
const LOCAL_TAKEOUT_LANDMARKS: LocalTakeoutLandmark[] = [
  { town: "Lagawe", label: "Ifugao Provincial Capitol", aliases: ["capitol", "provincial capitol", "ifugao capitol"] },
  { town: "Lagawe", label: "Lagawe Municipal Hall", aliases: ["municipal hall", "lagawe munisipyo", "munisipyo"] },
  { town: "Lagawe", label: "Ifugao State University Lagawe Campus", aliases: ["ifsu", "ifugao state university", "lagawe campus"] },
  { town: "Lagawe", label: "Lagawe Public Market", aliases: ["public market", "market", "palengke"] },
  { town: "Lagawe", label: "Lagawe Trading", aliases: ["trading", "lagawe trading"] },
  { town: "Lagawe", label: "Pedro's Pasta and Sides", aliases: ["pedros", "pedro", "pasta"] },
  { town: "Lagawe", label: "The Gazebo", aliases: ["gazebo"] },
  { town: "Lagawe", label: "Bahawit Hanging Bridge", aliases: ["bahawit", "hanging bridge"] },
  { town: "Lagawe", label: "Brussels Garden Inn", aliases: ["brussels", "garden inn"] },
  { town: "Lagawe", label: "Vines Cafe and Restaurant", aliases: ["vines", "vines cafe"] },

  { town: "Hingyon", label: "Hingyon Fire Station", aliases: ["fire station", "bfp", "hingyon fire"] },
  { town: "Hingyon", label: "TIMMAC Cafe and Restaurant", aliases: ["timmac", "timmac cafe"] },
  { town: "Hingyon", label: "Piwong Elementary School", aliases: ["piwong", "piwong elementary"] },
  { town: "Hingyon", label: "Elinora's General Merchandise", aliases: ["elinora", "general merchandise"] },
  { town: "Hingyon", label: "MCGI Piwong Hingyon Ifugao", aliases: ["mcgi", "piwong church"] },
  { town: "Hingyon", label: "Buyuccan Marcial Residence", aliases: ["buyuccan", "marcial residence"] },
  { town: "Hingyon", label: "SHAMAE Gasoline Station", aliases: ["shamae", "gas station", "gasoline"] },

  { town: "Banaue", label: "Banaue Public Market", aliases: ["public market", "market", "palengke"] },
  { town: "Banaue", label: "Banaue Museum", aliases: ["museum"] },
  { town: "Banaue", label: "Bocos Elementary School", aliases: ["bocos", "bocos elementary"] },
  { town: "Banaue", label: "Banaue Homestay", aliases: ["homestay"] },
  { town: "Banaue", label: "Banaue Sunrise Guest House", aliases: ["sunrise", "guest house"] },
  { town: "Banaue", label: "7th Heaven's Cafe and Lodge", aliases: ["7th heaven", "seventh heaven", "cafe and lodge"] },
  { town: "Banaue", label: "Uyami's Green View Lodge and Restaurant", aliases: ["uyami", "green view"] },
  { town: "Banaue", label: "MiddleGround Cafe and Restobar", aliases: ["middleground", "restobar"] },
  { town: "Banaue", label: "Bogah Lodge and Tours", aliases: ["bogah"] },
  { town: "Banaue", label: "The Friends Cafe", aliases: ["friends cafe"] },
  { town: "Banaue", label: "Bro Zone", aliases: ["bro zone"] },
  { town: "Banaue", label: "Savta Homestay", aliases: ["savta"] },
  { town: "Banaue", label: "TNJ Fuels", aliases: ["tnj", "fuels", "gas station"] },

  { town: "Lamut", label: "Lamut Municipal Hall", aliases: ["municipal hall", "lamut munisipyo", "munisipyo"] },
  { town: "Lamut", label: "Lamut Public Market", aliases: ["public market", "market", "palengke"] },
  { town: "Lamut", label: "Lamut Terminal", aliases: ["terminal"] },
  { town: "Lamut", label: "Lamut RHU", aliases: ["rhu", "health unit", "clinic"] },
];

function localLandmarkSearchText(row: LocalTakeoutLandmark): string {
  return [row.label, row.town, ...(row.aliases || [])].join(" ").toLowerCase();
}

function localLandmarkAddress(row: LocalTakeoutLandmark): string {
  return `${row.label}, ${row.town}, Ifugao`;
}

function getOrCreateDeviceKey(): string {
  if (typeof window === "undefined") return "";
  const existing = String(window.localStorage.getItem(LS_DEVICE_KEY) || "").trim();
  if (existing) return existing;

  const key = "dev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  window.localStorage.setItem(LS_DEVICE_KEY, key);
  return key;
}

async function getJson(url: string) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "application/json" },
  });

  const j = await res.json().catch(() => ({}));

  if (!res.ok || (j && j.ok === false)) {
    throw new Error(j?.message || j?.error || ("HTTP " + res.status));
  }

  return j;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401) {
  if (typeof window !== "undefined") {
    window.location.href = "/passenger-login?callbackUrl=/takeout";
  }
  throw new Error("Passenger session expired.");
}

if (res.status === 401) {
  if (typeof window !== "undefined") {
    window.location.href = "/passenger-login?callbackUrl=/takeout";
  }
  throw new Error("Passenger session expired.");
}

if (!res.ok || (j && j.ok === false)) {
  throw new Error(j?.message || j?.error || ("HTTP " + res.status));
}
  return j;
}


function isVendorAcceptingOrders(v: any): boolean {
  const raw =
    v?.accepting_orders ??
    v?.acceptingOrders ??
    v?.is_open ??
    v?.isOpen ??
    v?.vendor_accepting_orders ??
    v?.vendorOpen ??
    v?.status ??
    v?.vendor_status ??
    v?.availability_status ??
    v?.store_status ??
    true;

  if (raw === false) return false;
  if (raw === true) return true;

  const s = String(raw ?? "").trim().toLowerCase();
  if (["false", "0", "no", "closed", "offline", "inactive", "disabled", "unavailable", "not_accepting", "removed_from_pilot"].includes(s)) return false;
  if (["true", "1", "yes", "open", "online", "active", "available", "accepting", "accepting_orders"].includes(s)) return true;
  return true;
}

function vendorAvailabilityKnown(v: any): boolean {
  const raw =
    v?.accepting_orders ??
    v?.acceptingOrders ??
    v?.is_open ??
    v?.isOpen ??
    v?.vendor_accepting_orders ??
    v?.vendorOpen ??
    v?.status ??
    v?.vendor_status ??
    v?.availability_status ??
    v?.store_status ??
    null;
  return raw !== null && raw !== undefined && String(raw).trim() !== "";
}

function vendorCardIsOpen(v: any, overrides: Record<string, boolean>): boolean {
  const id = vendorKey(v);
  if (id && Object.prototype.hasOwnProperty.call(overrides, id)) {
    return overrides[id] === true;
  }
  return isVendorAcceptingOrders(v);
}

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number) {
  const v = Number(n || 0);
  return "PHP " + v.toFixed(2);
}
const PREP_TIME_OPTIONS = [15, 20, 30, 45, 60];

function prepMinutes(value: any) {
  const n = Number(value);
  return PREP_TIME_OPTIONS.includes(n) ? n : 15;
}

function vendorKey(v: VendorRow): string {
  return String(v.id || v.vendor_id || "").trim();
}

function vendorLabel(v: VendorRow): string {
  return String(v.display_name || v.vendor_name || v.name || v.email || vendorKey(v) || "Vendor").trim();
}

function normalizeTakeoutTown(value: any): string {
  const raw = String(value || "").trim().toLowerCase();
  return CANONICAL_TAKEOUT_TOWNS.find((town) => town.toLowerCase() === raw) || "";
}

// JRIDE_TAKEOUT_TOWN_SELECT_VENDOR_FILTER_FIX_V1
function vendorTown(v: VendorRow): string {
  return normalizeTakeoutTown(
    firstString(
      v.town,
      v.municipality,
      v.vendor_town,
      v.service_town,
      v.location_town,
      v.home_town,
      v.city,
      (v as any).town_name,
      (v as any).store_town
    )
  );
}

// JRIDE_VENDOR_LOGO_BINDING_V5
function vendorUploadedLogoUrl(v: VendorRow): string | null {
  const raw =
    (v as any).vendor_logo_url ??
    (v as any).vendorLogoUrl ??
    (v as any).logo_url ??
    (v as any).logoUrl ??
    (v as any).profile_logo_url ??
    (v as any).profileLogoUrl ??
    (v as any).business_logo_url ??
    (v as any).businessLogoUrl ??
    (v as any).store_logo_url ??
    (v as any).storeLogoUrl ??
    (v as any).logo_public_url ??
    (v as any).logoPublicUrl ??
    (v as any).public_logo_url ??
    (v as any).publicLogoUrl ??
    (v as any).image_url ??
    (v as any).imageUrl ??
    (v as any).photo_url ??
    (v as any).photoUrl ??
    null;

  const value = String(raw || "").trim();
  if (!value) return null;
  return value;
}

function firstString(...values: any[]): string {
  for (const v of values) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function onlyDigits(v: any): string {
  return String(v ?? "").replace(/[^0-9]/g, "").slice(0, 20);
}

function readLocal(key: string): string {
  if (typeof window === "undefined") return "";
  return String(window.localStorage.getItem(key) || "").trim();
}

function writeLocal(key: string, value: string) {
  if (typeof window === "undefined") return;
  const cleanValue = String(value || "").trim();
  if (cleanValue) window.localStorage.setItem(key, cleanValue);
}

function currentPassengerAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof window !== "undefined") {
    const token =
      window.localStorage.getItem("jride_passenger_token") ||
      window.localStorage.getItem("jride_access_token") ||
      "";
    if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  }
  return headers;
}

function logoutPassengerProfile() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(LS_TAKEOUT_CUSTOMER_NAME);
  window.localStorage.removeItem(LS_TAKEOUT_CUSTOMER_PHONE);
  window.localStorage.removeItem("jride_passenger_token");
  window.localStorage.removeItem("jride_access_token");
  window.sessionStorage.removeItem(LS_TAKEOUT_CUSTOMER_NAME);
  window.sessionStorage.removeItem(LS_TAKEOUT_CUSTOMER_PHONE);
  window.location.href = "/passenger-login?callbackUrl=/takeout";
}

async function fetchOptionalJson(url: string, init?: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, {
  ...(init || {}),
  method: "GET",
  cache: "no-store",
  headers: {
    Accept: "application/json",
    ...((init?.headers as Record<string, string>) || {}),
  },
});
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch {
    return null;
  }
}

function extractPassengerAutofill(source: any) {
  const root = source || {};
  const user = root.user || root.passenger || root.profile || root.data || root.account || root.customer || root;
  return {
    name: firstString(
      user.name,
      user.full_name,
      user.fullName,
      user.passenger_name,
      user.passengerName
    ),
    phone: onlyDigits(firstString(
      user.phone,
      user.phone_number,
      user.phoneNumber,
      user.mobile,
      user.mobile_number,
      user.mobileNumber,
      user.contact_number,
      user.contactNumber
    )),
    address: firstString(
      user.default_address,
      user.defaultAddress,
      user.saved_address,
      user.savedAddress,
      user.address_text,
      user.addressText,
      user.address,
      user.home_address,
      user.homeAddress
    ),
  };
}
function hasSignedInUser(source: any): boolean {
  const root = source || {};
  const user = root.user || root.session?.user || root.data?.user || root.account || null;
  if (!user || typeof user !== "object") return false;
  return !!firstString(user.id, user.sub, user.email, user.name);
}

function cleanDeliveryAddressLabel(v: any): string {
  const s = String(v || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.startsWith("pinned delivery spot")) return "Delivery spot marked on map";
  if (lower.startsWith("delivery pin")) return "Delivery spot marked on map";
  const coordOnly = /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(s);
  if (coordOnly) return "Delivery spot marked on map";
  return s;
}


function safeCoord(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function addressToDeliveryPin(row: AddressRow | null | undefined): DeliveryPin | null {
  if (!row) return null;
  const lat = safeCoord(row.dropoff_lat ?? row.lat);
  const lng = safeCoord(row.dropoff_lng ?? row.lng);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

function addressHasDeliveryPin(row: AddressRow | null | undefined): boolean {
  return !!addressToDeliveryPin(row);
}

type DeliveryPin = {
  lat: number;
  lng: number;
};

function deliveryPinLabel(pin: DeliveryPin | null): string {
  if (!pin) return "";
  return "Delivery spot marked on map";
}

function deliveryPinCoordinateText(pin: DeliveryPin | null): string {
  if (!pin) return "";
  return `${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}`;
}

function DeliveryPinPicker({ value, onChange }: { value: DeliveryPin | null; onChange: (next: DeliveryPin) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const [mapErr, setMapErr] = useState("");

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    if (!mapboxgl.accessToken) {
      setMapErr("Map token is missing. Exact map pin is still required before order submission.");
      return;
    }

        const hasInitialPin = !!value;
    const initialLng = value?.lng ?? 121.1;
    const initialLat = value?.lat ?? 16.8;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [initialLng, initialLat],
      zoom: hasInitialPin ? 16 : 12,
    });

    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    const createYouAreHereMarker = () => {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.flexDirection = "column";
      wrap.style.alignItems = "center";
      wrap.style.gap = "4px";

      const dot = document.createElement("div");
      dot.style.width = "18px";
      dot.style.height = "18px";
      dot.style.borderRadius = "9999px";
      dot.style.background = "#2563eb";
      dot.style.border = "3px solid #ffffff";
      dot.style.boxShadow = "0 0 0 4px rgba(37, 99, 235, 0.25)";

      const label = document.createElement("div");
      label.textContent = "You are here";
      label.style.whiteSpace = "nowrap";
      label.style.borderRadius = "9999px";
      label.style.background = "#ffffff";
      label.style.border = "1px solid #cbd5e1";
      label.style.padding = "3px 8px";
      label.style.fontSize = "11px";
      label.style.fontWeight = "700";
      label.style.color = "#1e293b";
      label.style.boxShadow = "0 4px 10px rgba(15, 23, 42, 0.12)";

      wrap.appendChild(label);
      wrap.appendChild(dot);
      return wrap;
    };

    const placeMarker = (lng: number, lat: number) => {
      if (!markerRef.current) {
        const marker = new mapboxgl.Marker({ element: createYouAreHereMarker(), draggable: true })
          .setLngLat([lng, lat])
          .addTo(map);
        marker.on("dragend", () => {
          const pos = marker.getLngLat();
          onChange({ lat: pos.lat, lng: pos.lng });
        });
        markerRef.current = marker;
      } else {
        markerRef.current.setLngLat([lng, lat]);
      }
    };

    if (value) placeMarker(value.lng, value.lat);
        if (!value && typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          map.flyTo({
            center: [pos.coords.longitude, pos.coords.latitude],
            zoom: 16,
            essential: true,
          });
        },
        () => undefined,
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 60000,
        },
      );
    }

    map.on("click", (event: mapboxgl.MapMouseEvent) => {
      const lng = event.lngLat.lng;
      const lat = event.lngLat.lat;
      placeMarker(lng, lat);
      onChange({ lat, lng });
    });

    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !value) return;
    if (!markerRef.current) {
      const marker = new mapboxgl.Marker({ draggable: true })
        .setLngLat([value.lng, value.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLngLat();
        onChange({ lat: pos.lat, lng: pos.lng });
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLngLat([value.lng, value.lat]);
    }
    map.flyTo({ center: [value.lng, value.lat], zoom: 16, essential: true });
  }, [value, onChange]);

  function useDeviceLocation() {
    setMapErr("");
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setMapErr("Device location is not available on this browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onChange({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setMapErr("Could not read device location. You can tap the map instead."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  }

  return (
    <div className="rounded border bg-white p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-semibold text-slate-700">Delivery pin</div>
          <div className="text-[11px] text-slate-500">Tap the map or drag the "You are here" pin to mark the exact delivery spot.</div>
        </div>
        <button type="button" onClick={useDeviceLocation} className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold shadow-sm hover:bg-slate-50">
          Use device location
        </button>
      </div>
      {mapErr ? <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">{mapErr}</div> : null}
      <div ref={containerRef} className="mt-2 h-64 w-full overflow-hidden rounded border bg-slate-100" />
      {value ? (
        <div className="mt-2 text-[11px] text-slate-600">
          You are here: <span className="font-semibold">{value.lat.toFixed(6)}, {value.lng.toFixed(6)}</span>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-red-600">No pin selected yet. Driver navigation requires the exact map location.</div>
      )}
    </div>
  );
}

export default function TakeoutPage() {
  const [vendorId, setVendorId] = useState("");
  const [vendors, setVendors] = useState<VendorRow[]>([]);
  const [vendorTownFilter, setVendorTownFilter] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [autofillNote, setAutofillNote] = useState("");
  const [authState, setAuthState] = useState<"unknown" | "guest" | "signed_in_profile" | "signed_in_missing_profile">("unknown");

  // Phase 2B.0 - DB-backed addresses (pilot via device_key)
  const [deviceKey, setDeviceKey] = useState("");
  const [addrMode, setAddrMode] = useState<"saved" | "new">("saved");
  const [saved, setSaved] = useState<AddressRow[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [addrBusy, setAddrBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [addrErr, setAddrErr] = useState<string | null>(null);

  const [newAddr, setNewAddr] = useState("");
  const [localLandmarkOpen, setLocalLandmarkOpen] = useState(false);
  const [saveAddr, setSaveAddr] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);
  const [showDeliveryPin, setShowDeliveryPin] = useState(false);
  const deliveryPinSectionRef = useRef<HTMLDivElement | null>(null);
  const [deliveryPin, setDeliveryPin] = useState<DeliveryPin | null>(null);
  const [deliveryPinNeedsConfirmation, setDeliveryPinNeedsConfirmation] =
    useState(false);

  // Phase 2B - menu consumption
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuErr, setMenuErr] = useState<string | null>(null);
  const [vendorClosed, setVendorClosed] = useState(false);
  // JRIDE_TAKEOUT_VENDOR_AVAILABILITY_ORDER_V22
  const [vendorAvailabilityById, setVendorAvailabilityById] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuCategoryFilter, setMenuCategoryFilter] = useState("All");
  const [menuSearchTerm, setMenuSearchTerm] = useState("");
  const [menuSortMode, setMenuSortMode] = useState<"recommended" | "price_asc" | "price_desc" | "prep_fast" | "name_asc">("recommended");
  const [menuVendorProfile, setMenuVendorProfile] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  const [note, setNote] = useState("");
  const [premiumPackagingSelections, setPremiumPackagingSelections] = useState<Record<string, boolean>>({});
  const [receiptRequested, setReceiptRequested] = useState(false);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [lastJson, setLastJson] = useState<ApiResp | null>(null);

  // JRIDE_TAKEOUT_PASSENGER_PRICING_UI_V1
  // Passenger-side visibility only for delivery fee quotes.
  // This page does not assign drivers, mutate ride lifecycle, touch ride fare, or touch payout logic.
  const [pricingOrder, setPricingOrder] = useState<TakeoutPricingOrder | null>(null);
  const [pricingBusy, setPricingBusy] = useState(false);
  const [pricingErr, setPricingErr] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const primary = useMemo(() => {
    const selected = selectedAddressId ? saved.find((a) => String(a.id) === selectedAddressId) : null;
    return selected || saved.find((a) => a.is_primary === true) || saved.find((a) => a.is_active !== false) || saved[0] || null;
  }, [saved, selectedAddressId]);

  useEffect(() => {
    if (addrMode !== "saved" || !primary) return;

    const addressText = cleanDeliveryAddressLabel(String(primary.address_text || primary.label || ""));
    if (addressText) {
      setNewAddr((prev) => prev.trim() ? prev : addressText);
    }

    const savedPin = addressToDeliveryPin(primary);
    if (savedPin) {
      setDeliveryPin(savedPin);
      return;
    }

    if (!deliveryPin) {
      setShowDeliveryPin(true);
    }
  }, [addrMode, primary, deliveryPin]);

  const vendorTowns = useMemo(() => {
    return [...CANONICAL_TAKEOUT_TOWNS];
}, []);

  const visibleVendors = useMemo(() => {
    const town = normalizeTakeoutTown(vendorTownFilter);
    if (!town) return [];
    return vendors
      .filter((v) => vendorTown(v) === town)
      .sort((a, b) => {
        const aOpen = vendorCardIsOpen(a, vendorAvailabilityById);
        const bOpen = vendorCardIsOpen(b, vendorAvailabilityById);
        if (aOpen !== bOpen) return aOpen ? -1 : 1;

        const aKnown = vendorAvailabilityKnown(a) || Object.prototype.hasOwnProperty.call(vendorAvailabilityById, vendorKey(a));
        const bKnown = vendorAvailabilityKnown(b) || Object.prototype.hasOwnProperty.call(vendorAvailabilityById, vendorKey(b));
        if (aKnown !== bKnown) return aKnown ? -1 : 1;

        return vendorLabel(a).localeCompare(vendorLabel(b));
      });
  }, [vendors, vendorTownFilter, vendorAvailabilityById]);
  const activeVendors = useMemo(() => {
    return visibleVendors.filter((v: any) => String(v?.marketplace_status || v?.onboarding_status || "").toLowerCase() !== "batch2");
  }, [visibleVendors]);

  const comingSoonVendors = useMemo(() => {
    return visibleVendors.filter((v: any) => String(v?.marketplace_status || v?.onboarding_status || "").toLowerCase() === "batch2");
  }, [visibleVendors]);

  const selectedVendor = useMemo(() => {
    const id = String(vendorId || "").trim();
    if (!id) return null;
    return vendors.find((v) => vendorKey(v) === id) || null;
  }, [vendors, vendorId]);

function selectedAddressTown(
  vendorTownFilter: string,
  selectedVendor: any
): string {
  const vendorTownValue =
    String(
      selectedVendor?.town ||
      selectedVendor?.municipality ||
      vendorTownFilter ||
      ""
    ).trim();

  return normalizeTakeoutTown(vendorTownValue);
}
  const selectedTownForAddress = useMemo(() => {
    return selectedAddressTown(vendorTownFilter, selectedVendor);
  }, [vendorTownFilter, selectedVendor]);

  const localLandmarkSuggestions = useMemo(() => {
    if (addrMode !== "new") return [];
    const town = normalizeTakeoutTown(selectedTownForAddress);
    const q = String(newAddr || "").trim().toLowerCase();
    if (!town || q.length < 2) return [];
    return LOCAL_TAKEOUT_LANDMARKS
      .filter((row) => normalizeTakeoutTown(row.town) === town)
      .filter((row) => localLandmarkSearchText(row).includes(q))
      .slice(0, 8);
  }, [addrMode, selectedTownForAddress, newAddr]);

  function chooseLocalLandmark(row: LocalTakeoutLandmark) {
    const label = localLandmarkAddress(row);
    setNewAddr(label);
    setLocalLandmarkOpen(false);
    setSubmitted(false);
    if (typeof row.lat === "number" && typeof row.lng === "number") {
      setDeliveryPin({ lat: row.lat, lng: row.lng });
    }
  }

  const resolvedDeliveryAddress = useMemo(() => {
    if (addrMode === "saved") return cleanDeliveryAddressLabel(primary?.address_text || "");
    return cleanDeliveryAddressLabel(newAddr || "");
  }, [addrMode, primary, newAddr]);

  const menuSelectable = useMemo(() => {
    return (menu || []).map((m) => {
      const available = (m.is_available !== false) && (m.sold_out_today !== true);
      const category = String(m.category || "Others").trim() || "Others";
      return { ...m, category, _available: available };
    });
  }, [menu]);

  const visibleMenuCategories = useMemo(() => {
    const set = new Set<string>();
    for (const item of menuSelectable) {
      const cat = String(item.category || "Others").trim() || "Others";
      set.add(cat);
    }

    const preferred = [
      "Meals",
      "Rice Meals",
      "Chicken",
      "Pork",
      "Seafood",
      "Noodles",
      "Pasta",
      "Bread",
      "Coffee",
      "Milk Tea",
      "Drinks",
      "Fruit Soda",
      "Desserts",
      "Waffles",
      "Snacks",
      "Add-ons",
      "Others",
    ];

    const out: string[] = ["All"];
    for (const cat of preferred) {
      if (set.has(cat)) {
        out.push(cat);
        set.delete(cat);
      }
    }
    out.push(...Array.from(set).sort((a, b) => a.localeCompare(b, "en")));
    return out;
  }, [menuSelectable]);

  useEffect(() => {
    if (!visibleMenuCategories.includes(menuCategoryFilter)) {
      setMenuCategoryFilter("All");
    }
  }, [visibleMenuCategories, menuCategoryFilter]);

  const filteredMenuSelectable = useMemo(() => {
    const q = menuSearchTerm.trim().toLowerCase();

    const filtered = menuSelectable.filter((m) => {
      const category = String(m.category || "Others").trim() || "Others";
      if (menuCategoryFilter !== "All" && category !== menuCategoryFilter) return false;
      if (!q) return true;

      const haystack = [
        m.name,
        m.description,
        category,
        m.packaging_note,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(q);
    });

    return [...filtered].sort((a, b) => {
      if (menuSortMode === "price_asc") return toNum(a.price) - toNum(b.price);
      if (menuSortMode === "price_desc") return toNum(b.price) - toNum(a.price);
      if (menuSortMode === "prep_fast") return prepMinutes(a.prep_time_minutes) - prepMinutes(b.prep_time_minutes);
      if (menuSortMode === "name_asc") return String(a.name || "").localeCompare(String(b.name || ""), "en");

      const ao = Number.isFinite(Number(a.sort_order)) ? Number(a.sort_order) : 0;
      const bo = Number.isFinite(Number(b.sort_order)) ? Number(b.sort_order) : 0;
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""), "en");
    });
  }, [menuSelectable, menuCategoryFilter, menuSearchTerm, menuSortMode]);

  function itemPremiumPackagingEnabled(m: MenuItem): boolean {
    return m.premium_packaging_enabled === true;
  }

  function itemPremiumPackagingFee(m: MenuItem): number {
    return itemPremiumPackagingEnabled(m) ? toNum(m.premium_packaging_fee) : 0;
  }

  function itemPremiumPackagingLabel(m: MenuItem): string {
    return String(m.premium_packaging_label || "Premium packaging").trim() || "Premium packaging";
  }

  function setItemPremiumPackaging(itemId: string, checked: boolean) {
    setPremiumPackagingSelections((prev) => {
      const next = { ...prev };
      if (checked) next[itemId] = true;
      else delete next[itemId];
      return next;
    });
  }

  const selectedLines = useMemo(() => {
    const lines: Array<{
      id: string;
      name: string;
      price: number;
      qty: number;
      line_total: number;
      packaging_note?: string | null;
      premium_packaging_selected?: boolean;
      premium_packaging_fee?: number;
      premium_packaging_label?: string | null;
      premium_packaging_total?: number;
    }> = [];

    for (const m of menuSelectable) {
      const q = Math.max(0, Math.floor(toNum(qty[m.id])));
      if (q > 0) {
        const premiumSelected = premiumPackagingSelections[m.id] === true && itemPremiumPackagingEnabled(m);
        const premiumFee = premiumSelected ? itemPremiumPackagingFee(m) : 0;
        const premiumLabel = premiumSelected ? itemPremiumPackagingLabel(m) : null;

        lines.push({
          id: m.id,
          name: m.name,
          price: toNum(m.price),
          qty: q,
          line_total: q * toNum(m.price),
          packaging_note: m.packaging_note || null,
          premium_packaging_selected: premiumSelected,
          premium_packaging_fee: premiumFee,
          premium_packaging_label: premiumLabel,
          premium_packaging_total: premiumFee * q,
        });
      }
    }

    return lines;
  }, [menuSelectable, qty, premiumPackagingSelections]);

  const itemsSubtotal = useMemo(() => selectedLines.reduce((a, r) => a + toNum(r.line_total), 0), [selectedLines]);
  const packagingEstimate = useMemo(() => selectedLines.reduce((a, r) => a + toNum(r.premium_packaging_total), 0), [selectedLines]);
  const estimatedSubtotalWithPackaging = itemsSubtotal + packagingEstimate;
  const premiumPackagingSelected = packagingEstimate > 0;
  const premiumPackagingLabel = "Premium packaging";
  const cashCollectionRequired = estimatedSubtotalWithPackaging >= 500;

  // Human readable for vendor UI, and JSON snapshot for future lock
  const itemsText = useMemo(() => {
    if (!selectedLines.length) return "";
    return selectedLines.map((r) => {
      const base = `${r.qty}x ${r.name} @ ${money(r.price)} = ${money(r.line_total)}`;
      const lines = [base];

      if (r.packaging_note) lines.push(`   Packaging: ${r.packaging_note}`);
      if (r.premium_packaging_selected) {
        lines.push(`   Add-on: ${r.premium_packaging_label || "Premium packaging"} (${money(toNum(r.premium_packaging_total))})`);
      }

      return lines.join("\n");
    }).join("\n");
  }, [selectedLines]);

  const itemsJson = useMemo(() => {
    return selectedLines.map((r) => ({
      menu_item_id: r.id,
      name: r.name,
      unit_price: r.price,
      qty: r.qty,
      line_total: r.line_total,
      packaging_note: r.packaging_note || null,
      premium_packaging_selected: r.premium_packaging_selected === true,
      premium_packaging_fee: toNum(r.premium_packaging_fee),
      premium_packaging_label: r.premium_packaging_label || null,
      premium_packaging_total: toNum(r.premium_packaging_total),
    }));
  }, [selectedLines]);

  const canSubmit = useMemo(() => {
    const hasVendor = vendorId.trim().length > 0;
    const hasVerifiedProfile = authState === "signed_in_profile" && customerName.trim().length > 0 && customerPhone.trim().length > 0;
    const hasDeliveryPin = !!deliveryPin;
    const hasItems = selectedLines.length > 0;
    return hasVendor && hasVerifiedProfile && hasDeliveryPin && hasItems && !vendorClosed && !busy;
  }, [vendorId, authState, customerName, customerPhone, deliveryPin, selectedLines.length, vendorClosed, busy]);


  async function loadPassengerAutofill() {
    // Authentication status is shown to the passenger, but customer name/phone must come from a real passenger profile.
    // Do not use email display names as passenger names.
    const authHeaders = currentPassengerAuthHeaders();

const session = await fetchOptionalJson(
  "/api/auth/session",
  { headers: authHeaders }
);

const passengerSession = await fetchOptionalJson(
  "/api/public/auth/session",
  { headers: authHeaders }
);

const contact = await fetchOptionalJson(
  "/api/takeout/passenger-contact",
  { headers: authHeaders }
);
    const signedIn =
      hasSignedInUser(passengerSession) ||
      hasSignedInUser(session) ||
      contact?.signed_in === true ||
      contact?.authenticated === true ||
      !!firstString(contact?.user_id, contact?.passenger_id, contact?.profile?.id, contact?.data?.id);

    const profileSources: any[] = [];

    if (contact?.full_name || contact?.phone || contact?.email || contact?.address) profileSources.push(contact);
    if (contact?.profile) profileSources.push(contact.profile);
    if (contact?.data) profileSources.push(contact.data);
    if (passengerSession?.user) profileSources.push(passengerSession.user);
    if (passengerSession?.profile) profileSources.push(passengerSession.profile);
    if (passengerSession?.data) profileSources.push(passengerSession.data);
    if (passengerSession?.full_name || passengerSession?.phone || passengerSession?.email || passengerSession?.address) profileSources.push(passengerSession);

    const profile = null;
    if (profile) profileSources.push(profile);

    const publicProfile = null;
    if (publicProfile) profileSources.push(publicProfile);

    const passengerMe = null;
    if (passengerMe) profileSources.push(passengerMe);

    const publicPassengerMe = null;
    if (publicPassengerMe) profileSources.push(publicPassengerMe);

    let profileName = "";
    let profilePhone = "";
    let profileAddress = "";

    for (const source of profileSources) {
      const hit = extractPassengerAutofill(source);
      if (!profileName && hit.name) profileName = hit.name;
      if (!profilePhone && hit.phone) profilePhone = hit.phone;
      if (!profileAddress && hit.address) profileAddress = cleanDeliveryAddressLabel(hit.address);
    }

    if (profileName) {
      setCustomerName(profileName);
    }

    if (profilePhone) {
      setCustomerPhone(profilePhone);
    }

    if (profileAddress) {
      setNewAddr((prev) => prev.trim() ? prev : profileAddress);
    }

    const loaded = [profileName ? "profile name" : "", profilePhone ? "profile phone" : "", profileAddress ? "profile address" : ""].filter(Boolean);

    if (signedIn && profileName && profilePhone) {
      setAuthState("signed_in_profile");
      setAutofillNote("Signed in. Loaded from verified passenger contact: " + loaded.join(", ") + ". These details are required for booking.");
    } else if (signedIn) {
      setAuthState("signed_in_missing_profile");
      setAutofillNote("Signed in, but a complete verified passenger name and phone were not found. Booking is blocked until the profile is fixed.");
    } else {
      setCustomerName("");
      setCustomerPhone("");
      setAuthState("guest");
      setAutofillNote("Not signed in. Sign in with your passenger phone number and password to book.");
    }
  }

  async function refreshAddresses(k?: string) {
    const dk = String(k || deviceKey || "").trim();
    if (!dk) return;
    setAddrBusy(true);
    setAddrErr(null);
    try {
      const j = await fetchOptionalJson("/api/passenger-addresses?device_key=" + encodeURIComponent(dk));
      const rows = Array.isArray(j?.addresses) ? (j.addresses as AddressRow[]) : [];
      setSaved(rows);

      const nextPrimary =
        rows.find((r) => r?.is_primary === true) ||
        rows.find((r) => r?.is_active !== false) ||
        rows[0] ||
        null;

      if (!nextPrimary) {
        setSelectedAddressId("");
        setAddrMode("new");
        return;
      }

      const nextAddress = cleanDeliveryAddressLabel(
        String(nextPrimary.address_text || nextPrimary.label || "")
      );

      if (!nextAddress) {
        setSelectedAddressId("");
        setAddrMode("new");
        return;
      }

      setSelectedAddressId(String(nextPrimary.id || ""));
      setAddrMode("saved");
      setNewAddr((prev) => prev.trim() ? prev : nextAddress);

      const savedPin = addressToDeliveryPin(nextPrimary);
      if (savedPin) {
        setDeliveryPin(savedPin);
      } else {
        setDeliveryPin(null);
        setShowDeliveryPin(true);
      }
    } catch (e: any) {
      setAddrErr(String(e?.message || e || "Failed to load addresses"));
      setSaved([]);
      setSelectedAddressId("");
      setAddrMode("new");
    } finally {
      setAddrBusy(false);
    }
  }

  async function refreshMenu(vId?: string, silent = false) {
    const vid = String(vId || vendorId || "").trim();
    if (!vid) {
      setVendorClosed(false);
      setMenu([]);
      setMenuVendorProfile(null);
      setMenuCategoryFilter("All");
      setMenuSearchTerm("");
      setQty({});
      return;
    }
    if (!silent) setMenuBusy(true);
    if (!silent) setMenuErr(null);
    try {
      // CUSTOMER_VENDOR_AVAILABILITY_V1
      // Prefer the vendor-menu API because it reflects the vendor open/closed switch.
      // Fallback to the legacy takeout menu read so the page does not break on older deploys.
      let j: any;
      try {
        j = await getJson("/api/vendor-menu/manage?vendor_id=" + encodeURIComponent(vid));
      } catch {
        j = await getJson("/api/takeout/menu?vendor_id=" + encodeURIComponent(vid));
      }
      const items = Array.isArray(j?.items) ? j.items : [];
      const mapped: MenuItem[] = items
        .filter(Boolean)
        .map((r: any) => ({
          id: String(r.id ?? r.menu_item_id ?? ""),
          name: String(r.name ?? ""),
          description: (r.description ?? null) as any,
          category: (r.category ?? r.item_category ?? r.menu_category ?? r.category_name ?? "Others") as any,
          packaging_note: (r.packaging_note ?? r.packagingNote ?? r.packaging ?? null) as any,
          premium_packaging_enabled: (r.premium_packaging_enabled === true) as any,
          premium_packaging_fee: (r.premium_packaging_fee ?? 0) as any,
          premium_packaging_label: (r.premium_packaging_label ?? "Premium packaging") as any,
          photo_url: (r.photo_url ?? r.image_url ?? r.menu_photo_url ?? r.item_photo_url ?? null) as any,
          prep_time_minutes: (r.prep_time_minutes ?? 15) as any,
          price: toNum(r.price),
          sort_order: (r.sort_order ?? 0) as any,
          is_available: (typeof r.is_available === "boolean" ? r.is_available : null),
          sold_out_today: (typeof r.sold_out_today === "boolean" ? r.sold_out_today : null),
          daily_available_quantity: (r.daily_available_quantity ?? null) as any,
          remaining_quantity: (r.remaining_quantity ?? null) as any,
          last_updated_at: (r.last_updated_at ?? null) as any,
        }))
        .filter((r: MenuItem) => r.id && r.name);

      const orderableCount = mapped.filter(
        (r) => r.is_available !== false && r.sold_out_today !== true,
      ).length;

      const closedByApi =
        j?.accepting_orders === false ||
        j?.vendor?.accepting_orders === false ||
        j?.vendor?.acceptingOrders === false ||
        j?.acceptingOrders === false ||
        j?.vendor_accepting_orders === false ||
        j?.vendorAcceptingOrders === false;

      const nextVendorClosed = closedByApi || orderableCount <= 0;
      setVendorClosed(nextVendorClosed);
      setVendorAvailabilityById((prev) => ({ ...prev, [vid]: !nextVendorClosed }));

      setMenuVendorProfile(j?.vendor || j || null);
      setMenu(mapped);
      // Keep existing qty but drop unknown
      setQty((prev) => {
        const next: Record<string, number> = {};
        for (const m of mapped) {
          if (prev[m.id]) next[m.id] = prev[m.id];
        }
        return next;
      });
    } catch (e: any) {
      setMenuErr(String(e?.message || e || "Failed to load menu"));
      setVendorClosed(false);
      setMenu([]);
      setMenuVendorProfile(null);
      setQty({});
    } finally {
      if (!silent) setMenuBusy(false);
    }
  }

  async function probeVendorAvailability(vid: string): Promise<boolean> {
    try {
      const j = await getJson("/api/vendor-menu/manage?vendor_id=" + encodeURIComponent(vid));
      const items = Array.isArray(j?.items) ? j.items : [];
      const orderableCount = items.filter((r: any) =>
        r &&
        r.is_available !== false &&
        r.sold_out_today !== true
      ).length;

      const closedByApi =
        j?.accepting_orders === false ||
        j?.vendor?.accepting_orders === false ||
        j?.vendor?.acceptingOrders === false ||
        j?.acceptingOrders === false ||
        j?.vendor_accepting_orders === false ||
        j?.vendorAcceptingOrders === false;

      return !(closedByApi || orderableCount <= 0);
    } catch {
      return true;
    }
  }


  useEffect(() => {
    const dk = getOrCreateDeviceKey();
    setDeviceKey(dk);
    refreshAddresses(dk).catch(() => undefined);
    loadPassengerAutofill().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const rows = visibleVendors;
    if (!rows.length) return;

    let cancelled = false;

    async function run() {
      const next: Record<string, boolean> = {};
      for (const v of rows) {
        const id = vendorKey(v);
        if (!id) continue;
        if (Object.prototype.hasOwnProperty.call(vendorAvailabilityById, id)) continue;

        const open = await probeVendorAvailability(id);
        if (cancelled) return;
        next[id] = open;
      }

      if (!cancelled && Object.keys(next).length > 0) {
        setVendorAvailabilityById((prev) => ({ ...prev, ...next }));
      }
    }

    run().catch(() => undefined);

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleVendors, vendorAvailabilityById]);

  useEffect(() => {
    writeLocal(LS_TAKEOUT_CUSTOMER_NAME, customerName);
  }, [customerName]);

  useEffect(() => {
    writeLocal(LS_TAKEOUT_CUSTOMER_PHONE, customerPhone);
  }, [customerPhone]);


  useEffect(() => {
    getJson("/api/admin/vendors")
      .then((j) => {
        const rows = Array.isArray(j?.vendors) ? j.vendors : Array.isArray(j?.data) ? j.data : [];
        // JRIDE_TAKEOUT_KEEP_CLOSED_VENDORS_VISIBLE_V1
        // Do not filter out vendors only because accepting_orders=false.
        // Closed vendors must remain visible in the passenger marketplace,
        // then vendorCardIsOpen/isVendorAcceptingOrders controls dimming and clickability.
        setVendors(rows);
      })
      .catch(() => setVendors([]));
  }, []);

  useEffect(() => {
    if (!vendorTownFilter) {
      if (vendorId) {
        setVendorId("");
        setQty({});
        setMenu([]);
        setVendorClosed(false);
        setMenuVendorProfile(null);
        setMenuErr(null);
        setPremiumPackagingSelections({});
        setReceiptRequested(false);
        setSubmitted(false);
      }
      return;
    }

    if (!vendorId) return;

    const stillAllowed = visibleVendors.some((v) => vendorKey(v) === vendorId);
    if (!stillAllowed) {
      setVendorId("");
      setQty({});
      setMenu([]);
      setVendorClosed(false);
      setMenuVendorProfile(null);
      setMenuErr(null);
      setPremiumPackagingSelections({});
      setReceiptRequested(false);
      setSubmitted(false);
    }
  }, [vendorTownFilter, vendorId, visibleVendors]);

  // Auto refresh menu when vendorId changes (debounced-ish)
  useEffect(() => {
    const t = setTimeout(() => {
      refreshMenu().catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  // JRIDE_TAKEOUT_AUTO_REFRESH_STATUS_V1
  // Poll only the takeout menu availability contract. This does not call ride, dispatch, fare, or lifecycle routes.
  useEffect(() => {
    const vid = String(vendorId || "").trim();
    if (!vid) return;
    const t = window.setInterval(() => {
      refreshMenu(vid, true).catch(() => undefined);
    }, 10000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  // JRIDE_TAKEOUT_PASSENGER_ORDER_STATUS_POLL_V1
  // Poll only the passenger takeout order read endpoint after submission so the passenger
  // sees driver fee proposals and later takeout progress updates. This remains isolated
  // from ride, dispatch, wallet, lifecycle, and driver routes.
  useEffect(() => {
    if (!submitted || !deviceKey) return;

    const orderStatus = normText(pricingOrder?.customer_status || pricingOrder?.vendor_status || "").toLowerCase();
    if (orderStatus === "completed" || orderStatus === "cancelled") return;

    let stopped = false;
    const poll = () => {
      if (stopped) return;
      refreshPricingOrder(pricingOrder).catch(() => undefined);
    };

    poll();
    const t = window.setInterval(poll, 5000);
    return () => {
      stopped = true;
      window.clearInterval(t);
    };
    // The pricing order and lastJson dependencies are intentional: the poller must switch
    // from device fallback to the exact order_id/booking_code as soon as the submit
    // response is available, and it must continue after fee confirmation until the takeout
    // order reaches completed or cancelled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitted, deviceKey, pricingOrder?.id, pricingOrder?.booking_code, pricingOrder?.takeout_pricing_status, pricingOrder?.vendor_status, pricingOrder?.customer_status, lastJson?.order_id, lastJson?.booking_code]);

  async function saveAddressToDb(addressText: string, makePrimary: boolean, pinOverride?: DeliveryPin | null) {
    const addr = cleanDeliveryAddressLabel(addressText);
    if (!addr) throw new Error("Address required");

    const pin = pinOverride ?? deliveryPin;
    if (!pin) throw new Error("Exact delivery pin required before saving address");

    await postJson("/api/passenger-addresses", {
      device_key: deviceKey,
      address_text: addr,
      is_primary: makePrimary,
      lat: pin.lat,
      lng: pin.lng,
      dropoff_lat: pin.lat,
      dropoff_lng: pin.lng,
      delivery_pin_lat: pin.lat,
      delivery_pin_lng: pin.lng,
      delivery_pin_label: deliveryPinLabel(pin),
      delivery_pin_coordinates: deliveryPinCoordinateText(pin),
    });

    await refreshAddresses(deviceKey);
  }

  async function makePrimaryExisting(id: string) {
    const row = saved.find((a) => a.id === id);
    if (!row) return;

    const savedPin = addressToDeliveryPin(row);
    if (!savedPin) {
      setSelectedAddressId(String(row.id || ""));
      setAddrMode("saved");
      setDeliveryPin(null);
      setShowDeliveryPin(true);
      setAddrErr("This saved address has no map pin yet. Please set the exact delivery pin before making it primary.");
      return;
    }

    await saveAddressToDb(row.address_text, true, savedPin);
  }

  function normalizeTakeoutOrders(j: any): TakeoutPricingOrder[] {
    if (Array.isArray(j)) return j as TakeoutPricingOrder[];
    if (j?.order && typeof j.order === "object") return [j.order as TakeoutPricingOrder];
    if (j?.data && !Array.isArray(j.data) && typeof j.data === "object") return [j.data as TakeoutPricingOrder];
    if (Array.isArray(j?.orders)) return j.orders as TakeoutPricingOrder[];
    if (Array.isArray(j?.data)) return j.data as TakeoutPricingOrder[];
    if (Array.isArray(j?.bookings)) return j.bookings as TakeoutPricingOrder[];
    return [];
  }

  function findPricingOrder(rows: TakeoutPricingOrder[], current: TakeoutPricingOrder | null, createdId: string): TakeoutPricingOrder | null {
    const keys = new Set<string>();
    const currentKey = takeoutOrderId(current);
    if (currentKey) keys.add(currentKey);
    if (createdId) keys.add(createdId);
    if (keys.size) {
      const hit = rows.find((r) => {
        const id = normText(r.id);
        const code = normText(r.booking_code || r.code);
        return keys.has(id) || keys.has(code);
      });
      if (hit) return hit;
    }
    return rows[0] || null;
  }

  async function refreshPricingOrder(current: TakeoutPricingOrder | null = pricingOrder) {
    const dk = normText(deviceKey);
    if (!dk) return;
    setPricingBusy(true);
    setPricingErr(null);
    try {
      const createdId = normText(
        takeoutOrderId(current) ||
          lastJson?.order_id ||
          lastJson?.orderId ||
          lastJson?.booking_id ||
          lastJson?.bookingId ||
          lastJson?.id ||
          lastJson?.booking_code ||
          lastJson?.bookingCode
      );
      const bookingCode = normText(current?.booking_code || current?.code || lastJson?.booking_code || lastJson?.bookingCode || lastJson?.code);
      const qs = createdId
        ? "order_id=" + encodeURIComponent(createdId)
        : bookingCode
          ? "booking_code=" + encodeURIComponent(bookingCode)
          : "device_key=" + encodeURIComponent(dk);
      const j = await getJson("/api/takeout/orders?" + qs);
      const rows = normalizeTakeoutOrders(j);
      const found = findPricingOrder(rows, current, createdId);
      if (found) setPricingOrder(found);
    } catch (e: any) {
      setPricingErr(String(e?.message || e || "Failed to refresh takeout pricing."));
    } finally {
      setPricingBusy(false);
    }
  }

  async function confirmTakeoutFee() {
    if (!pricingOrder) return;
    const orderId = normText(pricingOrder.id);
    const bookingCode = normText(pricingOrder.booking_code || pricingOrder.code);
    if (!orderId && !bookingCode) {
      setPricingErr("Missing takeout order id.");
      return;
    }
    setConfirmBusy(true);
    setPricingErr(null);
    try {
      const j = await postJson("/api/takeout/confirm-fee", {
        order_id: orderId || undefined,
        booking_code: bookingCode || undefined,
        confirm: true,
      });
      const next = (j?.order || j?.data || j?.proposal || null) as TakeoutPricingOrder | null;
      if (next) setPricingOrder(next);
      setResult("Takeout total confirmed. Driver is now assigned.");
    } catch (e: any) {
      setPricingErr(String(e?.message || e || "Failed to confirm takeout total."));
    } finally {
      setConfirmBusy(false);
    }
  }

  function setItemQty(id: string, nextQty: number) {
    setSubmitted(false);

    const item = (menu || []).find((m: any) => String(m?.id || "") === String(id || ""));
    const rawRemaining = (item as any)?.remaining_quantity;
    const hasRemainingLimit = rawRemaining !== null && rawRemaining !== undefined && String(rawRemaining).trim() !== "";
    const remainingLimit = hasRemainingLimit ? Math.max(0, Math.floor(toNum(rawRemaining))) : 99;
    const cappedQty = Math.max(0, Math.min(remainingLimit, Math.floor(toNum(nextQty))));

    setQty((q) => ({ ...q, [id]: cappedQty }));
  }

  async function submit() {
    try {
      if (vendorClosed) {
        setResult("Cannot place order: vendor is currently closed. Please try again later.");
        return;
      }

      if (authState !== "signed_in_profile" || !customerName.trim() || !customerPhone.trim()) {
        setResult("Only signed-in verified passengers with profile name and phone can place takeout orders.");
        return;
      }

      if (!deliveryPin) {
        setResult("Please set the exact delivery location on the map before placing the order.");
        setShowDeliveryPin(true);
        return;
      }

      setBusy(true);
      setResult("");
      setLastJson(null);

      const addressText = resolvedDeliveryAddress || deliveryPinLabel(deliveryPin);

      // Persist address to DB if requested (ONLY in "new" mode)
      if (addrMode === "new" && saveAddr && newAddr.trim()) {
        await saveAddressToDb(addressText, !!setPrimary);
        if (setPrimary) setAddrMode("saved");
      }      // PHASE 2D: build structured items[] for snapshot lock (menu edits must NOT affect history)
      const menuById: Record<string, any> = {};
      try {
        for (const m of (Array.isArray(menu) ? menu : [])) {
          const id = String((m as any)?.menu_item_id || (m as any)?.id || "").trim();
          if (id) menuById[id] = m;
        }
      } catch {}

      const itemsSnapshot = (Array.isArray(selectedLines) ? selectedLines : [])
        .map((l: any) => {
          const mid = String(l?.menu_item_id || l?.menuItemId || l?.id || l?.item_id || "").trim();
          const mm = mid ? menuById[mid] : null;

          const name = String(l?.name || mm?.name || "").trim();
          const price = Number(mm?.price ?? l?.price ?? l?.unit_price ?? 0);
          const qtyRaw = l?.quantity ?? l?.qty ?? l?.count ?? 1;
          const qty = Math.max(1, parseInt(String(qtyRaw), 10) || 1);

          if (!name) return null;

          return {
            menu_item_id: mid || null,
            name,
            price: Number.isFinite(price) ? price : 0,
            quantity: qty,
            packaging_note: String(mm?.packaging_note || l?.packaging_note || "").trim() || null,
          };
        })
        .filter(Boolean);


      // Snapshot payload (menu): Phase 2D will lock this into bookings later
      const payload = {
        // PHASE_3D_TAKEOUT_COORDS_FIX (payload-only; enables server-side dropoff coords)
        device_key: deviceKey,
        deviceKey: deviceKey,
        address_id: (addrMode === "saved" ? (primary?.id || null) : null),
        addressId: (addrMode === "saved" ? (primary?.id || null) : null),
        vendor_id: vendorId.trim(),
        vendorId: vendorId.trim(),
        service_type: "takeout",
        vendor_status: "preparing",

        customer_name: customerName.trim(),
        customerName: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customerPhone: customerPhone.trim(),

        to_label: addressText,
        toLabel: addressText,
        dropoff_lat: deliveryPin?.lat ?? null,
        dropoff_lng: deliveryPin?.lng ?? null,
        delivery_pin_lat: deliveryPin?.lat ?? null,
        delivery_pin_lng: deliveryPin?.lng ?? null,
        delivery_pin_label: deliveryPin ? deliveryPinLabel(deliveryPin) : null,
        delivery_pin_coordinates: deliveryPin ? deliveryPinCoordinateText(deliveryPin) : null,

        // Human readable (helps vendor UI today)
        items_text: itemsText,
        items: itemsSnapshot,
        // JSON snapshot for future order-lock (harmless if ignored)
        items_json: itemsJson,
        itemsJson: itemsJson,

        // Client-only item subtotal estimate
        estimated_items_subtotal: itemsSubtotal,
        premium_packaging_selected: premiumPackagingSelected,
        premium_packaging_fee: packagingEstimate,
        premium_packaging_label: premiumPackagingSelected ? premiumPackagingLabel : null,
        cash_collection_required: cashCollectionRequired,
        takeout_cash_collection_required: cashCollectionRequired,
        receipt_requested: receiptRequested,
        request_vendor_receipt: receiptRequested,
        order_preferences: {
          premium_packaging_selected: premiumPackagingSelected,
          premium_packaging_fee: packagingEstimate,
          premium_packaging_label: premiumPackagingSelected ? premiumPackagingLabel : null,
          cash_collection_required: cashCollectionRequired,
          receipt_requested: receiptRequested,
        },

        note: [
          note.trim(),
          cashCollectionRequired ? "Cash collection required: driver will collect the cash payment from the passenger before vendor purchase." : "",
          premiumPackagingSelected ? "Premium packaging requested: " + premiumPackagingLabel + " (" + money(packagingEstimate) + ")" : "",
          receiptRequested ? "Vendor receipt requested." : "",
        ].filter(Boolean).join("\n"),
      };

      const j = await postJson("/api/vendor-orders", payload);
      setLastJson(j);

      const maybeId =
        j?.order_id || j?.orderId || j?.booking_id || j?.bookingId || j?.id || "";

      const maybeCode = normText(j?.booking_code || j?.bookingCode || j?.code);

      // JRIDE_TAKEOUT_TRACKING_PAGE_ISOLATION_V5
      // After order creation, separate booking from live tracking.
      // This avoids stacking booking form, pricing, progress, completion, and debug JSON in one long page.
      const trackingKey = normText(maybeCode || maybeId);
      if (trackingKey && typeof window !== "undefined") {
        window.location.href = "/takeout/track/" + encodeURIComponent(trackingKey);
        return;
      }
      setResult("Order sent. Keep this screen open. Your order is not final until you approve the driver delivery fee." + (maybeId ? " ID: " + String(maybeId) : ""));
      setPricingOrder({
        id: normText(maybeId) || null,
        booking_code: maybeCode || null,
        takeout_pricing_status: "pricing_pending",
        total_bill: estimatedSubtotalWithPackaging,
        takeout_items_subtotal: itemsSubtotal,
      });
      setPricingErr(null);
      setQty({});
      setSubmitted(true);
      setMenu([]);
      setVendorId("");
      setNote("");
      setPremiumPackagingSelections({});
      setReceiptRequested(false);
    } catch (e: any) {
      const msg = String(e?.message || "Unknown error");
      if (msg.includes("closed") || msg.includes("unavailable") || msg.includes("TAKEOUT_VENDOR_CLOSED")) {
        setVendorClosed(true);
      }
      setResult("Create takeout order failed: " + msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md overflow-x-hidden px-2.5 py-2 pb-28 sm:max-w-7xl sm:px-4 md:p-6 md:pb-40 2xl:max-w-[1500px]">
      <div className="sticky top-0 z-20 -mx-2.5 -mt-2 flex items-center justify-between gap-2 border-b bg-white/95 px-3 py-2 shadow-sm backdrop-blur sm:static sm:mx-0 sm:mt-0 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none">
        <div>
          <div className="jride-premium-brand-row">
            <a href="/passenger" className="jride-premium-nav-pill" aria-label="Go to JRide passenger home">Home</a>
            <div className="jride-premium-title">JRide <span>Takeout</span></div>
          </div>
          <div className="hidden text-sm text-slate-600 sm:block">
            Choose a vendor, pick your items, then confirm the delivery fee after a driver proposal.
          </div>
        </div>
        <a href="/takeout/orders" className="shrink-0 rounded-full border px-3 py-1.5 text-center text-xs font-bold hover:bg-slate-50 sm:w-auto sm:rounded-lg sm:py-3 sm:text-sm">
          My orders
        </a>
      </div>

      <div className="mt-4">
        {authState === "guest" ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Sign in required</div>
                <div className="text-xs">Only verified JRide passengers with profile name and phone can place takeout orders.</div>
              </div>
              <a href="/passenger-login?callbackUrl=/takeout" className="rounded bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
                Sign in to book
              </a>
            </div>
          </div>
        ) : authState === "signed_in_missing_profile" ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <div className="font-semibold">Verified passenger profile required</div>
            <div className="text-xs">We could not load a complete verified passenger profile with name and phone. Booking is blocked until the profile is fixed.</div>
          </div>
        ) : authState === "signed_in_profile" ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 sm:text-sm">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 font-semibold">Verified passenger</div>
              <button
                type="button"
                onClick={logoutPassengerProfile}
                className="shrink-0 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                Logout
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border bg-white p-2.5 shadow-md sm:mt-4 sm:p-5">
        <div className="jride-takeout-form-grid grid gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] md:gap-5">
          <div className="jride-town-and-vendors space-y-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">{vendorTownFilter ? "Current town" : "Step 1"}</div>
                  <label className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Choose your delivery town</label>
                </div>
                <span className="rounded-full border border-emerald-700/40 bg-emerald-950/60 px-2.5 py-1 text-[10px] font-black text-emerald-100">
                  {vendorTownFilter ? vendorTownFilter + " selected" : "Not selected"}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-5 gap-1.5">
                {(["Lagawe", "Hingyon", "Banaue", "Lamut", "Kiangan"] as string[])
  .filter((town) => vendorTowns.includes(town as any))
  .map((town) => {
                  const active = vendorTownFilter === town;
                  return (
                    <button
                      key={town}
                      type="button"
                      onClick={() => {
                        const nextTown = normalizeTakeoutTown(town);
                        setVendorTownFilter(nextTown);
                        setVendorId("");
                        setQty({});
                        setMenu([]);
                        setVendorClosed(false);
                        setMenuVendorProfile(null);
                        setMenuErr(null);
                        setPremiumPackagingSelections({});
                        setReceiptRequested(false);
                        setSubmitted(false);
                        setResult("");
                        setLastJson(null);
                        setPricingOrder(null);
                      }}
                      className={cls(
                        "rounded-2xl border px-2 py-2 text-center text-xs font-black shadow-sm transition",
                        active
                          ? "border-emerald-300 bg-emerald-600 text-white shadow-emerald-950/30"
                          : "border-emerald-900/60 bg-slate-950/70 text-emerald-100 hover:border-emerald-400"
                      )}
                    >
                      <span className="block leading-tight">{town}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                Pick the delivery town first so nearby stores load faster.
              </div>
            </div>

            <div className="jride-vendor-menu-section space-y-2 md:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">{vendorId ? "Store selected" : "Step 2"}</div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Choose a store</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {vendorTownFilter ? "Select a restaurant or store to load its menu." : "Complete Step 1 to show available stores."}
                  </div>
                </div>
                {vendorTownFilter ? (
                  <div className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-800">
                    {visibleVendors.length} {visibleVendors.length === 1 ? "store" : "stores"}
                  </div>
                ) : null}
              </div>

              {!vendorTownFilter ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  <div className="font-semibold text-slate-900">Choose your town first.</div>
                  <div className="mt-1 text-xs">Nearby JRide Takeout vendors will appear here.</div>
                </div>
                            ) : activeVendors.length === 0 && comingSoonVendors.length === 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <div className="font-semibold">No vendors are listed for this town yet.</div>
                  <div className="mt-1 text-xs">Try another town or refresh again later.</div>
                </div>
              ) : (
                <div className={cls("jride-vendor-grid grid w-full min-w-0 max-w-full gap-4 overflow-hidden", vendorId ? "grid-cols-1 lg:max-w-[520px]" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4")}>
                  {/* JRIDE_TAKEOUT_SELECTED_VENDOR_FIRST_V2: after a store is selected, keep only that store above the menu so the menu appears directly below it. */}
                                    {(vendorId ? activeVendors.filter((v) => vendorKey(v) === vendorId) : activeVendors).map((v) => {
                    const id = vendorKey(v);
                    if (!id) return null;
                    const isSelected = vendorId === id;
                    const label = vendorLabel(v);
                    const town = vendorTown(v) || vendorTownFilter;
                    const isClosed = isSelected ? vendorClosed : !vendorCardIsOpen(v, vendorAvailabilityById);
                    const logoUrl = vendorUploadedLogoUrl(v);
                    const prep = prepMinutes((v as any).prep_time_minutes ?? (v as any).default_prep_time_minutes ?? 15);
                    const hasPremiumPackaging = v.premium_packaging_enabled === true;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={isClosed}
                        aria-disabled={isClosed}
                        title={isClosed ? "This vendor is closed right now." : "View this vendor menu."}
                        onClick={() => {
                          if (isClosed) return;
                          const nextVendorId = id;
                          setVendorId(nextVendorId);
                          setQty({});
                          setPremiumPackagingSelections({});
                          setReceiptRequested(false);
                          setSubmitted(false);
                          refreshMenu(nextVendorId);
                        }}
                        className={cls(
                          "group flex min-h-[92px] w-full min-w-0 max-w-full overflow-hidden items-start gap-2 rounded-xl border p-2 text-left shadow-[0_8px_20px_rgba(0,0,0,0.14)] transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[170px] sm:gap-4 sm:rounded-3xl sm:p-5 sm:shadow-[0_18px_50px_rgba(0,0,0,0.22)] sm:max-w-none",
                          isClosed
                            ? "border-slate-800 bg-slate-950/50 text-slate-400 grayscale"
                            : isSelected
                              ? "border-emerald-400 bg-emerald-950 text-white ring-2 ring-emerald-300/30"
                              : "border-emerald-900/70 bg-slate-950/80 text-white hover:border-emerald-400"
                        )}
                      >
                        <div className="mt-0.5 h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-emerald-500/40 bg-slate-950 sm:mt-1 sm:h-20 sm:w-20 sm:rounded-3xl">
                          {logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={logoUrl} alt={`${label} logo`} className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] font-extrabold uppercase tracking-[0.12em] text-emerald-200">
                              No logo uploaded
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                            <div className="min-w-0">
                              <div className="line-clamp-2 break-words text-base font-black leading-tight text-white sm:text-xl">
                                {label}
                              </div>
                              <div className="mt-0.5 text-xs font-semibold text-emerald-100 sm:mt-1 sm:text-sm">
                                {town}
                              </div>
                            </div>

                            <span
                              className={cls(
                                "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black",
                                isClosed
                                  ? "border-rose-300/70 bg-rose-500/10 text-rose-100"
                                  : "border-emerald-400/60 bg-emerald-500/15 text-emerald-100"
                              )}
                            >
                              {isClosed ? "Closed" : "Open"}
                            </span>
                          </div>

                          <p className="mt-1 hidden line-clamp-2 max-w-2xl text-sm leading-relaxed text-slate-300 sm:mt-3 sm:block">
                            {String((v as any).tagline || (v as any).description || "").trim() || "Fresh local meals and takeout favorites delivered to your location."}
                          </p>

                          <div className="mt-2 flex flex-row flex-wrap items-center gap-1.5 sm:mt-4 sm:gap-3">
                            <span className="rounded-full border border-emerald-500/40 bg-slate-950/70 px-2 py-1 text-[10px] font-bold text-emerald-100 sm:px-3 sm:py-1.5 sm:text-xs">
                              Prep time: {prep} min
                            </span>
                            {hasPremiumPackaging ? (
                              <span className="rounded-full border border-amber-300/50 bg-amber-300/10 px-2 py-1 text-[10px] font-bold text-amber-100 sm:px-3 sm:py-1.5 sm:text-xs">
                                Premium packaging
                              </span>
                            ) : null}
                            <span className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs font-black text-emerald-100 sm:ml-auto">
                              {isSelected ? "Viewing menu" : "Browse menu"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              {comingSoonVendors.length > 0 && !vendorId ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-black text-slate-900">Coming soon</div>
                      <div className="text-[11px] text-slate-500">These partner vendors are queued for the next takeout batch.</div>
                    </div>
                    <div className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600">
                      {comingSoonVendors.length} {comingSoonVendors.length === 1 ? "store" : "stores"}
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {comingSoonVendors.map((v: any) => {
                      const id = vendorKey(v);
                      const label = vendorLabel(v);
                      const logoUrl = vendorUploadedLogoUrl(v);

                      return (
                        <div key={id || label} className="flex min-h-[78px] items-center gap-2 rounded-xl border border-slate-200 bg-white p-2 opacity-70 grayscale">
                          <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            {logoUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={logoUrl} alt={`${label} logo`} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center px-1 text-center text-[8px] font-extrabold uppercase tracking-[0.08em] text-slate-500">
                                No logo
                              </div>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="line-clamp-2 text-sm font-black leading-tight text-slate-700">{label}</div>
                            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Coming soon</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
		{/* PHASE2B_MENU_CONSUMPTION */}
          <div className="jride-menu-section w-full min-w-0 md:col-span-2">
            {/* JRIDE_TAKEOUT_DESKTOP_FULL_WIDTH_V16 */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-500">{vendorId ? "Menu" : "Step 3"}</div>
                <div className="text-lg font-black tracking-tight text-slate-900">
                  Browse menu
                </div>
                <div className="hidden text-xs text-slate-500 sm:block">
                  {vendorId.trim() ? "Choose meals, drinks, and add-ons." : "Complete Step 2 to load a store menu."}
                </div>
              </div>
              {vendorId.trim() ? (
                <button
                  type="button"
                  onClick={() => refreshMenu().catch(() => undefined)}
                  className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 sm:rounded sm:px-4 sm:py-2 sm:text-base"
                  disabled={menuBusy}
                >
                  {menuBusy ? "Loading..." : "Refresh menu"}
                </button>
              ) : null}
            </div>

            {menuErr ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{menuErr}</div>
            ) : null}


            {!vendorId.trim() ? (
              <div className="mt-2 rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Choose a store first.</div>
                <div className="mt-1 text-xs text-slate-500">Today's menu, preparation time, and item availability will appear here.</div>
              </div>
            ) : menuBusy ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">Loading menu...</div>
            ) : menuSelectable.length === 0 ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">
                No menu items available today.
              </div>
            ) : (
              <>
              {/* JRIDE_TAKEOUT_STICKY_MENU_CONTROLS_V24 */}
              <div className="sticky top-[76px] z-30 -mx-1 mt-2 rounded-2xl border border-emerald-900/40 bg-slate-950/95 p-1.5 shadow-lg backdrop-blur sm:static sm:top-auto sm:z-auto sm:mx-0 sm:mt-3 sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none sm:backdrop-blur-0">
                <div className="grid grid-cols-[minmax(0,1fr)_128px] gap-1.5 sm:grid-cols-[minmax(0,1fr)_180px] sm:gap-2">
                  <label className="block min-w-0">
                    <span className="sr-only">Search menu items</span>
                    <input
                      value={menuSearchTerm}
                      onChange={(e) => setMenuSearchTerm(e.target.value)}
                      placeholder="Search menu items"
                      className="h-9 w-full rounded-full border border-emerald-900/60 bg-slate-950/70 px-3 text-xs font-semibold text-emerald-50 outline-none placeholder:text-slate-400 focus:border-emerald-400 sm:h-auto sm:px-4 sm:py-2 sm:text-sm"
                    />
                  </label>
                  <label className="block min-w-0">
                    <span className="sr-only">Sort menu items</span>
                    <select
                      value={menuSortMode}
                      onChange={(e) => setMenuSortMode(e.target.value as typeof menuSortMode)}
                      className="h-9 w-full rounded-full border border-emerald-900/60 bg-slate-950/70 px-2 text-xs font-bold text-emerald-50 outline-none focus:border-emerald-400 sm:h-auto sm:px-4 sm:py-2 sm:text-sm"
                    >
                      <option value="recommended">Recommended</option>
                      <option value="price_asc">Price low to high</option>
                      <option value="price_desc">Price high to low</option>
                      <option value="prep_fast">Prep time fastest</option>
                      <option value="name_asc">Name A-Z</option>
                    </select>
                  </label>
                </div>

                <div className="mt-1.5 flex gap-1.5 overflow-x-auto pb-0.5 sm:mt-3 sm:flex-wrap sm:gap-2 sm:overflow-visible sm:pb-1">
                  {visibleMenuCategories.map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setMenuCategoryFilter(cat)}
                      className={cls(
                        "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-black sm:px-3 sm:py-1.5 sm:text-xs",
                        menuCategoryFilter === cat
                          ? "border-emerald-300 bg-emerald-600 text-white"
                          : "border-emerald-900/60 bg-slate-950/70 text-emerald-100"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {filteredMenuSelectable.length === 0 ? (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-300">
                  No menu items match this category or search.
                </div>
              ) : null}

              {/* JRIDE_TAKEOUT_DYNAMIC_MENU_CATEGORIES_V17 */}
              <div className="jride-menu-grid mt-2 grid w-full min-w-0 grid-cols-1 gap-1.5 sm:mt-4 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {filteredMenuSelectable.map((m) => {
                  const q = Math.max(0, Math.floor(toNum(qty[m.id])));
                  const rawRemaining = (m as any)?.remaining_quantity;
                  const hasRemainingLimit = rawRemaining !== null && rawRemaining !== undefined && String(rawRemaining).trim() !== "";
                  const remainingLimit = hasRemainingLimit ? Math.max(0, Math.floor(toNum(rawRemaining))) : 99;
                  const plusDisabled = q >= remainingLimit;
                  const disabled = vendorClosed || !m._available || (hasRemainingLimit && remainingLimit <= 0);
                  return (
                    <div
                      key={m.id}
                      className={cls(
                        "flex min-h-[124px] w-full min-w-0 overflow-hidden flex-col justify-between rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm transition hover:border-emerald-200 hover:shadow-md sm:min-h-[245px] sm:rounded-2xl sm:p-3.5",
                        disabled ? "bg-slate-50 opacity-70" : "bg-white"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start gap-2 sm:gap-3">
                          {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-10 w-10 shrink-0 rounded-lg border object-cover shadow-sm sm:h-[70px] sm:w-[70px] sm:rounded-xl" /> : null}
                          <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-col items-start gap-1">
                          <div className="line-clamp-2 break-words text-sm font-extrabold leading-tight tracking-tight text-slate-900 sm:text-lg">{m.name}</div>
                          {m.sold_out_today ? (
                            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700">Sold out</span>
                          ) : null}
                          {m.is_available === false ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Unavailable</span>
                          ) : null}
                        </div>
                        {m.description ? (
                          <div className="mt-0.5 min-w-0 break-words line-clamp-1 text-[11px] leading-snug text-slate-600 sm:mt-1 sm:line-clamp-2 sm:text-xs">{m.description}</div>
                        ) : null}
                        <div className="mt-1 inline-flex max-w-full self-start break-words rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold text-slate-700 sm:mt-2 sm:px-2.5 sm:text-[10px]">Prep time: {prepMinutes(m.prep_time_minutes)} min</div>
                        {Number(m.remaining_quantity) > 0 ? (
                          <div className="mt-0.5 text-[10px] font-semibold text-emerald-700 sm:mt-1 sm:text-[11px]">Remaining today: {Number(m.remaining_quantity)}</div>
                        ) : null}
                        {m.packaging_note ? (
                          <div className="mt-0.5 line-clamp-1 rounded-lg border border-amber-200 bg-amber-50 px-1.5 py-1 text-[10px] font-medium leading-tight text-amber-800 sm:mt-2 sm:line-clamp-2 sm:rounded-xl sm:p-2 sm:text-[11px]">
                            Packaging: {m.packaging_note}
                          </div>
                        ) : null}
                        {itemPremiumPackagingEnabled(m) ? (
                          <label className="mt-0.5 flex min-w-0 max-w-full cursor-pointer items-center gap-1 overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 px-1.5 py-1 text-[10px] font-semibold leading-tight text-emerald-800 sm:mt-2 sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2 sm:text-xs">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={premiumPackagingSelections[m.id] === true}
                              disabled={disabled}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                if (checked && q <= 0) setItemQty(m.id, 1);
                                setItemPremiumPackaging(m.id, checked);
                              }}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="line-clamp-2 break-words font-semibold">
                                Add {itemPremiumPackagingLabel(m)} (+{money(itemPremiumPackagingFee(m))} each)
                              </span>
                            </span>
                          </label>
                        ) : null}
                        <div className="mt-1 text-lg font-black tracking-tight text-slate-900 sm:mt-3 sm:text-xl">{money(toNum(m.price))}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-1 grid w-full grid-cols-[32px_minmax(64px,1fr)_32px] items-center gap-1 sm:mt-4 sm:grid-cols-[42px_minmax(80px,1fr)_42px] sm:gap-2">
                        <button
                          type="button"
                          className="h-8 w-8 rounded-full border bg-white text-xs font-black shadow-sm hover:bg-black/5 disabled:opacity-50 sm:h-10 sm:w-10 sm:text-sm"
                          disabled={disabled || q <= 0}
                          onClick={() => setItemQty(m.id, q - 1)}
                        >
                          -
                        </button>
                        <input
                          className="h-8 w-full rounded-full border px-2 text-center text-xs font-black sm:h-10 sm:text-sm"
                          value={String(q)}
                          onChange={(e) => setItemQty(m.id, Number(e.target.value))}
                          disabled={disabled}
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          className="h-8 w-8 rounded-full border bg-white text-xs font-black shadow-sm hover:bg-black/5 disabled:opacity-50 sm:h-10 sm:w-10 sm:text-sm"
                          disabled={disabled || plusDisabled}
                          title={plusDisabled ? "No more stock remaining for this item today." : "Add one"}
                          onClick={() => setItemQty(m.id, q + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}

            {selectedLines.length > 0 ? (
              <div className="mt-2 rounded-xl border border-slate-200 bg-white p-2.5 text-sm shadow-sm sm:mt-3 sm:p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">Estimated subtotal</div>
                  <div className="font-semibold">{money(estimatedSubtotalWithPackaging)}</div>
                </div>
                {packagingEstimate > 0 ? (
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-700">
                    <span>{premiumPackagingLabel}</span>
                    <span>{money(packagingEstimate)}</span>
                  </div>
                ) : null}
                <div className="mt-1 text-[11px] text-slate-600">
                  {vendorClosed ? "Ordering is disabled because this vendor is closed." : "Items estimate only. The delivery fee follows after a driver proposal."}
                </div>
              </div>
            ) : null}

            {cashCollectionRequired ? (
              <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 shadow-sm">
                <div className="font-bold">Cash collection required.</div>
                <div className="mt-1">
                  Because this order exceeds PHP 500, your driver will collect the cash payment from you before proceeding to the vendor purchase.
                </div>
              </div>
            ) : null}

            {selectedLines.length > 0 ? (
              <details className="mt-2 rounded-xl border bg-white p-2.5 text-sm sm:mt-3 sm:p-3">
                <summary className="cursor-pointer font-medium">Packaging and receipt options</summary>
                <div className="mt-2 space-y-2 text-xs text-slate-700">
                  <div className="rounded-lg border bg-slate-50 p-2">Default item packaging is shown per menu item when the vendor provided a note.</div>
                  {packagingEstimate > 0 ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
                      Premium packaging selected: {money(packagingEstimate)}
                    </div>
                  ) : null}
                  <label className="flex items-start gap-2 rounded-lg border p-2">
                    <input type="checkbox" checked={receiptRequested} onChange={(e) => setReceiptRequested(e.target.checked)} />
                    <span>
                      <span className="block font-semibold">Request vendor receipt</span>
                      <span className="block text-slate-500">The vendor will see this request on the order queue.</span>
                    </span>
                  </label>
                </div>
              </details>
            ) : null}

            {itemsText ? (
              <details className="mt-3 rounded border bg-white p-3">
                <summary className="cursor-pointer text-sm font-medium">Menu snapshot (what will be sent)</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-800">{itemsText}</pre>
              </details>
            ) : null}
          </div>
            </div>
          </div>

          {vendorClosed ? (
            <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <div className="font-semibold">Vendor is currently closed</div>
              <div className="mt-1 text-xs">Please try again later. New orders are blocked until the vendor reopens.</div>
            </div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-slate-700">Verified passenger name (required)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              readOnly={authState === "signed_in_profile"}
              placeholder=""
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Verified passenger phone (required)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerPhone}
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
                setCustomerPhone(digitsOnly);
              }}
              readOnly={authState === "signed_in_profile"}
              placeholder="09xx..."
            />
          </div>

          {autofillNote && authState !== "signed_in_profile" ? (
  <div
    className={cls(
      "md:col-span-2 rounded border p-2 text-xs",
      authState === "guest"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-sky-200 bg-sky-50 text-sky-900"
    )}
  >
    {autofillNote}
  </div>
) : null}

          {/* JRIDE_TAKEOUT_AUTH_STATE_V4 */}
          {/* JRIDE_TAKEOUT_PASSENGER_AUTOFILL_V1 */}
          {/* JRIDE_TAKEOUT_DELIVERY_PIN_MAP_V1 */}
          {/* PHASE2B0_ADDRESS_PICKER_DB */}
          <div className="w-full min-w-0 md:col-span-2">
            {/* JRIDE_TAKEOUT_DESKTOP_FULL_WIDTH_V15 */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Delivery details</label>
              <button
                type="button"
                onClick={() => refreshAddresses().catch(() => undefined)}
                className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 sm:rounded sm:px-4 sm:py-2 sm:text-base"
                disabled={addrBusy}
              >
                {addrBusy ? "Refreshing..." : "Refresh saved"}
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="addrMode"
                  checked={addrMode === "saved"}
                  onChange={() => setAddrMode("saved")}
                  disabled={saved.length === 0}
                />
                <span>Use saved address</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="addrMode"
                  checked={addrMode === "new"}
                  onChange={() => setAddrMode("new")}
                />
                <span>Enter a new address</span>
              </label>
            </div>

            {addrErr ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                {addrErr}
              </div>
            ) : null}

            {addrMode === "saved" ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm">
                {primary ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs font-semibold text-slate-700">Primary address</div>
                      {addressHasDeliveryPin(primary) ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Has map pin</span>
                      ) : (
                        <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Needs map pin</span>
                      )}
                    </div>
                    <div className="mt-1 text-sm text-slate-900">{cleanDeliveryAddressLabel(primary.address_text)}</div>
                    {!addressHasDeliveryPin(primary) ? (
                      <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">
                        This saved address is text-only. Driver navigation uses the exact map location below. Set the pin before placing the order.
                      </div>
                    ) : null}

                    {saved.length > 1 ? (
                      <div className="mt-3">
                        <div className="text-[11px] font-medium text-slate-600">Other saved addresses</div>
                        <div className={cls("mt-2 space-y-2", vendorClosed && "opacity-60")}>
                          {saved.filter((a) => a.id !== primary.id).slice(0, 5).map((a) => (
                            <div key={a.id} className="flex items-start justify-between gap-2 rounded border bg-white p-2">
                              <div className="min-w-0">
                                <div className="text-xs text-slate-800">{cleanDeliveryAddressLabel(a.address_text)}</div>
                                {addressHasDeliveryPin(a) ? (
                                  <div className="mt-1 text-[10px] font-semibold text-emerald-700">Has map pin</div>
                                ) : (
                                  <div className="mt-1 text-[10px] font-semibold text-red-700">Needs map pin</div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAddressId(String(a.id || ""));
                                  setAddrMode("saved");
                                  const nextAddress = cleanDeliveryAddressLabel(String(a.address_text || a.label || ""));
                                  if (nextAddress) setNewAddr((prev) => prev.trim() ? prev : nextAddress);
                                  const savedPin = addressToDeliveryPin(a);
                                  if (savedPin) {
                                    setDeliveryPin(savedPin);
                                  } else {
                                    setDeliveryPin(null);
                                    setShowDeliveryPin(true);
                                  }
                                  makePrimaryExisting(a.id).catch(() => undefined);
                                }}
                                className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 sm:rounded sm:px-4 sm:py-2 sm:text-base"
                              >
                                Make primary
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-2 text-[11px] text-slate-600">(Pilot mode: tied to this device key)</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-700">
                    No saved address yet. Choose "Enter a new address".
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <textarea
                  className="w-full rounded border px-3 py-2 text-sm"
                  rows={2}
                  value={newAddr}
                  onFocus={() => setLocalLandmarkOpen(true)}
                  onChange={(e) => {
                    setNewAddr(e.target.value);
                    setLocalLandmarkOpen(true);
                    setSubmitted(false);
                  }}
                  placeholder="Search landmark, school, office, establishment, barangay, or address"
                />

                <div className="mt-1 text-[11px] text-slate-500">
                  Examples: Capitol, Municipal Hall, Public Market, TIMMAC, 7th Heaven, school, hospital, office.
                </div>

                {addrMode === "new" && localLandmarkOpen && localLandmarkSuggestions.length > 0 ? (
                  <div className="mt-2 overflow-hidden rounded border border-emerald-200 bg-white shadow-sm">
                    <div className="border-b bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                      Local landmark suggestions in {selectedTownForAddress}
                    </div>
                    {localLandmarkSuggestions.map((row) => (
                      <button
                        key={`${row.town}:${row.label}`}
                        type="button"
                        className="block w-full border-b px-3 py-2 text-left text-sm hover:bg-slate-50 last:border-b-0"
                        onClick={() => chooseLocalLandmark(row)}
                      >
                        <div className="font-semibold text-slate-900">{row.label}</div>
                        <div className="text-[11px] text-slate-500">{row.town}, Ifugao</div>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={saveAddr}
                      onChange={(e) => {
                        const v = !!e.target.checked;
                        setSaveAddr(v);
                        if (!v) setSetPrimary(false);
                      }}
                    />
                    <span>Save this address</span>
                  </label>

                  <label className={cls("inline-flex items-center gap-2", !saveAddr && "opacity-50")}>
                    <input
                      type="checkbox"
                      checked={setPrimary}
                      onChange={(e) => setSetPrimary(!!e.target.checked)}
                      disabled={!saveAddr}
                    />
                    <span>Set as primary</span>
                  </label>
                </div>

                <div className="mt-2 text-[11px] text-slate-600">
                  Tip: "Set as primary" makes it the default next time.
                </div>
              </div>
            )}

            {resolvedDeliveryAddress ? (
              <div className="mt-2 text-[11px] text-slate-600">
                Using: <span className="font-semibold">{resolvedDeliveryAddress}</span>
              </div>
            ) : null}

            <div
  		ref={deliveryPinSectionRef}
 		 className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5 sm:p-3"
		>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-extrabold text-slate-950">Exact delivery location</div>
                  <div className="text-[11px] font-medium text-slate-600">Set the exact drop-off pin so the driver goes to the correct spot.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
            setShowDeliveryPin((current) => {
             const next = !current;

             if (next) {
         requestAnimationFrame(() => {
        deliveryPinSectionRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
       });
       }

        return next;
      });
      }}
                  className="rounded-full border border-emerald-700 bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-800 sm:rounded sm:px-4 sm:py-2 sm:text-sm"
                >
                  {showDeliveryPin ? "Hide map" : deliveryPin ? "Change exact location" : "Set exact location"}
                </button>
              </div>
              {deliveryPin ? (
                <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                  Exact delivery location saved. Add a landmark in the address box if needed.
                </div>
              ) : (
                <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-300 bg-white px-3 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-black text-white">
                    !
                  </div>
                  <div>
                    <div className="text-sm font-extrabold text-slate-900">
                      Delivery location required before placing the order.
                    </div>
                    <div className="mt-1 text-xs text-slate-600">
                      Set your exact delivery location on the map to continue.
                    </div>
                  </div>
                </div>
              )}
              {showDeliveryPin ? (
                <div className="mt-3">
                  <div className="mb-3 rounded-xl border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-950">
                    Select your exact delivery location below. Move the map pin to your real drop-off point.
                  </div>
                    <DeliveryPinPicker
                    value={deliveryPin}
                    onChange={(next) => {
                      setDeliveryPin(next);
                      setSubmitted(false);
                      setDeliveryPinNeedsConfirmation(true);
                    }}
                  />

                  {deliveryPinNeedsConfirmation && deliveryPin ? (
                    <div className="mt-3 rounded-xl border border-emerald-300 bg-emerald-50 p-3">
                      <div className="text-sm font-bold text-emerald-900">
                        Pin selected
                      </div>
                      <div className="mt-1 text-xs text-emerald-800">
                        Review the map before continuing.
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                          onClick={() => {
                            setDeliveryPinNeedsConfirmation(false);
                            setShowDeliveryPin(false);
                          }}
                        >
                          Confirm location
                        </button>
                        <button
                          type="button"
                          className="rounded-lg border px-4 py-2 text-sm font-semibold"
                          onClick={() => {
  			// Keep the confirmation panel visible while the user adjusts the pin.
				}}
                        >
                          Adjust location
                        </button>
                      </div>
                    </div>
                  ) : null}
                      
                </div>
              ) : null}
            </div>

            
          </div>

          

          <details className="md:col-span-2 rounded-xl border bg-white p-2.5">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Add note (optional)</summary>
            <label className="sr-only">Note (optional)</label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any special instructions..."
            />
          </details>
        </div>

        {/* JRIDE_TAKEOUT_APP_LIKE_UI_V6 */}
        <div className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-md border-t bg-white/95 px-3 pb-[calc(0.55rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.16)] backdrop-blur sm:sticky sm:max-w-none sm:rounded-xl sm:border sm:p-3">
          {selectedLines.length > 0 ? (
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <div className="min-w-0">
                <div className="truncate font-bold text-slate-900">{selectedLines.length} item{selectedLines.length === 1 ? "" : "s"}</div>
                <div className="text-[11px] text-slate-500">Delivery fee follows after driver quote</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="text-[11px] text-slate-500">Subtotal</div>
                <div className="text-lg font-black text-slate-900">{money(estimatedSubtotalWithPackaging)}</div>
              </div>
            </div>
          ) : (
            <div className="mb-2 text-center">
              <div className="text-xs font-bold text-slate-900">Cart empty</div>
              <div className="mt-0.5 text-[11px] text-slate-500">Choose a menu item to begin.</div>
            </div>
          )}
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit || busy || submitted}
              className={cls(
                "rounded-xl px-3 py-2.5 text-sm font-black text-white shadow-md",
                canSubmit && !submitted ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-400"
              )}
            >
              {submitted ? "Order sent" : busy ? "Submitting order..." : vendorClosed ? "Vendor closed" : authState !== "signed_in_profile" ? "Sign in required" : "Continue"}
            </button>

            <a href="/takeout/orders" className="rounded-xl border px-3 py-2.5 text-center text-xs font-bold hover:bg-slate-50">
              Orders
            </a>
          </div>
          <div className="mt-1 text-center text-[10px] text-slate-500">
            Driver quote follows after checkout.
          </div>

          {vendorClosed ? (
            <div className="mt-1 text-[11px] font-medium text-rose-700">Cannot place order: vendor is closed.</div>
          ) : null}
        </div>

        {result && !["completed", "cancelled"].includes(normText(pricingOrder?.customer_status || pricingOrder?.vendor_status || "").toLowerCase()) ? (
          <div className="sticky bottom-3 z-20 mt-3 rounded-xl border border-slate-200 bg-white p-3 text-sm shadow-lg">{result}</div>
        ) : null}

        {submitted ? (
          <div className="mt-3 rounded border bg-white p-4 text-sm">
            <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
              <div>
                <div className="font-semibold text-slate-900">Order sent - keep this screen open</div>
                <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
                  Your order is not final yet. Wait for the driver delivery fee, then approve the total payable to continue.
                </div>
              </div>
              <button
                type="button"
                onClick={() => refreshPricingOrder().catch(() => undefined)}
                disabled={pricingBusy}
                className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
              >
                {pricingBusy ? "Refreshing..." : "Refresh"}
              </button>
            </div>

            {pricingErr ? (
              <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{pricingErr}</div>
            ) : null}

            {(() => {
              const order = pricingOrder;
              const status = normText(order?.takeout_pricing_status || "pricing_pending").toLowerCase();
              const vendorStatus = normText(order?.vendor_status || "").toLowerCase();
              const customerStatus = normText(order?.customer_status || "").toLowerCase();
              // JRIDE_TAKEOUT_PASSENGER_STATUS_CARD_CLEANUP_V4
              // Do not let stale customer_confirmed pricing status hide later vendor/customer progress.
              // Customer terminal states win, then vendor terminal states, then live vendor workflow, then customer status.
              const terminalStatus = ["completed", "cancelled"].includes(customerStatus)
                ? customerStatus
                : ["completed", "cancelled"].includes(vendorStatus)
                  ? vendorStatus
                  : "";
              const vendorWorkflowStatus = vendorStatus && !["requested", "vendor_pending"].includes(vendorStatus) ? vendorStatus : "";
              const progressStatus = terminalStatus || vendorWorkflowStatus || customerStatus || vendorStatus;
              const progressLabels: Record<string, string> = {
                requested: "Order submitted",
                vendor_pending: "Waiting for store confirmation",
                vendor_accepted: "Store confirmed",
                preparing: "Vendor preparing order",
                pickup_ready: "Order ready for pickup",
                driver_assigned: "Driver found",
                driver_fee_proposed: "Delivery quote ready",
                customer_confirmed: "Order confirmed",
                rider_arrived_vendor: "Driver arrived at vendor",
                arrived_vendor: "Driver arrived at vendor",
                picked_up: "Order picked up",
                delivering: "Driver delivering order",
                completed: "Order completed",
                cancelled: "Order cancelled",
              };
              const progressLabel = progressLabels[progressStatus] || (progressStatus ? progressStatus.replace(/_/g, " ") : "Waiting for driver update");
              const isOrderCompleted = progressStatus === "completed";
              const isOrderCancelled = progressStatus === "cancelled";
              const hasMovedPastCustomerConfirmation = ["rider_arrived_vendor", "arrived_vendor", "picked_up", "delivering", "completed", "cancelled"].includes(progressStatus);
              const foodSubtotal = toNum(order?.takeout_items_subtotal ?? order?.total_bill ?? itemsSubtotal);
              const deliveryFee = toNum(order?.takeout_delivery_fee);
              const serviceFee = toNum(order?.takeout_service_fee || 15);
              const totalPayable = toNum(order?.takeout_total_payable);
              const confirmationPackagingSubtotal = Math.max(
                0,
                toNum(order?.premium_packaging_fee),
                toNum(order?.order_preferences?.premium_packaging_fee),
                toNum(order?.takeout_pricing_snapshot?.packaging_subtotal),
                toNum(order?.takeout_pricing_snapshot?.takeout_packaging_subtotal),
                packagingEstimate
              );
              const expiresIn = secondsUntil(order?.takeout_fee_expires_at);
              const readyToConfirm = !isOrderCompleted && !isOrderCancelled && status === "driver_fee_proposed" && totalPayable > 0 && (expiresIn === null || expiresIn > 0);
              const driverStatus = normText(order?.driver_status || "").toLowerCase();
              const routePlan = normText(order?.takeout_route_plan || "").toLowerCase();
              const driverPoint = takeoutMapPoint(order?.driver_lat, order?.driver_lng);
              const vendorPoint = takeoutMapPoint(order?.vendor_lat ?? order?.pickup_lat, order?.vendor_lng ?? order?.pickup_lng);
              const customerPoint = takeoutMapPoint(order?.customer_lat ?? order?.dropoff_lat, order?.customer_lng ?? order?.dropoff_lng);
              const cashFirstRoute = order?.takeout_cash_collection_required === true || routePlan === "customer_cash_first";
              const alreadyPickedUp = ["picked_up", "delivering", "completed"].includes(progressStatus);
              const cashAlreadyCollected = ["cash_collected", "vendor_bound", "rider_arrived_vendor", "arrived_vendor", "picked_up", "delivering", "completed"].some((s) =>
                [progressStatus, customerStatus, vendorStatus, driverStatus].includes(s)
              );
              const takeoutMapTarget = alreadyPickedUp
                ? customerPoint
                : cashFirstRoute && !cashAlreadyCollected
                  ? customerPoint
                  : vendorPoint;
              const takeoutMapTargetLabel = alreadyPickedUp
                ? "customer"
                : cashFirstRoute && !cashAlreadyCollected
                  ? "customer"
                  : "vendor";
              const takeoutMapUrl = driverPoint && takeoutMapTarget ? takeoutMapsDirectionsUrl(driverPoint, takeoutMapTarget) : "";

              if (isOrderCompleted) {
                return (
                  <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                    <div className="font-semibold">Order completed.</div>
                    <div className="mt-1">Thank you for using JRide Takeout.</div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSubmitted(false);
                          setPricingOrder(null);
                          setPricingErr(null);
                          setResult("");
                          setLastJson(null);
                        }}
                        className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                      >
                        Order again
                      </button>
                      <a href="/" className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                        Back to home
                      </a>
                      <a href="/takeout/orders" className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">
                        View orders
                      </a>
                    </div>
                  </div>
                );
              }

              return (
                <div className="mt-3 space-y-2">
                  <div className="rounded border bg-slate-50 p-3">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-600">Pricing status</span>
                      <span className="font-semibold">{status.replace(/_/g, " ")}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-slate-600">Order progress</span>
                      <span className="font-semibold">{progressLabel}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-slate-600">Food subtotal</span>
                      <span>{money(foodSubtotal)}</span>
                    </div>
                    {confirmationPackagingSubtotal > 0 ? (
                      <div className="mt-1 flex justify-between gap-3">
                        <span className="text-slate-600">Premium packaging</span>
                        <span>{money(confirmationPackagingSubtotal)}</span>
                      </div>
                    ) : null}
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-slate-600">Delivery fee</span>
                      <span>{deliveryFee > 0 ? money(deliveryFee) : "Waiting for driver"}</span>
                    </div>
                    
                    <div className="mt-2 flex justify-between gap-3 border-t pt-2 text-base">
                      <span className="font-semibold">Total payable</span>
                      <span className="font-bold">{totalPayable > 0 ? money(totalPayable) : "Pending"}</span>
                    </div>
                    {order?.takeout_cash_collection_required === true ? (
                      <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        Driver will collect the cash payment from you before proceeding to the vendor purchase.
                      </div>
                    ) : null}
                    {status === "driver_fee_proposed" && !isOrderCompleted && !isOrderCancelled ? (
                      <div className="mt-3 rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                        <div className="text-base font-black uppercase tracking-wide">Action required</div>
                        <div className="mt-1 font-semibold">Driver proposed the delivery fee. Confirm the total payable to continue.</div>
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-white px-3 py-2">
                          <span className="text-xs font-semibold uppercase text-slate-600">Proposal expires in</span>
                          <span className="text-xl font-black tabular-nums text-rose-700">{expiresIn === null ? "--" : String(expiresIn) + " sec"}</span>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {status === "pricing_pending" ? (
                    <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                      {vendorStatus === "vendor_pending"
                        ? "Waiting for the vendor to accept the order before dispatch."
                        : "Looking for a nearby driver to propose the delivery fee. Do not close this page yet."}
                    </div>
                  ) : null}

                  {status === "expired" ? (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      The previous driver fee proposal expired. Please wait for another driver proposal.
                    </div>
                  ) : null}

                  {status === "customer_confirmed" && !hasMovedPastCustomerConfirmation ? (
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                      {order?.takeout_cash_collection_required === true
                        ? "Order confirmed. The driver is on the way to collect the cash payment before proceeding to the vendor."
                        : "Order confirmed. The driver is now assigned and the vendor workflow can proceed."}
                    </div>
                  ) : null}

                  {status === "customer_confirmed" || progressStatus ? (
                    <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
                      <div className="font-semibold text-slate-900">Live takeout progress</div>
                      <div className="mt-1">{progressLabel}</div>
                      {vendorStatus ? <div className="mt-1 text-slate-500">Vendor status: {vendorStatus.replace(/_/g, " ")}</div> : null}
                      {customerStatus ? <div className="mt-1 text-slate-500">Customer status: {customerStatus.replace(/_/g, " ")}</div> : null}
                      <div className="mt-1 text-[10px] text-red-600">
  mapdiag url={takeoutMapUrl ? "yes" : "no"} driver={driverPoint ? "yes" : "no"} vendor={vendorPoint ? "yes" : "no"} customer={customerPoint ? "yes" : "no"} done={isOrderCompleted ? "yes" : "no"} cancelled={isOrderCancelled ? "yes" : "no"}
</div>
                      {takeoutMapUrl && !isOrderCompleted && !isOrderCancelled ? (
                        <a
                          href={takeoutMapUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-3 inline-flex w-full items-center justify-center rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                        >
                          View driver route to {takeoutMapTargetLabel}
                        </a>
                      ) : !isOrderCompleted && !isOrderCancelled ? (
                        <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-500">
                          Driver map will appear once driver and destination coordinates are available.
                        </div>
                      ) : null}
                    </div>
                  ) : null}


                  {isOrderCancelled ? (
                    <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                      <div className="font-semibold">Order cancelled.</div>
                      <button
                        type="button"
                        onClick={() => {
                          setSubmitted(false);
                          setPricingOrder(null);
                          setPricingErr(null);
                          setResult("");
                          setLastJson(null);
                        }}
                        className="mt-3 rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800"
                      >
                        Start new takeout order
                      </button>
                    </div>
                  ) : null}

                  {readyToConfirm ? (
                    <button
                      type="button"
                      onClick={confirmTakeoutFee}
                      disabled={confirmBusy}
                      className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
                    >
                      {confirmBusy ? "Confirming..." : "Confirm total payable now"}
                    </button>
                  ) : null}
                </div>
              );
            })()}
          </div>
        ) : null}

        {lastJson && !["completed", "cancelled"].includes(normText(pricingOrder?.customer_status || pricingOrder?.vendor_status || "").toLowerCase()) ? (
          <pre className="mt-3 overflow-auto rounded border bg-black p-3 text-xs text-white">
{JSON.stringify(lastJson, null, 2)}
          </pre>
        ) : null}

        <style jsx global>{`
          /* JRIDE_TAKEOUT_PREMIUM_BRAND_UI_V7
             UI-only premium visual layer for Android WebView takeout.
             No API, lifecycle, dispatch, wallet, or auth logic is changed. */
          :root {
            --jr-bg: #061014;
            --jr-bg-2: #07171f;
            --jr-card: #0b1720;
            --jr-card-2: #0e202b;
            --jr-border: rgba(34, 197, 94, 0.24);
            --jr-border-soft: rgba(148, 163, 184, 0.20);
            --jr-green: #22c55e;
            --jr-green-2: #16a34a;
            --jr-green-3: #86efac;
            --jr-text: #f8fafc;
            --jr-muted: #a7b3c4;
            --jr-danger: #ff5b5b;
            --jr-warning: #f59e0b;
          }

          body {
            background:
              radial-gradient(circle at 18% 0%, rgba(34, 197, 94, 0.22), transparent 28%),
              radial-gradient(circle at 100% 18%, rgba(20, 184, 166, 0.13), transparent 32%),
              linear-gradient(180deg, #041015 0%, #071014 52%, #020617 100%) !important;
            color: var(--jr-text) !important;
          }

          .jride-premium-brand-row {
            display: flex;
            align-items: center;
            gap: 0.75rem;
          }

          .jride-premium-title {
            color: var(--jr-text);
            font-weight: 900;
            letter-spacing: -0.035em;
            font-size: 1.35rem;
            line-height: 1.1;
            white-space: nowrap;
          }

          .jride-premium-title span:last-child {
            color: var(--jr-green);
          }

          .jride-premium-logo-text {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-width: 2.15rem;
            height: 2.15rem;
            border-radius: 0.9rem;
            margin-right: 0.15rem;
            color: #061014 !important;
            background: linear-gradient(135deg, #86efac 0%, #22c55e 50%, #14b8a6 100%);
            box-shadow: 0 10px 25px rgba(34, 197, 94, 0.25);
            font-size: 0.86rem;
            letter-spacing: -0.06em;
          }

          .jride-premium-nav-pill,
          a[href="/takeout/orders"] {
            border: 1px solid rgba(34, 197, 94, 0.32) !important;
            background: rgba(6, 16, 20, 0.74) !important;
            color: var(--jr-text) !important;
            border-radius: 999px !important;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.06), 0 8px 24px rgba(0,0,0,0.24) !important;
            backdrop-filter: blur(10px);
          }

          a[href="/takeout/orders"]:hover,
          .jride-premium-nav-pill:hover {
            background: rgba(34, 197, 94, 0.13) !important;
            color: #bbf7d0 !important;
          }

          body .mx-auto.w-full.max-w-5xl {
            max-width: min(100%, 72rem) !important;
            min-height: 100vh;
            padding-top: 0.75rem !important;
            background: transparent !important;
          }

          body .text-slate-900,
          body .text-slate-800,
          body .text-slate-700 {
            color: var(--jr-text) !important;
          }

          body .text-slate-600,
          body .text-slate-500,
          body .text-slate-400 {
            color: var(--jr-muted) !important;
          }

          body .border,
          body .border-slate-200,
          body .border-slate-300 {
            border-color: var(--jr-border-soft) !important;
          }

          body .bg-white,
          body .bg-white\/95,
          body .bg-slate-50 {
            background: linear-gradient(180deg, rgba(15, 30, 41, 0.94), rgba(7, 18, 25, 0.94)) !important;
            color: var(--jr-text) !important;
          }

          body .rounded-2xl,
          body .rounded-xl,
          body .rounded-lg {
            border-radius: 1.25rem !important;
          }

          body .shadow-md,
          body .shadow-sm,
          body .shadow-lg {
            box-shadow: 0 16px 38px rgba(0, 0, 0, 0.34), inset 0 1px 0 rgba(255,255,255,0.04) !important;
          }

          body input,
          body select,
          body textarea {
            background: rgba(2, 6, 23, 0.35) !important;
            color: var(--jr-text) !important;
            border-color: rgba(148, 163, 184, 0.28) !important;
            border-radius: 1rem !important;
            min-height: 2.85rem;
            box-shadow: inset 0 1px 0 rgba(255,255,255,0.03) !important;
          }

          body input::placeholder,
          body textarea::placeholder {
            color: rgba(203, 213, 225, 0.62) !important;
          }

          body select:disabled,
          body input:read-only {
            background: rgba(15, 23, 42, 0.55) !important;
            color: #cbd5e1 !important;
          }

          body .bg-emerald-50,
          body .border-emerald-200 {
            background: linear-gradient(135deg, rgba(34, 197, 94, 0.16), rgba(20, 184, 166, 0.08)) !important;
            border-color: rgba(34, 197, 94, 0.42) !important;
            color: #bbf7d0 !important;
          }

          body .text-emerald-800,
          body .text-emerald-700,
          body .text-emerald-900 {
            color: #bbf7d0 !important;
          }

          body .bg-amber-50 {
            background: rgba(245, 158, 11, 0.12) !important;
            border-color: rgba(245, 158, 11, 0.36) !important;
            color: #fde68a !important;
          }

          body .bg-red-50,
          body .bg-rose-50 {
            background: rgba(239, 68, 68, 0.12) !important;
            border-color: rgba(239, 68, 68, 0.36) !important;
            color: #fecaca !important;
          }

          body .text-red-600,
          body .text-red-700,
          body .text-rose-700,
          body .text-rose-800 {
            color: var(--jr-danger) !important;
          }

          body button,
          body a {
            transition: transform 140ms ease, box-shadow 140ms ease, background 140ms ease, border-color 140ms ease;
          }

          body button:active,
          body a:active {
            transform: scale(0.985);
          }

          body button.bg-slate-900,
          body button.hover\:bg-slate-800,
          body button[type="button"]:not(:disabled) {
            border-color: rgba(34, 197, 94, 0.42) !important;
          }

          body button.bg-slate-900,
          body .sticky.bottom-0 button:not(:disabled) {
            background: linear-gradient(135deg, #86efac 0%, #22c55e 48%, #14b8a6 100%) !important;
            color: #061014 !important;
            box-shadow: 0 14px 32px rgba(34, 197, 94, 0.24) !important;
          }

          body button.bg-slate-400,
          body button:disabled {
            background: rgba(148, 163, 184, 0.45) !important;
            color: rgba(248, 250, 252, 0.72) !important;
            box-shadow: none !important;
          }

          body .sticky.bottom-0 {
            left: 0;
            right: 0;
            margin-left: -0.75rem;
            margin-right: -0.75rem;
            border-top: 1px solid rgba(34, 197, 94, 0.28) !important;
            background: linear-gradient(180deg, rgba(6, 16, 20, 0.82), rgba(2, 6, 23, 0.97)) !important;
            box-shadow: 0 -18px 48px rgba(0, 0, 0, 0.46), 0 -1px 0 rgba(34, 197, 94, 0.22) !important;
            backdrop-filter: blur(18px);
          }

          body .sticky.bottom-0::before {
            content: "";
            position: absolute;
            inset: 0.55rem auto auto 1rem;
            width: 3.15rem;
            height: 3.15rem;
            border-radius: 999px;
            border: 1px solid rgba(34, 197, 94, 0.36);
            background: radial-gradient(circle at 50% 35%, rgba(134, 239, 172, 0.38), rgba(34, 197, 94, 0.16) 55%, rgba(2,6,23,0.30));
            pointer-events: none;
          }

          body .sticky.bottom-0::after {
            content: "JR";
            position: absolute;
            left: 1.95rem;
            top: 1.35rem;
            color: #bbf7d0;
            font-weight: 900;
            font-size: 0.75rem;
            pointer-events: none;
          }

          body .sticky.bottom-0 button {
            border-radius: 1rem !important;
            min-height: 3.1rem;
            font-weight: 900 !important;
          }

          body .sticky.bottom-0 a[href="/takeout/orders"] {
            min-height: 3.1rem;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 800;
          }

          body .mapboxgl-map {
            border-radius: 1.15rem !important;
            filter: saturate(0.92) contrast(0.95);
          }


          /* JRIDE_TAKEOUT_DESKTOP_FULL_WIDTH_V16
             Desktop layout contract:
             - town selector and passenger name share the first row
             - vendor marketplace, selected vendor, menu grid, and subtotal use the full allocated card width
             - Android/WebView remains one-column and app-like. */
          @media (min-width: 768px) {
            .jride-takeout-form-grid {
              display: grid !important;
              grid-template-columns: minmax(0, 1fr) minmax(320px, 420px) !important;
              align-items: start !important;
              column-gap: 1.25rem !important;
              row-gap: 1rem !important;
            }

            .jride-town-and-vendors {
              display: contents !important;
            }

            .jride-town-and-vendors > div:first-child {
              grid-column: 1 / 2 !important;
              grid-row: 1 !important;
              min-width: 0 !important;
            }

            .jride-vendor-menu-section {
              grid-column: 1 / -1 !important;
              grid-row: 2 !important;
              width: 100% !important;
              max-width: none !important;
              min-width: 0 !important;
            }

            .jride-vendor-grid {
              width: 100% !important;
              max-width: none !important;
              min-width: 0 !important;
            }

            .jride-vendor-grid > button {
              width: 100% !important;
              max-width: none !important;
            }

            .jride-selected-vendor-summary,
            .jride-menu-section,
            .jride-menu-grid {
              width: 100% !important;
              max-width: none !important;
              min-width: 0 !important;
            }

            .jride-menu-grid {
              grid-template-columns: repeat(4, minmax(0, 1fr)) !important;
            }
          }

          @media (min-width: 768px) and (max-width: 1180px) {
            .jride-menu-grid {
              grid-template-columns: repeat(3, minmax(0, 1fr)) !important;
            }
          }

          @media (max-width: 640px) {
            body .mx-auto.w-full.max-w-5xl {
              max-width: 30rem !important;
              padding-left: 0.65rem !important;
              padding-right: 0.65rem !important;
            }

            .jride-premium-title {
              font-size: 1.1rem;
            }

            .jride-premium-logo-text {
              min-width: 1.85rem;
              height: 1.85rem;
              font-size: 0.72rem;
              border-radius: 0.75rem;
            }

            .jride-premium-nav-pill,
            a[href="/takeout/orders"] {
              padding: 0.55rem 0.85rem !important;
              font-size: 0.78rem !important;
            }

            body label {
              font-size: 0.72rem !important;
              letter-spacing: 0.01em;
            }
          }
        `}</style>
      </div>
    </div>
  );
}





























