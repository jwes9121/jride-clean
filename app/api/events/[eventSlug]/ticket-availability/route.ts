import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

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
  {
    params,
  }: {
    params: { eventSlug: string };
  }
) {
  try {
    const eventSlug = cleanText(params.eventSlug);

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    const supabase = supabaseAdmin();

    const { data: event, error: eventError } =
      await supabase
        .from("events")
        .select(
          "id,slug,name,short_name,status,event_date,venue,registration_opens_at,registration_closes_at"
        )
        .eq("slug", eventSlug)
        .maybeSingle();

    if (eventError) {
      throw new Error(eventError.message);
    }

    if (!event?.id) {
      return noStore(
        {
          success: false,
          error: "Event was not found.",
        },
        404
      );
    }

    const [
      totalResult,
      availableResult,
      reservedResult,
      claimedResult,
    ] = await Promise.all([
      supabase
        .from("event_tickets")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("ticket_type", "regular")
        .neq("status", "void"),

      supabase
        .from("event_tickets")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("ticket_type", "regular")
        .eq("status", "available"),

      supabase
        .from("event_tickets")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("ticket_type", "regular")
        .eq("status", "reserved"),

      supabase
        .from("event_tickets")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("ticket_type", "regular")
        .eq("status", "claimed"),
    ]);

    for (const result of [
      totalResult,
      availableResult,
      reservedResult,
      claimedResult,
    ]) {
      if (result.error) {
        throw new Error(result.error.message);
      }
    }

    const total = totalResult.count || 0;
    const available = availableResult.count || 0;
    const reserved = reservedResult.count || 0;
    const claimed = claimedResult.count || 0;

    return noStore({
      success: true,
      event: {
        name: event.name,
        shortName: event.short_name,
        slug: event.slug,
        status: event.status,
        eventDate: event.event_date,
        venue: event.venue,
        registrationOpensAt:
          event.registration_opens_at,
        registrationClosesAt:
          event.registration_closes_at,
      },
      total,
      available,
      reserved,
      claimed,
      registrationSlotsRemaining:
        available + reserved,
      soldOut:
        total > 0 &&
        available + reserved === 0,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Ticket availability failed to load.",
      },
      500
    );
  }
}
