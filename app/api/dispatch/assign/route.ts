import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function err(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }
function ok(payload: any) { return NextResponse.json(payload); }
function isAllowed(r?: string) { return r === "admin" || r === "dispatcher"; }

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const email = session?.user?.email || "";
  if (!isAllowed(role)) return err("Forbidden", 403);

  let body: any = null;
  try { body = await req.json(); } catch { return err("Invalid JSON"); }

  const booking_id = String(body.booking_id || "").trim();
  const driver_id = String(body.driver_id || "").trim();
  if (!booking_id || !driver_id) return err("booking_id and driver_id required");

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("bookings")
    .update({ driver_id, status: "assigned", dispatcher_email: email })
    .eq("id", booking_id)
    .select("*").single();

  if (error) return err(error.message, 500);

  await sb.from("dispatcher_action_logs").insert({
    booking_id, action: "assigned", actor_email: email, details: { driver_id }
  });

  return ok({ row: data });
}
