import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  _req: NextRequest,
  { params }: { params: { eventSlug: string } }
) {
  try {
    const supabase = supabaseAdmin();

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,name,short_name,slug,event_date,group_label")
      .eq("slug", params.eventSlug)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);

    if (!event?.id) {
      return NextResponse.json(
        { success: false, error: "Event not found." },
        { status: 404 }
      );
    }

    const { data: alumniType, error: alumniTypeError } = await supabase
      .from("event_attendee_types")
      .select("id")
      .eq("event_id", event.id)
      .eq("type_key", "alumni")
      .maybeSingle();

    if (alumniTypeError) throw new Error(alumniTypeError.message);

    if (!alumniType?.id) {
      return NextResponse.json(
        { success: false, error: "Alumni attendee type not found." },
        { status: 500 }
      );
    }

    const now = new Date();

    const [
      registeredAlumniResult,
      checkedInResult,
      pendingReviewResult,
      guestsResult,
      velocity1Result,
      velocity5Result,
      velocity15Result,
      topBatchesResult,
      recentActivityResult,
      lastCheckinResult,
    ] = await Promise.all([
      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendee_type_id", alumniType.id)
        .is("merged_into", null),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("is_disqualified", true)
        .is("merged_into", null),

      supabase
        .from("event_guest_links")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .gte("checked_in_at", new Date(now.getTime() - 60_000).toISOString()),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .gte("checked_in_at", new Date(now.getTime() - 300_000).toISOString()),

      supabase
        .from("event_attendees")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .gte("checked_in_at", new Date(now.getTime() - 900_000).toISOString()),

      supabase
        .from("event_attendees")
        .select("group_value")
        .eq("event_id", event.id)
        .eq("attendee_type_id", alumniType.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null),

      supabase
        .from("event_attendees")
        .select("id,full_name,group_value,attendance_status,checked_in_at,is_disqualified,attendee_type_id")
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .order("checked_in_at", { ascending: false })
        .limit(20),

      supabase
        .from("event_attendees")
        .select("checked_in_at")
        .eq("event_id", event.id)
        .eq("attendance_status", "checked_in")
        .is("merged_into", null)
        .order("checked_in_at", { ascending: false })
        .limit(1),
    ]);

    const batchCounts: Record<string, number> = {};

    for (const row of topBatchesResult.data || []) {
      const key = String(row.group_value || "Unknown");
      batchCounts[key] = (batchCounts[key] || 0) + 1;
    }

    const topBatches = Object.entries(batchCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([value, count]) => ({ value, count }));

    const lastCheckinAt = lastCheckinResult.data?.[0]?.checked_in_at || null;

    const secondsSinceLastScan = lastCheckinAt
      ? Math.floor((now.getTime() - new Date(lastCheckinAt).getTime()) / 1000)
      : null;

    const scannerStatus =
      secondsSinceLastScan === null
        ? "unknown"
        : secondsSinceLastScan < 600
        ? "online"
        : "idle";

    return NextResponse.json({
      success: true,
      generatedAt: now.toISOString(),
      event: {
        title: event.name,
        shortName: event.short_name,
        slug: event.slug,
        eventDate: event.event_date,
        groupLabel: event.group_label || "Batch",
      },
      summary: {
        registeredAlumni: registeredAlumniResult.count || 0,
        checkedIn: checkedInResult.count || 0,
        pendingReview: pendingReviewResult.count || 0,
        guests: guestsResult.count || 0,
      },
      velocity: {
        last1Min: velocity1Result.count || 0,
        last5Min: velocity5Result.count || 0,
        last15Min: velocity15Result.count || 0,
      },
      topBatches,
      recentActivity: (recentActivityResult.data || []).map((attendee) => ({
        id: attendee.id,
        fullName: attendee.full_name,
        groupValue: attendee.group_value,
        checkedInAt: attendee.checked_in_at,
        attendeeType: attendee.attendee_type_id === alumniType.id ? "alumni" : "guest",
      })),
      scanner: {
        status: scannerStatus,
        lastCheckinAt,
        secondsSinceLastScan,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Dashboard load failed.",
      },
      { status: 500 }
    );
  }
}
