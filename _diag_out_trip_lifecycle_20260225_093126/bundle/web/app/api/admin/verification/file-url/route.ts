import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const bucket = String(u.searchParams.get("bucket") || "").trim();
    const path = String(u.searchParams.get("path") || "").trim();

    if (!bucket || !path) {
      return NextResponse.json({ ok: false, error: "bucket and path required" }, { status: 400 });
    }

    const supabase = adminSupabase();
    const s = await supabase.storage.from(bucket).createSignedUrl(path, 60);

    if (s.error) {
      return NextResponse.json({ ok: false, error: s.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, url: s.data?.signedUrl || null }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}