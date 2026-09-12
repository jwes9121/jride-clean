import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const supabase = createClient();

  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;

  if (!user) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = user.id;

  const { data: verification } = await supabaseAdmin({ noStore: true })
    .from("passenger_verifications").select("status").eq("user_id", user.id).maybeSingle();
  const verified = ["approved_admin", "approved", "verified"].includes(
    String(verification?.status || "").trim().toLowerCase()
  );

  const r = await supabaseAdmin({ noStore: true })
    .from("passenger_free_ride_audit")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  const row: any = (!r.error && r.data) ? r.data : null;

  // Default amounts (your business rule)
  const discount_php = 35;
  const driver_credit_php = 20;

  return NextResponse.json(
    {
      ok: true,
      authed: true,
      passenger_id,
      verified,
      free_ride: row
        ? {
            status: row.status,
            reason: row.reason || null,
            trip_id: row.trip_id || null,
            driver_id: row.driver_id || null,
            discount_php: row.discount_php ?? discount_php,
            driver_credit_php: row.driver_credit_php ?? driver_credit_php,
            created_at: row.created_at || null,
            updated_at: row.updated_at || null,
          }
        : {
            status: "none",
            discount_php,
            driver_credit_php,
          },
    },
    { status: 200 }
  );
}
