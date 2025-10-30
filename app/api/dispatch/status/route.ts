import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function jerr(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function jok(data: any) {
  return NextResponse.json(data);
}
const ALLOWED = new Set(["pending", "assigned", "en-route", "arrived", "complete"]);
const CAN = (r?: string) => r === "admin" || r === "dispatcher";

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!CAN(role)) return jerr("Forbidden", 403);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return jerr("Invalid JSON body");
  }
  const booking_id = String(body.booking_id || "").trim();
  const status = String(body.status || "").trim();

  if (!booking_id) return jerr("booking_id required");
  if (!ALLOWED.has(status)) return jerr(`status must be one of: ${Array.from(ALLOWED).join(", ")}`);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bookings")
    .update({ status })
    .eq("id", booking_id)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) return jerr(error.message, 500);
  if (!data) return jerr("Booking not found", 404);

  return jok({ row: data });
}
