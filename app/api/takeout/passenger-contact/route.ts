import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "../../../../auth";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type ProfileRow = {
  user_id?: string | null;
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

async function findProfileByUserId(userId: string | null): Promise<ProfileRow | null> {
  if (!userId) return null;

  const { data } = await supabase
    .from("passenger_profiles")
    .select("user_id, full_name, phone, email")
    .eq("user_id", userId)
    .maybeSingle();

  return (data as ProfileRow | null) || null;
}

async function findProfileByEmail(email: string | null): Promise<ProfileRow | null> {
  if (!email) return null;

  const { data } = await supabase
    .from("passenger_profiles")
    .select("user_id, full_name, phone, email")
    .eq("email", email)
    .maybeSingle();

  return (data as ProfileRow | null) || null;
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;

    let userId: string | null = null;
    let userEmail: string | null = null;
    let meta: Record<string, unknown> = {};
    let authMode: "bearer" | "nextauth" | "none" = "none";

    if (bearerToken) {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(bearerToken);

      if (!error && user) {
        userId = user.id;
        userEmail = clean(user.email);
        meta = (user.user_metadata || {}) as Record<string, unknown>;
        authMode = "bearer";
      }
    }

    if (!userId && !userEmail) {
      const session = await auth();
      const sessionUser = (session as any)?.user || null;

      if (sessionUser) {
        userId = clean(sessionUser.id);
        userEmail = clean(sessionUser.email);
        meta = {
          full_name: sessionUser.full_name,
          name: sessionUser.name,
          phone: sessionUser.phone,
          mobile: sessionUser.mobile,
          address: sessionUser.address,
        };
        authMode = "nextauth";
      }
    }

    if (!userId && !userEmail) {
      return NextResponse.json({
        ok: false,
        signed_in: false,
        reason: "not_authenticated",
      });
    }

    let profile = await findProfileByUserId(userId);

    if (!profile) {
      profile = await findProfileByEmail(userEmail);
    }

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
      userEmail ||
      null;

    return NextResponse.json({
      ok: true,
      signed_in: true,
      auth_mode: authMode,
      user_id: userId,
      profile_user_id: clean(profile?.user_id),
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
