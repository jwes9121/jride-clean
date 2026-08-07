import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function cleanUuid(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : "";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);
    if (!authorization.ok) {
      return noStore({ success: false, error: authorization.error }, authorization.status);
    }

    const familyId = cleanUuid(params.familyId);
    if (!familyId) {
      return noStore({ success: false, error: "Invalid family ID." }, 400);
    }

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id,name")
      .eq("id", familyId)
      .maybeSingle();

    if (familyError) throw new Error(familyError.message);
    if (!family?.id) {
      return noStore({ success: false, error: "Family reunion not found." }, 404);
    }

    const { data: familyLinks, error: familyLinksError } = await supabase
      .from("family_reunion_events")
      .select("id,event_id,created_at")
      .eq("family_id", familyId)
      .order("created_at", { ascending: false });

    if (familyLinksError) throw new Error(familyLinksError.message);

    const { data: allLinks, error: allLinksError } = await supabase
      .from("family_reunion_events")
      .select("event_id");

    if (allLinksError) throw new Error(allLinksError.message);

    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id,slug,status")
      .order("slug", { ascending: true });

    if (eventsError) throw new Error(eventsError.message);

    const eventById = new Map(
      (events ?? []).map((event) => [String(event.id), event] as const)
    );
    const assignedIds = new Set(
      (allLinks ?? []).map((row) => String(row.event_id))
    );

    const linkedEvents = (familyLinks ?? [])
      .map((link) => {
        const event = eventById.get(String(link.event_id));
        if (!event) return null;

        return {
          linkId: link.id,
          linkedAt: link.created_at,
          eventId: event.id,
          slug: event.slug,
          status: event.status,
        };
      })
      .filter(Boolean);

    const eligibleEvents = (events ?? [])
      .filter((event) => !assignedIds.has(String(event.id)))
      .map((event) => ({
        eventId: event.id,
        slug: event.slug,
        status: event.status,
      }));

    return noStore({
      success: true,
      family: { id: family.id, name: family.name },
      linkedEvents,
      eligibleEvents,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load reunion events.",
      },
      500
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const authorization = await requireStaff(["admin"]);
    if (!authorization.ok) {
      return noStore({ success: false, error: authorization.error }, authorization.status);
    }

    const familyId = cleanUuid(params.familyId);
    if (!familyId) {
      return noStore({ success: false, error: "Invalid family ID." }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const eventId = cleanUuid(body.eventId);
    if (!eventId) {
      return noStore({ success: false, error: "A valid event is required." }, 400);
    }

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id,name")
      .eq("id", familyId)
      .maybeSingle();

    if (familyError) throw new Error(familyError.message);
    if (!family?.id) {
      return noStore({ success: false, error: "Family reunion not found." }, 404);
    }

    const { data: event, error: eventError } = await supabase
      .from("events")
      .select("id,slug,status")
      .eq("id", eventId)
      .maybeSingle();

    if (eventError) throw new Error(eventError.message);
    if (!event?.id) {
      return noStore({ success: false, error: "Event not found." }, 404);
    }

    const { data: existing, error: existingError } = await supabase
      .from("family_reunion_events")
      .select("id,family_id")
      .eq("event_id", eventId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);

    if (existing?.id) {
      return noStore(
        {
          success: false,
          error:
            existing.family_id === familyId
              ? "This event is already linked to this family."
              : "This event is already linked to another family project.",
        },
        409
      );
    }

    const { data: link, error: insertError } = await supabase
      .from("family_reunion_events")
      .insert({ family_id: familyId, event_id: eventId })
      .select("id,family_id,event_id,created_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return noStore(
          { success: false, error: "This event is already linked to a family project." },
          409
        );
      }
      throw new Error(insertError.message);
    }

    return noStore(
      {
        success: true,
        link: {
          id: link.id,
          familyId: link.family_id,
          eventId: link.event_id,
          linkedAt: link.created_at,
          slug: event.slug,
          status: event.status,
        },
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to link reunion event.",
      },
      500
    );
  }
}
