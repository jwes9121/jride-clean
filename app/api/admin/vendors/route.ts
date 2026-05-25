import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET() {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "MISSING_SERVICE_ROLE", message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("vendor_accounts")
    .select("id,email,display_name,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: "DB_ERROR", message: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, vendors: data || [] }, { status: 200 });
}