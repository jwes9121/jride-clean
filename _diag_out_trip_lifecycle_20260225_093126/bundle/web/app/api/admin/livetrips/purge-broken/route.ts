import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  const supabase = createClient();

  // Best-effort actor identity
  const { data: userRes } = await supabase.auth.getUser();
  const actorId = userRes?.user?.id ?? null;
  const actorEmail = (userRes?.user as any)?.email ?? null;

  // Cancel broken live trips (missing booking_code)
  // NOTE: Only update status to avoid assuming optional columns exist.
  const { data: rows, error } = await supabase
    .from("bookings")
    .update({ status: "cancelled" })
    .in("status", ["assigned", "on_the_way", "on_trip"])
    .or("booking_code.is.null,booking_code.eq.")
    .select("id, booking_code, status");

  if (error) {
    // Audit failed attempt too (best effort)
    try {
      await supabase.from("admin_audit_log").insert({
        actor_id: actorId,
        actor_email: actorEmail,
        action: "PURGE_BROKEN_TRIPS",
        meta: { ok: false, error: error.message },
      } as any);
    } catch {}
    return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  }

  const count = rows?.length ?? 0;

  // Audit success (best effort)
  try {
    await supabase.from("admin_audit_log").insert({
      actor_id: actorId,
      actor_email: actorEmail,
      action: "PURGE_BROKEN_TRIPS",
      meta: {
        ok: true,
        count,
        criteria: { statusIn: ["assigned", "on_the_way", "on_trip"], booking_code_missing: true },
      },
    } as any);
  } catch {}

  return NextResponse.json({ ok: true, count });
}
