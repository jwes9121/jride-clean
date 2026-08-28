import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { offerAgrimarketDriver } from "@/lib/agrimarket/dispatch";
import { agrimarketEnabled } from "@/app/api/agrimarket/_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function headers() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    Pragma: "no-cache",
  };
}

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = text(process.env.CRON_SECRET);
  if (!secret) return false;
  return text(req.headers.get("authorization")) === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: headers() }
    );
  }

  if (!agrimarketEnabled()) {
    return NextResponse.json(
      { ok: true, enabled: false, note: "AGRIMARKET_DISABLED" },
      { status: 200, headers: headers() }
    );
  }

  const admin = supabaseAdmin();
  const now = new Date();
  const nowIso = now.toISOString();

  const settlementRes = await admin.rpc("agrimarket_retry_pending_settlements_v1", {
    p_now: nowIso,
    p_limit: 100,
  });
  const settlementRows = settlementRes.error
    ? []
    : Array.isArray(settlementRes.data)
      ? settlementRes.data
      : [];
  const settlementCompleted = settlementRows.filter((row: any) => row?.settled === true).length;
  const settlementPending = settlementRows.filter((row: any) => row?.settled !== true).length;

  const expiryRes = await admin
    .from("agrimarket_driver_offers")
    .update({
      status: "expired",
      responded_at: nowIso,
      reason_code: "offer_timeout",
      updated_at: nowIso,
    })
    .eq("status", "offered")
    .lte("expires_at", nowIso)
    .select("id,order_id,driver_id");

  if (expiryRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "AGRIMARKET_DRIVER_OFFER_EXPIRY_FAILED",
        message: expiryRes.error.message,
        settlement_retry_error: settlementRes.error?.message || null,
      },
      { status: 500, headers: headers() }
    );
  }

  const pendingRes = await admin
    .from("agrimarket_orders")
    .select("id,order_code,status,ready_at,assigned_driver_id")
    .is("assigned_driver_id", null)
    .in("status", ["preparing", "ready_for_dispatch", "dispatching"])
    .order("ready_at", { ascending: true, nullsFirst: true })
    .limit(50);

  if (pendingRes.error) {
    return NextResponse.json(
      {
        ok: false,
        error: "AGRIMARKET_DISPATCH_SCAN_FAILED",
        message: pendingRes.error.message,
        settlement_retry_error: settlementRes.error?.message || null,
      },
      { status: 500, headers: headers() }
    );
  }

  const rows = Array.isArray(pendingRes.data) ? pendingRes.data : [];
  const results: any[] = [];
  let offered = 0;
  let waitingForPrep = 0;
  let noDriver = 0;
  let failures = settlementRes.error ? 1 : 0;

  for (const row of rows as any[]) {
    const readyAtMs = Date.parse(text(row.ready_at));
    if (
      text(row.status).toLowerCase() === "preparing" &&
      Number.isFinite(readyAtMs) &&
      readyAtMs <= now.getTime()
    ) {
      await admin
        .from("agrimarket_orders")
        .update({ status: "ready_for_dispatch", updated_at: nowIso })
        .eq("id", row.id)
        .eq("status", "preparing")
        .is("assigned_driver_id", null);
    }

    try {
      const result = await offerAgrimarketDriver({ orderId: text(row.id) });
      results.push(result);
      if (result.offered) {
        offered += 1;
      } else if (result.error === "AGRIMARKET_DISPATCH_TOO_EARLY") {
        waitingForPrep += 1;
      } else if (
        result.error === "NO_PREFERRED_VEHICLE_DRIVER_AVAILABLE" ||
        result.error === "NO_ELIGIBLE_DRIVER_AVAILABLE" ||
        result.error === "NO_DRIVER_WITHIN_NORMAL_PICKUP_RANGE" ||
        result.error === "ROAD_DISTANCE_UNAVAILABLE" ||
        result.error === "AGRIMARKET_DRIVER_OFFER_RACE_LOST"
      ) {
        noDriver += 1;
      } else if (!result.ok) {
        failures += 1;
      }
    } catch (error: any) {
      failures += 1;
      results.push({
        ok: false,
        order_id: text(row.id),
        order_code: text(row.order_code),
        error: "AGRIMARKET_DISPATCH_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      });
    }
  }

  return NextResponse.json(
    {
      ok: failures === 0,
      enabled: true,
      generated_at: nowIso,
      settlement_retry_error: settlementRes.error?.message || null,
      settlement_retried: settlementRows.length,
      settlement_completed: settlementCompleted,
      settlement_pending: settlementPending,
      expired_offers: Array.isArray(expiryRes.data) ? expiryRes.data.length : 0,
      scanned_orders: rows.length,
      offered,
      waiting_for_preparation: waitingForPrep,
      no_driver_available: noDriver,
      failures,
      results,
    },
    { status: failures ? 207 : 200, headers: headers() }
  );
}
