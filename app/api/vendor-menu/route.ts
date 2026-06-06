import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type Action = "toggle_available" | "toggle_soldout" | "update_price" | "set_vendor_accepting";

type DayState = {
  menu_item_id?: string | null;
  is_available_today?: boolean | null;
  is_sold_out_today?: boolean | null;
};

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
  return Number.isFinite(n) ? n : null;
}

function boolFromBody(v: any, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "open", "accepting"].includes(s)) return true;
  if (["0", "false", "no", "closed", "paused"].includes(s)) return false;
  return fallback;
}

function serviceDateManila(): string {
  // JRIDE_VENDOR_MENU_DAYSTATE_AUTHORITATIVE_V1
  // Use Philippine service day for vendor availability rows.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const yyyy = parts.find((p) => p.type === "year")?.value || "";
  const mm = parts.find((p) => p.type === "month")?.value || "";
  const dd = parts.find((p) => p.type === "day")?.value || "";
  return `${yyyy}-${mm}-${dd}`;
}

function idOf(row: any): string {
  return String(row?.id ?? row?.menu_item_id ?? row?.menuItemId ?? "").trim();
}

function normalizeBaseMenuRow(row: any) {
  const availableBase =
    typeof row?.is_available === "boolean"
      ? row.is_available
      : typeof row?.is_available_today === "boolean"
        ? row.is_available_today
        : true;

  const soldBase =
    typeof row?.sold_out_today === "boolean"
      ? row.sold_out_today
      : typeof row?.is_sold_out_today === "boolean"
        ? row.is_sold_out_today
        : false;

  return {
    ...row,
    is_available: availableBase,
    is_available_today: availableBase,
    sold_out_today: soldBase,
    is_sold_out_today: soldBase,
  };
}

async function loadDayStateMap(admin: any, vendor_id: string, service_date: string) {
  const state = await admin
    .from("vendor_menu_item_day_state")
    .select("menu_item_id,is_available_today,is_sold_out_today")
    .eq("vendor_id", vendor_id)
    .eq("service_date", service_date);

  if (state.error) throw state.error;

  const map = new Map<string, DayState>();
  for (const row of Array.isArray(state.data) ? state.data : []) {
    const id = String(row?.menu_item_id || "").trim();
    if (id) map.set(id, row as DayState);
  }
  return map;
}

function overlayDayState(rows: any[], dayStateMap: Map<string, DayState>) {
  return rows.map((raw) => {
    const row = normalizeBaseMenuRow(raw);
    const state = dayStateMap.get(idOf(row));
    if (!state) return row;

    const available =
      typeof state.is_available_today === "boolean"
        ? state.is_available_today
        : row.is_available !== false;

    const soldOut =
      typeof state.is_sold_out_today === "boolean"
        ? state.is_sold_out_today
        : row.sold_out_today === true;

    return {
      ...row,
      is_available: available,
      is_available_today: available,
      sold_out_today: soldOut,
      is_sold_out_today: soldOut,
    };
  });
}

function computeAcceptingOrders(rows: any[]): boolean {
  if (!rows.length) return true;
  return rows.some((row) => row?.is_available !== false && row?.sold_out_today !== true);
}

async function loadMenuOptionsMap(admin: any, vendor_id: string, menu_item_ids: string[]) {
  const ids = Array.from(new Set(menu_item_ids.map((id) => cleanString(id)).filter(Boolean)));

  const variantsByItem = new Map<string, any[]>();
  const addonsByItem = new Map<string, any[]>();

  if (!ids.length) {
    return { variantsByItem, addonsByItem };
  }

  const variants = await admin
    .from("vendor_menu_item_variants")
    .select("id,vendor_id,menu_item_id,group_name,option_name,price,sort_order,is_active")
    .eq("vendor_id", vendor_id)
    .in("menu_item_id", ids)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("option_name", { ascending: true });

  if (variants.error) throw variants.error;

  for (const row of Array.isArray(variants.data) ? variants.data : []) {
    const key = cleanString(row?.menu_item_id);
    if (!key) continue;
    const list = variantsByItem.get(key) || [];
    list.push({
      id: cleanString(row?.id),
      vendor_id: cleanString(row?.vendor_id),
      menu_item_id: key,
      group_name: cleanString(row?.group_name),
      option_name: cleanString(row?.option_name),
      price: toNum(row?.price) ?? 0,
      sort_order: toNum(row?.sort_order) ?? 0,
      is_active: row?.is_active !== false,
    });
    variantsByItem.set(key, list);
  }

  const addons = await admin
    .from("vendor_menu_item_addons")
    .select("id,vendor_id,menu_item_id,addon_name,price,sort_order,is_active")
    .eq("vendor_id", vendor_id)
    .in("menu_item_id", ids)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("addon_name", { ascending: true });

  if (addons.error) throw addons.error;

  for (const row of Array.isArray(addons.data) ? addons.data : []) {
    const key = cleanString(row?.menu_item_id);
    if (!key) continue;
    const list = addonsByItem.get(key) || [];
    list.push({
      id: cleanString(row?.id),
      vendor_id: cleanString(row?.vendor_id),
      menu_item_id: key,
      addon_name: cleanString(row?.addon_name),
      price: toNum(row?.price) ?? 0,
      sort_order: toNum(row?.sort_order) ?? 0,
      is_active: row?.is_active !== false,
    });
    addonsByItem.set(key, list);
  }

  return { variantsByItem, addonsByItem };
}


