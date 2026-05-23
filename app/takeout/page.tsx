"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

const passengerToken =
  typeof window !== "undefined"
    ? localStorage.getItem("jride_passenger_token")
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

function getOrCreateDeviceKey(): string {
  if (typeof window === "undefined") return "";
  const existing = String(window.localStorage.getItem(LS_DEVICE_KEY) || "").trim();
  if (existing) return existing;

  const key = "dev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  window.localStorage.setItem(LS_DEVICE_KEY, key);
  return key;
}

async function getJson(url: string) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
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

function vendorTown(v: VendorRow): string {
  return normalizeTakeoutTown(v.town);
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

async function fetchOptionalJson(url: string): Promise<any> {
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
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
      setMapErr("Map token is missing. You can still submit using the text address.");
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

    const placeMarker = (lng: number, lat: number) => {
      if (!markerRef.current) {
        const marker = new mapboxgl.Marker({ draggable: true })
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
          <div className="text-[11px] text-slate-500">Tap the map or drag the pin to mark the exact delivery spot.</div>
        </div>
        <button type="button" onClick={useDeviceLocation} className="rounded border px-2 py-1 text-xs hover:bg-slate-50">
          Use device location
        </button>
      </div>
      {mapErr ? <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800">{mapErr}</div> : null}
      <div ref={containerRef} className="mt-2 h-64 w-full overflow-hidden rounded border bg-slate-100" />
      {value ? (
        <div className="mt-2 text-[11px] text-slate-600">
          Pin set: <span className="font-semibold">{value.lat.toFixed(6)}, {value.lng.toFixed(6)}</span>
        </div>
      ) : (
        <div className="mt-2 text-[11px] text-slate-500">No pin selected yet. Text address will still be used.</div>
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
  const [saveAddr, setSaveAddr] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);
  const [showDeliveryPin, setShowDeliveryPin] = useState(false);
  const [deliveryPin, setDeliveryPin] = useState<DeliveryPin | null>(null);

  // Phase 2B - menu consumption
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuErr, setMenuErr] = useState<string | null>(null);
  const [vendorClosed, setVendorClosed] = useState(false);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [menuVendorProfile, setMenuVendorProfile] = useState<any>(null);
  const [qty, setQty] = useState<Record<string, number>>({});

  const [note, setNote] = useState("");
  const [premiumPackagingSelected, setPremiumPackagingSelected] = useState(false);
  const [receiptRequested, setReceiptRequested] = useState(false);

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [lastJson, setLastJson] = useState<ApiResp | null>(null);

  // JRIDE_TAKEOUT_PASSENGER_PRICING_UI_V1
  // Passenger-side visibility only for driver delivery fee proposals.
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

    const lat = safeCoord(primary.dropoff_lat ?? primary.lat);
    const lng = safeCoord(primary.dropoff_lng ?? primary.lng);
    if (!deliveryPin && lat != null && lng != null) {
      setDeliveryPin({ lat, lng });
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

  const resolvedDeliveryAddress = useMemo(() => {
    if (addrMode === "saved") return cleanDeliveryAddressLabel(primary?.address_text || "");
    return cleanDeliveryAddressLabel(newAddr || "");
  }, [addrMode, primary, newAddr]);

  const menuSelectable = useMemo(() => {
    return (menu || []).map((m) => {
      const available = (m.is_available !== false) && (m.sold_out_today !== true);
      return { ...m, _available: available };
    });
  }, [menu]);

  const selectedLines = useMemo(() => {
    const lines: Array<{ id: string; name: string; price: number; qty: number; line_total: number; packaging_note?: string | null }> = [];
    for (const m of menuSelectable) {
      const q = Math.max(0, Math.floor(toNum(qty[m.id])));
      if (q > 0) {
        lines.push({ id: m.id, name: m.name, price: toNum(m.price), qty: q, line_total: q * toNum(m.price), packaging_note: m.packaging_note || null });
      }
    }
    return lines;
  }, [menuSelectable, qty]);

  const itemsSubtotal = useMemo(() => selectedLines.reduce((a, r) => a + toNum(r.line_total), 0), [selectedLines]);

  const premiumPackagingEnabled = selectedVendor?.premium_packaging_enabled === true || menuVendorProfile?.premium_packaging_enabled === true;
  const premiumPackagingFee = premiumPackagingEnabled ? toNum(menuVendorProfile?.premium_packaging_fee ?? selectedVendor?.premium_packaging_fee) : 0;
  const premiumPackagingLabel = String(menuVendorProfile?.premium_packaging_label || selectedVendor?.premium_packaging_label || "Premium packaging").trim() || "Premium packaging";
  const packagingEstimate = premiumPackagingSelected && premiumPackagingEnabled ? premiumPackagingFee : 0;

  // Human readable for vendor UI, and JSON snapshot for future lock
  const itemsText = useMemo(() => {
    if (!selectedLines.length) return "";
    return selectedLines.map((r) => {
      const base = `${r.qty}x ${r.name} @ ${money(r.price)} = ${money(r.line_total)}`;
      return r.packaging_note ? base + `\n   Packaging: ${r.packaging_note}` : base;
    }).join("\n");
  }, [selectedLines]);

  const itemsJson = useMemo(() => {
    return selectedLines.map((r) => ({ menu_item_id: r.id, name: r.name, unit_price: r.price, qty: r.qty, line_total: r.line_total, packaging_note: r.packaging_note || null }));
  }, [selectedLines]);

  const canSubmit = useMemo(() => {
    const hasVendor = vendorId.trim().length > 0;
    const hasName = customerName.trim().length > 0;
    const hasAddr = resolvedDeliveryAddress.length > 0 || !!deliveryPin;
    const hasItems = selectedLines.length > 0;
    return hasVendor && hasName && hasAddr && hasItems && !vendorClosed && !busy;
  }, [vendorId, customerName, resolvedDeliveryAddress, deliveryPin, selectedLines.length, vendorClosed, busy]);


  async function loadPassengerAutofill() {
    // Authentication status is shown to the passenger, but customer name/phone must come from a real passenger profile.
    // Do not use email display names as passenger names.
    const session = await fetchOptionalJson("/api/auth/session");
    const passengerSession = await fetchOptionalJson("/api/public/auth/session");
    const contact = await fetchOptionalJson("/api/takeout/passenger-contact");
    const signedIn =
      hasSignedInUser(passengerSession) ||
      passengerSession?.ok === true ||
      hasSignedInUser(session) ||
      contact?.signed_in === true;

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

    if (signedIn && loaded.length) {
      setAuthState("signed_in_profile");
      setAutofillNote("Signed in. Loaded from verified passenger contact: " + loaded.join(", ") + ". You can still edit before submitting.");
    } else if (signedIn) {
      setAuthState("signed_in_missing_profile");
      setAutofillNote("Signed in. Passenger contact was not found on this page yet. Please confirm the delivery name and phone for this order.");
    } else {
      setAuthState("guest");
      setAutofillNote("Not signed in. Sign in for faster checkout, saved contact details, and synced order history.");
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

      const latValue = safeCoord(nextPrimary.dropoff_lat ?? nextPrimary.lat);
      const lngValue = safeCoord(nextPrimary.dropoff_lng ?? nextPrimary.lng);

      if (latValue != null && lngValue != null) {
        setDeliveryPin({ lat: latValue, lng: lngValue });
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

      const orderableCount = mapped.filter((r) => (r.is_available !== false) && (r.sold_out_today !== true)).length;
      const closedByApi =
        j?.accepting_orders === false ||`r`n        j?.vendor?.accepting_orders === false ||`r`n        j?.vendor?.acceptingOrders === false ||
        j?.acceptingOrders === false ||
        j?.vendor_accepting_orders === false ||
        j?.vendorAcceptingOrders === false ||
        j?.vendor_open === false ||
        j?.vendorOpen === false ||
        j?.is_open === false ||
        j?.isOpen === false;
      setVendorClosed(Boolean(closedByApi || (mapped.length > 0 && orderableCount === 0)));

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
        setPremiumPackagingSelected(false);
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
      setPremiumPackagingSelected(false);
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

  async function saveAddressToDb(addressText: string, makePrimary: boolean) {
    const addr = cleanDeliveryAddressLabel(addressText);
    if (!addr) throw new Error("Address required");

    await postJson("/api/passenger-addresses", {
      device_key: deviceKey,
      address_text: addr,
      is_primary: makePrimary,
    });

    await refreshAddresses(deviceKey);
  }

  async function makePrimaryExisting(id: string) {
    const row = saved.find((a) => a.id === id);
    if (!row) return;
    await saveAddressToDb(row.address_text, true);
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
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, Math.floor(toNum(nextQty)))) }));
  }

  async function submit() {
    try {
      if (vendorClosed) {
        setResult("Cannot place order: vendor is currently closed. Please try again later.");
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
        premium_packaging_selected: premiumPackagingSelected && premiumPackagingEnabled,
        premium_packaging_fee: packagingEstimate,
        premium_packaging_label: premiumPackagingSelected && premiumPackagingEnabled ? premiumPackagingLabel : null,
        receipt_requested: receiptRequested,
        request_vendor_receipt: receiptRequested,
        order_preferences: {
          premium_packaging_selected: premiumPackagingSelected && premiumPackagingEnabled,
          premium_packaging_fee: packagingEstimate,
          premium_packaging_label: premiumPackagingSelected && premiumPackagingEnabled ? premiumPackagingLabel : null,
          receipt_requested: receiptRequested,
        },

        note: [
          note.trim(),
          premiumPackagingSelected && premiumPackagingEnabled ? "Premium packaging requested: " + premiumPackagingLabel + " (" + money(packagingEstimate) + ")" : "",
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
      setResult("Takeout order submitted. Waiting for a driver delivery fee proposal." + (maybeId ? " ID: " + String(maybeId) : ""));
      setPricingOrder({
        id: normText(maybeId) || null,
        booking_code: maybeCode || null,
        takeout_pricing_status: "pricing_pending",
        total_bill: itemsSubtotal,
        takeout_items_subtotal: itemsSubtotal,
      });
      setPricingErr(null);
      setQty({});
      setSubmitted(true);
      setMenu([]);
      setVendorId("");
      setNote("");
      setPremiumPackagingSelected(false);
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
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold">JRide Takeout</div>
          <div className="text-sm text-slate-600">
            Choose a vendor, select menu items, set your delivery address, and confirm the delivery fee after a driver proposal.
          </div>
        </div>
        <a href="/takeout/orders" className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
          My takeout orders
        </a>
      </div>

      <div className="mt-4">
        {authState === "guest" ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-semibold">You are not signed in</div>
                <div className="text-xs">Sign in to autofill your verified passenger contact, phone number, saved address, and keep order history synced.</div>
              </div>
              <a href="/passenger-login?callbackUrl=/takeout" className="rounded bg-black px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800">
                Sign in for faster checkout
              </a>
            </div>
          </div>
        ) : authState === "signed_in_missing_profile" ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
            <div className="font-semibold">Signed in. Confirm delivery contact</div>
            <div className="text-xs">We could not load your passenger contact here yet. Please enter the name and phone the vendor or driver should use for this order.</div>
          </div>
        ) : authState === "signed_in_profile" ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            <div className="font-semibold">Signed in passenger profile loaded</div>
            <div className="text-xs">Name and phone were loaded from your passenger profile. You can still edit before submitting.</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 rounded-lg border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div>
              <label className="text-xs font-medium text-slate-700">Choose store location</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2 text-sm"
                value={vendorTownFilter}
                onChange={(e) => {
                  setVendorTownFilter(e.target.value);
                }}
              >
                <option value="">Select town</option>
                {vendorTowns.map((town) => (
                  <option key={town} value={town}>
                    {town}
                  </option>
                ))}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                Vendors are grouped by town for faster delivery.
              </div>
            </div>

            <div>
              <label className="text-xs font-medium text-slate-700">Select vendor</label>
              <select
                className="mt-1 w-full rounded border px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400"
                value={vendorId}
                disabled={!vendorTownFilter}
                onChange={(e) => {
                    const nextVendorId = e.target.value;
                    setVendorId(nextVendorId);
                    setQty({});
                    setPremiumPackagingSelected(false);
                    setReceiptRequested(false);
                    setSubmitted(false);
                    refreshMenu(nextVendorId);
                  }}
              >
                <option value="">{vendorTownFilter ? "Select vendor" : "Choose store location"}</option>
                {visibleVendors.map((v) => {
                  const id = vendorKey(v);
                  if (!id) return null;
                  return (
                    <option key={id} value={id}>
                      {vendorLabel(v)}
                    </option>
                  );
                })}
              </select>
              <div className="mt-1 text-[11px] text-slate-500">
                Menu loads automatically after you select a vendor.
              </div>
              {vendorTownFilter && visibleVendors.length === 0 ? (
                <div className="mt-1 text-[11px] text-amber-700">
                  No vendors are listed for this town yet.
                </div>
              ) : null}
            </div>
            {vendorId ? (
              <div className="mt-1 text-[11px] text-slate-500">
                Selected: <span className="font-medium">{selectedVendor ? vendorLabel(selectedVendor) : "Vendor"}</span>
                {vendorClosed ? <div className="mt-1 text-xs font-semibold text-red-700">This vendor is currently closed and cannot accept new orders.</div> : null}
              </div>
            ) : null}
          </div>

          {vendorClosed ? (
            <div className="md:col-span-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <div className="font-semibold">Vendor is currently closed</div>
              <div className="mt-1 text-xs">Please try again later. New orders are blocked until the vendor reopens.</div>
            </div>
          ) : null}

          <div>
            <label className="text-xs font-medium text-slate-700">Passenger name (required)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder=""
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Passenger phone (recommended)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerPhone}
              onChange={(e) => {
                const digitsOnly = e.target.value.replace(/[^0-9]/g, "");
                setCustomerPhone(digitsOnly);
              }}
              placeholder="09xx..."
            />
          </div>

          {autofillNote ? (
            <div
              className={cls(
                "md:col-span-2 rounded border p-2 text-xs",
                authState === "guest" ? "border-amber-300 bg-amber-50 text-amber-900" :
                authState === "signed_in_missing_profile" ? "border-sky-200 bg-sky-50 text-sky-900" :
                "border-emerald-200 bg-emerald-50 text-emerald-800"
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
              <label className="text-xs font-medium text-slate-700">Delivery address (required)</label>
              <button
                type="button"
                onClick={() => refreshAddresses().catch(() => undefined)}
                className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
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
                    <div className="text-xs font-semibold text-slate-700">Primary address</div>
                    <div className="mt-1 text-sm text-slate-900">{cleanDeliveryAddressLabel(primary.address_text)}</div>

                    {saved.length > 1 ? (
                      <div className="mt-3">
                        <div className="text-[11px] font-medium text-slate-600">Other saved addresses</div>
                        <div className={cls("mt-2 space-y-2", vendorClosed && "opacity-60")}>
                          {saved.filter((a) => a.id !== primary.id).slice(0, 5).map((a) => (
                            <div key={a.id} className="flex items-start justify-between gap-2 rounded border bg-white p-2">
                              <div className="text-xs text-slate-800">{cleanDeliveryAddressLabel(a.address_text)}</div>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedAddressId(String(a.id || ""));
                                  setAddrMode("saved");
                                  const nextAddress = cleanDeliveryAddressLabel(String(a.address_text || a.label || ""));
                                  if (nextAddress) setNewAddr((prev) => prev.trim() ? prev : nextAddress);
                                  const latValue = safeCoord(a.dropoff_lat ?? a.lat);
                                  const lngValue = safeCoord(a.dropoff_lng ?? a.lng);
                                  if (latValue != null && lngValue != null) setDeliveryPin({ lat: latValue, lng: lngValue });
                                  makePrimaryExisting(a.id).catch(() => undefined);
                                }}
                                className="shrink-0 rounded border px-2 py-1 text-[11px] hover:bg-black/5"
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
                  onChange={(e) => {
                    setNewAddr(e.target.value);
                    setSubmitted(false);
                  }}
                  placeholder="House / landmark / purok / barangay"
                />

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

            <div className="mt-3 rounded border bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold text-slate-700">Exact delivery spot</div>
                  <div className="text-[11px] text-slate-500">Use this when the written address is not enough for the driver.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDeliveryPin((v) => !v)}
                  className="rounded border px-2 py-1 text-xs hover:bg-white"
                >
                  {showDeliveryPin ? "Hide map" : deliveryPin ? "Mark exact location" : "Mark exact location"}
                </button>
              </div>
              {deliveryPin ? (
                <div className="mt-2 text-[11px] text-emerald-700">Delivery spot saved for this order. Add a landmark in the address box if needed.</div>
              ) : (
                <div className="mt-2 text-[11px] text-slate-500">No delivery spot marked yet. The order can still use the written address.</div>
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

          {/* PHASE2B_MENU_CONSUMPTION */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-slate-700">Menu (today)</div>
                <div className="text-[11px] text-slate-500">Only available items can be selected.</div>
              </div>
              <button
                type="button"
                onClick={() => refreshMenu().catch(() => undefined)}
                className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                disabled={menuBusy || !vendorId.trim()}
              >
                {menuBusy ? "Loading..." : "Refresh menu"}
              </button>
            </div>

            {menuErr ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{menuErr}</div>
            ) : null}


            {!vendorId.trim() ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">
                Select a vendor to load today's menu.
              </div>
            ) : menuBusy ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">Loading menu...</div>
            ) : menuSelectable.length === 0 ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">
                No menu items available today.
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {menuSelectable.map((m) => {
                  const q = Math.max(0, Math.floor(toNum(qty[m.id])));
                  const disabled = vendorClosed || !m._available;
                  return (
                    <div
                      key={m.id}
                      className={cls(
                        "flex items-start justify-between gap-3 rounded border p-3",
                        disabled ? "bg-slate-50 opacity-70" : "bg-white"
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-3">
                          {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-16 w-16 rounded-xl border object-cover" /> : null}
                          <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{m.name}</div>
                          {m.sold_out_today ? (
                            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700">Sold out</span>
                          ) : null}
                          {m.is_available === false ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Unavailable</span>
                          ) : null}
                        </div>
                        {m.description ? (
                          <div className="mt-1 text-xs text-slate-600">{m.description}</div>
                        ) : null}
                        <div className="text-[11px] font-medium text-slate-600">Prep time: {prepMinutes(m.prep_time_minutes)} min</div>
                        {Number(m.remaining_quantity) > 0 ? (
                          <div className="text-[11px] font-medium text-slate-600">Remaining today: {Number(m.remaining_quantity)}</div>
                        ) : null}
                        {m.packaging_note ? (
                          <div className="mt-2 rounded-lg border bg-slate-50 p-2 text-[11px] text-slate-600">
                            Packaging: {m.packaging_note}
                          </div>
                        ) : null}
                        {m.premium_packaging_enabled ? (
                          <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2 text-[11px] font-medium text-emerald-800">
                            Premium packaging available (+{money(toNum(m.premium_packaging_fee))})
                          </div>
                        ) : null}
                        <div className="mt-2 text-sm font-semibold">{money(toNum(m.price))}</div>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <button
                          type="button"
                          className="h-8 w-8 rounded border text-sm hover:bg-black/5 disabled:opacity-50"
                          disabled={disabled || q <= 0}
                          onClick={() => setItemQty(m.id, q - 1)}
                        >
                          -
                        </button>
                        <input
                          className="h-8 w-14 rounded border px-2 text-center text-sm"
                          value={String(q)}
                          onChange={(e) => setItemQty(m.id, Number(e.target.value))}
                          disabled={disabled}
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          className="h-8 w-8 rounded border text-sm hover:bg-black/5 disabled:opacity-50"
                          disabled={disabled}
                          onClick={() => setItemQty(m.id, q + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">Estimated items subtotal</div>
                <div className="font-semibold">{money(itemsSubtotal)}</div>
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

            {premiumPackagingEnabled || selectedLines.length > 0 ? (
              <div className="mt-3 rounded border bg-white p-3 text-sm">
                <div className="font-medium">Packaging and receipt options</div>
                <div className="mt-2 space-y-2 text-xs text-slate-700">
                  <div className="rounded-lg border bg-slate-50 p-2">Default item packaging is shown per menu item when the vendor provided a note.</div>
                  {premiumPackagingEnabled ? (
                    <label className="flex items-start gap-2 rounded-lg border p-2">
                      <input type="checkbox" checked={premiumPackagingSelected} onChange={(e) => setPremiumPackagingSelected(e.target.checked)} />
                      <span>
                        <span className="block font-semibold">Add {premiumPackagingLabel}{premiumPackagingFee > 0 ? " - " + money(premiumPackagingFee) : ""}</span>
                        <span className="block text-slate-500">Optional upgraded packaging selected by the passenger.</span>
                      </span>
                    </label>
                  ) : null}
                  <label className="flex items-start gap-2 rounded-lg border p-2">
                    <input type="checkbox" checked={receiptRequested} onChange={(e) => setReceiptRequested(e.target.checked)} />
                    <span>
                      <span className="block font-semibold">Request vendor receipt</span>
                      <span className="block text-slate-500">The vendor will see this request on the order queue.</span>
                    </span>
                  </label>
                </div>
              </div>
            ) : null}

            {itemsText ? (
              <details className="mt-3 rounded border bg-white p-3">
                <summary className="cursor-pointer text-sm font-medium">Menu snapshot (what will be sent)</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-800">{itemsText}</pre>
              </details>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-700">Note (optional)</label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any special instructions..."
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit || busy || submitted}
            className={cls(
              "rounded px-4 py-2 text-sm font-medium text-white",
              canSubmit && !submitted ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-400"
            )}
          >
            {submitted ? "Order submitted" : busy ? "Submitting..." : vendorClosed ? "Vendor closed" : "Submit takeout order"}
          </button>

          {vendorClosed ? (
            <span className="text-xs font-medium text-rose-700">Cannot place order: vendor is closed.</span>
          ) : null}

          <a href="/takeout/orders" className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
            View my orders
          </a>
        </div>

        {result && !["completed", "cancelled"].includes(normText(pricingOrder?.customer_status || pricingOrder?.vendor_status || "").toLowerCase()) ? (
          <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">{result}</div>
        ) : null}

        {submitted ? (
          <div className="mt-3 rounded border bg-white p-4 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-slate-900">Takeout pricing confirmation</div>
                <div className="mt-1 text-xs text-slate-600">
                  Waiting for a driver delivery fee proposal before the order is finally confirmed.
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
                vendor_pending: "Waiting for vendor confirmation",
                vendor_accepted: "Vendor accepted order",
                preparing: "Vendor preparing order",
                pickup_ready: "Order ready for pickup",
                driver_assigned: "Driver assigned",
                driver_fee_proposed: "Driver delivery fee proposed",
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
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-slate-600">Driver delivery fee</span>
                      <span>{deliveryFee > 0 ? money(deliveryFee) : "Waiting for driver"}</span>
                    </div>
                    <div className="mt-1 flex justify-between gap-3">
                      <span className="text-slate-600">JRide service fee</span>
                      <span>{serviceFee > 0 ? money(serviceFee) : "--"}</span>
                    </div>
                    <div className="mt-2 flex justify-between gap-3 border-t pt-2 text-base">
                      <span className="font-semibold">Total payable</span>
                      <span className="font-bold">{totalPayable > 0 ? money(totalPayable) : "Pending"}</span>
                    </div>
                    {order?.takeout_cash_collection_required === true ? (
                      <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        Cash collection required before vendor pickup.
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
                      Order confirmed. The driver is now assigned and the vendor workflow can proceed.
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
      </div>
    </div>
  );
}


















