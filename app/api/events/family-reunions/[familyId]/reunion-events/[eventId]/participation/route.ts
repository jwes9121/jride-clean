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

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    text
  )
    ? text
    : "";
}

async function verifyFamilyEvent(
  supabase: ReturnType<typeof supabaseAdmin>,
  familyId: string,
  eventId: string
) {
  const { data: link, error } = await supabase
    .from("family_reunion_events")
    .select("id,family_id,event_id")
    .eq("family_id", familyId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return Boolean(link?.id);
}

export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: { familyId: string; eventId: string };
  }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);

    if (!authorization.ok) {
      return noStore(
        { success: false, error: authorization.error },
        authorization.status
      );
    }

    const familyId = cleanUuid(params.familyId);
    const eventId = cleanUuid(params.eventId);

    if (!familyId || !eventId) {
      return noStore(
        { success: false, error: "Invalid family or event ID." },
        400
      );
    }

    const supabase = supabaseAdmin();

    if (!(await verifyFamilyEvent(supabase, familyId, eventId))) {
      return noStore(
        {
          success: false,
          error: "This event is not linked to this family project.",
        },
        404
      );
    }

    const [
      { data: familyPeople, error: peopleError },
      { data: attendeeRows, error: attendeeError },
      { data: reunionLinks, error: linksError },
    ] = await Promise.all([
      supabase
        .from("family_people")
        .select(
          "id,full_name,nickname,location_text,location_bucket"
        )
        .eq("family_id", familyId)
        .order("full_name", { ascending: true }),

      supabase
        .from("event_attendees")
        .select(
          "id,full_name,nickname,mobile_number,registration_number,registration_status,attendance_status,registered_at,checked_in_at,is_disqualified,merged_into"
        )
        .eq("event_id", eventId)
        .is("merged_into", null)
        .order("full_name", { ascending: true }),

      supabase
        .from("family_reunion_links")
        .select("id,family_person_id,event_id,attendee_id,created_at")
        .eq("event_id", eventId),
    ]);

    if (peopleError) throw new Error(peopleError.message);
    if (attendeeError) throw new Error(attendeeError.message);
    if (linksError) throw new Error(linksError.message);

    const attendeeById = new Map(
      (attendeeRows ?? []).map((attendee) => [String(attendee.id), attendee] as const)
    );

    const linkByPersonId = new Map(
      (reunionLinks ?? []).map((link) => [
        String(link.family_person_id),
        link,
      ] as const)
    );

    const usedAttendeeIds = new Set(
      (reunionLinks ?? [])
        .map((link) => String(link.attendee_id || ""))
        .filter(Boolean)
    );

    const people = (familyPeople ?? []).map((person) => {
      const link = linkByPersonId.get(String(person.id));
      const attendee = link?.attendee_id
        ? attendeeById.get(String(link.attendee_id))
        : null;

      return {
        familyPersonId: person.id,
        fullName: person.full_name,
        nickname: person.nickname,
        locationText: person.location_text,
        locationBucket: person.location_bucket,
        linkId: link?.id ?? null,
        attendee: attendee
          ? {
              attendeeId: attendee.id,
              fullName: attendee.full_name,
              nickname: attendee.nickname,
              mobileNumber: attendee.mobile_number,
              registrationNumber: attendee.registration_number,
              registrationStatus: attendee.registration_status,
              attendanceStatus: attendee.attendance_status,
              registeredAt: attendee.registered_at,
              checkedInAt: attendee.checked_in_at,
              isDisqualified: attendee.is_disqualified,
            }
          : null,
      };
    });

    const availableAttendees = (attendeeRows ?? [])
      .filter((attendee) => !usedAttendeeIds.has(String(attendee.id)))
      .map((attendee) => ({
        attendeeId: attendee.id,
        fullName: attendee.full_name,
        nickname: attendee.nickname,
        mobileNumber: attendee.mobile_number,
        registrationNumber: attendee.registration_number,
        registrationStatus: attendee.registration_status,
        attendanceStatus: attendee.attendance_status,
        registeredAt: attendee.registered_at,
        checkedInAt: attendee.checked_in_at,
        isDisqualified: attendee.is_disqualified,
      }));

    return noStore({
      success: true,
      familyId,
      eventId,
      people,
      availableAttendees,
      totals: {
        familyPeople: people.length,
        linkedPeople: people.filter((person) => person.attendee !== null).length,
        availableAttendees: availableAttendees.length,
      },
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load family participation.",
      },
      500
    );
  }
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: { familyId: string; eventId: string };
  }
) {
  try {
    const authorization = await requireStaff(["admin"]);

    if (!authorization.ok) {
      return noStore(
        { success: false, error: authorization.error },
        authorization.status
      );
    }

    const familyId = cleanUuid(params.familyId);
    const eventId = cleanUuid(params.eventId);

    if (!familyId || !eventId) {
      return noStore(
        { success: false, error: "Invalid family or event ID." },
        400
      );
    }

    const body = await req.json().catch(() => ({}));
    const familyPersonId = cleanUuid(body.familyPersonId);
    const attendeeId = cleanUuid(body.attendeeId);

    if (!familyPersonId || !attendeeId) {
      return noStore(
        {
          success: false,
          error: "A valid family member and attendee are required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    if (!(await verifyFamilyEvent(supabase, familyId, eventId))) {
      return noStore(
        {
          success: false,
          error: "This event is not linked to this family project.",
        },
        409
      );
    }

    const [
      { data: familyPerson, error: personError },
      { data: attendee, error: attendeeError },
    ] = await Promise.all([
      supabase
        .from("family_people")
        .select("id,family_id,full_name")
        .eq("id", familyPersonId)
        .maybeSingle(),

      supabase
        .from("event_attendees")
        .select("id,event_id,full_name,merged_into")
        .eq("id", attendeeId)
        .maybeSingle(),
    ]);

    if (personError) throw new Error(personError.message);
    if (attendeeError) throw new Error(attendeeError.message);

    if (!familyPerson?.id || String(familyPerson.family_id || "") !== familyId) {
      return noStore(
        {
          success: false,
          error: "The selected family member does not belong to this family project.",
        },
        400
      );
    }

    if (
      !attendee?.id ||
      String(attendee.event_id || "") !== eventId ||
      attendee.merged_into
    ) {
      return noStore(
        {
          success: false,
          error: "The selected attendee does not belong to this reunion event.",
        },
        400
      );
    }

    const { data: existingPersonLink, error: personLinkError } = await supabase
      .from("family_reunion_links")
      .select("id,attendee_id")
      .eq("family_person_id", familyPersonId)
      .eq("event_id", eventId)
      .maybeSingle();

    if (personLinkError) throw new Error(personLinkError.message);

    if (existingPersonLink?.id) {
      return noStore(
        {
          success: false,
          error: "This family member is already linked for this reunion event.",
        },
        409
      );
    }

    const { data: existingAttendeeLink, error: attendeeLinkError } = await supabase
      .from("family_reunion_links")
      .select("id,family_person_id")
      .eq("attendee_id", attendeeId)
      .maybeSingle();

    if (attendeeLinkError) throw new Error(attendeeLinkError.message);

    if (existingAttendeeLink?.id) {
      return noStore(
        {
          success: false,
          error: "This attendee is already linked to another family member.",
        },
        409
      );
    }

    const { data: link, error: insertError } = await supabase
      .from("family_reunion_links")
      .insert({
        family_person_id: familyPersonId,
        event_id: eventId,
        attendee_id: attendeeId,
      })
      .select("id,family_person_id,event_id,attendee_id,created_at")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return noStore(
          {
            success: false,
            error: "This family member or attendee is already linked.",
          },
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
          familyPersonId: link.family_person_id,
          eventId: link.event_id,
          attendeeId: link.attendee_id,
          createdAt: link.created_at,
        },
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to link family member to attendee.",
      },
      500
    );
  }
}
