import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(v: any): string {
  return String(v ?? "").trim();
}

function lower(v: any): string {
  return text(v).toLowerCase();
}

function json(status: number, payload: any) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

  if (!url || !key) {
    throw new Error("Missing Supabase service configuration.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function isExpired(value: any): boolean {
  const raw = text(value);
  if (!raw) return true;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= Date.now();
}

function positiveInt(v: any): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

async function getTakeoutInventoryItems(serviceSupabase: any, bookingId: string) {
  const res = await serviceSupabase
    .from("takeout_order_items")
    .select("menu_item_id,quantity,name")
    .eq("booking_id", bookingId);

  if (res.error) throw new Error(res.error.message || "takeout_order_items query failed");

  const totals = new Map<string, { qty: number; name: string }>();
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const id = text(row?.menu_item_id);
    if (!id) continue;
    const qty = Math.max(1, positiveInt(row?.quantity) || 1);
    const prev = totals.get(id) || { qty: 0, name: text(row?.name) || id };
    prev.qty += qty;
    totals.set(id, prev);
  }
  return Array.from(totals.entries()).map(([menu_item_id, v]) => ({ menu_item_id, ...v }));
}

async function assertTakeoutInventoryAvailable(serviceSupabase: any, bookingId: string) {
  const items = await getTakeoutInventoryItems(serviceSupabase, bookingId);
  const blocked: string[] = [];

  for (const item of items) {
    const q = await serviceSupabase
      .from("vendor_menu_items")
      .select("id,name,daily_available_quantity,remaining_quantity,sold_out_today")
      .eq("id", item.menu_item_id)
      .maybeSingle();

    if (q.error) throw new Error(q.error.message || "vendor_menu_items query failed");
    const row = q.data as any;
    const daily = positiveInt(row?.daily_available_quantity);
    const remaining = positiveInt(row?.remaining_quantity ?? daily);
    const soldOut = row?.sold_out_today === true;

    if (soldOut || (daily > 0 && remaining < item.qty)) {
      blocked.push(row?.name || item.name || item.menu_item_id);
    }
  }

  return blocked;
}

