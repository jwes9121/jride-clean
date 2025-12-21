import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function auditAssign(params: {
  bookingCode?: string;
  driverId?: string;
  actor?: string;
  ok: boolean;
  code?: string;
  message?: string;
  meta?: any;
}) {
  try {
    await supabase.from("dispatch_assign_audit").insert({
      booking_code: params.bookingCode ?? null,
      driver_id: params.driverId ?? null,
      actor: params.actor ?? "unknown",
      ok: !!params.ok,
      code: params.code ?? null,
      message: params.message ?? null,
      meta: params.meta ?? {},
    });
  } catch {
    // never block dispatch on audit failures
  }
}

export async function POST(req: Request) {
  let bookingCode: string | undefined;
  let driverId: string | undefined;
  let actor: string | undefined;
  let meta: any;
  try {
    const body = await req.json();
    ({ bookingCode, driverId } = body || {});    actor =
      (req.headers.get("x-user-email") ||
        req.headers.get("x-forwarded-email") ||
        req.headers.get("x-vercel-user-email") ||
        "unknown") as string;

    meta = {
      ip: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || null,
      userAgent: req.headers.get("user-agent") || null,
      host: req.headers.get("host") || null,
    };


    if (!bookingCode) {
      await auditAssign({ bookingCode, driverId, actor, ok: false, code: "MISSING_BOOKING", message: "Missing bookingCode", meta }); /*audit hook*/ return bad("Missing bookingCode", "MISSING_BOOKING", 400);
    }
    if (!driverId) {
      await auditAssign({ bookingCode, driverId, actor, ok: false, code: "MISSING_DRIVER", message: "Missing driverId", meta }); /*audit hook*/ return bad("Missing driverId", "MISSING_DRIVER", 400);
    }

    // 1) Fetch booking
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id,status,driver_id")
      .eq("booking_code", bookingCode)
      .single();

    if (bookingErr || !booking) {
      await auditAssign({ bookingCode, driverId, actor, ok: false, code: "BOOKING_NOT_FOUND", message: "Booking not found", meta }); /*audit hook*/ return bad("Booking not found", "BOOKING_NOT_FOUND", 404);
    }

    if (booking.driver_id) {
      await auditAssign({ bookingCode, driverId, actor, ok: false, code: "ALREADY_ASSIGNED", message: "Booking already assigned", meta }); /*audit hook*/ return bad("Booking already assigned", "ALREADY_ASSIGNED", 409);
    }

    if (["on_trip", "completed", "cancelled"].includes(booking.status)) {
      await auditAssign({ bookingCode, driverId, actor, ok: false, code: "NOT_ASSIGNABLE", message: "Booking not assignable", meta }); /*audit hook*/ return bad("Booking not assignable", "NOT_ASSIGNABLE", 409, {
        status: booking.status,
      });
    }

    // 2) Ensure driver is not busy
    const { count: activeCount } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .in("status", ["assigned", "on_the_way", "on_trip"]);

    if ((activeCount ?? 0) > 0) {
      await auditAssign({ bookingCode, driverId, actor, ok: false, code: "DRIVER_BUSY", message: "Driver already on active trip", meta }); /*audit hook*/ return bad("Driver already on active trip", "DRIVER_BUSY", 409);
    }

    // 3) Assign with optimistic lock
    const { data: updated, error: updateErr } = await supabase
      .from("bookings")
      .update({
        driver_id: driverId,
        assigned_driver_id: driverId,
        assigned_at: new Date().toISOString(),
        status: "assigned",
      })
      .eq("booking_code", bookingCode)
      .is("driver_id", null)
      .select("id");

    if (updateErr || !updated || updated.length === 0) {
      /*audit hook*/ await auditAssign({ bookingCode, driverId, actor, ok: false, code: "NO_ROWS_UPDATED", message: "Assignment failed (no rows updated)", meta }); return bad("Assignment failed (no rows updated)", "NO_ROWS_UPDATED", 409, { bookingCode, driverId });}

    await auditAssign({ bookingCode, driverId, actor, ok: true, code: "OK", message: "assigned", meta }); return ok({ bookingCode, driverId });
  } catch (e: any) {
    /*audit hook*/ await auditAssign({ bookingCode, driverId, actor, ok: false, code: "INTERNAL_ERROR", message: "Internal server error", meta: { ...meta, error: String(e?.message || e) } }); return bad(
      "Internal server error",
      "INTERNAL_ERROR",
      500,
      { error: String(e?.message || e) }
    );
  }
}



