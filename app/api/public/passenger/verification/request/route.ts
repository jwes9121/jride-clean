import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const passenger_id = session.user.id;
  const supabase = createClient();

  const r = await supabase
    .from("passenger_verification_requests")
    .select("*")
    .eq("passenger_id", passenger_id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    authed: true,
    passenger_id,
    request: (!r.error && r.data) ? r.data : null
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const passenger_id = session.user.id;
  const body: any = await req.json().catch(() => ({}));
  const full_name = String(body.full_name || "").trim();
  const town = String(body.town || "").trim();
  const id_front_path = body?.id_front_path ? String(body.id_front_path).trim() : "";
  const selfie_with_id_path = body?.selfie_with_id_path ? String(body.selfie_with_id_path).trim() : "";

  if (!full_name) {
    return NextResponse.json({ ok: false, error: "Full name required" }, { status: 400 });
  }
  if (!town) {
    return NextResponse.json({ ok: false, error: "Town required" }, { status: 400 });
  }

  const supabase = createClient();

  const up = await supabase
    .from("passenger_verification_requests")
    .upsert({
      passenger_id,
      full_name,
      town,
      status: "pending",
      submitted_at: new Date().toISOString()
    }, { onConflict: "passenger_id" })
    .select("*")
    .single();

  if (up.error) {
    return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, request: up.data });
}