import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePassengerBookingIdentity } from "@/lib/passenger/bookingIdentity";
import { errandFeatureEnabled } from "@/lib/errand/server";

function text(value: unknown): string {
  const clean = String(value ?? "").trim();
  return clean.toLowerCase() === "null" || clean.toLowerCase() === "undefined"
    ? ""
    : clean;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function GET(req: Request) {
  try {
    const enabled = errandFeatureEnabled();
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json(
        {
          ok: true,
          enabled,
          authed: false,
          verified: false,
          verification_status: null,
          profile_name: null,
          last_stage0: null,
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    const auth = createClient();
    const { data: authData, error: authError } = await auth.auth.getUser(token);
    const userId = text(authData?.user?.id);

    if (authError || !userId) {
      return NextResponse.json(
        {
          ok: true,
          enabled,
          authed: false,
          verified: false,
          verification_status: null,
          profile_name: null,
          last_stage0: null,
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const [verification, identity, profile, recentErrand] = await Promise.all([
      admin
        .from("passenger_verifications")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
      resolvePassengerBookingIdentity(admin, userId),
      admin
        .from("passenger_profiles")
        .select("town_origin,barangay_origin")
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("bookings")
        .select("from_label,pickup_lat,pickup_lng,created_at")
        .eq("created_by_user_id", userId)
        .eq("service_type", "errand")
        .not("pickup_lat", "is", null)
        .not("pickup_lng", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (verification.error) {
      return NextResponse.json(
        {
          ok: false,
          enabled,
          authed: true,
          error: "VERIFICATION_CHECK_FAILED",
          message: verification.error.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const verificationStatus = text((verification.data as any)?.status).toLowerCase();
    const verified = verificationStatus === "approved_admin";

    const recentLabel = text((recentErrand.data as any)?.from_label);
    const recentLat = num((recentErrand.data as any)?.pickup_lat);
    const recentLng = num((recentErrand.data as any)?.pickup_lng);
    const lastStage0 =
      !recentErrand.error && recentLabel && recentLat != null && recentLng != null
        ? {
            label: recentLabel,
            lat: recentLat,
            lng: recentLng,
            source: "latest_errand",
          }
        : null;

    return NextResponse.json(
      {
        ok: true,
        enabled,
        authed: true,
        verified,
        verification_status: verificationStatus || null,
        profile_name: identity.name || null,
        profile_name_source: identity.source || null,
        profile_town: !profile.error ? text((profile.data as any)?.town_origin) || null : null,
        profile_barangay: !profile.error
          ? text((profile.data as any)?.barangay_origin) || null
          : null,
        last_stage0: lastStage0,
        user_id: userId,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_ELIGIBILITY_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
