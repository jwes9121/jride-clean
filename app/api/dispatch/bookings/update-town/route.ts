import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function err(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function ok(payload: any) {
  return NextResponse.json(payload);
}
function allowed(r?: string) {
  return r === "admin" || r === "dispatcher";
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!allowed(role)) return err("Forbidden", 403);

  let payload: any = {};
  try {
    payload = await req.json();
  } catch {
    return err("Invalid JSON body");
  }

  const booking_id = String(payload.booking_id || "").trim();
  const town = String(payload.town || "").trim();

  if (!booking_id) return err("booking_id required");
  if (!town) return err("town required");

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("bookings")
    .update({ town })
    .eq("id", booking_id)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) return err(error.message, 500);
  if (!data) return err("Booking not found", 404);

  return ok({ row: data });
}
