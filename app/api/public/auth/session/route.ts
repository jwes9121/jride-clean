import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const SUPABASE_URL =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ ok: false, error: "Missing Supabase env." }, { status: 500 });
  }

  const at = req.cookies.get("jride_pax_at")?.value || "";
  if (!at) {
    return NextResponse.json({ ok: false, authed: false }, { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Validate token
  const { data, error } = await supabase.auth.getUser(at);

  if (error || !data?.user) {
    // Clear bad cookies
    const res = NextResponse.json({ ok: false, authed: false }, { status: 200 });
    res.cookies.set({ name: "jride_pax_at", value: "", path: "/", maxAge: 0 });
    res.cookies.set({ name: "jride_pax_rt", value: "", path: "/", maxAge: 0 });
    return res;
  }

  const md: any = data.user.user_metadata || {};
  const verified = md?.verified === true || ["1","true","yes","y","on"].includes(String(md?.verified ?? "").trim().toLowerCase());
  const night_allowed = md?.night_allowed === true || ["1","true","yes","y","on"].includes(String(md?.night_allowed ?? "").trim().toLowerCase()) || verified;

  return NextResponse.json({
    ok: true,
    authed: true,
    role: "passenger",
    user: {
      id: data.user.id,
      phone: md?.phone ?? null,
      verified,
      night_allowed,
    },
  });
}