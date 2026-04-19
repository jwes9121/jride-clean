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

    const anyPromoRes = await admin
      .from("passenger_promo_allowlist")
      .select("id, promo_code, platform, status, require_verified")
      .eq("promo_code", promoCode)
      .eq("platform", "android")
      .limit(1)
      .maybeSingle();

    if (anyPromoRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_CODE_LOOKUP_FAILED",
          message: anyPromoRes.error.message || "Could not validate this promo code.",
        },
        { status: 500 }
      );
    }

    if (!anyPromoRes.data) {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_CODE_UNKNOWN",
          message: "Promo code not found. Please check the code and try again.",
        },
        { status: 200 }
      );
    }

    const activePromoRes = await admin
      .from("passenger_promo_allowlist")
      .select("id")
      .eq("promo_code", promoCode)
      .eq("platform", "android")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (activePromoRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_STATUS_LOOKUP_FAILED",
          message: activePromoRes.error.message || "Could not validate promo campaign status.",
        },
        { status: 500 }
      );
    }

    if (!activePromoRes.data) {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_ENDED",
          message: "This promo has already ended.",
        },
        { status: 200 }
      );
    }

    const requireVerified = anyPromoRes.data?.require_verified === true;

    if (requireVerified) {
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
            message: "Verify your account first before using this promo.",
          },
          { status: 200 }
        );
      }
    }

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
      const passengerPromoRes = await admin
        .from("passenger_promo_allowlist")
        .select("id, status")
        .eq("passenger_id", passengerId)
        .eq("platform", "android")
        .eq("promo_code", promoCode)
        .limit(1)
        .maybeSingle();

      if (passengerPromoRes.error) {
        return NextResponse.json(
          {
            ok: false,
            eligible: false,
            error: "PROMO_PASSENGER_ALLOWLIST_LOOKUP_FAILED",
            message: passengerPromoRes.error.message || "Could not validate passenger promo status.",
          },
          { status: 500 }
        );
      }

      if (passengerPromoRes.data && norm(passengerPromoRes.data.status) !== "active") {
        return NextResponse.json(
          {
            ok: true,
            eligible: false,
            error: "PROMO_ENDED",
            message: "This promo has already ended.",
          },
          { status: 200 }
        );
      }

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

    const promoProgramCode = "ANDROID_FIRST_RIDE_40";

    const ensureStatusRes = await admin.rpc("jride_promo_ensure_android_credit", {
      p_user_id: passengerId,
      p_device_id: deviceId,
      p_program_code: promoProgramCode,
    });

    if (ensureStatusRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_ENSURE_RPC_FAILED",
          message: ensureStatusRes.error.message || "Could not verify promo ownership for this account and device.",
        },
        { status: 500 }
      );
    }

    const ensureStatus = (ensureStatusRes.data as any) || null;

    if (ensureStatus?.ok === false) {
      const ensureError = norm(ensureStatus?.error);

      if (ensureError === "promo_already_exists_for_user_or_device") {
        return NextResponse.json(
          {
            ok: true,
            eligible: false,
            error: "PROMO_ALREADY_EXISTS_FOR_USER_OR_DEVICE",
            message: "This promo is already attached to this Android device or another passenger account on this device.",
            promo_status: ensureStatus,
          },
          { status: 200 }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: ensureStatus?.error || "PROMO_NOT_AVAILABLE",
          message: "This promo is not currently available for this Android passenger account and device.",
          promo_status: ensureStatus,
        },
        { status: 200 }
      );
    }

    const statusRes = await admin.rpc("jride_promo_get_status", {
      p_user_id: passengerId,
      p_device_id: deviceId,
      p_program_code: promoProgramCode,
    });

    if (statusRes.error) {
      return NextResponse.json(
        {
          ok: false,
          eligible: false,
          error: "PROMO_STATUS_RPC_FAILED",
          message: statusRes.error.message || "Could not check promo credit status.",
        },
        { status: 500 }
      );
    }

    const promoStatus = (statusRes.data as any) || null;
    const creditExists = promoStatus?.credit_exists === true;
    const creditStatus = norm(promoStatus?.credit_status);

    if (creditExists && creditStatus === "used") {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_ALREADY_USED",
          message: "This promo for this account and device has already been used.",
          promo_status: promoStatus,
        },
        { status: 200 }
      );
    }

    if (creditExists && creditStatus === "reserved") {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_ALREADY_RESERVED",
          message: "This promo is already reserved for another booking.",
          promo_status: promoStatus,
        },
        { status: 200 }
      );
    }

    if (creditExists && creditStatus && creditStatus !== "available") {
      return NextResponse.json(
        {
          ok: true,
          eligible: false,
          error: "PROMO_NOT_AVAILABLE",
          message: "This promo is not currently available for this account and device.",
          promo_status: promoStatus,
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
          discount_amount: Number(promoStatus?.credit_amount ?? 40),
          platform: "android",
          passenger_id: passengerId,
          require_verified: allowRow?.require_verified === true,
          approved_device_match: approvedDeviceId ? approvedDeviceId === deviceId : true,
          credit_exists: creditExists,
          credit_status: creditStatus || (creditExists ? "available" : null),
          credit_id: promoStatus?.credit_id ?? null,
          daily_available_slots: promoStatus?.daily_available_slots ?? null,
        },
        promo_status: promoStatus,
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
