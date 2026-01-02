import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Resp = {
  ok: boolean;
  code?: string;
  message?: string;
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
      return json(400, { ok: false, code: "MISSING_CODE", message: "Missing booking code" });
    }

    // IMPORTANT:
    // Do NOT require supabase.auth.getUser() here.
    // Your passenger session is not a Supabase Auth cookie, so polling must work without it.

    const { data: b, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, driver_id, assigned_driver_id, created_at, updated_at, created_by_user_id"
      )
      .eq("booking_code", bookingCode)
      .maybeSingle();

    if (error) {
      return json(500, { ok: false, code: "DB_ERROR", message: String(error.message || error) });
    }
    if (!b) {
      return json(404, { ok: false, code: "NOT_FOUND", message: "Booking not found" });
    }

    return json(200, { ok: true, booking: b });
  } catch (e: any) {
    return json(500, { ok: false, code: "ERROR", message: String(e?.message || e) });
  }
}