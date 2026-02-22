import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function truthy(v: any): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0" && s !== "no";
  }
  return false;
}

export async function GET() {
  const supabase = createClient();

  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;

  if (!user) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = user.id;

  const meta: any = (user as any)?.user_metadata || {};
  const verified =
    truthy(meta?.verified) ||
    truthy(meta?.is_verified) ||
    truthy(meta?.verification_tier) ||
    truthy(meta?.night_allowed);

  const r = await supabase
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