async function decrementTakeoutInventory(serviceSupabase: any, bookingId: string) {
  const items = await getTakeoutInventoryItems(serviceSupabase, bookingId);
  const changed: any[] = [];

  for (const item of items) {
    const q = await serviceSupabase
      .from("vendor_menu_items")
      .select("id,daily_available_quantity,remaining_quantity")
      .eq("id", item.menu_item_id)
      .maybeSingle();

    if (q.error || !q.data) continue;
    const row = q.data as any;
    const daily = positiveInt(row?.daily_available_quantity);
    if (daily <= 0) continue;

    const remaining = positiveInt(row?.remaining_quantity ?? daily);
    const nextRemaining = Math.max(0, remaining - item.qty);
    const up = await serviceSupabase
      .from("vendor_menu_items")
      .update({
        remaining_quantity: nextRemaining,
        sold_out_today: nextRemaining <= 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.menu_item_id);

    if (!up.error) changed.push({ menu_item_id: item.menu_item_id, quantity: item.qty, remaining_quantity: nextRemaining });
  }

  return changed;
}

export async function POST(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const body = await req.json().catch(() => ({}));

    const orderId = text(
      body?.order_id ||
        body?.orderId ||
        body?.booking_id ||
        body?.bookingId ||
        body?.id,
    );

    const bookingCode = text(
      body?.booking_code || body?.bookingCode || body?.code,
    );

    const confirm = body?.confirm === true || lower(body?.action) === "confirm";

    if (!confirm) {
      return json(400, {
        ok: false,
        error: "CONFIRM_REQUIRED",
        message: "confirm=true or action=confirm is required.",
      });
    }

    if (!orderId && !bookingCode) {
      return json(400, {
        ok: false,
        error: "ORDER_REQUIRED",
        message: "order_id or booking_code is required.",
      });
    }

    let q = serviceSupabase
      .from("bookings")
      .select(
        "id,booking_code,service_type,assigned_driver_id,driver_id,vendor_status,customer_status,takeout_pricing_status,takeout_delivery_fee,takeout_service_fee,takeout_total_payable,takeout_cash_collection_required,takeout_fee_proposed_by_driver_id,takeout_fee_proposed_at,takeout_fee_expires_at,takeout_customer_confirmed_at,takeout_route_plan,status",
      )
      .eq("service_type", "takeout")
      .limit(1);

    q = orderId ? q.eq("id", orderId) : q.eq("booking_code", bookingCode);

    const orderRes = await q.maybeSingle();

    if (orderRes.error) {
      return json(500, {
        ok: false,
        error: "TAKEOUT_CONFIRM_QUERY_FAILED",
        message: orderRes.error.message,
      });
    }

    const order = orderRes.data as any;

    if (!order?.id) {
      return json(404, {
        ok: false,
        error: "TAKEOUT_ORDER_NOT_FOUND",
        message: "Takeout order not found.",
      });
    }

    if (
      lower(order.vendor_status) === "completed" ||
      lower(order.customer_status) === "completed" ||
      lower(order.status) === "completed"
    ) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ALREADY_COMPLETED",
        message: "Takeout order is already completed.",
      });
    }

    if (
      lower(order.vendor_status) === "cancelled" ||
      lower(order.customer_status) === "cancelled" ||
      lower(order.status) === "cancelled"
    ) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ALREADY_CANCELLED",
        message: "Takeout order is already cancelled.",
      });
    }

    if (text(order.takeout_customer_confirmed_at)) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ALREADY_CONFIRMED",
        message: "Takeout order was already confirmed.",
      });
    }

    if (lower(order.takeout_pricing_status) !== "driver_fee_proposed") {
      return json(409, {
        ok: false,
        error: "TAKEOUT_FEE_NOT_READY",
        message: "No active driver delivery fee proposal to confirm.",
      });
    }

    if (order.takeout_delivery_fee === null || order.takeout_delivery_fee === undefined) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_DELIVERY_FEE_MISSING",
        message: "Driver delivery fee is missing.",
      });
    }

    const proposedDriverId = text(
      order.takeout_fee_proposed_by_driver_id ||
        order.assigned_driver_id ||
        order.driver_id,
    );

    if (!proposedDriverId) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_PROPOSING_DRIVER_MISSING",
        message: "Driver proposal is missing.",
      });
    }

    if (isExpired(order.takeout_fee_expires_at)) {
      await serviceSupabase
        .from("bookings")
        .update({ takeout_pricing_status: "expired" })
        .eq("id", order.id)
        .eq("service_type", "takeout");

      return json(409, {
        ok: false,
        error: "TAKEOUT_FEE_PROPOSAL_EXPIRED",
        message: "Delivery fee proposal expired. Please wait for a new proposal.",
      });
    }

    const blockedInventory = await assertTakeoutInventoryAvailable(serviceSupabase, order.id);
    if (blockedInventory.length) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_INVENTORY_UNAVAILABLE",
        message: "One or more selected items are sold out or no longer have enough stock.",
        blocked_items: blockedInventory,
      });
    }

    const nowIso = new Date().toISOString();

    const updateRes = await serviceSupabase
      .from("bookings")
      .update({
        assigned_driver_id: proposedDriverId,
        driver_id: proposedDriverId,
        takeout_pricing_status: "customer_confirmed",
        takeout_customer_confirmed_at: nowIso,
        vendor_status: "driver_assigned",
        customer_status: "driver_assigned",
      })
      .eq("id", order.id)
      .eq("service_type", "takeout")
      .eq("takeout_pricing_status", "driver_fee_proposed")
      .select(
        "id,booking_code,service_type,assigned_driver_id,driver_id,vendor_status,customer_status,takeout_pricing_status,takeout_delivery_fee,takeout_service_fee,takeout_total_payable,takeout_cash_collection_required,takeout_fee_proposed_by_driver_id,takeout_fee_proposed_at,takeout_fee_expires_at,takeout_customer_confirmed_at,takeout_route_plan,status",
      )
      .single();

    if (updateRes.error) {
      return json(500, {
        ok: false,
        error: "TAKEOUT_CONFIRM_UPDATE_FAILED",
        message: updateRes.error.message,
      });
    }

    const inventory_updates = await decrementTakeoutInventory(serviceSupabase, order.id);

    return json(200, {
      ok: true,
      order: updateRes.data,
      inventory_updates,
      guard: "takeout_confirm_fee_v3_no_already_assigned_block_inventory_v42",
    });
  } catch (err: any) {
    return json(500, {
      ok: false,
      error: "TAKEOUT_CONFIRM_FEE_FAILED",
      message: err?.message || "Failed to confirm takeout delivery fee.",
    });
  }
}
