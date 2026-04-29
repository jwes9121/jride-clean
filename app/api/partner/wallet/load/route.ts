import { NextRequest, NextResponse } from "next/server";
import { requirePartnerAccess } from "@/lib/partner-access";
import { createClient } from "@supabase/supabase-js";

function db() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
    process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    { auth:{persistSession:false,autoRefreshToken:false} }
  );
}

export async function POST(req: NextRequest) {
  const gate = await requirePartnerAccess();

  if (!gate.ok) {
    return NextResponse.json(gate, { status: gate.status });
  }

  const access = Array.isArray(gate.access) ? gate.access : [];
  const body = await req.json().catch(()=>({}));

  const territory = String(body.territory || "");
  const driver_id = String(body.driver_id || "");
  const amount = Number(body.amount || 0);

  const allowed = access.some((x:any) =>
    String(x.territory_name || "") === territory
  );

  if (!allowed) {
    return NextResponse.json({ ok:false, error:"FORBIDDEN_TERRITORY" }, { status:403 });
  }

  if (!driver_id || amount <= 0) {
    return NextResponse.json({ ok:false, error:"INVALID_INPUT" }, { status:400 });
  }

  const supabase = db();

  const res = await supabase
    .from("partner_wallet_load_ledger")
    .insert({
      territory_name: territory,
      driver_id,
      amount,
      status: "pending_hq_post",
      created_by_email: gate.user.email
    })
    .select()
    .single();

  return NextResponse.json({
    ok:true,
    row: res.data
  });
}
