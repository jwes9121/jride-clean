import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
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

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          error: authorization.error,
        },
        authorization.status
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,name,event_date,status")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    const { count: checkedInCount, error: checkedInError } = await supabase
      .from("event_attendees")
      .select("id", { count: "exact", head: true })
      .eq("event_id", event.id)
      .eq("attendance_status", "checked_in")
      .eq("is_disqualified", false)
      .is("merged_into", null);

    if (checkedInError) throw new Error(checkedInError.message);

    if (event.status !== "live") {
      return noStore({
        success: true,
        trackingOpen: false,
        generatedAt: new Date().toISOString(),
        event,
        summary: {
          checkedIn: checkedInCount || 0,
          sharing: 0,
          fresh: 0,
          delayed: 0,
          stale: 0,
        },
        positions: [],
        message: "Live safety tracking is available only while the event status is LIVE.",
      });
    }

    const { data: rows, error: locationError } = await supabase
      .from("event_live_safety_locations")
      .select(
        "attendee_id,latitude,longitude,accuracy_m,heading_deg,speed_mps,sharing_started_at,updated_at,source"
      )
      .eq("event_id", event.id)
      .order("updated_at", { ascending: false });

    if (locationError) throw new Error(locationError.message);

    const attendeeIds = (rows || [])
      .map((row: any) => String(row.attendee_id || ""))
      .filter(Boolean);

    const attendeeResult =
      attendeeIds.length > 0
        ? await supabase
            .from("event_attendees")
            .select(
              "id,full_name,registration_number,group_value,attendance_status,is_disqualified,merged_into"
            )
            .eq("event_id", event.id)
            .in("id", attendeeIds)
        : { data: [], error: null };

    if (attendeeResult.error) {
      throw new Error(attendeeResult.error.message);
    }

    const attendeeById = new Map(
      (attendeeResult.data || []).map((attendee: any) => [
        String(attendee.id),
        attendee,
      ])
    );

    const nowMs = Date.now();

    const positions = (rows || [])
      .map((row: any) => {
        const attendee: any = attendeeById.get(
          String(row.attendee_id)
        );

        if (!attendee || attendee.merged_into || attendee.is_disqualified) {
          return null;
        }

        const updatedMs = Date.parse(String(row.updated_at || ""));
        const ageSeconds = Number.isFinite(updatedMs)
          ? Math.max(0, Math.floor((nowMs - updatedMs) / 1000))
          : null;

        const freshness =
          ageSeconds === null || ageSeconds > 120
            ? "stale"
            : ageSeconds > 45
            ? "delayed"
            : "fresh";

        return {
          attendeeId: attendee.id,
          fullName: attendee.full_name,
          registrationNumber: attendee.registration_number,
          groupValue: attendee.group_value,
          attendanceStatus: attendee.attendance_status,
          latitude: row.latitude,
          longitude: row.longitude,
          accuracyM: row.accuracy_m,
          headingDeg: row.heading_deg,
          speedMps: row.speed_mps,
          sharingStartedAt: row.sharing_started_at,
          updatedAt: row.updated_at,
          ageSeconds,
          freshness,
        };
      })
      .filter(Boolean);

    const fresh = positions.filter(
      (position: any) => position.freshness === "fresh"
    ).length;
    const delayed = positions.filter(
      (position: any) => position.freshness === "delayed"
    ).length;
    const stale = positions.filter(
      (position: any) => position.freshness === "stale"
    ).length;

    return noStore({
      success: true,
      trackingOpen: true,
      generatedAt: new Date().toISOString(),
      event,
      summary: {
        checkedIn: checkedInCount || 0,
        sharing: positions.length,
        fresh,
        delayed,
        stale,
      },
      positions,
      privacy: {
        purpose: "participant_safety",
        storage: "latest_location_only",
        visibleTo: "authorized_event_staff",
        automaticCleanup: "when_event_leaves_live_status",
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load live safety locations.",
      },
      500
    );
  }
}