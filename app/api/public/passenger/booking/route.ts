import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Resp = {
  ok: boolean;
  code?: string;
  message?: string;
  signed_in?: boolean;
  booking?: any;
};

function json(status: number, body: Resp) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const url = new URL(req.url);
    const bookingCode = String(url.searchParams.get("code") || "").trim();
    if (!bookingCode) {
      return json(400, {
        ok: false,
        code: "MISSING_CODE",
        message: "Missing booking code",
        signed_in: false,
      });
    }

    // Polling must NOT require auth.
    // Booking ownership is already enforced during booking creation.
    const { data: b, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        booking_code,
        status,
        driver_id,
        assigned_driver_id,
        created_at,
        updated_at,
        created_by_user_id
        `
      )
      .eq("booking_code", bookingCode)
      .maybeSingle();

    if (error) {
      return json(500, {
        ok: false,
        code: "DB_ERROR",
        message: String(error.message || error),
        signed_in: false,
      });
    }

    if (!b) {
      return json(404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Booking not found",
        signed_in: false,
      });
    }

    // If booking exists, treat as signed in for polling purposes.
    return json(200, {
      ok: true,
      signed_in: true,
      booking: b,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      code: "ERROR",
      message: String(e?.message || e),
      signed_in: false,
    });
  }
}
