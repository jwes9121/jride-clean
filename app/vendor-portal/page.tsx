"use client";

import React, { useEffect, useMemo, useState } from "react";

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
  price: number;
  photo_url?: string | null;
  sort_order?: number | null;
  is_available: boolean;
  sold_out_today: boolean;
  last_updated_at?: string | null;
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

const MAX_ITEMS = 15;

function cls(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

function clean(v: any) {
  return String(v ?? "").trim();
}

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(v: any) {
  return "PHP " + toNum(v).toFixed(2);
}

function vendorKey(v: VendorRow) {
  return clean(v.id || v.vendor_id || v.email || "");
}

function vendorLabel(v: VendorRow) {
  return clean(v.display_name || v.vendor_name || v.name || v.email || vendorKey(v) || "Vendor");
}

function normalizeVendorStatus(s: any) {
  const x = clean(s).toLowerCase();
  if (!x || x === "requested") return "vendor_pending";
  if (x === "accepted") return "vendor_accepted";
  if (x === "canceled") return "cancelled";
  return x;
}

function statusLabel(s: any) {
  const x = normalizeVendorStatus(s);
  if (x === "vendor_pending") return "Waiting for vendor confirmation";
  if (x === "vendor_accepted") return "Vendor accepted";
  if (x === "driver_assigned") return "Driver assigned";
  if (x === "pickup_ready") return "Pickup ready";
  if (x === "preparing") return "Preparing";
  if (x === "completed") return "Completed";
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

function orderCustomerName(o: TakeoutOrder) {
  return clean(o.customer_name) || "Customer";
}

function orderCustomerPhone(o: TakeoutOrder) {
  return clean(o.customer_phone) || clean(o.passenger_phone) || clean(o.phone) || "No phone provided";
}

function orderDeliveryAddress(o: TakeoutOrder) {
  return clean(o.default_address) || clean(o.saved_address) || clean(o.to_label) || "No saved/default address shown";
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

  const [profileName, setProfileName] = useState("");
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState("");
  const [premiumPackagingEnabled, setPremiumPackagingEnabled] = useState(false);
  const [premiumPackagingFee, setPremiumPackagingFee] = useState("");
  const [premiumPackagingLabel, setPremiumPackagingLabel] = useState("Premium packaging");

  const [editingId, setEditingId] = useState("");
  const [itemName, setItemName] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemPackagingNote, setItemPackagingNote] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemSoldOut, setItemSoldOut] = useState(false);
  const [itemFile, setItemFile] = useState<File | null>(null);
  const [itemPreview, setItemPreview] = useState("");

  const selectedVendor = useMemo(() => {
    return vendors.find((v) => vendorKey(v) === vendorId) || null;
  }, [vendors, vendorId]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) => ["vendor_pending", "vendor_accepted", "driver_assigned", "pickup_ready"].includes(normalizeVendorStatus(o.vendor_status)));
  }, [orders]);

  const historyOrders = useMemo(() => {
    return orders.filter((o) => ["completed", "cancelled"].includes(normalizeVendorStatus(o.vendor_status)));
  }, [orders]);

  const usedCount = menu.length;
  const limitReached = usedCount >= MAX_ITEMS && !editingId;

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
      setProfile(v);
      setProfileName(clean(v?.name || (selectedVendor ? vendorLabel(selectedVendor as any) : vid)));
      setAcceptingOrders(v?.accepting_orders !== false);
      setLogoPreview(clean(v?.logo_url || ""));
      setPremiumPackagingEnabled(v?.premium_packaging_enabled === true);
      setPremiumPackagingFee(clean(v?.premium_packaging_fee || ""));
      setPremiumPackagingLabel(clean(v?.premium_packaging_label || "Premium packaging") || "Premium packaging");
      setMenu(items);
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendor menu"));
      setProfile(null);
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

  function resetItemForm() {
    setEditingId("");
    setItemName("");
    setItemDescription("");
    setItemPackagingNote("");
    setItemPrice("");
    setItemAvailable(true);
    setItemSoldOut(false);
    setItemFile(null);
    setItemPreview("");
  }

  function editItem(m: MenuItem) {
    setEditingId(clean(m.id || m.menu_item_id));
    setItemName(m.name || "");
    setItemDescription(m.description || "");
    setItemPackagingNote(m.packaging_note || "");
    setItemPrice(String(m.price || ""));
    setItemAvailable(m.is_available !== false);
    setItemSoldOut(m.sold_out_today === true);
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
        accepting_orders: acceptingOrders,
        premium_packaging_enabled: premiumPackagingEnabled,
        premium_packaging_fee: premiumPackagingFee,
        premium_packaging_label: premiumPackagingLabel,
        logo_data_url: logoDataUrl,
      });
      setMessage(j?.warning ? "Profile saved, but image warning: " + j.warning : "Vendor profile saved.");
      setLogoFile(null);
      await loadVendorData(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function saveItem() {
    const vid = clean(vendorId);
    if (!vid) return;
    if (limitReached) {
      setError("Free-tier menu limit reached: 15 menu items maximum.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const photoDataUrl = await fileToDataUrl(itemFile);
      const j = await postJson("/api/vendor-menu/manage", {
        action: "save_item",
        vendor_id: vid,
        id: editingId || null,
        name: itemName,
        description: itemDescription,
        packaging_note: itemPackagingNote,
        price: itemPrice,
        is_available: itemAvailable,
        sold_out_today: itemSoldOut,
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
    const actionText = next.sold_out_today === true ? "mark this item as sold out" : next.is_available === false ? "make this item unavailable" : "update this item";
    if ((next.sold_out_today === true || next.is_available === false) && !window.confirm("Confirm: " + actionText + "?")) return;
    setBusy(true);
    setError("");
    try {
      await postJson("/api/vendor-menu/manage", {
        action: "toggle_item",
        vendor_id: vid,
        id: m.id || m.menu_item_id,
        is_available: next.is_available ?? m.is_available,
        sold_out_today: next.sold_out_today ?? m.sold_out_today,
      });
      await loadVendorData(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function moveOrder(order: TakeoutOrder, nextStatus: string) {
    const vid = clean(vendorId);
    const oid = clean(order.id);
    if (!vid || !oid) return;
    if (nextStatus === "cancelled" && !window.confirm("Cancel this takeout order?")) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await postJson("/api/vendor-orders", {
        vendor_id: vid,
        order_id: oid,
        vendor_status: nextStatus,
      });
      setMessage("Order updated to " + statusLabel(nextStatus) + ".");
      await loadOrders(vid, true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
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
                    {vendorLabel(v)}{v.town ? " - " + v.town : ""}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={() => refreshAll().catch((e) => setError(String(e?.message || e)))}
              className="rounded-xl border px-4 py-2 text-sm hover:bg-slate-50"
              disabled={!vendorId || busy}
            >
              Refresh
            </button>
          </div>
        </div>

        {error ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        {message ? <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}

        {!vendorId ? (
          <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">Select a vendor to continue.</div>
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3">
            <section className="self-start rounded-2xl border bg-white p-4 shadow-sm lg:sticky lg:top-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Vendor profile</h2>
                  <p className="text-xs text-slate-500">Store identity and order availability.</p>
                </div>
                <span className={cls("rounded-full border px-3 py-1 text-xs font-semibold", acceptingOrders ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-rose-300 bg-rose-50 text-rose-700")}>{acceptingOrders ? "Open" : "Closed"}</span>
              </div>

              <div className="mt-4 flex items-center gap-3">
                <div className="h-20 w-20 overflow-hidden rounded-2xl border bg-slate-100">
                  {logoPreview ? <img src={logoPreview} alt="Vendor logo" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">Logo</div>}
                </div>
                <div className="min-w-0 text-sm">
                  <div className="font-semibold">{profile?.name || profileName || (selectedVendor ? vendorLabel(selectedVendor as any) : "Vendor")}</div>
                  <div className="text-xs text-slate-500">{profile?.town || selectedVendor?.town || "Town not set"}</div>
                  <div className="mt-1 text-[11px] text-slate-500">Logo is optional, but recommended for passenger trust.</div>
                </div>
              </div>

              <label className="mt-4 block text-xs font-medium text-slate-700">Vendor name</label>
              <input className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" value={profileName} onChange={(e) => setProfileName(e.target.value)} placeholder="Vendor name" />

              <label className="mt-3 block text-xs font-medium text-slate-700">Vendor logo</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  setLogoFile(f);
                  if (f) setLogoPreview(URL.createObjectURL(f));
                }}
              />

              <label className="mt-4 flex items-center justify-between rounded-xl border bg-slate-50 p-3 text-sm">
                <span>
                  <span className="block font-medium">Accepting orders</span>
                  <span className="block text-xs text-slate-500">Closed vendors are blocked from new orders.</span>
                </span>
                <input type="checkbox" checked={acceptingOrders} onChange={(e) => setAcceptingOrders(e.target.checked)} />
              </label>

              <div className="mt-4 rounded-xl border bg-slate-50 p-3 text-sm">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className="block font-medium">Offer upgraded packaging</span>
                    <span className="block text-xs text-slate-500">Passengers may optionally pay extra for improved packaging.</span>
                  </span>
                  <input type="checkbox" checked={premiumPackagingEnabled} onChange={(e) => setPremiumPackagingEnabled(e.target.checked)} />
                </label>
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-medium text-slate-700">Label</label>
                    <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={premiumPackagingLabel} onChange={(e) => setPremiumPackagingLabel(e.target.value)} placeholder="Premium sealed packaging" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">Fee</label>
                    <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={premiumPackagingFee} onChange={(e) => setPremiumPackagingFee(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0.00" />
                  </div>
                </div>
              </div>

              <button type="button" onClick={saveProfile} disabled={busy} className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400">
                Save profile
              </button>
            </section>

            <section className="rounded-2xl border bg-white p-4 shadow-sm lg:col-span-2">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Menu manager</h2>
                  <p className="text-xs text-slate-500">Menu catalog. Free-tier limit: {usedCount}/{MAX_ITEMS} items used.</p>
                </div>
                <span className={cls("rounded-full border px-3 py-1 text-xs font-semibold", limitReached ? "border-rose-300 bg-rose-50 text-rose-700" : "border-slate-300 bg-slate-50 text-slate-700")}>{limitReached ? "Limit reached" : `${MAX_ITEMS - usedCount} slots left`}</span>
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
                    className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm"
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
                <div className="md:col-span-6">
                  <label className="text-xs font-medium text-slate-700">Packaging note</label>
                  <textarea className="mt-1 w-full rounded-xl border px-3 py-2 text-sm" rows={2} value={itemPackagingNote} onChange={(e) => setItemPackagingNote(e.target.value)} disabled={limitReached} placeholder="Example: Packed in standard takeaway packaging." />
                  <div className="mt-1 text-[11px] text-slate-500">This is separate from the menu description and explains the default packaging included with the item.</div>
                </div>
                <div className="flex flex-wrap items-center gap-4 md:col-span-6">
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={itemAvailable} onChange={(e) => setItemAvailable(e.target.checked)} disabled={limitReached} /> Available</label>
                  <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={itemSoldOut} onChange={(e) => setItemSoldOut(e.target.checked)} disabled={limitReached} /> Sold out today</label>
                  {itemPreview ? <img src={itemPreview} alt="Item preview" className="h-12 w-12 rounded-xl border object-cover" /> : null}
                  <button type="button" onClick={saveItem} disabled={busy || limitReached} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400">{editingId ? "Update item" : "Add item"}</button>
                  <button type="button" onClick={resetItemForm} className="rounded-xl border bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Clear</button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {menu.length === 0 ? (
                  <div className="rounded-xl border bg-white p-4 text-sm text-slate-600">No menu items yet.</div>
                ) : (
                  menu.map((m) => (
                    <div key={m.id || m.menu_item_id || m.name} className="group overflow-hidden rounded-2xl border bg-white shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                      <div className="h-36 bg-slate-100">
                        {m.photo_url ? <img src={m.photo_url} alt={m.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-xs text-slate-400">No photo</div>}
                      </div>
                      <div className="space-y-2 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="line-clamp-2 font-semibold leading-snug">{m.name}</div>
                            <div className="mt-1 text-base font-bold text-slate-900">{money(m.price)}</div>
                          </div>
                          <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50" onClick={() => editItem(m)}>Edit</button>
                        </div>
                        {m.description ? <div className="text-xs text-slate-500">{m.description}</div> : null}
                        {m.packaging_note ? <div className="rounded-lg border bg-slate-50 p-2 text-[11px] text-slate-600">Packaging: {m.packaging_note}</div> : null}
                        <div className="flex flex-wrap gap-2 text-xs">
                          <span className={cls("rounded-full border px-2 py-1", m.is_available ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-slate-50 text-slate-600")}>{m.is_available ? "Available" : "Unavailable"}</span>
                          {m.sold_out_today ? <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-1 text-rose-700">Sold out</span> : null}
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" className="rounded-lg border bg-white px-2 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50" onClick={() => toggleItem(m, { is_available: !m.is_available })}>{m.is_available ? "Make unavailable" : "Make available"}</button>
                          <button type="button" className={cls("rounded-lg border px-2 py-2 text-xs font-medium", m.sold_out_today ? "bg-white text-slate-700 hover:bg-slate-50" : "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100")} onClick={() => toggleItem(m, { sold_out_today: !m.sold_out_today })}>{m.sold_out_today ? "Clear sold out" : "Mark sold out"}</button>
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
                  <h2 className="text-lg font-semibold">Order queue</h2>
                  <p className="text-xs text-slate-500">Large simple controls for vendor processing.</p>
                </div>
                <div className="text-xs text-slate-500">Active: {activeOrders.length} | History: {historyOrders.length}</div>
              </div>

              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Active vendor workflow</h3>
                  <div className="mb-2 text-[11px] text-slate-500">Shows passenger, address, items, receipt request, packaging, and notes.</div>
                  <div className="space-y-2">
                    {activeOrders.length === 0 ? <div className="rounded-xl border bg-slate-50 p-3 text-sm text-slate-600">No active orders.</div> : null}
                    {activeOrders.map((o) => {
                      const s = normalizeVendorStatus(o.vendor_status);
                      return (
                        <div key={o.id || o.booking_code || Math.random()} className="rounded-2xl border p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="font-semibold">{o.booking_code || o.id}</div>
                              <div className="mt-1 grid gap-0.5 text-xs text-slate-600">
                                <div><span className="font-semibold text-slate-700">Passenger:</span> {orderCustomerName(o)}</div>
                                <div><span className="font-semibold text-slate-700">Phone:</span> {orderCustomerPhone(o)}</div>
                                <div><span className="font-semibold text-slate-700">Default address:</span> {orderDeliveryAddress(o)}</div>
                              </div>
                            </div>
                            <span className={cls("rounded-full border px-2 py-1 text-xs font-semibold", orderClass(s))}>{statusLabel(s)}</span>
                          </div>
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
                            <div>Receipt requested: {orderReceiptRequested(o) ? "YES" : "NO"}</div>
                            <div>Packaging: {orderPremiumPackagingSelected(o) ? orderOptionLabel(o) : "Standard item packaging"}</div>
                            {clean(o.note) ? <div>Customer note: {clean(o.note)}</div> : <div>Customer note: none</div>}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {s === "vendor_pending" ? (
                              <>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "vendor_accepted")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Accept order</button>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "cancelled")} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Reject order</button>
                              </>
                            ) : null}
                            {s === "vendor_accepted" ? (
                              <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">Vendor accepted. Dispatch can proceed. No second vendor action is required. Wait for driver assignment and mark Pickup ready only when the order is ready.</div>
                            ) : null}
                            {s === "driver_assigned" ? (
                              <>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "pickup_ready")} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Pickup ready</button>
                                <button type="button" disabled={busy} onClick={() => moveOrder(o, "cancelled")} className="rounded-xl border border-rose-300 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Cancel</button>
                              </>
                            ) : null}
                            {s === "pickup_ready" ? (
                              <button type="button" disabled={busy} onClick={() => moveOrder(o, "completed")} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-300">Completed</button>
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
                          <div>Default address: {orderDeliveryAddress(o)}</div>
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
