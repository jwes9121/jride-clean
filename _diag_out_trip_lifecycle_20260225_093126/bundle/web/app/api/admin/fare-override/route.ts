import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

/**
 * Admin / Dispatcher fare override & verification endpoint.
 *
 * Body:
 * {
 *   "bookingCode": "JR-2025-0002",
 *   "verifiedFare": 75,
 *   "adminId": "dispatcher-richelle",  // optional
 *   "reason": "Corrected per fare matrix" // optional
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingCode: string | undefined = body?.bookingCode;
    const verifiedFare: number | undefined = body?.verifiedFare;
    const adminId: string | undefined = body?.adminId;
    const reason: string | undefined = body?.reason;

    if (!bookingCode || typeof verifiedFare !== "number") {
      return NextResponse.json(
        { ok: false, error: "MISSING_OR_INVALID_FIELDS" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update({
        verified_fare: verifiedFare,
        verified_by: adminId ?? null,
        verified_at: new Date().toISOString(),
        verified_reason: reason ?? null,
      })
      .eq("booking_code", bookingCode)
      .select("*")
      .single();

    if (error) {
      console.error("FARE_OVERRIDE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_OVERRIDE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
