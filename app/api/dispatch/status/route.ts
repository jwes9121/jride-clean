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
  const status = String(body.status || "").trim().toLowerCase();
  if (!booking_id) return err("booking_id required");
  const allowed = ["requested","assigned","enroute","arrived","completed","canceled"];
  if (allowed.indexOf(status) < 0) return err("invalid status");

  const sb = supabaseAdmin();
  const { data, error } = await sb.from("bookings")
    .update({ status, dispatcher_email: email })
    .eq("id", booking_id)
    .select("*").single();

  if (error) return err(error.message, 500);

  await sb.from("dispatcher_action_logs").insert({
    booking_id, action: "status", actor_email: email, details: { status }
  });

  return ok({ row: data });
}
