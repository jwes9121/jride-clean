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
          "id,slug,name,short_name,status,registration_opens_at,registration_closes_at"
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
      remainingResult,
    ] = await Promise.all([
      supabase
        .from("event_tickets")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("ticket_type", "regular"),

      supabase
        .from("event_tickets")
        .select("id", {
          count: "exact",
          head: true,
        })
        .eq("event_id", event.id)
        .eq("ticket_type", "regular")
        .in("status", [
          "available",
          "reserved",
        ]),
    ]);

    if (totalResult.error) {
      throw new Error(totalResult.error.message);
    }

    if (remainingResult.error) {
      throw new Error(
        remainingResult.error.message
      );
    }

    const total = totalResult.count || 0;
    const remaining =
      remainingResult.count || 0;

    return noStore({
      success: true,
      event: {
        name: event.name,
        shortName: event.short_name,
        slug: event.slug,
        status: event.status,
        registrationOpensAt:
          event.registration_opens_at,
        registrationClosesAt:
          event.registration_closes_at,
      },
      total,
      remaining,
      soldOut:
        total > 0 && remaining === 0,
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