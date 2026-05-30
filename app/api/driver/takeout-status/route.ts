import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = new Set(["requested", "driver_assigned", "rider_arrived_vendor", "picked_up", "delivering", "completed", "cancelled"]);

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const configured = String(process.env.DRIVER_PING_SECRET || process.env.NEXT_PUBLIC_DRIVER_PING_SECRET || "").trim();
  if (!configured) return true;
  const got = String(req.headers.get("x-jride-driver-secret") || "").trim();
  return got.length > 0 && got === configured;
}

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "assigned") return "driver_assigned";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "pickedup") return "picked_up";
  if (s === "canceled") return "cancelled";
  return s;
}

// JRIDE_TAKEOUT_CANONICAL_COMPLETION_PATH_V2
// Takeout vendor/customer statuses can progress on their own, but DB wallet triggers
// still require bookings.status to follow the canonical ride-safe chain before completed.
// This helper advances only takeout rows, only inside the takeout-status route, and never
// weakens database lifecycle guards.
async function ensureTakeoutCanonicalPathForCompletion(admin: any, order: any, driverId: string) {
  const bookingId = String(order?.id || "").trim();
  const assignedDriverId = String(order?.assigned_driver_id || order?.driver_id || driverId || "").trim();
  if (!bookingId || !assignedDriverId) {
    return { ok: false, error: "TAKEOUT_CANONICAL_DRIVER_MISSING", message: "Takeout completion requires assigned driver." };
  }

  const chain = ["requested", "assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"];
  const current = String(order?.status || "requested").trim().toLowerCase() || "requested";
  if (current === "completed") return { ok: true, skipped: true };

  let startIndex = chain.indexOf(current);
  if (startIndex < 0) startIndex = 0;

  for (let i = startIndex + 1; i < chain.length; i++) {
    const canonicalStatus = chain[i];
    const patch: any = {
      status: canonicalStatus,
      driver_id: assignedDriverId,
      assigned_driver_id: assignedDriverId,
    };

    if (["on_the_way", "arrived", "on_trip"].includes(canonicalStatus)) {
      patch.driver_status = canonicalStatus;
    }

    const step = await admin
      .from("bookings")
      .update(patch)
      .eq("id", bookingId)
      .eq("service_type", "takeout")
      .select("id,status,driver_status,assigned_driver_id,driver_id")
      .single();

    if (step.error) {
      return {
        ok: false,
        error: "TAKEOUT_CANONICAL_STEP_FAILED",
        message: step.error.message,
        attempted_status: canonicalStatus,
      };
    }
  }

  return { ok: true, advanced_to: "on_trip" };
}

export async function POST(req: NextRequest) {
  if (!isDriverSecretAuthorized(req)) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const admin = getAdmin();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG" });
  }

  const body = await req.json().catch(() => ({} as any));
  const driverId = String(body?.driver_id || body?.driverId || "").trim();
  const orderId = String(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id || "").trim();
  const bookingCode = String(body?.booking_code || body?.bookingCode || body?.code || "").trim();
  const nextStatus = normStatus(body?.status || body?.vendor_status || body?.vendorStatus);

  if (!driverId) return json(400, { ok: false, error: "driver_id_required" });
  if (!orderId && !bookingCode) return json(400, { ok: false, error: "order_id_or_booking_code_required" });
  if (!ALLOWED.has(nextStatus)) return json(400, { ok: false, error: "bad_status" });

  let q = admin
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,driver_status,assigned_driver_id,driver_id,takeout_total_payable,takeout_delivery_fee,takeout_service_fee,completed_at")
    .eq("service_type", "takeout")
    .eq("assigned_driver_id", driverId)
    .limit(1);

  q = orderId ? q.eq("id", orderId) : q.eq("booking_code", bookingCode);
  const existing = await q.maybeSingle();

  if (existing.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: existing.error.message });
  }
  if (!existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND" });
  }

  const current = normStatus((existing.data as any).vendor_status || "requested");
  if (current === "completed" || current === "cancelled") {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED" });
  }

  if (nextStatus === "completed") {
    const canonical = await ensureTakeoutCanonicalPathForCompletion(admin, existing.data, driverId);
    if (!canonical.ok) {
      return json(500, canonical);
    }
  }

  const patch: any = {
    vendor_status: nextStatus,
    customer_status: nextStatus,
  };

  if (nextStatus === "completed") {
    const nowIso = new Date().toISOString();
    patch.status = "completed";
    patch.driver_status = "completed";
    patch.completed_at = nowIso;
  }

  if (nextStatus === "requested") {
    patch.assigned_driver_id = null;
  }

  const up = await admin
    .from("bookings")
    .update(patch)
    .eq("id", (existing.data as any).id)
    .eq("service_type", "takeout")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,driver_status,assigned_driver_id,driver_id,takeout_total_payable,takeout_delivery_fee,takeout_service_fee,completed_at,updated_at")
    .single();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }

  let wallet_deduction: any = null;

  if (nextStatus === "completed") {
    const order = up.data as any;
    const bookingId = String(order?.id || "").trim();
    const walletDriverId = String(order?.assigned_driver_id || order?.driver_id || driverId || "").trim();
    const payable = Number(order?.takeout_total_payable || 0);
    const deduction = payable >= 50 ? 20 : 15;
    const reason = "takeout_completion_service_fee";

    if (bookingId && walletDriverId) {
      const existingWalletTx = await admin
        .from("driver_wallet_transactions")
        .select("id")
        .eq("booking_id", bookingId)
        .eq("driver_id", walletDriverId)
        .eq("reason", reason)
        .limit(1)
        .maybeSingle();

      if (existingWalletTx.error) {
        return json(500, { ok: false, error: "TAKEOUT_WALLET_IDEMPOTENCY_QUERY_FAILED", message: existingWalletTx.error.message });
      }

      if (existingWalletTx.data?.id) {
        wallet_deduction = { ok: true, skipped: true, reason: "already_deducted" };
      } else {
        const lastTx = await admin
          .from("driver_wallet_transactions")
          .select("balance_after")
          .eq("driver_id", walletDriverId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (lastTx.error) {
          return json(500, { ok: false, error: "TAKEOUT_WALLET_BALANCE_QUERY_FAILED", message: lastTx.error.message });
        }

        const previousBalance = Number((lastTx.data as any)?.balance_after || 0);
        const amount = -deduction;
        const balanceAfter = previousBalance + amount;

        const walletIns = await admin
          .from("driver_wallet_transactions")
          .insert({
            driver_id: walletDriverId,
            amount,
            balance_after: balanceAfter,
            reason,
            booking_id: bookingId,
          })
          .select("id,driver_id,amount,balance_after,reason,booking_id,created_at")
          .single();

        if (walletIns.error) {
          return json(500, { ok: false, error: "TAKEOUT_WALLET_DEDUCTION_FAILED", message: walletIns.error.message });
        }

        wallet_deduction = { ok: true, transaction: walletIns.data };
      }
    }
  }

  return json(200, { ok: true, order: up.data, wallet_deduction });
}


