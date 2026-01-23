import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function normTown(v: any): string {
  const s = String(v || "").trim();
  return s;
}

export async function GET() {
  const supabase = createClient();
  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;
  if (!user) return NextResponse.json({ ok: true, authed: false }, { status: 200 });

  const passenger_id = user.id;

  const r = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  return NextResponse.json(
    {
      ok: true,
      authed: true,
      passenger_id,
      request: (!r.error && r.data) ? r.data : null,
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: ures } = await supabase.auth.getUser();
  const user = ures?.user || null;
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  const passenger_id = user.id;
  const body: any = await req.json().catch(() => ({}));

  const full_name = String(body?.full_name || "").trim();
  const town = normTown(body?.town);

  if (!full_name) {
    return NextResponse.json({ ok: false, error: "Full name is required" }, { status: 400 });
  }
  if (!town) {
    return NextResponse.json({ ok: false, error: "Town is required" }, { status: 400 });
  }

  const now = new Date().toISOString();

  // Upsert: passenger can resubmit
  const up = await supabase
    .from("passenger_verification_requests")
    .upsert(
      {
        passenger_id,
        full_name,
        town,
        status: "pending",
        submitted_at: now,
      },
      { onConflict: "passenger_id" }
    )
    .select("*")
    .single();

  if (up.error) {
    return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, request: up.data }, { status: 200 });
}
