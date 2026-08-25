import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePassengerBookingIdentity } from "@/lib/passenger/bookingIdentity";
import { errandFeatureEnabled } from "@/lib/errand/server";

function text(value: unknown): string {
  return String(value ?? "").trim();
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
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const [verification, identity] = await Promise.all([
      admin
        .from("passenger_verifications")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle(),
      resolvePassengerBookingIdentity(admin, userId),
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

    return NextResponse.json(
      {
        ok: true,
        enabled,
        authed: true,
        verified,
        verification_status: verificationStatus || null,
        profile_name: identity.name || null,
        profile_name_source: identity.source || null,
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
