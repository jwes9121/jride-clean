import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ALLOWED = new Set([
  "pending",
  "assigned",
  "on_the_way",
  "on_trip",
  "completed",
  "cancelled",
]);

export async function POST(req: NextRequest) {
  let body:any = {};
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const bookingCode = String(body.bookingCode || "").trim();
  const status = String(body.status || "").trim();

  if (!bookingCode) {
    return NextResponse.json({ error: "bookingCode required" }, { status: 400 });
  }
  if (!ALLOWED.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bookings")
    .update({
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("booking_code", bookingCode)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, booking: data });
}