"use client";

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

type MenuItemOption = {
  id?: string | null;
  group_name?: string | null;
  option_name?: string | null;
  addon_name?: string | null;
  price?: number | string | null;
};

type SelectedMenuOptions = {
  variant?: MenuItemOption | null;
  addons?: MenuItemOption[];
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
  variants?: MenuItemOption[] | null;
  addons?: MenuItemOption[] | null;
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
};

function normText(v: any): string {
  return String(v ?? "").trim();
}

function takeoutOrderId(o: TakeoutPricingOrder | null | undefined): string {
  return normText(o?.id || o?.booking_code || o?.code);
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

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number) {
  const v = Number(n || 0);
  return "PHP " + v.toFixed(2);
}

function menuOptionLabel(option: MenuItemOption | null | undefined): string {
  if (!option) return "";
  return String(option.option_name || option.addon_name || "").trim();
}

function menuOptionPrice(option: MenuItemOption | null | undefined): number {
  return toNum(option?.price);
}

function menuItemHasChoices(item: MenuItem): boolean {
  return (Array.isArray(item.variants) && item.variants.length > 0) || (Array.isArray(item.addons) && item.addons.length > 0);
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

    const initialLng = value?.lng ?? 121.1;
    const initialLat = value?.lat ?? 16.8;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [initialLng, initialLat],
      zoom: value ? 16 : 12,
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
  const [deliveryPin, setDeliveryPin] = useState<DeliveryPin | null>(null);

  // Phase 2B - menu consumption
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuErr, setMenuErr] = useState<string | null>(null);
  const [vendorClosed, setVendorClosed] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuCategoryFilter, setMenuCategoryFilter] = useState("All");
  const [menuVendorProfile, setMenuVendorProfile] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [selectedMenuOptions, setSelectedMenuOptions] = useState<Record<string, SelectedMenuOptions>>({});
  const [optionModalItem, setOptionModalItem] = useState<MenuItem | null>(null);
  const [optionModalVariantId, setOptionModalVariantId] = useState("");
  const [optionModalAddonIds, setOptionModalAddonIds] = useState<Record<string, boolean>>({});

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
    return vendors.filter((v) => vendorTown(v) === town);
  }, [vendors, vendorTownFilter]);

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
      return { ...m, category: String(m.category || "Others"), _available: available };
    });
  }, [menu]);

  const visibleMenuCategories = useMemo(() => {
    const set = new Set<string>();
    for (const item of menuSelectable) set.add(String(item.category || "Others"));
    return ["All", "Meals", "Drinks", "Snacks", "Desserts", "Add-ons", "Others"].filter((cat) => cat === "All" || set.has(cat));
  }, [menuSelectable]);

  const filteredMenuSelectable = useMemo(() => {
    if (menuCategoryFilter === "All") return menuSelectable;
    return menuSelectable.filter((m) => String(m.category || "Others") === menuCategoryFilter);
  }, [menuSelectable, menuCategoryFilter]);

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

  function openMenuOptionModal(item: MenuItem) {
    const existing = selectedMenuOptions[item.id] || {};
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const addons = Array.isArray(item.addons) ? item.addons : [];
    setOptionModalItem(item);
    setOptionModalVariantId(String(existing.variant?.id || existing.variant?.option_name || variants[0]?.id || variants[0]?.option_name || ""));
    const nextAddonIds: Record<string, boolean> = {};
    for (const addon of existing.addons || []) {
      const key = String(addon.id || addon.addon_name || "");
      if (key) nextAddonIds[key] = true;
    }
    for (const addon of addons) {
      const key = String(addon.id || addon.addon_name || "");
      if (key && nextAddonIds[key] === undefined) nextAddonIds[key] = false;
    }
    setOptionModalAddonIds(nextAddonIds);
  }

  function saveMenuOptionSelection() {
    const item = optionModalItem;
    if (!item) return;
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const addons = Array.isArray(item.addons) ? item.addons : [];
    const selectedVariant = variants.find((v) => String(v.id || v.option_name || "") === optionModalVariantId) || variants[0] || null;
    const selectedAddons = addons.filter((a) => optionModalAddonIds[String(a.id || a.addon_name || "")] === true);
    setSelectedMenuOptions((prev) => ({
      ...prev,
      [item.id]: { variant: selectedVariant, addons: selectedAddons },
    }));
    setItemQty(item.id, Math.max(1, Math.floor(toNum(qty[item.id])) || 1));
    setOptionModalItem(null);
  }

  function selectedOptionSummary(item: MenuItem): string {
    const selected = selectedMenuOptions[item.id];
    const parts: string[] = [];
    if (selected?.variant) parts.push(menuOptionLabel(selected.variant));
    if (selected?.addons?.length) parts.push(selected.addons.map(menuOptionLabel).filter(Boolean).join(", "));
    return parts.filter(Boolean).join(" + ");
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
        const selected = selectedMenuOptions[m.id] || {};
        const variant = selected.variant || null;
        const addons = selected.addons || [];
        const variantPrice = variant ? menuOptionPrice(variant) : toNum(m.price);
        const addonTotal = addons.reduce((a, row) => a + menuOptionPrice(row), 0);
        const unitPrice = variant ? variantPrice + addonTotal : toNum(m.price) + addonTotal;

        lines.push({
          id: m.id,
          name: m.name,
          price: unitPrice,
          qty: q,
          line_total: q * unitPrice,
          packaging_note: m.packaging_note || null,
          selected_variant: variant,
          selected_addons: addons,
          option_summary: selectedOptionSummary(m),
          premium_packaging_selected: premiumSelected,
          premium_packaging_fee: premiumFee,
          premium_packaging_label: premiumLabel,
          premium_packaging_total: premiumFee * q,
        } as any);
      }
    }

    return lines;
  }, [menuSelectable, qty, premiumPackagingSelections, selectedMenuOptions]);

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

      setVendorClosed(
        closedByApi ||
        orderableCount <= 0,
      );

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

  useEffect(() => {
    const dk = getOrCreateDeviceKey();
    setDeviceKey(dk);
    refreshAddresses(dk).catch(() => undefined);
    loadPassengerAutofill().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
            selected_variant: l?.selected_variant || null,
            selected_addons: Array.isArray(l?.selected_addons) ? l.selected_addons : [],
            option_summary: String(l?.option_summary || "").trim() || null,
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
      setResult("Takeout order submitted. Waiting for a delivery fee quote." + (maybeId ? " ID: " + String(maybeId) : ""));
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
    <div className="mx-auto w-full max-w-md overflow-x-hidden px-2.5 py-2 pb-28 sm:max-w-5xl sm:px-4 md:p-6 md:pb-40">
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
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900 sm:p-3 sm:text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="font-semibold">Passenger verified</div>
                <div className="hidden text-xs sm:block">Name and phone were loaded from your verified passenger profile. These details are required for booking.</div>
              </div>
              <button
                type="button"
                onClick={logoutPassengerProfile}
                className="rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
              >
                Logout
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-3 rounded-2xl border bg-white p-2.5 shadow-md sm:mt-4 sm:p-5">
        <div className="grid gap-2.5 md:grid-cols-1 md:gap-3">
          <div className="space-y-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Choose town</label>
                <span className="rounded-full border border-emerald-700/40 bg-emerald-950/60 px-2.5 py-1 text-[10px] font-black text-emerald-100">
                  {vendorTownFilter || "Select"}
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

            <div className="space-y-2 md:col-span-2">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Vendor marketplace</div>
                  <div className="mt-0.5 text-sm font-bold text-slate-950">Choose a store</div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {vendorTownFilter ? "Browse restaurants and stores in your selected town." : "Choose a town first to show available stores."}
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
                  Select a town above to browse JRide Takeout vendors.
                </div>
              ) : visibleVendors.length === 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                  <div className="font-semibold">No vendors are listed for this town yet.</div>
                  <div className="mt-1 text-xs">Try another town or refresh again later.</div>
                </div>
              ) : (
                <div className="grid gap-4">
                  {visibleVendors.map((v) => {
                    const id = vendorKey(v);
                    if (!id) return null;
                    const isSelected = vendorId === id;
                    const label = vendorLabel(v);
                    const town = vendorTown(v) || vendorTownFilter;
                    const rawAccepting =
                      (v as any).accepting_orders ??
                      (v as any).acceptingOrders ??
                      (v as any).is_open ??
                      (v as any).isOpen ??
                      null;
                    const isClosed = isSelected ? vendorClosed : rawAccepting === false;
                    const logoUrl = vendorUploadedLogoUrl(v);
                    const prep = prepMinutes((v as any).prep_time_minutes ?? (v as any).default_prep_time_minutes ?? 15);
                    const hasPremiumPackaging = v.premium_packaging_enabled === true;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={!vendorTownFilter}
                        onClick={() => {
                          const nextVendorId = id;
                          setVendorId(nextVendorId);
                          setQty({});
                          setPremiumPackagingSelections({});
                          setReceiptRequested(false);
                          setSubmitted(false);
                          refreshMenu(nextVendorId);
                        }}
                        className={cls(
                          "group flex min-h-[170px] w-full items-start gap-4 rounded-3xl border p-5 text-left shadow-[0_18px_50px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-60 sm:max-w-none",
                          isSelected
                            ? "border-emerald-400 bg-emerald-950 text-white ring-2 ring-emerald-300/30"
                            : "border-emerald-900/70 bg-slate-950/80 text-white hover:border-emerald-400"
                        )}
                      >
                        <div className="mt-1 h-20 w-20 shrink-0 overflow-hidden rounded-3xl border border-emerald-500/40 bg-slate-950">
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
                              <div className="break-words text-lg font-black leading-tight text-white sm:text-xl">
                                {label}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-emerald-100">
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

                          <p className="mt-3 line-clamp-2 max-w-2xl text-sm leading-relaxed text-slate-300">
                            Fresh local meals and takeout favorites delivered to your location.
                          </p>

                          <div className="mt-4 flex flex-col items-start gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                            <span className="rounded-full border border-emerald-500/40 bg-slate-950/70 px-3 py-1.5 text-xs font-bold text-emerald-100">
                              Prep time: {prep} min
                            </span>
                            {hasPremiumPackaging ? (
                              <span className="rounded-full border border-amber-300/50 bg-amber-300/10 px-3 py-1.5 text-xs font-bold text-amber-100">
                                Premium packaging
                              </span>
                            ) : null}
                            <span className="rounded-full border border-emerald-500/40 px-3 py-1.5 text-xs font-black text-emerald-100 sm:ml-auto">
                              {isSelected ? "Menu loaded" : "View menu"}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {vendorId ? (
                <div className={cls(
                  "rounded-xl border p-3 text-xs",
                  vendorClosed ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
                )}>
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between sm:gap-3">
                    <div>
                      <div className="text-[11px] uppercase tracking-wide text-slate-500">Selected vendor</div>
                      <div className="mt-0.5 font-semibold text-slate-900">{selectedVendor ? vendorLabel(selectedVendor) : "Vendor"}</div>
                    </div>
                    <div className={cls(
                      "rounded-full border px-2 py-1 text-[11px] font-semibold",
                      vendorClosed ? "border-rose-300 bg-white text-rose-700" : "border-emerald-300 bg-white text-emerald-700"
                    )}>
                      {vendorClosed ? "Closed" : "Open"}
                    </div>
                  </div>
                  <div className="mt-2 text-[11px]">
                    {vendorClosed ? "This vendor is not accepting new orders right now." : "This vendor is accepting takeout orders."}
                  </div>
                </div>
              ) : null}
		{/* PHASE2B_MENU_CONSUMPTION */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-black tracking-tight text-slate-900">
  Browse menu
</div>
                <div className="hidden text-xs text-slate-500 sm:block">
  Swipe through available meals, drinks, and add-ons.
</div>
              </div>
              <button
                type="button"
                onClick={() => refreshMenu().catch(() => undefined)}
                className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 sm:rounded sm:px-4 sm:py-2 sm:text-base"
                disabled={menuBusy || !vendorId.trim()}
              >
                {menuBusy ? "Loading..." : "Refresh menu"}
              </button>
            </div>

            {menuErr ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{menuErr}</div>
            ) : null}


            {!vendorId.trim() ? (
              <div className="mt-2 rounded-xl border border-dashed bg-slate-50 p-4 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Select a vendor to view today's menu.</div>
                <div className="mt-1 text-xs text-slate-500">Available items, prep time, packaging notes, and subtotal will appear here.</div>
              </div>
            ) : menuBusy ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">Loading menu...</div>
            ) : menuSelectable.length === 0 ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">
                No menu items available today.
              </div>
            ) : (
              <>
              <div className="mt-3 flex flex-wrap gap-2">
                {visibleMenuCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setMenuCategoryFilter(cat)}
                    className={cls(
                      "rounded-full border px-3 py-1.5 text-xs font-black",
                      menuCategoryFilter === cat
                        ? "border-emerald-300 bg-emerald-600 text-white"
                        : "border-emerald-900/60 bg-slate-950/70 text-emerald-100"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid w-full grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
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
                        "w-full rounded-3xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 hover:shadow-md",
                        disabled ? "bg-slate-50 opacity-70" : "bg-white"
                      )}
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex items-start gap-4">
                          {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-20 w-20 shrink-0 rounded-2xl border object-cover shadow-sm sm:h-24 sm:w-24" /> : null}
                          <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start gap-2">
                          <div className="line-clamp-2 text-lg font-extrabold leading-tight tracking-tight text-slate-900">{m.name}</div>
                          {m.sold_out_today ? (
                            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700">Sold out</span>
                          ) : null}
                          {m.is_available === false ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Unavailable</span>
                          ) : null}
                        </div>
                        {m.description ? (
                          <div className="mt-1 text-sm leading-relaxed text-slate-600">{m.description}</div>
                        ) : null}
                        <div className="mt-2 inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-700">Prep time: {prepMinutes(m.prep_time_minutes)} min</div>
                        {Number(m.remaining_quantity) > 0 ? (
                          <div className="mt-1 text-[11px] font-semibold text-emerald-700">Remaining today: {Number(m.remaining_quantity)}</div>
                        ) : null}
                        {m.packaging_note ? (
                          <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-[11px] font-medium text-amber-800">
                            Packaging: {m.packaging_note}
                          </div>
                        ) : null}
                        {itemPremiumPackagingEnabled(m) ? (
                          <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-800">
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
                            <span>
                              <span className="block font-semibold">
                                Add {itemPremiumPackagingLabel(m)} (+{money(itemPremiumPackagingFee(m))} each)
                              </span>
                              <span className="hidden text-emerald-700 sm:block">
                                Optional add-on. This is added to your subtotal when checked.
                              </span>
                            </span>
                          </label>
                        ) : null}
                        {menuItemHasChoices(m) ? (
                          <button
                            type="button"
                            disabled={disabled}
                            onClick={() => openMenuOptionModal(m)}
                            className="mt-3 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-left text-xs font-semibold text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                          >
                            {selectedOptionSummary(m) ? "Selected: " + selectedOptionSummary(m) : "Choose size, flavor, or add-ons"}
                          </button>
                        ) : null}
                        <div className="mt-3 text-xl font-black tracking-tight text-slate-900">{money(toNum(m.price))}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 grid w-full grid-cols-[44px_minmax(72px,120px)_44px] items-center gap-2">
                        <button
                          type="button"
                          className="h-9 w-9 rounded-xl border bg-white text-sm font-black shadow-sm hover:bg-black/5 disabled:opacity-50 sm:h-11 sm:w-11 sm:text-base"
                          disabled={disabled || q <= 0}
                          onClick={() => setItemQty(m.id, q - 1)}
                        >
                          -
                        </button>
                        <input
                          className="h-9 w-full rounded-xl border px-2 text-center text-sm font-black sm:h-11 sm:w-16 sm:text-base"
                          value={String(q)}
                          onChange={(e) => setItemQty(m.id, Number(e.target.value))}
                          disabled={disabled}
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          className="h-9 w-9 rounded-xl border bg-white text-sm font-black shadow-sm hover:bg-black/5 disabled:opacity-50 sm:h-11 sm:w-11 sm:text-base"
                          disabled={disabled || plusDisabled}
                          title={plusDisabled ? "No more stock remaining for this item today." : "Add one"}
                          onClick={() => {
                            if (menuItemHasChoices(m) && !selectedMenuOptions[m.id]) openMenuOptionModal(m);
                            else setItemQty(m.id, q + 1);
                          }}
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
                {vendorClosed ? "Ordering is disabled because this vendor is closed." : "This is an estimate for items only. The final delivery fee appears after a driver proposal."}
              </div>
            </div>

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
          <div className="md:col-span-2">
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

            <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-2.5 sm:p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-bold text-slate-900">Exact delivery pin</div>
                  <div className="hidden text-[11px] text-slate-500 sm:block">Required: set the exact delivery pin so the driver route uses the correct passenger location.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeliveryPin((v) => !v)}
                  className="rounded-full border bg-white px-3 py-1.5 text-xs font-bold hover:bg-slate-50 sm:rounded sm:px-4 sm:py-2 sm:text-base"
                >
                  {showDeliveryPin ? "Hide location options" : deliveryPin ? "Change exact location" : "Set exact location"}
                </button>
              </div>
              {deliveryPin ? (
                <div className="mt-2 text-[11px] text-emerald-700">Delivery spot saved for this order. Add a landmark in the address box if needed.</div>
              ) : (
                <div className="mt-2 text-[11px] text-red-600">No delivery spot marked yet. Set the exact delivery pin before placing the order.</div>
              )}
              {showDeliveryPin ? (
                <div className="mt-3">
                  <DeliveryPinPicker value={deliveryPin} onChange={(next) => { setDeliveryPin(next); setSubmitted(false); }} />
                </div>
              ) : null}
            </div>

            <div className="mt-2 text-[11px] text-slate-500">
              Device key: <code>{deviceKey || "..."}</code>
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
          <div className="mb-2 flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <div className="truncate font-bold text-slate-900">{selectedLines.length || 0} item{selectedLines.length === 1 ? "" : "s"}</div>
              <div className="text-[11px] text-slate-500">Delivery fee follows after driver quote</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[11px] text-slate-500">Subtotal</div>
              <div className="text-base font-black text-slate-900">{money(estimatedSubtotalWithPackaging)}</div>
            </div>
          </div>

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
              {submitted ? "Submitted" : busy ? "Submitting..." : vendorClosed ? "Vendor closed" : authState !== "signed_in_profile" ? "Sign in required" : "Review order"}
            </button>

            <a href="/takeout/orders" className="rounded-xl border px-3 py-2.5 text-center text-xs font-bold hover:bg-slate-50">
              Orders
            </a>
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
                <div className="font-semibold text-slate-900">Takeout pricing confirmation</div>
                <div className="mt-1 text-xs text-slate-600">
                  Waiting for a delivery fee quote before the order is finally confirmed.
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
                      <div className="mt-2 text-xs text-slate-600">
                        Proposal expires in: <span className="font-semibold">{expiresIn === null ? "--" : String(expiresIn) + " sec"}</span>
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
                      {confirmBusy ? "Confirming..." : "Confirm order total"}
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

        
      {optionModalItem ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-black text-slate-900">{optionModalItem.name}</div>
                <div className="text-xs text-slate-500">Choose required options and optional add-ons before adding to cart.</div>
              </div>
              <button type="button" onClick={() => setOptionModalItem(null)} className="rounded-lg border px-3 py-1 text-sm font-semibold">Close</button>
            </div>

            {Array.isArray(optionModalItem.variants) && optionModalItem.variants.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Required choice</div>
                <div className="space-y-2">
                  {optionModalItem.variants.map((v, idx) => {
                    const key = String(v.id || v.option_name || idx);
                    return (
                      <label key={key} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                        <span className="flex items-center gap-2">
                          <input type="radio" name="takeout-item-variant" checked={optionModalVariantId === key} onChange={() => setOptionModalVariantId(key)} />
                          <span>{v.group_name ? String(v.group_name) + ": " : ""}{menuOptionLabel(v)}</span>
                        </span>
                        <span className="font-bold">{money(menuOptionPrice(v))}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {Array.isArray(optionModalItem.addons) && optionModalItem.addons.length > 0 ? (
              <div className="mt-4">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-600">Optional add-ons</div>
                <div className="space-y-2">
                  {optionModalItem.addons.map((a, idx) => {
                    const key = String(a.id || a.addon_name || idx);
                    return (
                      <label key={key} className="flex items-center justify-between gap-3 rounded-xl border p-3 text-sm">
                        <span className="flex items-center gap-2">
                          <input type="checkbox" checked={optionModalAddonIds[key] === true} onChange={(e) => setOptionModalAddonIds((prev) => ({ ...prev, [key]: e.target.checked }))} />
                          <span>{menuOptionLabel(a)}</span>
                        </span>
                        <span className="font-bold">+{money(menuOptionPrice(a))}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm">
              <div className="flex justify-between"><span>Item base</span><span>{money(toNum(optionModalItem.price))}</span></div>
              <div className="mt-1 flex justify-between font-black"><span>Selected line price</span><span>{money(((() => {
                const variants = Array.isArray(optionModalItem.variants) ? optionModalItem.variants : [];
                const selectedVariant = variants.find((v) => String(v.id || v.option_name || "") === optionModalVariantId) || variants[0] || null;
                const variantPrice = selectedVariant ? menuOptionPrice(selectedVariant) : toNum(optionModalItem.price);
                const addons = Array.isArray(optionModalItem.addons) ? optionModalItem.addons : [];
                const addonTotal = addons.filter((a) => optionModalAddonIds[String(a.id || a.addon_name || "")] === true).reduce((sum, a) => sum + menuOptionPrice(a), 0);
                return (selectedVariant ? variantPrice : toNum(optionModalItem.price)) + addonTotal;
              })()))}</span></div>
            </div>

            <button type="button" onClick={saveMenuOptionSelection} className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-black text-white">Save options and add to cart</button>
          </div>
        </div>
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
            max-width: 30rem !important;
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

          @media (max-width: 640px) {
            body .mx-auto.w-full.max-w-5xl {
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



















