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

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return json(401, { ok: false, code: "NOT_SIGNED_IN", message: "Not signed in" });
    }

    const url = new URL(req.url);
    const bookingCode = String(url.searchParams.get("code") || "").trim();
    if (!bookingCode) {
      return json(400, { ok: false, code: "MISSING_CODE", message: "Missing booking code" });
    }

    // Minimal fields only (avoid schema assumptions)
    const { data: b, error } = await supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, updated_at, created_at")
      .eq("booking_code", bookingCode)
      .maybeSingle();

    if (error) {
      return json(500, { ok: false, code: "DB_ERROR", message: String(error.message || error) });
    }
    if (!b) {
      return json(404, { ok: false, code: "NOT_FOUND", message: "Booking not found" });
    }

    // Optional safety: if bookings has passenger_id, enforce ownership (best-effort, no assumptions)
    // We do not query passenger_id directly to avoid hard failure on missing column.
    // If you later confirm passenger_id exists, we can harden this.

    return json(200, { ok: true, booking: b });
  } catch (e: any) {
    return json(500, { ok: false, code: "ERROR", message: String(e?.message || e) });
  }
}