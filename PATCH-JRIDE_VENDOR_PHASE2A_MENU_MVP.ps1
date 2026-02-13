# PATCH-JRIDE_VENDOR_PHASE2A_MENU_MVP.ps1
# Phase 2A: Vendor Menu MVP (list + toggle available/soldout + optional price)
# Also fixes vendor-orders API to support pilot mode (no login) when vendor_id is present.
# UTF-8 no BOM. Creates backups before writing.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }
function Ok($m) { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"

$vendorOrdersPage = Join-Path $root "app\vendor-orders\page.tsx"
$vendorOrdersApi  = Join-Path $root "app\api\vendor-orders\route.ts"
$vendorMenuApiDir = Join-Path $root "app\api\vendor-menu"
$vendorMenuApi    = Join-Path $vendorMenuApiDir "route.ts"

if (!(Test-Path $vendorOrdersPage)) { Fail "Missing file: $vendorOrdersPage" }
if (!(Test-Path $vendorOrdersApi))  { Fail "Missing file: $vendorOrdersApi" }

# Backup helper
function Backup-File($path) {
  $bak = "$path.bak.$ts"
  Copy-Item -Force $path $bak
  Ok "Backup: $bak"
}

Backup-File $vendorOrdersPage
Backup-File $vendorOrdersApi

if (!(Test-Path $vendorMenuApiDir)) {
  New-Item -ItemType Directory -Force -Path $vendorMenuApiDir | Out-Null
  Ok "Created dir: $vendorMenuApiDir"
}

# ---------- Write app/api/vendor-orders/route.ts ----------
# Key change: allow unauthenticated pilot mode as long as vendor_id is provided.
# Uses service role for GET/POST in pilot mode.
$vendorOrdersApiContent = @'
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getServiceRoleAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;

  return createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function isAuthedWithEither(supabase: any) {
  // NextAuth session OR Supabase auth user
  const session = await auth().catch(() => null as any);
  if (session?.user) return true;

  const { data } = await supabase.auth.getUser();
  return !!data?.user;
}

// GET /api/vendor-orders?vendor_id=UUID
export async function GET(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  // Accept both vendor_id and vendorId (for safety)
  const vendor_id =
    String(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId") || "").trim();

  // PILOT MODE RULE:
  // - If authed: allow.
  // - If NOT authed: still allow, BUT vendor_id must be present (private link acts as the "key").
  const authed = await isAuthedWithEither(supabase);
  if (!authed && !vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required (pilot mode)" });
  }

  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  // Always read using service role to avoid RLS surprises in pilot mode.
  const { data, error } = await admin
    .from("bookings")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("created_at", { ascending: false });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  const rows = (Array.isArray(data) ? data : []) as any[];

  // Keep mapping very forgiving (no column assumptions beyond those read)
  const orders = rows.map((r) => ({
    id: r.id ?? null,
    booking_code: r.booking_code ?? null,
    vendor_id: r.vendor_id ?? vendor_id,
    vendor_status: r.vendor_status ?? r.vendorStatus ?? null,
    status: r.status ?? null,
    service_type: r.service_type ?? null,
    created_at: r.created_at ?? null,
    updated_at: r.updated_at ?? null,
    // optional display fields if present
    customer_name: r.customer_name ?? r.passenger_name ?? r.rider_name ?? null,
    customer_phone: r.customer_phone ?? r.passenger_phone ?? r.rider_phone ?? null,
    delivery_address: r.delivery_address ?? r.dropoff_label ?? null,
    items: r.items ?? null,
    note: r.note ?? null,
    total_bill: r.total_bill ?? r.totalBill ?? r.fare ?? null,
  }));

  return json(200, { ok: true, vendor_id, orders });
}

// POST /api/vendor-orders
// - Create when no order_id/orderId
// - Update vendor_status when order_id present
export async function POST(req: NextRequest) {
  const supabase = createRouteHandlerClient({ cookies });

  const body = await req.json().catch(() => ({} as any));

  const order_id = String(body.order_id ?? body.orderId ?? "").trim();
  const vendor_id = String(body.vendor_id ?? body.vendorId ?? "").trim();
  const vendor_status = String(body.vendor_status ?? body.vendorStatus ?? body.status ?? "").trim() || "preparing";

  // PILOT MODE RULE:
  // - If authed: allow.
  // - If NOT authed: still allow, BUT vendor_id must be present (private link acts as the "key").
  const authed = await isAuthedWithEither(supabase);
  if (!authed && !vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required (pilot mode)" });
  }

  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  if (!vendor_id) {
    return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
  }

  // CREATE (kept for completeness; you can ignore/disable from UI)
  if (!order_id) {
    const insertRow: any = {
      vendor_id,
      vendor_status,
      service_type: "takeout",
      status: "requested",
    };

    const { data, error } = await admin.from("bookings").insert(insertRow).select("*").single();

    if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

    return json(200, {
      ok: true,
      action: "created",
      order_id: data?.id ?? null,
      id: data?.id ?? null,
      booking_code: data?.booking_code ?? null,
      vendor_id: data?.vendor_id ?? vendor_id,
      vendor_status: data?.vendor_status ?? vendor_status,
    });
  }

  // UPDATE (vendor_status only)
  const patch: any = { vendor_status };

  const { data, error } = await admin
    .from("bookings")
    .update(patch)
    .eq("id", order_id)
    .eq("vendor_id", vendor_id)
    .select("*")
    .single();

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, {
    ok: true,
    action: "updated",
    order_id: data?.id ?? order_id,
    vendor_id,
    vendor_status: data?.vendor_status ?? vendor_status,
  });
}
'@

# ---------- Write app/api/vendor-menu/route.ts ----------
# Uses service role. Pilot mode: requires vendor_id.
# GET: list today's menu via view vendor_menu_today
# POST: actions: toggle_available, toggle_soldout, update_price
$vendorMenuApiContent = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getServiceRoleAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;

  return createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toNum(v: any): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

type Action = "toggle_available" | "toggle_soldout" | "update_price";

export async function GET(req: NextRequest) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const vendor_id = String(req.nextUrl.searchParams.get("vendor_id") || "").trim();
  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });

  // Read from view created in your schema: public.vendor_menu_today
  const { data, error } = await admin
    .from("vendor_menu_today")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, vendor_id, items: Array.isArray(data) ? data : [] });
}

