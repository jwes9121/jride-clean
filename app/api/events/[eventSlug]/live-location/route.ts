import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function finiteNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function loadPassContext(
  supabase: any,
  eventSlug: string,
  registrationNumber: string,
  qrToken: string
) {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id,slug,name,event_date,status")
    .eq("slug", eventSlug)
    .maybeSingle();

  if (eventError) throw new Error(eventError.message);

  if (!event?.id) {
    return {
      ok: false as const,
      status: 404,
      reason: "event_not_found",
      message: "Event was not found.",
    };
  }

  const { data: attendee, error: attendeeError } = await supabase
    .from("event_attendees")
    .select(
      "id,full_name,registration_number,attendance_status,checked_in_at,is_disqualified,merged_into"
    )
    .eq("event_id", event.id)
    .eq("registration_number", registrationNumber)
    .eq("qr_token", qrToken)
    .maybeSingle();

  if (attendeeError) throw new Error(attendeeError.message);

  if (!attendee?.id || attendee.merged_into) {
    return {
      ok: false as const,
      status: 404,
      reason: "invalid_pass",
      message: "Event Pass is invalid.",
    };
  }

  const { data: participation, error: participationError } = await supabase
    .from("event_attendee_participation")
    .select("fun_walk")
    .eq("attendee_id", attendee.id)
    .maybeSingle();

  if (participationError) {
    throw new Error(participationError.message);
  }

  const joiningFunWalk =
    participation == null || participation.fun_walk === true;

  const trackingAvailable =
    event.status === "live" &&
    attendee.attendance_status === "checked_in" &&
    attendee.is_disqualified !== true &&
    joiningFunWalk;

  let availabilityReason = "available";
  let availabilityMessage = "Live safety tracking is available.";

  if (event.status !== "live") {
    availabilityReason = "event_not_live";
    availabilityMessage =
      "Live safety tracking starts only while the event status is LIVE.";
  } else if (attendee.attendance_status !== "checked_in") {
    availabilityReason = "not_checked_in";
    availabilityMessage =
      "Check in at the event before starting live safety tracking.";
  } else if (attendee.is_disqualified === true) {
    availabilityReason = "attendee_not_eligible";
    availabilityMessage = "This attendee is not eligible for live tracking.";
  } else if (!joiningFunWalk) {
    availabilityReason = "not_joining_fun_walk";
    availabilityMessage = "This attendee is not joining the Fun Walk.";
  }

  return {
    ok: true as const,
    event,
    attendee,
    trackingAvailable,
    availabilityReason,
    availabilityMessage,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);
    const registrationNumber = cleanText(
      req.nextUrl.searchParams.get("registrationNumber")
    );
    const qrToken = cleanText(req.nextUrl.searchParams.get("token"));

    if (!eventSlug || !registrationNumber || !qrToken) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message: "Registration number and Event Pass token are required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();
    const context = await loadPassContext(
      supabase,
      eventSlug,
      registrationNumber,
      qrToken
    );

    if (!context.ok) {
      return noStore(
        {
          success: false,
          reason: context.reason,
          message: context.message,
        },
        context.status
      );
    }

    const { data: location, error: locationError } = await supabase
      .from("event_live_safety_locations")
      .select("sharing_started_at,updated_at,accuracy_m")
      .eq("event_id", context.event.id)
      .eq("attendee_id", context.attendee.id)
      .maybeSingle();

    if (locationError) throw new Error(locationError.message);

    return noStore({
      success: true,
      eventStatus: context.event.status,
      attendeeStatus: context.attendee.attendance_status,
      trackingAvailable: context.trackingAvailable,
      availabilityReason: context.availabilityReason,
      message: context.availabilityMessage,
      sharingActive: Boolean(location),
      sharingStartedAt: location?.sharing_started_at || null,
      lastUpdatedAt: location?.updated_at || null,
      lastAccuracyM: location?.accuracy_m ?? null,
      privacy: {
        purpose: "participant_safety",
        storage: "latest_location_only",
        visibleTo: "authorized_event_staff",
        endsWhenEventLeavesLiveStatus: true,
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to read live tracking status.",
      },
      500
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);
    const body = await req.json().catch(() => ({}));
    const registrationNumber = cleanText(body.registrationNumber);
    const qrToken = cleanText(body.token);

    const latitude = finiteNumber(body.latitude);
    const longitude = finiteNumber(body.longitude);
    const accuracyM = finiteNumber(body.accuracyM);
    const headingDeg = finiteNumber(body.headingDeg);
    const speedMps = finiteNumber(body.speedMps);

    if (
      !eventSlug ||
      !registrationNumber ||
      !qrToken ||
      latitude === null ||
      longitude === null ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message: "A valid Event Pass and phone location are required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();
    const context = await loadPassContext(
      supabase,
      eventSlug,
      registrationNumber,
      qrToken
    );

    if (!context.ok) {
      return noStore(
        {
          success: false,
          reason: context.reason,
          message: context.message,
        },
        context.status
      );
    }

    if (!context.trackingAvailable) {
      return noStore(
        {
          success: false,
          reason: context.availabilityReason,
          message: context.availabilityMessage,
        },
        409
      );
    }

    const nowIso = new Date().toISOString();

    const { data: location, error: upsertError } = await supabase
      .from("event_live_safety_locations")
      .upsert(
        {
          event_id: context.event.id,
          attendee_id: context.attendee.id,
          latitude,
          longitude,
          accuracy_m:
            accuracyM !== null && accuracyM >= 0 ? accuracyM : null,
          heading_deg:
            headingDeg !== null && headingDeg >= 0 && headingDeg <= 360
              ? headingDeg
              : null,
          speed_mps:
            speedMps !== null && speedMps >= 0 ? speedMps : null,
          updated_at: nowIso,
          source: "event_pass_web",
        },
        {
          onConflict: "event_id,attendee_id",
          ignoreDuplicates: false,
        }
      )
      .select(
        "event_id,attendee_id,sharing_started_at,updated_at,accuracy_m"
      )
      .single();

    if (upsertError) throw new Error(upsertError.message);

    return noStore({
      success: true,
      reason: "location_updated",
      sharingActive: true,
      sharingStartedAt: location.sharing_started_at,
      updatedAt: location.updated_at,
      accuracyM: location.accuracy_m,
      message: "Safety location updated.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to update live safety location.",
      },
      500
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);
    const body = await req.json().catch(() => ({}));
    const registrationNumber = cleanText(body.registrationNumber);
    const qrToken = cleanText(body.token);

    if (!eventSlug || !registrationNumber || !qrToken) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message: "Registration number and Event Pass token are required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();
    const context = await loadPassContext(
      supabase,
      eventSlug,
      registrationNumber,
      qrToken
    );

    if (!context.ok) {
      return noStore(
        {
          success: false,
          reason: context.reason,
          message: context.message,
        },
        context.status
      );
    }

    const { error: deleteError } = await supabase
      .from("event_live_safety_locations")
      .delete()
      .eq("event_id", context.event.id)
      .eq("attendee_id", context.attendee.id);

    if (deleteError) throw new Error(deleteError.message);

    return noStore({
      success: true,
      reason: "sharing_stopped",
      sharingActive: false,
      message: "Live safety location sharing stopped.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to stop live safety tracking.",
      },
      500
    );
  }
}