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

function cleanUuid(value: unknown) {
  const text = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    text
  )
    ? text
    : "";
}

type FamilyLinkRow = {
  family_person_id: string;
  attendee_id: string | null;
};

type FamilyPersonRow = {
  id: string;
  full_name: string;
  nickname: string | null;
  sex: string | null;
  location_text: string | null;
  location_scope: string | null;
  location_bucket: string | null;
};

type AttendeeRow = {
  id: string;
  registration_number: string | null;
  full_name: string;
};

async function resolveEvent(eventSlug: string) {
  const supabase = supabaseAdmin();

  const { data: event, error } = await supabase
    .from("events")
    .select("id,slug,name,short_name")
    .eq("slug", eventSlug)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return {
    supabase,
    event,
  };
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

    const { supabase, event } = await resolveEvent(params.eventSlug);

    if (!event?.id) {
      return noStore(
        {
          success: false,
          error: "Event not found.",
        },
        404
      );
    }

    const { data: linkRows, error: linksError } = await supabase
      .from("family_reunion_links")
      .select("family_person_id,attendee_id")
      .eq("event_id", event.id);

    if (linksError) throw new Error(linksError.message);

    const links = (linkRows ?? []) as FamilyLinkRow[];
    const personIds = Array.from(
      new Set(
        links
          .map((row) => String(row.family_person_id || "").trim())
          .filter(Boolean)
      )
    );

    if (personIds.length === 0) {
      return noStore({
        success: true,
        event: {
          id: event.id,
          slug: event.slug,
          name: event.name,
          shortName: event.short_name,
        },
        people: [],
      });
    }

    const { data: peopleRows, error: peopleError } = await supabase
      .from("family_people")
      .select(
        "id,full_name,nickname,sex,location_text,location_scope,location_bucket"
      )
      .in("id", personIds);

    if (peopleError) throw new Error(peopleError.message);

    const attendeeIds = Array.from(
      new Set(
        links
          .map((row) => String(row.attendee_id || "").trim())
          .filter(Boolean)
      )
    );

    let attendees: AttendeeRow[] = [];

    if (attendeeIds.length > 0) {
      const { data: attendeeRows, error: attendeeError } = await supabase
        .from("event_attendees")
        .select("id,registration_number,full_name")
        .in("id", attendeeIds)
        .eq("event_id", event.id)
        .is("merged_into", null);

      if (attendeeError) throw new Error(attendeeError.message);
      attendees = (attendeeRows ?? []) as AttendeeRow[];
    }

    const attendeeById = new Map(
      attendees.map((row) => [row.id, row] as const)
    );
    const linkByPersonId = new Map(
      links.map((row) => [row.family_person_id, row] as const)
    );

    const people = ((peopleRows ?? []) as FamilyPersonRow[])
      .map((person) => {
        const link = linkByPersonId.get(person.id);
        const attendee =
          link?.attendee_id ? attendeeById.get(link.attendee_id) : undefined;

        return {
          id: person.id,
          fullName: person.full_name,
          nickname: person.nickname,
          sex: person.sex,
          locationText: person.location_text,
          locationScope: person.location_scope,
          locationBucket: person.location_bucket,
          attendeeId: link?.attendee_id ?? null,
          registrationNumber: attendee?.registration_number ?? null,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, "en"));

    return noStore({
      success: true,
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        shortName: event.short_name,
      },
      people,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load reunion people.",
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

    const body = await req.json().catch(() => ({}));
    const personAId = cleanUuid(body.personAId);
    const personBId = cleanUuid(body.personBId);

    if (!personAId || !personBId) {
      return noStore(
        {
          success: false,
          error: "Two valid family person IDs are required.",
        },
        400
      );
    }

    if (personAId === personBId) {
      return noStore(
        {
          success: false,
          error: "Choose two different people.",
        },
        400
      );
    }

    const { supabase, event } = await resolveEvent(params.eventSlug);

    if (!event?.id) {
      return noStore(
        {
          success: false,
          error: "Event not found.",
        },
        404
      );
    }

    const { data: linkedRows, error: linkedError } = await supabase
      .from("family_reunion_links")
      .select("family_person_id")
      .eq("event_id", event.id)
      .in("family_person_id", [personAId, personBId]);

    if (linkedError) throw new Error(linkedError.message);

    const linkedIds = new Set(
      (linkedRows ?? []).map((row) => String(row.family_person_id))
    );

    if (!linkedIds.has(personAId) || !linkedIds.has(personBId)) {
      return noStore(
        {
          success: false,
          error:
            "Both people must be linked to this reunion before their relationship can be searched.",
        },
        400
      );
    }

    const { data: relationship, error: relationshipError } =
      await supabase.rpc("describe_family_relationship", {
        p_person_a_id: personAId,
        p_person_b_id: personBId,
        p_relationship_types: ["biological"],
      });

    if (relationshipError) {
      throw new Error(relationshipError.message);
    }

    const result =
      relationship && typeof relationship === "object"
        ? (relationship as Record<string, unknown>)
        : null;

    if (!result) {
      return noStore(
        {
          success: false,
          error: "Relationship Finder returned no result.",
        },
        500
      );
    }

    const nearestRaw = Array.isArray(result.nearestCommonAncestors)
      ? result.nearestCommonAncestors
      : [];

    const ancestorIds = Array.from(
      new Set(
        nearestRaw
          .map((row) => {
            if (!row || typeof row !== "object") return "";
            return cleanUuid((row as Record<string, unknown>).ancestorId);
          })
          .filter(Boolean)
      )
    );

    let ancestorNames: FamilyPersonRow[] = [];

    if (ancestorIds.length > 0) {
      const { data: ancestorRows, error: ancestorError } = await supabase
        .from("family_people")
        .select(
          "id,full_name,nickname,sex,location_text,location_scope,location_bucket"
        )
        .in("id", ancestorIds);

      if (ancestorError) throw new Error(ancestorError.message);
      ancestorNames = (ancestorRows ?? []) as FamilyPersonRow[];
    }

    const ancestorById = new Map(
      ancestorNames.map((row) => [row.id, row] as const)
    );

    const nearestCommonAncestors = nearestRaw.map((row) => {
      const item =
        row && typeof row === "object"
          ? (row as Record<string, unknown>)
          : {};
      const ancestorId = cleanUuid(item.ancestorId);
      const person = ancestorId ? ancestorById.get(ancestorId) : undefined;

      return {
        ancestorId: ancestorId || null,
        fullName: person?.full_name ?? null,
        depthA:
          typeof item.depthA === "number"
            ? item.depthA
            : Number(item.depthA ?? 0),
        depthB:
          typeof item.depthB === "number"
            ? item.depthB
            : Number(item.depthB ?? 0),
      };
    });

    return noStore({
      success: true,
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
        shortName: event.short_name,
      },
      relationship: {
        ...result,
        nearestCommonAncestors,
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Relationship Finder failed.",
      },
      500
    );
  }
}
