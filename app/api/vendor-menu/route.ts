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

function boolFromBody(v: any, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "open", "accepting"].includes(s)) return true;
  if (["0", "false", "no", "closed", "paused"].includes(s)) return false;
  return fallback;
}

function serviceDateUtc(): string {
  const today = new Date();
  const yyyy = today.getUTCFullYear();
  const mm = String(today.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(today.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

type Action = "toggle_available" | "toggle_soldout" | "update_price" | "set_vendor_accepting";

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
    .order("sort_order", { ascending: true }).order("name", { ascending: true });

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

  // JRIDE_VENDOR_OPEN_CLOSE_ENFORCEMENT_V1
  // Vendor-level open/closed is enforced by setting all active menu items available/unavailable for today.
  // This preserves existing takeout order/status routes and does not touch ride dispatch or trip lifecycle.
  const service_date = serviceDateUtc();

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
        last_updated_at: new Date().toISOString(),
      }));

      const up = await admin
        .from("vendor_menu_item_day_state")
        .upsert(rows, { onConflict: "menu_item_id,service_date" });

      if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
    }

    const refreshed = await admin
      .from("vendor_menu_today")
      .select("*")
      .eq("vendor_id", vendor_id)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (refreshed.error) return json(500, { ok: false, error: "DB_ERROR", message: refreshed.error.message });

    return json(200, {
      ok: true,
      action: "set_vendor_accepting",
      vendor_id,
      accepting_orders: accepting,
      affected_menu_items: ids.length,
      items: Array.isArray(refreshed.data) ? refreshed.data : [],
    });
  }

  if (!menu_item_id) return json(400, { ok: false, error: "menu_item_id_required", message: "menu_item_id required" });

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
    .order("sort_order", { ascending: true }).order("name", { ascending: true });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, vendor_id, items: Array.isArray(data) ? data : [] });
}