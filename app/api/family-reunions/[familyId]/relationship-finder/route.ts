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

type FamilyPersonRow = {
  id: string;
  family_id: string | null;
  full_name: string;
};

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

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id,name")
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

    const people = (peopleRows ?? []) as FamilyPersonRow[];
    const peopleById = new Map(people.map((person) => [person.id, person] as const));

    const personA = peopleById.get(personAId);
    const personB = peopleById.get(personBId);

    if (!personA || !personB) {
      return noStore(
        {
          success: false,
          error: "One or both family members could not be found.",
        },
        404
      );
    }

    // family_id is organizational metadata, not a hard graph partition.
    // For the first UI slice, the selectable people come from this family
    // detail page, so both selected people must belong to this project's
    // visible member list. Cross-family traversal remains supported by the
    // proven RPC and can be exposed later through a deliberate global mode.
    if (personA.family_id !== familyId || personB.family_id !== familyId) {
      return noStore(
        {
          success: false,
          error:
            "Both selected people must belong to this family reunion project.",
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

    const ancestorNameById = new Map<string, string>();

    if (ancestorIds.length > 0) {
      const { data: ancestorRows, error: ancestorError } = await supabase
        .from("family_people")
        .select("id,full_name")
        .in("id", ancestorIds);

      if (ancestorError) throw new Error(ancestorError.message);

      for (const row of ancestorRows ?? []) {
        ancestorNameById.set(String(row.id), String(row.full_name || ""));
      }
    }

    const nearestCommonAncestors = nearestRaw.map((row) => {
      const item =
        row && typeof row === "object"
          ? (row as Record<string, unknown>)
          : {};

      const ancestorId = cleanUuid(item.ancestorId);

      return {
        ancestorId: ancestorId || null,
        fullName: ancestorId ? ancestorNameById.get(ancestorId) ?? null : null,
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
      family: {
        id: family.id,
        name: family.name,
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
