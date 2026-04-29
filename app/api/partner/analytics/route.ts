import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requirePartnerAccess } from "../../../../lib/partner-access";

function db() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function GET(req: NextRequest) {
  const gate = await requirePartnerAccess();

  if (!gate.ok) {
    return NextResponse.json(gate, { status: gate.status });
  }

  const access = Array.isArray(gate.access) ? gate.access : [];
  const territory = String(req.nextUrl.searchParams.get("territory") || "");

  const allowed = access.some((x: any) => String(x.territory_name || "") === territory);

  if (!allowed) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN_TERRITORY" }, { status: 403 });
  }

  const supabase = db();

  const res = await supabase
    .from("bookings")
    .select("status")
    .eq("town", territory);

  const rows = Array.isArray(res.data) ? res.data : [];

  const completed = rows.filter((x: any) => x.status === "completed").length;
  const active = rows.filter((x: any) =>
    ["requested","searching","assigned","accepted","fare_proposed","ready","on_the_way","arrived","on_trip"].includes(x.status)
  ).length;

  return NextResponse.json({
    ok: true,
    territory,
    totals: {
      total_bookings: rows.length,
      completed,
      active
    }
  });
}