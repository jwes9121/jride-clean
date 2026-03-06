import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const passenger_id = body?.passenger_id ? String(body.passenger_id) : "";
    const admin_notes = body?.admin_notes ? String(body.admin_notes) : null;

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "Missing passenger_id" }, { status: 400 });
    }

    const admin = adminClient();
    const upd = await admin
      .from("passenger_verification_requests")
      .update({
        status: "pending_admin",
        admin_notes,
      })
      .eq("passenger_id", passenger_id)
      .eq("status", "submitted")
      .select("*")
      .single();

    if (upd.error) {
      return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: upd.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}