async function loadVendorProfile(admin: any, vendor_id: string) {
  const byId = await admin.from("vendor_accounts").select("*").eq("id", vendor_id).limit(1);
  if (!byId.error && Array.isArray(byId.data) && byId.data[0]) return byId.data[0];
  const byEmail = await admin.from("vendor_accounts").select("*").eq("email", vendor_id).limit(1);
  if (!byEmail.error && Array.isArray(byEmail.data) && byEmail.data[0]) return byEmail.data[0];
  return null;
}

function cleanString(v: any) {
  return String(v ?? "").trim();
}

async function loadMenuWithAuthoritativeDayState(admin: any, vendor_id: string, service_date: string) {
  const menu = await admin
    .from("vendor_menu_today")
    .select("*")
    .eq("vendor_id", vendor_id)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if (menu.error) throw menu.error;

  const rows = Array.isArray(menu.data) ? menu.data : [];
  const dayStateMap = await loadDayStateMap(admin, vendor_id, service_date);
  const baseItems = overlayDayState(rows, dayStateMap);
  const menuItemIds = baseItems.map((row) => idOf(row)).filter(Boolean);
  const { variantsByItem, addonsByItem } = await loadMenuOptionsMap(admin, vendor_id, menuItemIds);

  const items = baseItems.map((row) => {
    const itemId = idOf(row);
    return {
      ...row,
      variants: variantsByItem.get(itemId) || [],
      addons: addonsByItem.get(itemId) || [],
      has_variants: (variantsByItem.get(itemId) || []).length > 0,
      has_addons: (addonsByItem.get(itemId) || []).length > 0,
    };
  });

  const accepting_orders = computeAcceptingOrders(items);

  return { items, accepting_orders };
}

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

  const service_date = serviceDateManila();

  try {
    const { items, accepting_orders } = await loadMenuWithAuthoritativeDayState(admin, vendor_id, service_date);
    const vendor = await loadVendorProfile(admin, vendor_id);
    const premiumPackagingEnabled = vendor?.premium_packaging_enabled === true || vendor?.premiumPackagingEnabled === true;
    const premiumPackagingFee = Number(vendor?.premium_packaging_fee ?? vendor?.premiumPackagingFee ?? 0);
    const premiumPackagingLabel = cleanString(vendor?.premium_packaging_label || vendor?.premiumPackagingLabel || "Premium packaging") || "Premium packaging";

    return json(200, {
      ok: true,
      vendor_id,
      service_date,
      accepting_orders,
      vendor: vendor ? {
        id: cleanString(vendor?.id || vendor_id),
        vendor_id,
        name: cleanString(vendor?.display_name || vendor?.vendor_name || vendor?.name || vendor_id),
        premium_packaging_enabled: premiumPackagingEnabled,
        premium_packaging_fee: Number.isFinite(premiumPackagingFee) ? premiumPackagingFee : 0,
        premium_packaging_label: premiumPackagingLabel,
      } : null,
      premium_packaging_enabled: premiumPackagingEnabled,
      premium_packaging_fee: Number.isFinite(premiumPackagingFee) ? premiumPackagingFee : 0,
      premium_packaging_label: premiumPackagingLabel,
      vendor_accepting_orders: accepting_orders,
      vendor_open: accepting_orders,
      is_open: accepting_orders,
      items,
    });
  } catch (error: any) {
    return json(500, { ok: false, error: "DB_ERROR", message: error?.message || "Failed to load vendor menu" });
  }
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

  const service_date = serviceDateManila();

  if (action === "set_vendor_accepting") {
    const accepting = boolFromBody(body.accepting_orders ?? body.acceptingOrders ?? body.is_available ?? body.isAvailable, true);

    const menu = await admin
      .from("vendor_menu_items")
      .select("id")
      .eq("vendor_id", vendor_id);

    if (menu.error) return json(500, { ok: false, error: "DB_ERROR", message: menu.error.message });

    const ids = (Array.isArray(menu.data) ? menu.data : [])
      .map((r: any) => String(r?.id || "").trim())
      .filter(Boolean);

    if (ids.length) {
      const rows = ids.map((id: string) => ({
        vendor_id,
        menu_item_id: id,
        service_date,
        is_available_today: accepting,
        is_sold_out_today: false,
        last_updated_at: new Date().toISOString(),
      }));

      const up = await admin
        .from("vendor_menu_item_day_state")
        .upsert(rows, { onConflict: "menu_item_id,service_date" });

      if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
    }

    try {
      const { items, accepting_orders } = await loadMenuWithAuthoritativeDayState(admin, vendor_id, service_date);
      return json(200, {
        ok: true,
        action: "set_vendor_accepting",
        vendor_id,
        service_date,
        accepting_orders,
        vendor_accepting_orders: accepting_orders,
        vendor_open: accepting_orders,
        is_open: accepting_orders,
        requested_accepting_orders: accepting,
        affected_menu_items: ids.length,
        items,
      });
    } catch (error: any) {
      return json(500, { ok: false, error: "DB_ERROR", message: error?.message || "Failed to refresh vendor menu" });
    }
  }

  if (!menu_item_id) return json(400, { ok: false, error: "menu_item_id_required", message: "menu_item_id required" });

  const upsertBase: any = {
    vendor_id,
    menu_item_id,
    service_date,
    last_updated_at: new Date().toISOString(),
  };

  const existing = await admin
    .from("vendor_menu_item_day_state")
    .select("*")
    .eq("menu_item_id", menu_item_id)
    .eq("service_date", service_date)
    .maybeSingle();

  if (existing.error) return json(500, { ok: false, error: "DB_ERROR", message: existing.error.message });

  const curAvail = existing.data?.is_available_today ?? true;
  const curSold = existing.data?.is_sold_out_today ?? false;

  if (action === "toggle_available") {
    upsertBase.is_available_today = !curAvail;
    upsertBase.is_sold_out_today = curSold;
  } else if (action === "toggle_soldout") {
    upsertBase.is_sold_out_today = !curSold;
    upsertBase.is_available_today = curAvail;
  } else if (action === "update_price") {
    const p = toNum(body.price);
    if (p === null) return json(400, { ok: false, error: "bad_price", message: "price must be a number" });

    const priceUpdate = await admin
      .from("vendor_menu_items")
      .update({ price: p })
      .eq("id", menu_item_id)
      .eq("vendor_id", vendor_id);

    if (priceUpdate.error) return json(500, { ok: false, error: "DB_ERROR", message: priceUpdate.error.message });

    upsertBase.is_available_today = curAvail;
    upsertBase.is_sold_out_today = curSold;
  } else {
    return json(400, { ok: false, error: "bad_action", message: "Unknown action" });
  }

  const up = await admin
    .from("vendor_menu_item_day_state")
    .upsert(upsertBase, { onConflict: "menu_item_id,service_date" });

  if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });

  try {
    const { items, accepting_orders } = await loadMenuWithAuthoritativeDayState(admin, vendor_id, service_date);
    const vendor = await loadVendorProfile(admin, vendor_id);
    const premiumPackagingEnabled = vendor?.premium_packaging_enabled === true || vendor?.premiumPackagingEnabled === true;
    const premiumPackagingFee = Number(vendor?.premium_packaging_fee ?? vendor?.premiumPackagingFee ?? 0);
    const premiumPackagingLabel = cleanString(vendor?.premium_packaging_label || vendor?.premiumPackagingLabel || "Premium packaging") || "Premium packaging";
    return json(200, {
      ok: true,
      vendor_id,
      service_date,
      accepting_orders,
      vendor: vendor ? {
        id: cleanString(vendor?.id || vendor_id),
        vendor_id,
        name: cleanString(vendor?.display_name || vendor?.vendor_name || vendor?.name || vendor_id),
        premium_packaging_enabled: premiumPackagingEnabled,
        premium_packaging_fee: Number.isFinite(premiumPackagingFee) ? premiumPackagingFee : 0,
        premium_packaging_label: premiumPackagingLabel,
      } : null,
      premium_packaging_enabled: premiumPackagingEnabled,
      premium_packaging_fee: Number.isFinite(premiumPackagingFee) ? premiumPackagingFee : 0,
      premium_packaging_label: premiumPackagingLabel,
      vendor_accepting_orders: accepting_orders,
      vendor_open: accepting_orders,
      is_open: accepting_orders,
      items,
    });
  } catch (error: any) {
    return json(500, { ok: false, error: "DB_ERROR", message: error?.message || "Failed to refresh vendor menu" });
  }
}
