import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(v: any): string {
  return String(v ?? "").trim();
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

function ratingValue(v: any): number | null {
  const n = Number(v);
  if (!Number.isInteger(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

function isCompletedTakeout(order: any): boolean {
  const status = text(order?.status).toLowerCase();
  const customerStatus = text(order?.customer_status).toLowerCase();
  const vendorStatus = text(order?.vendor_status).toLowerCase();
  return status === "completed" || customerStatus === "completed" || vendorStatus === "completed";
}

async function findTakeoutOrder(serviceSupabase: any, orderId: string, bookingCode: string) {
  let q = serviceSupabase
    .from("bookings")
    .select("*")
    .eq("service_type", "takeout")
    .limit(1);

  q = orderId ? q.eq("id", orderId) : q.eq("booking_code", bookingCode);

  const res = await q.maybeSingle();

  if (res.error) {
    throw new Error(res.error.message);
  }

  return res.data as any;
}

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();

    const orderId = text(req.nextUrl.searchParams.get("order_id"));
    const bookingCode = text(req.nextUrl.searchParams.get("booking_code") || req.nextUrl.searchParams.get("code"));

    if (!orderId && !bookingCode) {
      return json(400, { ok: false, error: "ORDER_REQUIRED", message: "order_id or booking_code is required." });
    }

    const order = await findTakeoutOrder(serviceSupabase, orderId, bookingCode);

    if (!order?.id) {
      return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: "Takeout order not found." });
    }

    const rating = await serviceSupabase
      .from("takeout_ratings")
      .select("*")
      .eq("booking_id", order.id)
      .limit(1)
      .maybeSingle();

    if (rating.error) {
      return json(500, { ok: false, error: "RATING_QUERY_FAILED", message: rating.error.message });
    }

    return json(200, { ok: true, rating: rating.data || null });
  } catch (e: any) {
    return json(500, { ok: false, error: "TAKEOUT_RATE_FAILED", message: String(e?.message || e) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const body = await req.json().catch(() => ({}));

    const orderId = text(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id);
    const bookingCode = text(body?.booking_code || body?.bookingCode || body?.code);

    if (!orderId && !bookingCode) {
      return json(400, { ok: false, error: "ORDER_REQUIRED", message: "order_id or booking_code is required." });
    }

    const driverRating = ratingValue(body?.driver_rating);
    const vendorRating = ratingValue(body?.vendor_rating);

    if (!driverRating || !vendorRating) {
      return json(400, {
        ok: false,
        error: "RATING_REQUIRED",
        message: "driver_rating and vendor_rating must be integers from 1 to 5.",
      });
    }

    const order = await findTakeoutOrder(serviceSupabase, orderId, bookingCode);

    if (!order?.id) {
      return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND", message: "Takeout order not found." });
    }

    if (!isCompletedTakeout(order)) {
      return json(409, {
        ok: false,
        error: "ORDER_NOT_COMPLETED",
        message: "Takeout order can only be rated after completion.",
      });
    }

    const bookingId = text(order.id);
    const driverId = text(order.assigned_driver_id || order.driver_id || order.takeout_fee_proposed_by_driver_id) || null;
    const vendorId = text(order.vendor_id) || null;
    const passengerId = text(order.created_by_user_id || order.passenger_id || order.user_id) || null;

    const upsertPayload = {
      booking_id: bookingId,
      booking_code: text(order.booking_code || bookingCode) || null,
      passenger_id: passengerId,
      vendor_id: vendorId,
      driver_id: driverId,
      driver_rating: driverRating,
      driver_comment: text(body?.driver_comment || body?.driverComment) || null,
      vendor_rating: vendorRating,
      vendor_comment: text(body?.vendor_comment || body?.vendorComment) || null,
    };

    const rating = await serviceSupabase
      .from("takeout_ratings")
      .upsert(upsertPayload, { onConflict: "booking_id" })
      .select("*")
      .maybeSingle();

    if (rating.error) {
      return json(500, { ok: false, error: "RATING_SAVE_FAILED", message: rating.error.message });
    }

    return json(200, { ok: true, rating: rating.data });
  } catch (e: any) {
    return json(500, { ok: false, error: "TAKEOUT_RATE_FAILED", message: String(e?.message || e) });
  }
}
