import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const SPOUSE_STATUSES = new Set([
  "married",
  "partner",
  "separated",
  "divorced",
  "widowed",
]);

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

function cleanStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

type PersonRow = {
  id: string;
  family_id: string;
  full_name: string;
  location_text: string | null;
  location_bucket: string | null;
};

type SpouseRow = {
  id: string;
  person_a_id: string;
  person_b_id: string;
  status: string;
  created_at: string;
};

async function loadPerson(
  supabase: ReturnType<typeof supabaseAdmin>,
  personId: string
) {
  const { data, error } = await supabase
    .from("family_people")
    .select("id,family_id,full_name,location_text,location_bucket")
    .eq("id", personId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return (data || null) as PersonRow | null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
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
    const personId = cleanUuid(req.nextUrl.searchParams.get("personId"));

    if (!familyId || !personId) {
      return noStore(
        { success: false, error: "Valid family and person IDs are required." },
        400
      );
    }

    const supabase = supabaseAdmin();
    const person = await loadPerson(supabase, personId);

    if (!person) {
      return noStore({ success: false, error: "Person not found." }, 404);
    }

    if (person.family_id !== familyId) {
      return noStore(
        {
          success: false,
          error: "The selected person is not assigned to this family project.",
        },
        409
      );
    }

    const { data: spouseRows, error: spouseError } = await supabase
      .from("family_spouses")
      .select("id,person_a_id,person_b_id,status,created_at")
      .or(`person_a_id.eq.${personId},person_b_id.eq.${personId}`)
      .order("created_at", { ascending: true });

    if (spouseError) throw new Error(spouseError.message);

    const rows = (spouseRows || []) as SpouseRow[];
    const otherIds = Array.from(
      new Set(
        rows.map((row) =>
          row.person_a_id === personId ? row.person_b_id : row.person_a_id
        )
      )
    );

    let spousePeople: PersonRow[] = [];

    if (otherIds.length > 0) {
      const { data, error } = await supabase
        .from("family_people")
        .select("id,family_id,full_name,location_text,location_bucket")
        .in("id", otherIds);

      if (error) throw new Error(error.message);
      spousePeople = (data || []) as PersonRow[];
    }

    const peopleById = new Map(
      spousePeople.map((row) => [row.id, row] as const)
    );

    return noStore({
      success: true,
      person: {
        id: person.id,
        fullName: person.full_name,
      },
      spouses: rows
        .map((row) => {
          const spousePersonId =
            row.person_a_id === personId
              ? row.person_b_id
              : row.person_a_id;
          const spousePerson = peopleById.get(spousePersonId);

          return {
            relationshipId: row.id,
            spousePersonId,
            fullName: spousePerson?.full_name || "Recorded spouse",
            familyId: spousePerson?.family_id || null,
            locationText: spousePerson?.location_text || null,
            locationBucket: spousePerson?.location_bucket || null,
            status: row.status,
            createdAt: row.created_at,
          };
        })
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "en")),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load spouse relationships.",
      },
      500
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { familyId: string } }
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
    const body = await req.json().catch(() => ({}));
    const relationshipId = cleanUuid(body.relationshipId);
    const status = cleanStatus(body.status);

    if (!familyId || !relationshipId) {
      return noStore(
        { success: false, error: "Valid family and relationship IDs are required." },
        400
      );
    }

    if (!SPOUSE_STATUSES.has(status)) {
      return noStore(
        { success: false, error: "Invalid spouse relationship status." },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: relationship, error: relationshipError } = await supabase
      .from("family_spouses")
      .select("id,person_a_id,person_b_id,status")
      .eq("id", relationshipId)
      .maybeSingle();

    if (relationshipError) throw new Error(relationshipError.message);

    if (!relationship?.id) {
      return noStore(
        { success: false, error: "Spouse relationship not found." },
        404
      );
    }

    const { data: relatedPeople, error: peopleError } = await supabase
      .from("family_people")
      .select("id,family_id")
      .in("id", [relationship.person_a_id, relationship.person_b_id]);

    if (peopleError) throw new Error(peopleError.message);

    const belongsToFamily = (relatedPeople || []).some(
      (person) => person.family_id === familyId
    );

    if (!belongsToFamily) {
      return noStore(
        {
          success: false,
          error: "This spouse relationship does not belong to this family project.",
        },
        403
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("family_spouses")
      .update({ status })
      .eq("id", relationshipId)
      .select("id,person_a_id,person_b_id,status")
      .single();

    if (updateError) throw new Error(updateError.message);

    return noStore({
      success: true,
      relationship: {
        relationshipId: updated.id,
        personAId: updated.person_a_id,
        personBId: updated.person_b_id,
        status: updated.status,
      },
      message: "Spouse relationship status updated.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to update spouse relationship.",
      },
      500
    );
  }
}
