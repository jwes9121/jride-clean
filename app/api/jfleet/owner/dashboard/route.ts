import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });

  const [inquiries, bookings, vehicles, drivers] = await Promise.all([
    admin
      .from("jfleet_inquiries")
      .select(
        "id,inquiry_code,purpose,requested_vehicle_type,trip_mode,pickup_label,scheduled_start_at,scheduled_end_at,passenger_count,cargo_description,cargo_weight_kg,luggage_notes,special_notes,status,submitted_at,quote_due_at,owner_opened_at,current_itinerary_version,created_at"
      )
      .eq("partner_id", auth.partner.id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("jfleet_bookings")
      .select(
        "id,booking_code,inquiry_id,accepted_quote_id,passenger_user_id,current_itinerary_id,scheduled_start_at,scheduled_end_at,original_quote_amount,addon_total,reservation_required_amount,cancellation_free_until,final_trip_value,jride_commission_amount,partner_net_amount,status,payment_status,reservation_paid_at,fully_paid_at,assigned_vehicle_id,assigned_driver_id,assigned_at,trip_started_at,trip_completed_at,cancelled_at,cancelled_by,cancellation_reason,cancellation_penalty_amount,refund_amount,created_at"
      )
      .eq("partner_id", auth.partner.id)
      .order("scheduled_start_at", { ascending: true })
      .limit(100),
    admin
      .from("jfleet_vehicles")
      .select(
        "id,unit_code,vehicle_type,make,model,model_year,plate_number,passenger_capacity,cargo_capacity_kg,status,documents_verified,notes"
      )
      .eq("partner_id", auth.partner.id)
      .order("unit_code", { ascending: true }),
    admin
      .from("jfleet_drivers")
      .select(
        "id,driver_code,full_name,phone,photo_url,status,documents_verified,rating_average,rating_count,completed_trips"
      )
      .eq("partner_id", auth.partner.id)
      .order("full_name", { ascending: true }),
  ]);

  const failure = [inquiries, bookings, vehicles, drivers].find((result) => result.error);
  if (failure?.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_OWNER_DASHBOARD_READ_FAILED",
        message: "Could not load the JFleet owner dashboard.",
      },
      { status: 500, headers }
    );
  }

  const inquiryRows = inquiries.data ?? [];
  const inquiryIds = inquiryRows.map((row) => row.id);
  const bookingRows = bookings.data ?? [];
  const bookingIds = bookingRows.map((row) => row.id);

  const [itineraries, quotes, payments, addons] = await Promise.all([
    inquiryIds.length
      ? admin
          .from("jfleet_itineraries")
          .select("id,inquiry_id,version_no,source,status,change_reason,created_at")
          .in("inquiry_id", inquiryIds)
          .order("version_no", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    inquiryIds.length
      ? admin
          .from("jfleet_quotes")
          .select(
            "id,inquiry_id,itinerary_id,version_no,status,total_amount,currency,valid_until,inclusions,exclusions,pricing_notes,fuel_basis_note,sent_at,accepted_at,declined_at"
          )
          .in("inquiry_id", inquiryIds)
          .order("version_no", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? admin
          .from("jfleet_payments")
          .select(
            "id,booking_id,payment_kind,amount,status,payment_channel,payment_reference,paid_at,confirmed_at,notes,created_at"
          )
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    bookingIds.length
      ? admin
          .from("jfleet_addons")
          .select(
            "id,booking_id,requested_by,description,additional_route,fuel_vehicle_fee,driver_fee,other_fee,total_amount,status,proposed_at,accepted_at,payment_confirmed_at,notes"
          )
          .in("booking_id", bookingIds)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ]);

  const relatedFailure = [itineraries, quotes, payments, addons].find(
    (result) => result.error
  );
  if (relatedFailure?.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_OWNER_DASHBOARD_DETAIL_FAILED",
        message: "Could not load JFleet booking details.",
      },
      { status: 500, headers }
    );
  }

  const itineraryRows = itineraries.data ?? [];
  const itineraryIds = itineraryRows.map((row) => row.id);
  const stops = itineraryIds.length
    ? await admin
        .from("jfleet_itinerary_stops")
        .select("id,itinerary_id,sequence_no,stop_type,location_label,lat,lng,notes")
        .in("itinerary_id", itineraryIds)
        .order("sequence_no", { ascending: true })
    : { data: [], error: null };

  if (stops.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_OWNER_ITINERARY_READ_FAILED",
        message: "Could not load the JFleet itinerary.",
      },
      { status: 500, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      owner_user_id: auth.user.id,
      partner: auth.partner,
      inquiries: inquiryRows,
      itineraries: itineraryRows,
      itinerary_stops: stops.data ?? [],
      quotes: quotes.data ?? [],
      bookings: bookingRows,
      payments: payments.data ?? [],
      addons: addons.data ?? [],
      vehicles: vehicles.data ?? [],
      drivers: drivers.data ?? [],
    },
    { status: 200, headers }
  );
}
