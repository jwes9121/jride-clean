import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  override?: boolean | null;
  source?: string | null;
};

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const driverId = String(body.driverId ?? "").trim();

    if (!driverId) {
      return NextResponse.json({ error: "MISSING_DRIVER_ID" }, { status: 400 });
    }
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }

    // Update bookings directly (baseline-safe, avoids “function not found” RPC issues)
    let q = supabase.from("bookings").update({
      driver_id: driverId,
      status: "assigned",
      updated_at: new Date().toISOString(),
    });

    if (bookingId) q = q.eq("id", bookingId);
    else q = q.eq("booking_code", bookingCode);

    const { error } = await q;

    if (error) {
      console.error("DISPATCH_ASSIGN_DB_ERROR", error);
      return NextResponse.json(
        { error: "DISPATCH_ASSIGN_DB_ERROR", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("DISPATCH_ASSIGN_UNEXPECTED", err);
    return NextResponse.json(
      { error: "DISPATCH_ASSIGN_UNEXPECTED", message: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
