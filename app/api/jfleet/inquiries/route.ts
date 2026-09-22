import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetPassenger } from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Old APKs/tabs must restart in the pinned planner, never silently create an
// unreviewable inquiry. Do not redirect POST payloads to another write endpoint.
export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };
  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not accepting quote requests yet." },
      { status: 503, headers }
    );
  }
  const auth = await requireJfleetPassenger(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }
  return NextResponse.json(
    {
      ok: false,
      code: "JFLEET_PINNED_REQUEST_REQUIRED",
      message: "This quote form has been replaced. Open Request a quote, pin the itinerary and review the road route. No inquiry was created.",
      next_path: "/jfleet/request",
    },
    { status: 410, headers }
  );
}

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetPassenger(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const inquiries = await admin
    .from("jfleet_inquiries")
    .select(
      "id,inquiry_code,purpose,requested_vehicle_type,trip_mode,pickup_label,scheduled_start_at,scheduled_end_at,status,submitted_at,quote_due_at,current_itinerary_version,created_at,jfleet_itineraries(id,version_no,status,source,created_at,jfleet_itinerary_stops(sequence_no,stop_type,location_label,lat,lng,notes)),jfleet_quotes(id,version_no,status,total_amount,currency,valid_until,inclusions,exclusions,pricing_notes,fuel_basis_note,sent_at,accepted_at)"
    )
    .eq("passenger_user_id", auth.user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  if (inquiries.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_INQUIRY_READ_FAILED",
        message: "Could not load your JFleet inquiries.",
      },
      { status: 500, headers }
    );
  }

  return NextResponse.json(
    { ok: true, inquiries: inquiries.data ?? [] },
    { status: 200, headers }
  );
}