export async function POST(req: NextRequest) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));

  const vendor_id = String(body.vendor_id || body.vendorId || "").trim();
  const menu_item_id = String(body.menu_item_id || body.menuItemId || "").trim();
  const action = String(body.action || "").trim() as Action;

  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
  if (!menu_item_id) return json(400, { ok: false, error: "menu_item_id_required", message: "menu_item_id required" });

  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  // Use a date string; DB view uses current_date anyway, but day_state uses date.
  const service_date = `${yyyy}-${mm}-${dd}`;

  // Upsert day_state row first (so toggles always have a row to update)
  // NOTE: service_date is in UTC here; for PH local date you can later switch to app-provided service_date.
  const upsertBase: any = {
    vendor_id,
    menu_item_id,
    service_date,
    last_updated_at: new Date().toISOString(),
  };

  // Fetch current day_state (if any)
  const { data: existing, error: exErr } = await admin
    .from("vendor_menu_item_day_state")
    .select("*")
    .eq("menu_item_id", menu_item_id)
    .eq("service_date", service_date)
    .maybeSingle();

  if (exErr) return json(500, { ok: false, error: "DB_ERROR", message: exErr.message });

  const curAvail = existing?.is_available_today ?? true;
  const curSold = existing?.is_sold_out_today ?? false;

  if (action === "toggle_available") {
    upsertBase.is_available_today = !curAvail;
    // If making unavailable, sold out doesn't matter; keep sold_out as-is.
    upsertBase.is_sold_out_today = curSold;
  } else if (action === "toggle_soldout") {
    upsertBase.is_sold_out_today = !curSold;
    // Sold out implies not orderable; keep available true but UI will block order.
    upsertBase.is_available_today = curAvail;
  } else if (action === "update_price") {
    const p = toNum(body.price);
    if (p === null) return json(400, { ok: false, error: "bad_price", message: "price must be a number" });

    // Update base menu item price (stable catalog)
    const { error: pErr } = await admin
      .from("vendor_menu_items")
      .update({ price: p })
      .eq("id", menu_item_id)
      .eq("vendor_id", vendor_id);

    if (pErr) return json(500, { ok: false, error: "DB_ERROR", message: pErr.message });

    // Touch day_state last_updated
    upsertBase.is_available_today = curAvail;
    upsertBase.is_sold_out_today = curSold;
  } else {
    return json(400, { ok: false, error: "bad_action", message: "Unknown action" });
  }

  const { error: upErr } = await admin
    .from("vendor_menu_item_day_state")
    .upsert(upsertBase, { onConflict: "menu_item_id,service_date" });

  if (upErr) return json(500, { ok: false, error: "DB_ERROR", message: upErr.message });

  // Return refreshed list
  const { data, error } = await admin
    .from("vendor_menu_today")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, vendor_id, items: Array.isArray(data) ? data : [] });
}
'@

