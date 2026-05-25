import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = new Set([
  "requested",
  "preparing",
  "pickup_ready",
  "driver_assigned",
  "arrived_customer_cash",
  "cash_collected",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
  "cancelled",
]);

const MOVEMENT_AFTER_CONFIRM = new Set([
  "arrived_customer_cash",
  "cash_collected",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
]);

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "ready" || s === "prepared" || s === "ready_for_pickup") return "pickup_ready";
  if (s === "driver_cancelled" || s === "driver_canceled" || s === "reassign") return "requested";
  if (s === "canceled") return "cancelled";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "arrived_customer" || s === "rider_arrived_customer") return "arrived_customer_cash";
  if (s === "cash_received" || s === "customer_cash_collected") return "cash_collected";
  if (s === "pickedup") return "picked_up";
  return s;
}

function normText(value: any) {
  return String(value || "").trim().toLowerCase();
}

function money(value: any) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 0;
  return Math.round(x * 100) / 100;
}

function firstPositiveMoney(...values: any[]) {
  for (const value of values) {
    const x = money(value);
    if (x > 0) return x;
  }
  return 0;
}


async function updateBookingSchemaSafe(admin: any, orderId: string, patchInitial: Record<string, any>) {
  let patch: Record<string, any> = { ...patchInitial };
  let lastError: any = null;

  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await admin
      .from("bookings")
      .update(patch)
      .eq("id", orderId)
      .eq("service_type", "takeout")
      .select("id,booking_code,service_type,status,vendor_status,customer_status,assigned_driver_id,driver_id,takeout_pricing_status,takeout_customer_confirmed_at,takeout_route_plan,takeout_delivery_fee,takeout_service_fee,updated_at")
      .single();

    if (!res.error) return res;

    lastError = res.error;
    const msg = String(res.error?.message || "");
    const m =
      msg.match(/Could not find the '([^']+)' column/i) ||
      msg.match(/column\s+"([^"]+)"\s+of\s+relation\s+"bookings"\s+does\s+not\s+exist/i);

    if (m?.[1] && Object.prototype.hasOwnProperty.call(patch, m[1])) {
      delete patch[m[1]];
      continue;
    }

    return res;
  }

  return { data: null, error: lastError || { message: "schema-safe update retries exceeded" } } as any;
}

async function deductTakeoutStockOnCompletion(admin: any, bookingId: string) {
  const itemsRes = await admin
    .from("takeout_order_items")
    .select("menu_item_id,quantity")
    .eq("booking_id", bookingId);

  if (itemsRes.error || !Array.isArray(itemsRes.data)) {
    return { ok: false, deducted: 0, error: itemsRes.error?.message || "order_items_unavailable" };
  }

  let deducted = 0;
  const nowIso = new Date().toISOString();

  for (const item of itemsRes.data as any[]) {
    const menuItemId = String(item?.menu_item_id || "").trim();
    const qty = Math.max(1, parseInt(String(item?.quantity ?? 1), 10) || 1);
    if (!menuItemId) continue;

    const menuRow = await admin
      .from("vendor_menu_items")
      .select("id,remaining_quantity")
      .eq("id", menuItemId)
      .single();

    if (menuRow.error || !menuRow.data) continue;

    const currentRemaining = Math.max(0, parseInt(String((menuRow.data as any).remaining_quantity ?? 0), 10) || 0);
    const nextRemaining = Math.max(0, currentRemaining - qty);

    await admin
      .from("vendor_menu_items")
      .update({
        remaining_quantity: nextRemaining,
        sold_out_today: nextRemaining <= 0,
        updated_at: nowIso,
      })
      .eq("id", menuItemId);

    deducted += qty;
  }

  return { ok: true, deducted };
}

async function deductTakeoutDriverWalletOnCompletion(admin: any, order: any) {
  const bookingId = String(order?.id || "").trim();
  const bookingCode = String(order?.booking_code || "").trim();
  const driverId = String(order?.assigned_driver_id || order?.driver_id || "").trim();
  const deliveryFee = money(order?.takeout_delivery_fee);
  const amount = deliveryFee >= 50 ? 20 : 15;

  if (!bookingId) return { ok: false, skipped: true, reason: "missing_booking_id" };
  if (!driverId) return { ok: false, skipped: true, reason: "missing_driver_id" };
  if (!(amount > 0)) return { ok: false, skipped: true, reason: "missing_deduction_amount" };

  const existing = await admin
    .from("driver_wallet_transactions")
    .select("id,amount,reason")
    .eq("booking_id", bookingId);

  if (existing.error) {
    return { ok: false, error: existing.error.message, stage: "existing_wallet_tx_lookup" };
  }

  const alreadyDeducted = (existing.data || []).some((tx: any) => {
    const amt = money(tx?.amount);
    const reason = String(tx?.reason || "").toLowerCase();
    return amt < 0 && reason.includes("takeout") && reason.includes("platform");
  });

  if (alreadyDeducted) {
    return { ok: true, skipped: true, reason: "already_deducted" };
  }

  const balanceRes = await admin
    .from("driver_wallet_balances_v1")
    .select("balance")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (balanceRes.error) {
    return { ok: false, error: balanceRes.error.message, stage: "driver_wallet_balance_lookup" };
  }

  const balanceBefore = money((balanceRes.data as any)?.balance);
  const deduction = -Math.abs(amount);
  const balanceAfter = money(balanceBefore + deduction);
  const nowIso = new Date().toISOString();
  const label = bookingCode || bookingId;

  const insertRes = await admin.from("driver_wallet_transactions").insert({
    driver_id: driverId,
    booking_id: bookingId,
    amount: deduction,
    balance_after: balanceAfter,
    reason: "takeout_platform_fee " + label,
    created_at: nowIso,
  });

  if (insertRes.error) {
    return { ok: false, error: insertRes.error.message, stage: "driver_wallet_tx_insert" };
  }

  return {
    ok: true,
    skipped: false,
    driver_id: driverId,
    booking_id: bookingId,
    booking_code: bookingCode || null,
    amount: deduction,
    balance_before: balanceBefore,
    balance_after: balanceAfter,
  };
}

