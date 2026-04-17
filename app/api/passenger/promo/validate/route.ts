import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

function env(name: string) {
  return process.env[name] || "";
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function norm(v: unknown): string {
  return text(v).toLowerCase();
}

function createAdminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createSupabaseClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function extractBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!auth) return "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m?.[1]?.trim() || "";
}

function createUserClient(accessToken: string) {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const anon =
    env("SUPABASE_ANON_KEY") ||
    env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
    env("NEXT_PUBLIC_SUPABASE_KEY") ||
    "";
  if (!url || !anon) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
  }
  return createSupabaseClient(url, anon, {
    global: { headers: { Authorization: "Bearer " + accessToken } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolvePassengerAuth(req: Request) {
  const cookieSupabase = createClient();
  const accessToken = extractBearerToken(req);

  if (accessToken) {
    const userSupabase = createUserClient(accessToken);
    const { data: userRes, error: userErr } = await userSupabase.auth.getUser(accessToken);
    const user = userRes?.user;
    if (userErr || !user?.id) {
      return {
        ok: false,
        authed: false,
        user: null,
        supabase: userSupabase,
        error: userErr?.message || "Invalid bearer token",
      };
    }
    return {
      ok: true,
      authed: true,
      user,
      supabase: userSupabase,
      error: "",
    };
  }

  const { data: userRes, error: userErr } = await cookieSupabase.auth.getUser();
  const user = userRes?.user;
  if (userErr || !user?.id) {
    return {
      ok: false,
      authed: false,
      user: null,
      supabase: cookieSupabase,
      error: userErr?.message || "Not signed in",
    };
  }

  return {
    ok: true,
    authed: true,
    user,
    supabase: cookieSupabase,
    error: "",
  };
}

export async function POST(req: Request) {
  try {
    const auth = await resolvePassengerAuth(req);

    if (!auth.authed || !auth.user?.id) {
      return NextResponse.json(
        { ok: false, eligible: false, error: "NOT_AUTHED", message: "Passenger sign-in required." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({} as any));
    const promoCode = norm(body?.promo_code);
    const platform = norm(body?.platform);
    const deviceId = text(body?.device_id);

    if (!promoCode) {
      return NextResponse.json(
        { ok: false, eligible: false, error: "MISSING_PROMO_CODE", message: "Promo code is required." },
        { status: 400 }
      );
    }

    if (platform !== "android") {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "ANDROID_ONLY",
          message: "This promo is available for Android bookings only.",
        },
        { status: 200 }
      );
    }

    if (!deviceId) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "MISSING_DEVICE_ID",
          message: "Android device ID is required.",
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const passengerId = auth.user.id;

    const allowRes = await admin
      .from("passenger_promo_allowlist")
      .select("*")
      .eq("passenger_id", passengerId)
      .eq("platform", "android")
      .eq("status", "active")
      .eq("promo_code", promoCode)
      .maybeSingle();

    if (allowRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_ALLOWLIST_LOOKUP_FAILED",
          message: allowRes.error.message || "Could not validate promo allowlist.",
        },
        { status: 500 }
      );
    }

    const allowRow: any = allowRes.data || null;

    if (!allowRow) {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_NOT_ALLOWED",
          message: "This promo is not approved for this passenger account.",
        },
        { status: 200 }
      );
    }

    const approvedDeviceId = text(allowRow?.approved_device_id);
    if (approvedDeviceId && approvedDeviceId !== deviceId) {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "DEVICE_NOT_ALLOWED",
          message: "This promo is not approved for this Android device.",
        },
        { status: 200 }
      );
    }

    if (allowRow?.require_verified === true) {
      const verificationRes = await admin
        .from("passenger_verification_requests")
        .select("status")
        .eq("passenger_id", passengerId)
        .maybeSingle();

      if (verificationRes.error) {
        return NextResponse.json(
          {
            ok: false,
            eligible: false,
            error: "VERIFICATION_LOOKUP_FAILED",
            message: verificationRes.error.message || "Could not verify passenger status.",
          },
          { status: 500 }
        );
      }

      const verificationStatus = norm(verificationRes.data?.status);
      if (verificationStatus !== "approved") {
        return NextResponse.json(
          {
            ok: true,
            eligible: false,
            error: "PASSENGER_NOT_VERIFIED",
            message: "Passenger verification must be approved before using this promo.",
          },
          { status: 200 }
        );
      }
    }

    const byPassengerRes = await admin
      .from("passenger_promo_redemptions")
      .select("id, booking_code, redeemed_at, status")
      .eq("passenger_id", passengerId)
      .eq("promo_code", promoCode)
      .maybeSingle();

    if (byPassengerRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_PASSENGER_REDEMPTION_LOOKUP_FAILED",
          message: byPassengerRes.error.message || "Could not check passenger redemption status.",
        },
        { status: 500 }
      );
    }

    if (byPassengerRes.data) {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_ALREADY_USED_BY_PASSENGER",
          message: "This promo has already been used by this passenger account.",
          redemption: byPassengerRes.data,
        },
        { status: 200 }
      );
    }

    const byDeviceRes = await admin
      .from("passenger_promo_redemptions")
      .select("id, booking_code, redeemed_at, status")
      .eq("device_id", deviceId)
      .eq("promo_code", promoCode)
      .maybeSingle();

    if (byDeviceRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_DEVICE_REDEMPTION_LOOKUP_FAILED",
          message: byDeviceRes.error.message || "Could not check device redemption status.",
        },
        { status: 500 }
      );
    }

    if (byDeviceRes.data) {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_ALREADY_USED_BY_DEVICE",
          message: "This promo has already been used on this Android device.",
          redemption: byDeviceRes.data,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        eligible: true,
        promo: {
          promo_code: promoCode,
          discount_amount: 40,
          platform: "android",
          passenger_id: passengerId,
          require_verified: allowRow?.require_verified === true,
          approved_device_match: approvedDeviceId ? approvedDeviceId === deviceId : true,
        },
        message: "Promo is valid for this Android passenger account and device.",
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        eligible: false,
        error: "PROMO_VALIDATE_FAILED",
        message: String(err?.message || err || "Unexpected promo validation failure."),
      },
      { status: 500 }
    );
  }
}
