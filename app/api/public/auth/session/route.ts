import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function getDeviceId(req: NextRequest): string {
  return String(
    req.headers.get("x-device-id") ||
    req.nextUrl.searchParams.get("device_id") ||
    ""
  ).trim();
}

function createAnonSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function getUserFromCookieOrBearer(req: NextRequest) {
  const cookieSupabase = createClient();
  const cookieUserRes = await cookieSupabase.auth.getUser();
  if (cookieUserRes.data?.user) {
    return { user: cookieUserRes.data.user, authMode: "cookie" as const };
  }

  const token = getBearerToken(req);
  if (!token) {
    return { user: null, authMode: "none" as const };
  }

  const anonSupabase = createAnonSupabase();
  const bearerUserRes = await anonSupabase.auth.getUser(token);
  if (bearerUserRes.data?.user) {
    return { user: bearerUserRes.data.user, authMode: "bearer" as const };
  }

  return { user: null, authMode: "none" as const };
}

async function computeVerified(supabase: any, user: any): Promise<boolean> {
  if (!user?.id) return false;

  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const st = String((pv?.data as any)?.status ?? "").toLowerCase().trim();
    if (st) return st === "approved_admin" || st === "approved" || st === "verified";
  } catch {}

  try {
    const pr = await supabase
      .from("passenger_verification_requests")
      .select("status")
      .eq("passenger_id", user.id)
      .maybeSingle();

    const st = String((pr?.data as any)?.status ?? "").toLowerCase().trim();
    if (st) return st === "approved_admin" || st === "approved" || st === "verified";
  } catch {}

  try {
    const email = user?.email ?? null;
    const userId = user.id;

    const truthy = (v: unknown) =>
      v === true ||
      (typeof v === "number" && v > 0) ||
      (typeof v === "string" &&
        v.trim() !== "" &&
        v.trim().toLowerCase() !== "false" &&
        v.trim().toLowerCase() !== "0" &&
        v.trim().toLowerCase() !== "no");

    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase
        .from("passengers")
        .select("is_verified,verified,verification_tier,night_allowed")
        .eq(col, val)
        .limit(1)
        .maybeSingle();

      if (!r?.error && r?.data) {
        const row: any = r.data;
        return (
          truthy(row.is_verified) ||
          truthy(row.verified) ||
          truthy(row.verification_tier) ||
          truthy(row.night_allowed)
        );
      }
    }
  } catch {}

  return false;
}

export async function GET(req: NextRequest) {
  try {
    const { user, authMode } = await getUserFromCookieOrBearer(req);

    const headers = { "Cache-Control": "no-store, max-age=0" };

    if (!user) {
      return NextResponse.json(
        { ok: true, authed: false },
        { status: 200, headers }
      );
    }

    const meta = (user.user_metadata ?? {}) as any;
    const fullName =
      meta.full_name ??
      meta.name ??
      meta.display_name ??
      null;

    const role = meta.role ?? null;

    const deviceId = getDeviceId(req);
    const anonSupabase = createAnonSupabase();

    let deviceSession: any = null;
    if (authMode === "bearer" && deviceId) {
      const validateRes = await anonSupabase.rpc("jride_passenger_validate_device_session", {
        p_user_id: user.id,
        p_device_id: deviceId,
      });

      if (validateRes.error) {
        return NextResponse.json(
          {
            ok: false,
            authed: false,
            error: "DEVICE_SESSION_VALIDATE_FAILED",
            message: validateRes.error.message,
          },
          { status: 401, headers }
        );
      }

      deviceSession = validateRes.data as any;
      if (!deviceSession?.ok) {
        return NextResponse.json(
          {
            ok: false,
            authed: false,
            error: deviceSession?.error || "ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE",
          },
          { status: 401, headers }
        );
      }
    }

    const verified = await computeVerified(anonSupabase, user);

    let promo: any = null;
    if (deviceId) {
      const promoRes = await anonSupabase.rpc("jride_promo_get_status", {
        p_user_id: user.id,
        p_device_id: deviceId,
        p_is_verified: verified,
        p_program_code: "ANDROID_FIRST_RIDE_40",
      });
      if (!promoRes.error) {
        promo = promoRes.data as any;
      }
    }

    return NextResponse.json(
      {
        ok: true,
        authed: true,
        role,
        auth_mode: authMode,
        verified,
        user: {
          id: user.id,
          email: user.email ?? null,
          phone: (user as any).phone ?? null,
          name: fullName,
          full_name: fullName,
        },
        device_session: deviceSession?.ok ? deviceSession : null,
        promo: promo?.ok ? promo : null,
      },
      { status: 200, headers }
    );
  } catch {
    return NextResponse.json(
      { ok: false, error: "SESSION_ROUTE_FAILED" },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}