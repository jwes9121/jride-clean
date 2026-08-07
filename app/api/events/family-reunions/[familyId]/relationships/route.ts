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

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

const PARENT_CHILD_TYPES = new Set(["biological", "adoptive", "step"]);
const SPOUSE_STATUSES = new Set([
  "married",
  "partner",
  "separated",
  "divorced",
  "widowed",
]);

export async function POST(
  req: NextRequest,
  { params }: { params: { familyId: string } }
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

    const familyId = cleanUuid(params.familyId);

    if (!familyId) {
      return noStore(
        {
          success: false,
          error: "Invalid family ID.",
        },
        400
      );
    }

    const body = await req.json().catch(() => ({}));
    const relationshipKind = cleanText(body.relationshipKind, 30);
    const personAId = cleanUuid(body.personAId);
    const personBId = cleanUuid(body.personBId);

    if (!personAId || !personBId) {
      return noStore(
        {
          success: false,
          error: "Two valid people are required.",
        },
        400
      );
    }

    if (personAId === personBId) {
      return noStore(
        {
          success: false,
          error: "A person cannot be related to themselves in this way.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id")
      .eq("id", familyId)
      .maybeSingle();

    if (familyError) throw new Error(familyError.message);

    if (!family?.id) {
      return noStore(
        {
          success: false,
          error: "Family reunion not found.",
        },
        404
      );
    }

    const { data: peopleRows, error: peopleError } = await supabase
      .from("family_people")
      .select("id,family_id,full_name")
      .in("id", [personAId, personBId]);

    if (peopleError) throw new Error(peopleError.message);

    const peopleById = new Map(
      (peopleRows ?? []).map((person) => [String(person.id), person] as const)
    );

    const personA = peopleById.get(personAId);
    const personB = peopleById.get(personBId);

    if (!personA || !personB) {
      return noStore(
        {
          success: false,
          error: "One or both people could not be found.",
        },
        404
      );
    }

    if (
      String(personA.family_id || "") !== familyId ||
      String(personB.family_id || "") !== familyId
    ) {
      return noStore(
        {
          success: false,
          error:
            "Both people must currently belong to this family project before editing relationships here.",
        },
        400
      );
    }

    if (relationshipKind === "parent_child") {
      const relationshipType =
        cleanText(body.relationshipType, 30) || "biological";

      if (!PARENT_CHILD_TYPES.has(relationshipType)) {
        return noStore(
          {
            success: false,
            error: "Invalid parent-child relationship type.",
          },
          400
        );
      }

      const { data: edge, error: edgeError } = await supabase
        .from("family_parent_child")
        .insert({
          parent_person_id: personAId,
          child_person_id: personBId,
          relationship_type: relationshipType,
        })
        .select(
          "id,parent_person_id,child_person_id,relationship_type,created_at"
        )
        .single();

      if (edgeError) {
        const message = edgeError.message || "";

        if (message.includes("FAMILY_PARENT_CHILD_CYCLE_DETECTED")) {
          return noStore(
            {
              success: false,
              error:
                "This parent-child relationship would create a cycle in the family tree.",
            },
            409
          );
        }

        if (message.toLowerCase().includes("duplicate")) {
          return noStore(
            {
              success: false,
              error: "That parent-child relationship already exists.",
            },
            409
          );
        }

        throw new Error(message);
      }

      return noStore(
        {
          success: true,
          relationshipKind,
          relationship: edge,
        },
        201
      );
    }

    if (relationshipKind === "spouse") {
      const status = cleanText(body.status, 30) || "married";

      if (!SPOUSE_STATUSES.has(status)) {
        return noStore(
          {
            success: false,
            error: "Invalid spouse relationship status.",
          },
          400
        );
      }

      const [personOneId, personTwoId] = [personAId, personBId].sort();

      const { data: spouse, error: spouseError } = await supabase
        .from("family_spouses")
        .insert({
          person_a_id: personOneId,
          person_b_id: personTwoId,
          status,
        })
        .select("id,person_a_id,person_b_id,status,created_at")
        .single();

      if (spouseError) {
        const message = spouseError.message || "";

        if (
          message.toLowerCase().includes("duplicate") ||
          message.toLowerCase().includes("unique")
        ) {
          return noStore(
            {
              success: false,
              error: "That spouse relationship already exists.",
            },
            409
          );
        }

        throw new Error(message);
      }

      return noStore(
        {
          success: true,
          relationshipKind,
          relationship: spouse,
        },
        201
      );
    }

    return noStore(
      {
        success: false,
        error: "Invalid relationship kind.",
      },
      400
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to add family relationship.",
      },
      500
    );
  }
}