# ---------- Write app/vendor-orders/page.tsx ----------
# Adds a Menu tab without breaking Orders behavior.
# Menu actions use existing vendorActionBlocked (geo gate).
$vendorOrdersPageContent = @'
"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import OfflineIndicator from "@/components/OfflineIndicator";

type VendorOrderStatus = "preparing" | "driver_arrived" | "picked_up" | "completed";

type VendorOrder = {
  id: string;
  bookingCode: string;
  customerName: string;
  totalBill: number;
  status: VendorOrderStatus;
  createdAt: string;
};

type ApiOrder = {
  id: string;
  booking_code: string;
  customer_name: string;
  total_bill: number;
  vendor_status: VendorOrderStatus | null;
  created_at: string;
};

type MenuItem = {
  menu_item_id: string;
  vendor_id: string;
  name: string;
  description: string | null;
  price: number;
  sort_order: number;
  is_active: boolean;
  service_date: string;
  is_available_today: boolean;
  is_sold_out_today: boolean;
  last_updated_at: string;
  created_at?: string | null;
};

function formatAmount(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "PHP 0.00";
  return "PHP " + v.toFixed(2);
}

function isSameLocalDay(iso: string | null | undefined) {
  if (!iso) return false;
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function VendorOrdersInner() {
  const searchParams = useSearchParams();
  const vendorIdFromQuery = String(searchParams?.get("vendor_id") || "").trim();

  // PHASE15_VENDORID_REMEMBER: store vendor_id once then keep URL clean (/vendor-orders)
  const [vendorId, setVendorId] = useState<string>("");

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const fromQuery = String(vendorIdFromQuery || "").trim();
      const stored = String(window.localStorage.getItem("JRIDE_VENDOR_ID") || "").trim();
      const resolved = (fromQuery || stored).trim();

      if (fromQuery) {
        window.localStorage.setItem("JRIDE_VENDOR_ID", fromQuery);
        // Clean the page URL (do not keep vendor_id in address bar)
        try {
          const clean = window.location.pathname;
          window.history.replaceState({}, "", clean);
        } catch {}
      }

      setVendorId(resolved);
    } catch {
      setVendorId(String(vendorIdFromQuery || "").trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorIdFromQuery]);

  // UI
  const [tab, setTab] = useState<"orders" | "menu">("orders");

  // Orders state
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const activeOrders = useMemo(() => orders.filter((o) => o.status !== "completed"), [orders]);
  const completedOrders = useMemo(() => orders.filter((o) => o.status === "completed"), [orders]);

  // PHASE14_VENDOR_CORE_HARDEN: UI-only vendor transition gating
  const VENDOR_FLOW_UI = ["preparing", "driver_arrived", "picked_up", "completed"] as const;
  type VendorFlowStatus = (typeof VENDOR_FLOW_UI)[number];

  function normVendorFlowStatus(s: any): VendorFlowStatus | null {
    const v = String(s || "").trim();
    return (VENDOR_FLOW_UI as readonly string[]).includes(v) ? (v as VendorFlowStatus) : null;
  }

  function nextVendorFlowStatus(cur: VendorFlowStatus): VendorFlowStatus | null {
    const i = VENDOR_FLOW_UI.indexOf(cur);
    if (i < 0) return null;
    return i + 1 < VENDOR_FLOW_UI.length ? VENDOR_FLOW_UI[i + 1] : null;
  }

  function vendorCanTransitionUI(order: any, target: any): boolean {
    const cur = normVendorFlowStatus(order?.status);
    const tgt = normVendorFlowStatus(target);
    if (!cur || !tgt) return true; // fails open if unknown
    if (cur === tgt) return false; // no-op clicks disabled
    const next = nextVendorFlowStatus(cur);
    return next === tgt;
  }

  // PHASE13_VENDOR_ACTION_GEO_GATE (kept)
  const DEV_VENDOR_GEO_BYPASS = process.env.NEXT_PUBLIC_VENDOR_GEO_BYPASS === "1";
  const [vGeoPermission, setVGeoPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [vGeoInsideIfugao, setVGeoInsideIfugao] = useState<boolean>(false);
  const [vGeoErr, setVGeoErr] = useState<string | null>(null);
  const [vGeoLast, setVGeoLast] = useState<{ lat: number; lng: number } | null>(null);

  const IFUGAO_BBOX = { minLat: 16.4, maxLat: 17.8, minLng: 120.8, maxLng: 121.7 };

  function inIfugaoBBox(lat: number, lng: number) {
    return lat >= IFUGAO_BBOX.minLat && lat <= IFUGAO_BBOX.maxLat && lng >= IFUGAO_BBOX.minLng && lng <= IFUGAO_BBOX.maxLng;
  }

  async function refreshVendorGeoGate(opts?: { prompt?: boolean }) {
    try {
      setVGeoErr(null);

      if (typeof window === "undefined" || typeof navigator === "undefined") {
        setVGeoPermission("unknown");
        setVGeoInsideIfugao(false);
        return;
      }

      if (!("geolocation" in navigator)) {
        setVGeoPermission("denied");
        setVGeoInsideIfugao(false);
        setVGeoErr("Geolocation not supported on this device/browser.");
        return;
      }

      const permApi: any = (navigator as any).permissions;
      if (permApi && permApi.query) {
        try {
          const st = await permApi.query({ name: "geolocation" });
          if (st?.state === "granted") setVGeoPermission("granted");
          else if (st?.state === "denied") setVGeoPermission("denied");
          else setVGeoPermission("unknown");
        } catch {}
      }

      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: opts?.prompt ? 0 : 30000,
        });
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      setVGeoLast({ lat, lng });
      setVGeoPermission("granted");

      const inside = inIfugaoBBox(lat, lng);
      setVGeoInsideIfugao(inside);
      if (!inside) setVGeoErr("Action blocked: you appear outside Ifugao.");
    } catch (e: any) {
      const code = e?.code;
      const msg =
        code === 1 ? "Location permission denied. Actions are disabled."
        : code === 2 ? "Location unavailable. Actions are disabled."
        : code === 3 ? "Location request timed out. Actions are disabled."
        : e?.message || "Location check failed. Actions are disabled.";

      setVGeoPermission(code === 1 ? "denied" : "unknown");
      setVGeoInsideIfugao(false);
      setVGeoErr(msg);
    }
  }

  useEffect(() => {
    refreshVendorGeoGate({ prompt: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const vendorActionBlocked = !DEV_VENDOR_GEO_BYPASS && !(vGeoPermission === "granted" && vGeoInsideIfugao);

  // Prevent poll flicker while a status update is in-flight
  const updatingIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    updatingIdRef.current = updatingId;
  }, [updatingId]);

  const loadOrders = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const res = await fetch(
        vendorId ? "/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorId) : "/api/vendor-orders",
        { method: "GET", headers: { Accept: "application/json" } }
      );

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Failed to load orders (status ${res.status})`;
        throw new Error(msg);
      }

      const data: { orders: ApiOrder[] } = j;

      const mapped: VendorOrder[] = (data.orders || []).map((o) => ({
        id: o.id,
        bookingCode: o.booking_code,
        customerName: o.customer_name ?? "",
        totalBill: (o.total_bill ?? 0) as any,
        status: (o.vendor_status ?? "preparing") as VendorOrderStatus,
        createdAt: o.created_at,
      }));

      if (updatingIdRef.current) return;
      setOrders(mapped);
    } catch (err: any) {
      console.error("[VendorOrders] loadOrders error:", err);
      setError(err?.message || "Failed to load orders.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders().catch(() => undefined);
    const t = setInterval(() => {
      loadOrders().catch(() => undefined);
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderStatusBadge = (status: VendorOrderStatus) => {
    const base = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border";
    switch (status) {
      case "preparing":
        return <span className={`${base} bg-amber-50 text-amber-700 border-amber-200`}>preparing</span>;
      case "driver_arrived":
        return <span className={`${base} bg-sky-50 text-sky-700 border-sky-200`}>ready</span>;
      case "picked_up":
        return <span className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}>picked up</span>;
      case "completed":
      default:
        return <span className={`${base} bg-slate-100 text-slate-600 border-slate-200`}>completed</span>;
    }
  };

  async function handleStatusUpdate(order: VendorOrder, nextStatus: any) {
    try {
      setError(null);
      setUpdatingId(order.id);

      // Instant UI feedback
      setOrders((prev) => prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o)));

      const res = await fetch(
        vendorId ? "/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorId) : "/api/vendor-orders",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order_id: order.id,
            vendor_id: vendorId,
            vendor_status: String(nextStatus),
          }),
        }
      );

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Failed to update status (HTTP ${res.status})`;
        throw new Error(msg);
      }

      await loadOrders();
    } catch (err: any) {
      console.error("[VendorOrders] handleStatusUpdate error:", err);
      setError(err?.message || "Failed to update order status.");
      try { await loadOrders(); } catch {}
    } finally {
      setUpdatingId(null);
    }
  }

  // -------- MENU (Phase 2A MVP) --------
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState<boolean>(false);
  const [menuErr, setMenuErr] = useState<string | null>(null);
  const [menuBusy, setMenuBusy] = useState<string | null>(null); // menu_item_id busy
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  const staleMenu = useMemo(() => {
    if (menuItems.length === 0) return false;
    // consider stale if ALL items have last_updated_at not today
    const anyUpdatedToday = menuItems.some((it) => isSameLocalDay(it.last_updated_at));
    return !anyUpdatedToday;
  }, [menuItems]);

  async function loadMenu() {
    try {
      setMenuLoading(true);
      setMenuErr(null);
      if (!vendorId) {
        setMenuItems([]);
        return;
      }
      const res = await fetch("/api/vendor-menu?vendor_id=" + encodeURIComponent(vendorId), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Failed to load menu (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const items = Array.isArray(j.items) ? (j.items as MenuItem[]) : [];
      setMenuItems(items);
      // seed priceDraft
      const next: Record<string, string> = {};
      for (const it of items) next[String(it.menu_item_id)] = String(it.price ?? "");
      setPriceDraft(next);
    } catch (e: any) {
      setMenuErr(String(e?.message || e || "Failed to load menu"));
    } finally {
      setMenuLoading(false);
    }
  }

  useEffect(() => {
    // Load menu once vendorId resolves
    if (vendorId) loadMenu().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  async function menuAction(menu_item_id: string, action: "toggle_available" | "toggle_soldout" | "update_price") {
    try {
      setMenuErr(null);
      if (!vendorId) throw new Error("vendor_id missing");
      setMenuBusy(menu_item_id);

      const body: any = { vendor_id: vendorId, menu_item_id, action };
      if (action === "update_price") {
        body.price = priceDraft[menu_item_id];
      }

      const res = await fetch("/api/vendor-menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Menu update failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      const items = Array.isArray(j.items) ? (j.items as MenuItem[]) : [];
      setMenuItems(items);
    } catch (e: any) {
      setMenuErr(String(e?.message || e || "Menu action failed"));
      // best-effort refresh
      try { await loadMenu(); } catch {}
    } finally {
      setMenuBusy(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Action gating banner (page still accessible) */}
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Vendor action location check</div>
          <button
            type="button"
            className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] hover:bg-amber-100"
            onClick={() => refreshVendorGeoGate({ prompt: true })}
          >
            Refresh location
          </button>
        </div>
        <div className="mt-1 opacity-90">
          Permission: <span className="font-semibold">{vGeoPermission}</span> | Inside Ifugao:{" "}
          <span className="font-semibold">{String(vGeoInsideIfugao)}</span>{" "}
          {vGeoLast ? (
            <span className="opacity-80">| Last: {vGeoLast.lat.toFixed(5)},{vGeoLast.lng.toFixed(5)}</span>
          ) : (
            <span className="opacity-80">| Last: n/a</span>
          )}
        </div>
        {vendorActionBlocked ? (
          <div className="mt-1 text-red-700">
            Actions disabled until location permission is granted and you are inside Ifugao.
            {vGeoErr ? <span className="opacity-90"> ({vGeoErr})</span> : null}
          </div>
        ) : (
          <div className="mt-1 text-emerald-700">Actions enabled.</div>
        )}
      </div>

      {/* Vendor context */}
      {!vendorId ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <div className="font-medium">Vendor context not set</div>
          <div className="mt-1 opacity-90">
            Open the private vendor link once so this device remembers vendor_id.
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
          Vendor ID: <span className="font-semibold">{vendorId}</span>
        </div>
      )}

      <OfflineIndicator />

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white shadow-sm border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">JRide Vendor</h1>
            <p className="text-xs text-slate-500">Orders + Menu (pilot mode)</p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => setTab("orders")}
              className={`rounded-full border px-3 py-1 ${tab === "orders" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}
            >
              Orders
            </button>
            <button
              type="button"
              onClick={() => setTab("menu")}
              className={`rounded-full border px-3 py-1 ${tab === "menu" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"}`}
            >
              Menu
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4 space-y-6">
        {tab === "orders" ? (
          <>
            {/* Error / loading */}
            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">{error}</div>
                  <button
                    type="button"
                    className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                    onClick={() => loadOrders().catch(() => undefined)}
                    disabled={isLoading}
                  >
                    Retry
                  </button>
                </div>
              </div>
            )}
            {isLoading && (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                Loading orders...
              </div>
            )}

            {/* KPI pills */}
            <div className="flex items-center gap-3 text-xs">
              <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                Active: <span className="font-semibold">{activeOrders.length}</span>
              </div>
              <div className="px-3 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
                Completed: <span className="font-semibold">{completedOrders.length}</span>
              </div>
            </div>

            {/* Active orders */}
            <section>
              <h2 className="text-sm font-semibold text-slate-800 mb-2">Active orders</h2>

              {activeOrders.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
                  No active takeout orders right now.
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Code</th>
                        <th className="px-3 py-2 text-left font-semibold">Customer</th>
                        <th className="px-3 py-2 text-left font-semibold">Bill</th>
                        <th className="px-3 py-2 text-left font-semibold">Status</th>
                        <th className="px-3 py-2 text-left font-semibold">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2 font-semibold text-slate-900">{o.bookingCode}</td>
                          <td className="px-3 py-2 text-slate-700">{o.customerName}</td>
                          <td className="px-3 py-2 text-slate-900">{formatAmount(o.totalBill)}</td>
                          <td className="px-3 py-2">{renderStatusBadge(o.status)}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {o.status === "preparing" && (
                                <button
                                  type="button"
                                  disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o, "driver_arrived")}
                                  onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o, "driver_arrived") ? null : handleStatusUpdate(o, "driver_arrived"))}
                                  className="rounded-full border border-sky-500 px-2 py-1 text-[11px] text-sky-700 hover:bg-sky-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  Mark ready
                                </button>
                              )}
                              {o.status === "driver_arrived" && (
                                <button
                                  type="button"
                                  disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o, "picked_up")}
                                  onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o, "picked_up") ? null : handleStatusUpdate(o, "picked_up"))}
                                  className="rounded-full border border-emerald-500 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  Order picked up
                                </button>
                              )}
                              {o.status === "picked_up" && (
                                <button
                                  type="button"
                                  disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o, "completed")}
                                  onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o, "completed") ? null : handleStatusUpdate(o, "completed"))}
                                  className="rounded-full border border-slate-500 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                  Mark completed
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Completed */}
            <section>
              <h2 className="text-sm font-semibold text-slate-800 mb-2">Completed orders</h2>
              {completedOrders.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-xs text-slate-500">
                  No completed orders yet for today.
                </div>
              ) : (
                <ul className="space-y-1 text-xs">
                  {completedOrders.map((o) => (
                    <li key={o.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-900">{o.bookingCode}</span>
                        <span className="text-slate-500">{o.customerName}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-slate-900">{formatAmount(o.totalBill)}</div>
                        <div className="text-[11px] text-slate-400">Completed</div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <>
            {/* MENU TAB */}
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-800">Menu (today)</h2>
                <p className="text-xs text-slate-500">Toggle availability / sold out, update price. No deletes.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadMenu().catch(() => undefined)}
                  className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs hover:bg-black/5"
                  disabled={menuLoading}
                >
                  Refresh
                </button>
              </div>
            </div>

            {staleMenu ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <div className="font-medium">Menu not updated today</div>
                <div className="mt-1 opacity-90">Please review availability so passengers only see what is available today.</div>
              </div>
            ) : null}

            {menuErr ? (
              <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                {menuErr}
              </div>
            ) : null}

            {menuLoading ? (
              <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                Loading menu...
              </div>
            ) : null}

            {!menuLoading && menuItems.length === 0 ? (
              <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
                No menu items yet. (Admin will seed items first in MVP.)
              </div>
            ) : null}

            {!menuLoading && menuItems.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Item</th>
                      <th className="px-3 py-2 text-left font-semibold">Price</th>
                      <th className="px-3 py-2 text-left font-semibold">Today</th>
                      <th className="px-3 py-2 text-left font-semibold">Last updated</th>
                      <th className="px-3 py-2 text-left font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {menuItems.map((it) => {
                      const id = String(it.menu_item_id);
                      const busy = menuBusy === id;
                      const updatedToday = isSameLocalDay(it.last_updated_at);
                      return (
                        <tr key={id} className="hover:bg-slate-50/60">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-slate-900">{it.name}</div>
                            {it.description ? <div className="text-[11px] text-slate-500">{it.description}</div> : null}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <input
                                value={priceDraft[id] ?? String(it.price ?? "")}
                                onChange={(e) => setPriceDraft((p) => ({ ...p, [id]: e.target.value }))}
                                className="w-24 rounded border border-slate-200 px-2 py-1 text-xs"
                                inputMode="decimal"
                              />
                              <button
                                type="button"
                                disabled={vendorActionBlocked || busy}
                                onClick={() => (vendorActionBlocked ? null : menuAction(id, "update_price"))}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                Save
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1">
                              <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-medium border ${
                                it.is_sold_out_today ? "bg-rose-50 text-rose-700 border-rose-200"
                                : it.is_available_today ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                : "bg-slate-100 text-slate-600 border-slate-200"
                              }`}>
                                {it.is_sold_out_today ? "Sold out" : it.is_available_today ? "Available" : "Unavailable"}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className={`text-[11px] ${updatedToday ? "text-emerald-700" : "text-amber-700"}`}>
                              {it.last_updated_at ? new Date(it.last_updated_at).toLocaleString() : "-"}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                disabled={vendorActionBlocked || busy}
                                onClick={() => (vendorActionBlocked ? null : menuAction(id, "toggle_available"))}
                                className="rounded-full border border-slate-500 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                Toggle available
                              </button>
                              <button
                                type="button"
                                disabled={vendorActionBlocked || busy}
                                onClick={() => (vendorActionBlocked ? null : menuAction(id, "toggle_soldout"))}
                                className="rounded-full border border-rose-500 px-2 py-1 text-[11px] text-rose-700 hover:bg-rose-50 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                Toggle sold out
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}

            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
              Note: Admin will seed initial menu items in <span className="font-semibold">vendor_menu_items</span>. Vendors can only toggle and update price in MVP.
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export default function VendorOrdersPage() {
  return (
    <Suspense fallback={<div className="p-4 text-xs text-slate-500">Loading vendor...</div>}>
      <VendorOrdersInner />
    </Suspense>
  );
}
'@

# Write files as UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

[System.IO.File]::WriteAllText($vendorOrdersApi, $vendorOrdersApiContent, $utf8NoBom)
Ok "Wrote: $vendorOrdersApi"

[System.IO.File]::WriteAllText($vendorMenuApi, $vendorMenuApiContent, $utf8NoBom)
Ok "Wrote: $vendorMenuApi"

[System.IO.File]::WriteAllText($vendorOrdersPage, $vendorOrdersPageContent, $utf8NoBom)
Ok "Wrote: $vendorOrdersPage"

Write-Host ""
Ok "Phase 2A patch applied."
Write-Host "Next: run build, then test /vendor-orders -> Menu tab." -ForegroundColor Cyan
