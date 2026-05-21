import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return NextResponse.json({
        ok: false,
        signed_in: false,
        reason: "missing_token",
      });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return NextResponse.json({
        ok: false,
        signed_in: false,
        reason: "invalid_session",
      });
    }

    const { data: profile } = await supabase
      .from("passenger_profiles")
      .select("full_name, phone, email")
      .eq("user_id", user.id)
      .maybeSingle();

    const meta = (user.user_metadata || {}) as Record<string, unknown>;

    const fullName =
      clean(profile?.full_name) ||
      clean(meta.full_name) ||
      clean(meta.name) ||
      null;

    const phone =
      clean(profile?.phone) ||
      clean(meta.phone) ||
      clean(meta.mobile) ||
      null;

    const email =
      clean(profile?.email) ||
      clean(user.email) ||
      null;

    return NextResponse.json({
      ok: true,
      signed_in: true,
      user_id: user.id,
      full_name: fullName,
      phone,
      email,
      has_complete_contact: Boolean(fullName && phone),
      source:
        profile && (profile.full_name || profile.phone)
          ? "passenger_profiles"
          : "auth_metadata",
    });
  } catch (error) {
    console.error("takeout passenger-contact error", error);

    return NextResponse.json(
      {
        ok: false,
        signed_in: false,
        reason: "server_error",
      },
      { status: 500 }
    );
  }
}