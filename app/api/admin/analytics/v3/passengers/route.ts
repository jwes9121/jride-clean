import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ACTIVITY_COLUMNS,
  IDENTITY_COLUMNS,
  PASSENGER_UUID,
  VERIFICATION_LOCATION_COLUMNS,
} from "@/lib/passenger/identity";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, body: unknown) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" },
  });
}

export async function GET(req: Request) {
  try {
    const access = await requireStaff();
    if (!access.ok) return json(access.status, { ok: false, error: access.error });
    const params = new URL(req.url).searchParams;
    const userId = (params.get("passenger_id") || "").trim().toLowerCase();
    const query = (params.get("q") || "").trim();
    if (userId && !PASSENGER_UUID.test(userId)) {
      return json(400, { ok: false, error: "Enter a valid passenger UUID." });
    }
    if (!userId && (query.length < 2 || query.length > 120)) {
      return json(400, { ok: false, error: "Enter 2 to 120 characters to search." });
    }
    const db = supabaseAdmin({ noStore: true });
    if (!userId) {
      const result = await db.rpc("search_passenger_identity_v1", { p_query: query }).select(IDENTITY_COLUMNS);
      if (result.error) return json(503, { ok: false, error: "Passenger search is unavailable. Please retry." });
      const rows = result.data || [];
      return json(200, { ok: true, rows: rows.slice(0, 25), has_more: rows.length > 25 });
    }

    const profile = await db.from("passenger_identity_v1").select(IDENTITY_COLUMNS).eq("user_id", userId).maybeSingle();
    if (profile.error) return json(503, { ok: false, error: "Passenger profile is unavailable. Please retry." });
    if (!profile.data) return json(404, { ok: false, error: "Passenger profile not found." });
    const canViewVerificationLocation = access.staff.role === "admin";
    let verificationLocation = null;
    let verificationLocationError: string | null = null;
    if (canViewVerificationLocation) {
      const location = await db.from("passenger_verification_latest_location_v1")
        .select(VERIFICATION_LOCATION_COLUMNS).eq("passenger_id", userId).maybeSingle();
      verificationLocation = location.error ? null : location.data;
      verificationLocationError = location.error
        ? "Verification submission location could not be loaded. Please retry."
        : null;
    }

    const activity = await db.from("passenger_recent_activity_v1").select(ACTIVITY_COLUMNS)
      .eq("user_id", userId).order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("activity_id", { ascending: false }).limit(51);
    return json(200, {
      ok: true,
      profile: profile.data,
      can_view_evidence: access.staff.role === "admin",
      can_view_verification_location: canViewVerificationLocation,
      verification_location: verificationLocation,
      verification_location_error: verificationLocationError,
      activity: activity.error ? [] : (activity.data || []).slice(0, 50),
      activity_has_more: !activity.error && (activity.data || []).length > 50,
      activity_error: activity.error ? "Recent activity could not be loaded. Please retry." : null,
    });
  } catch {
    return json(503, { ok: false, error: "Passenger lookup is unavailable. Please retry." });
  }
}
