import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const url = new URL(req.url);
    const bookingId = (url.searchParams.get("bookingId") || "").trim();
    const bookingCode = (url.searchParams.get("bookingCode") || "").trim();

    if (!bookingId && !bookingCode) {
      return NextResponse.json({ logs: [] }, { status: 200 });
    }

    let q = supabase
      .from("booking_assignment_log")
      .select("id, created_at, booking_id, booking_code, from_driver_id, to_driver_id, source, actor, note")
      .order("created_at", { ascending: false })
      .limit(25);

    if (bookingId) q = q.eq("booking_id", bookingId);
    else q = q.eq("booking_code", bookingCode);

    const { data, error } = await q;

    if (error) {
      console.error("ADMIN_ASSIGNMENT_LOG_ERROR", error);
      return NextResponse.json({ error: "ADMIN_ASSIGNMENT_LOG_ERROR", message: error.message, logs: [] }, { status: 500 });
    }

    return NextResponse.json({ logs: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("ADMIN_ASSIGNMENT_LOG_UNEXPECTED", err);
    return NextResponse.json(
      { error: "ADMIN_ASSIGNMENT_LOG_UNEXPECTED", message: err?.message ?? "Unexpected error", logs: [] },
      { status: 500 }
    );
  }
}