export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));
  const orderId = String(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id || "").trim();
  const nextStatus = normStatus(body?.status || body?.vendor_status || body?.vendorStatus);
  const cashCollectedAmountRaw = String(body?.cash_collected_amount ?? body?.cashCollectedAmount ?? body?.collected_amount ?? "").trim();
  const cashCollectedAmount = cashCollectedAmountRaw ? Number(cashCollectedAmountRaw.replace(/[^0-9.]/g, "")) : null;

  if (!orderId) return json(400, { ok: false, error: "order_id_required", message: "order_id required" });
  if (!ALLOWED.has(nextStatus)) return json(400, { ok: false, error: "bad_status", message: "Unsupported takeout dispatch status" });

  const existing = await admin
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,assigned_driver_id,driver_id,takeout_pricing_status,takeout_customer_confirmed_at,takeout_route_plan,takeout_delivery_fee,takeout_service_fee")
    .eq("id", orderId)
    .eq("service_type", "takeout")
    .single();

  if (existing.error || !existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: existing.error?.message || "Takeout order not found" });
  }

  const row: any = existing.data;
  const current = normStatus(row.status || row.vendor_status || row.customer_status || "requested");
  const pricingStatus = normText(row.takeout_pricing_status);
  const routePlan = normText(row.takeout_route_plan) || "vendor_first";
  const customerConfirmed = !!row.takeout_customer_confirmed_at || pricingStatus === "customer_confirmed";

  if ((current === "completed" || current === "cancelled") && nextStatus !== "preparing") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED", message: "Closed takeout orders can only be reopened to preparing" });
  }

  if (current === "pickup_ready" && nextStatus === "preparing") {
    return json(409, { ok: false, error: "INVALID_STATUS_MOVEMENT", message: "pickup_ready cannot move back to preparing" });
  }

  const vendorAcceptedForAssignment = new Set(["vendor_accepted", "preparing", "pickup_ready", "driver_assigned"]);
  if (nextStatus === "driver_assigned" && !vendorAcceptedForAssignment.has(current)) {
    return json(409, {
      ok: false,
      error: "VENDOR_ACCEPTANCE_REQUIRED",
      message: "Vendor must accept the order before driver assignment.",
      current_status: current,
    });
  }

  if (MOVEMENT_AFTER_CONFIRM.has(nextStatus) && !customerConfirmed) {
    return json(409, {
      ok: false,
      error: "CUSTOMER_CONFIRMATION_REQUIRED",
      message: "Passenger must confirm the takeout total before driver movement statuses.",
    });
  }

  if (nextStatus === "cash_collected" && (cashCollectedAmount == null || !Number.isFinite(cashCollectedAmount) || cashCollectedAmount <= 0)) {
    return json(400, {
      ok: false,
      error: "CASH_COLLECTED_AMOUNT_REQUIRED",
      message: "Collected cash amount is required before confirming cash collection.",
    });
  }

  if (routePlan === "customer_cash_first") {
    if (nextStatus === "rider_arrived_vendor" && current !== "cash_collected") {
      return json(409, {
        ok: false,
        error: "CASH_COLLECTION_REQUIRED",
        message: "Driver must collect customer cash before arriving at vendor.",
      });
    }

    if ((nextStatus === "picked_up" || nextStatus === "delivering" || nextStatus === "completed") && current !== "rider_arrived_vendor" && current !== "picked_up" && current !== "delivering") {
      return json(409, {
        ok: false,
        error: "INVALID_CASH_FIRST_SEQUENCE",
        message: "Customer-cash-first orders must pass through cash collection and vendor arrival before pickup, delivery, or completion.",
      });
    }
  } else if (nextStatus === "arrived_customer_cash" || nextStatus === "cash_collected") {
    return json(409, {
      ok: false,
      error: "INVALID_ROUTE_PLAN_STATUS",
      message: "Customer cash collection statuses are only allowed for customer_cash_first route plan.",
    });
  }

  const patch: any = {
    status: nextStatus,
    vendor_status: nextStatus,
    customer_status: nextStatus === "requested" ? "requested" : nextStatus,
  };

  if (nextStatus === "arrived_customer_cash") {
    patch.customer_status = "driver_arrived_for_cash";
  }

  if (nextStatus === "cash_collected") {
    patch.customer_status = "cash_collected";
    patch.cash_collected_amount = cashCollectedAmount;
    patch.takeout_cash_collected_amount = cashCollectedAmount;
    patch.cash_collected_at = new Date().toISOString();
    patch.takeout_cash_collected_at = new Date().toISOString();
  }

  if (nextStatus === "requested" || nextStatus === "cancelled") {
    patch.assigned_driver_id = null;
    patch.driver_id = null;
    patch.assigned_at = null;
  }

  const up = await updateBookingSchemaSafe(admin, orderId, patch);

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  let inventory: any = null;
  let driverWallet: any = null;
  if (nextStatus === "completed" && current !== "completed") {
    inventory = await deductTakeoutStockOnCompletion(admin, orderId);
    driverWallet = await deductTakeoutDriverWalletOnCompletion(admin, up.data || row);
  }

  return json(200, {
    ok: true,
    order: up.data,
    inventory,
    driver_wallet: driverWallet,
    guard: "takeout_status_route_plan_vendor_acceptance_guard_v74_main_status_sync",
  });
}


