import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const sa = supabaseAdmin();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bookingCode: string | undefined = body?.bookingCode;
    const response: "accepted" | "rejected" | undefined = body?.response;

    if (!bookingCode || !response) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    if (response !== "accepted" && response !== "rejected") {
      return NextResponse.json({ ok: false, error: "INVALID_RESPONSE" }, { status: 400 });
    }

    const updates: Record<string, any> =
      response === "accepted"
        ? {
            passenger_fare_response: "accepted",
            status: "ready",
            driver_status: "ready",
            customer_status: "ready",
            updated_at: new Date().toISOString(),
          }
        : {
            passenger_fare_response: "rejected",
            status: "pending",
            driver_id: null,
            assigned_driver_id: null,
            assigned_at: null,
            proposed_fare: null,
            verified_fare: null,
            verified_by: null,
            verified_at: null,
            verified_reason: null,
            updated_at: new Date().toISOString(),
          };

    const { data, error } = await sa.from("bookings")
      .update(updates)
      .eq("booking_code", bookingCode)
      .select("*")
      .maybeSingle();

    if (error) {
      console.error("FARE_RESPONSE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_RESPONSE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}