import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RELATIONSHIP_TYPES = new Set(["biological", "adoptive", "step"]);

type ParentEdgeRow = {
  id: string;
  parent_person_id: string;
  child_person_id: string;
  relationship_type: string;
  created_at: string;
};

type PersonRow = {
  id: string;
  family_id: string | null;
  full_name: string;
  nickname: string | null;
  location_text: string | null;
  location_bucket: string | null;
};

type CandidateRow = {
  candidate_id: string;
  full_name: string;
  nickname: string | null;
  location_text: string | null;
  location_bucket: string | null;
  match_scope: "CURRENT_FAMILY" | "OTHER_FAMILY";
  organizational_family_id: string | null;
  organizational_family_name: string | null;
  similarity_score: number;
  child_biological_parent_count: number;
  child_biological_parents: {
    id: string;
    fullName: string;
  }[];
  already_parent_of_child: boolean;
  cycle_would_be_created: boolean;
  quick_parent_decision:
    | "SAFE_TO_LINK"
    | "ALREADY_LINKED"
    | "ADVANCED_EDITOR_REQUIRED"
    | "CYCLE_WOULD_BE_CREATED";
};

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

function mapWriteError(error: { code?: string | null; message?: string | null }) {
  const message = String(error.message || "");
  const lower = message.toLowerCase();

  if (message.includes("FAMILY_PARENT_CHILD_CYCLE_DETECTED")) {
    return {
      status: 409,
      resultCode: "CYCLE_WOULD_BE_CREATED",
      error:
        "This replacement would create an ancestry cycle. No relationship was changed.",
    };
  }

  if (message.includes("FAMILY_BIOLOGICAL_PARENT_LIMIT_EXCEEDED")) {
    return {
      status: 409,
      resultCode: "BIOLOGICAL_PARENT_LIMIT",
      error:
        "This person already has two biological parents. No relationship was changed.",
    };
  }

  if (
    error.code === "23505" ||
    lower.includes("duplicate") ||
    lower.includes("unique")
  ) {
    return {
      status: 409,
      resultCode: "DUPLICATE_PARENT_EDGE",
      error:
        "That parent-child relationship already exists. No relationship was changed.",
    };
  }

  if (
    error.code === "23514" &&
    (lower.includes("not_self") || lower.includes("check constraint"))
  ) {
    return {
      status: 409,
      resultCode: "INVALID_PARENT",
      error: "A person cannot be recorded as their own parent.",
    };
  }

  return null;
}

async function loadChild(
  supabase: ReturnType<typeof supabaseAdmin>,
  familyId: string,
  childPersonId: string
) {
  const { data, error } = await supabase
    .from("family_people")
    .select(
      "id,family_id,full_name,nickname,location_text,location_bucket"
    )
    .eq("id", childPersonId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const child = (data || null) as PersonRow | null;

  if (!child) {
    return {
      ok: false as const,
      response: noStore(
        { success: false, error: "Selected family member was not found." },
        404
      ),
    };
  }

  if (child.family_id !== familyId) {
    return {
      ok: false as const,
      response: noStore(
        {
          success: false,
          error:
            "The selected person is not filed under this genealogy project.",
        },
        409
      ),
    };
  }

  return {
    ok: true as const,
    child,
  };
}

async function loadEdge(
  supabase: ReturnType<typeof supabaseAdmin>,
  relationshipId: string
) {
  const { data, error } = await supabase
    .from("family_parent_child")
    .select(
      "id,parent_person_id,child_person_id,relationship_type,created_at"
    )
    .eq("id", relationshipId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return (data || null) as ParentEdgeRow | null;
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
    const childPersonId = cleanUuid(
      req.nextUrl.searchParams.get("childPersonId")
    );
    const query = cleanText(req.nextUrl.searchParams.get("q"), 200);

    if (!familyId || !childPersonId) {
      return noStore(
        {
          success: false,
          error: "Valid family and child IDs are required.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();
    const childResult = await loadChild(supabase, familyId, childPersonId);

    if (!childResult.ok) {
      return childResult.response;
    }

    const { child } = childResult;

    const { data: edgeData, error: edgeError } = await supabase
      .from("family_parent_child")
      .select(
        "id,parent_person_id,child_person_id,relationship_type,created_at"
      )
      .eq("child_person_id", childPersonId)
      .order("created_at", { ascending: true });

    if (edgeError) throw new Error(edgeError.message);

    const edges = (edgeData || []) as ParentEdgeRow[];
    const parentIds = Array.from(
      new Set(edges.map((edge) => edge.parent_person_id))
    );

    let parents: PersonRow[] = [];

    if (parentIds.length > 0) {
      const { data, error } = await supabase
        .from("family_people")
        .select(
          "id,family_id,full_name,nickname,location_text,location_bucket"
        )
        .in("id", parentIds);

      if (error) throw new Error(error.message);
      parents = (data || []) as PersonRow[];
    }

    const parentFamilyIds = Array.from(
      new Set(
        parents
          .map((parent) => parent.family_id)
          .filter((value): value is string => Boolean(value))
      )
    );

    const familyNameById = new Map<string, string>();

    if (parentFamilyIds.length > 0) {
      const { data, error } = await supabase
        .from("families")
        .select("id,name")
        .in("id", parentFamilyIds);

      if (error) throw new Error(error.message);

      for (const row of data || []) {
        familyNameById.set(String(row.id), String(row.name || ""));
      }
    }

    const parentById = new Map(
      parents.map((parent) => [parent.id, parent] as const)
    );

    const relationships = edges
      .map((edge) => {
        const parent = parentById.get(edge.parent_person_id);

        return {
          relationshipId: edge.id,
          parentPersonId: edge.parent_person_id,
          parentName: parent?.full_name || "Recorded parent",
          parentNickname: parent?.nickname || null,
          parentFamilyId: parent?.family_id || null,
          parentFamilyName: parent?.family_id
            ? familyNameById.get(parent.family_id) || null
            : null,
          locationText: parent?.location_text || null,
          locationBucket: parent?.location_bucket || null,
          relationshipType: edge.relationship_type,
          createdAt: edge.created_at,
        };
      })
      .sort((left, right) => {
        const typeOrder: Record<string, number> = {
          biological: 0,
          adoptive: 1,
          step: 2,
        };

        const typeDifference =
          (typeOrder[left.relationshipType] ?? 9) -
          (typeOrder[right.relationshipType] ?? 9);

        if (typeDifference !== 0) return typeDifference;
        return left.parentName.localeCompare(right.parentName, "en");
      });

    let candidates: {
      candidateId: string;
      fullName: string;
      nickname: string | null;
      locationText: string | null;
      locationBucket: string | null;
      matchScope: "CURRENT_FAMILY" | "OTHER_FAMILY";
      organizationalFamily: {
        id: string;
        name: string | null;
      } | null;
      similarityScore: number;
      existingParentOfChild: boolean;
      cycleWouldBeCreated: boolean;
      quickParentDecision: CandidateRow["quick_parent_decision"];
      replacementAllowed: boolean;
      replacementBlockReason: string | null;
    }[] = [];

    if (query.length >= 2) {
      const { data, error } = await supabase.rpc(
        "family_quick_add_parent_candidates",
        {
          p_family_id: familyId,
          p_name: query,
          p_child_person_id: childPersonId,
          p_limit: 12,
        }
      );

      if (error) throw new Error(error.message);

      const existingParentIds = new Set(parentIds);

      candidates = ((data || []) as CandidateRow[])
        .map((candidate) => {
          const isChild = candidate.candidate_id === childPersonId;
          const existingParent = existingParentIds.has(
            candidate.candidate_id
          );
          const cycle = Boolean(candidate.cycle_would_be_created);

          let replacementBlockReason: string | null = null;

          if (isChild) {
            replacementBlockReason =
              "A person cannot be recorded as their own parent.";
          } else if (existingParent) {
            replacementBlockReason =
              "This person is already recorded as a parent of the selected person.";
          } else if (cycle) {
            replacementBlockReason =
              "This replacement would create an ancestry cycle.";
          }

          return {
            candidateId: candidate.candidate_id,
            fullName: candidate.full_name,
            nickname: candidate.nickname,
            locationText: candidate.location_text,
            locationBucket: candidate.location_bucket,
            matchScope: candidate.match_scope,
            organizationalFamily: candidate.organizational_family_id
              ? {
                  id: candidate.organizational_family_id,
                  name: candidate.organizational_family_name,
                }
              : null,
            similarityScore: candidate.similarity_score,
            existingParentOfChild: existingParent,
            cycleWouldBeCreated: cycle,
            quickParentDecision: candidate.quick_parent_decision,
            replacementAllowed: !replacementBlockReason,
            replacementBlockReason,
          };
        })
        .sort(
          (left, right) =>
            right.similarityScore - left.similarityScore
        );
    }

    return noStore({
      success: true,
      child: {
        id: child.id,
        fullName: child.full_name,
        familyId: child.family_id,
      },
      biologicalParentCount: relationships.filter(
        (relationship) =>
          relationship.relationshipType === "biological"
      ).length,
      relationships,
      candidates,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load parent relationships.",
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
    const childPersonId = cleanUuid(body.childPersonId);
    const relationshipId = cleanUuid(body.relationshipId);
    const expectedParentPersonId = cleanUuid(
      body.expectedParentPersonId
    );
    const operation = cleanText(body.operation, 40).toLowerCase();

    if (
      !familyId ||
      !childPersonId ||
      !relationshipId ||
      !expectedParentPersonId
    ) {
      return noStore(
        {
          success: false,
          error:
            "Valid family, child, relationship, and expected parent IDs are required.",
        },
        400
      );
    }

    if (!["replace_parent", "change_type"].includes(operation)) {
      return noStore(
        { success: false, error: "Invalid correction operation." },
        400
      );
    }

    const supabase = supabaseAdmin();
    const childResult = await loadChild(supabase, familyId, childPersonId);

    if (!childResult.ok) {
      return childResult.response;
    }

    const edge = await loadEdge(supabase, relationshipId);

    if (!edge) {
      return noStore(
        {
          success: false,
          resultCode: "RELATIONSHIP_NOT_FOUND",
          error: "The parent relationship no longer exists.",
        },
        404
      );
    }

    if (
      edge.child_person_id !== childPersonId ||
      edge.parent_person_id !== expectedParentPersonId
    ) {
      return noStore(
        {
          success: false,
          resultCode: "STALE_RELATIONSHIP",
          error:
            "This parent relationship changed after the page was loaded. Refresh before correcting it.",
        },
        409
      );
    }

    if (operation === "replace_parent") {
      const replacementParentPersonId = cleanUuid(
        body.replacementParentPersonId
      );

      if (!replacementParentPersonId) {
        return noStore(
          {
            success: false,
            error: "Choose a valid replacement parent.",
          },
          400
        );
      }

      if (replacementParentPersonId === childPersonId) {
        return noStore(
          {
            success: false,
            resultCode: "INVALID_PARENT",
            error: "A person cannot be recorded as their own parent.",
          },
          409
        );
      }

      if (replacementParentPersonId === edge.parent_person_id) {
        return noStore(
          {
            success: true,
            resultCode: "NO_CHANGE",
            relationship: {
              relationshipId: edge.id,
              parentPersonId: edge.parent_person_id,
              childPersonId: edge.child_person_id,
              relationshipType: edge.relationship_type,
            },
            message: "The selected replacement is already the recorded parent.",
          },
          200
        );
      }

      const { data: replacementPerson, error: replacementError } =
        await supabase
          .from("family_people")
          .select("id,full_name")
          .eq("id", replacementParentPersonId)
          .maybeSingle();

      if (replacementError) {
        throw new Error(replacementError.message);
      }

      if (!replacementPerson?.id) {
        return noStore(
          {
            success: false,
            resultCode: "REPLACEMENT_PERSON_NOT_FOUND",
            error: "The selected replacement parent no longer exists.",
          },
          404
        );
      }

      const { data: updated, error: updateError } = await supabase
        .from("family_parent_child")
        .update({
          parent_person_id: replacementParentPersonId,
        })
        .eq("id", relationshipId)
        .eq("child_person_id", childPersonId)
        .eq("parent_person_id", expectedParentPersonId)
        .select(
          "id,parent_person_id,child_person_id,relationship_type,created_at"
        )
        .maybeSingle();

      if (updateError) {
        const mapped = mapWriteError(updateError);

        if (mapped) {
          return noStore(
            {
              success: false,
              resultCode: mapped.resultCode,
              error: mapped.error,
            },
            mapped.status
          );
        }

        throw new Error(updateError.message);
      }

      if (!updated?.id) {
        return noStore(
          {
            success: false,
            resultCode: "STALE_RELATIONSHIP",
            error:
              "This parent relationship changed before the correction was saved. Refresh and try again.",
          },
          409
        );
      }

      return noStore({
        success: true,
        resultCode: "PARENT_REPLACED",
        relationship: {
          relationshipId: updated.id,
          parentPersonId: updated.parent_person_id,
          childPersonId: updated.child_person_id,
          relationshipType: updated.relationship_type,
        },
        message: `Parent replaced with ${replacementPerson.full_name}.`,
      });
    }

    const relationshipType = cleanText(
      body.relationshipType,
      30
    ).toLowerCase();

    if (!RELATIONSHIP_TYPES.has(relationshipType)) {
      return noStore(
        {
          success: false,
          error: "Invalid parent relationship type.",
        },
        400
      );
    }

    if (relationshipType === edge.relationship_type) {
      return noStore({
        success: true,
        resultCode: "NO_CHANGE",
        relationship: {
          relationshipId: edge.id,
          parentPersonId: edge.parent_person_id,
          childPersonId: edge.child_person_id,
          relationshipType: edge.relationship_type,
        },
        message: "The relationship type is already set to that value.",
      });
    }

    if (
      relationshipType === "biological" &&
      edge.relationship_type !== "biological"
    ) {
      const { count, error: countError } = await supabase
        .from("family_parent_child")
        .select("id", { count: "exact", head: true })
        .eq("child_person_id", childPersonId)
        .eq("relationship_type", "biological")
        .neq("id", relationshipId);

      if (countError) throw new Error(countError.message);

      if ((count || 0) >= 2) {
        return noStore(
          {
            success: false,
            resultCode: "BIOLOGICAL_PARENT_LIMIT",
            error:
              "This person already has two biological parents. Change or remove one of those relationships first.",
          },
          409
        );
      }
    }

    const { data: updated, error: updateError } = await supabase
      .from("family_parent_child")
      .update({
        relationship_type: relationshipType,
      })
      .eq("id", relationshipId)
      .eq("child_person_id", childPersonId)
      .eq("parent_person_id", expectedParentPersonId)
      .select(
        "id,parent_person_id,child_person_id,relationship_type,created_at"
      )
      .maybeSingle();

    if (updateError) {
      const mapped = mapWriteError(updateError);

      if (mapped) {
        return noStore(
          {
            success: false,
            resultCode: mapped.resultCode,
            error: mapped.error,
          },
          mapped.status
        );
      }

      throw new Error(updateError.message);
    }

    if (!updated?.id) {
      return noStore(
        {
          success: false,
          resultCode: "STALE_RELATIONSHIP",
          error:
            "This parent relationship changed before the correction was saved. Refresh and try again.",
        },
        409
      );
    }

    return noStore({
      success: true,
      resultCode: "RELATIONSHIP_TYPE_CHANGED",
      relationship: {
        relationshipId: updated.id,
        parentPersonId: updated.parent_person_id,
        childPersonId: updated.child_person_id,
        relationshipType: updated.relationship_type,
      },
      message: `Parent relationship changed to ${relationshipType}.`,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to correct parent relationship.",
      },
      500
    );
  }
}

export async function DELETE(
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
    const childPersonId = cleanUuid(body.childPersonId);
    const relationshipId = cleanUuid(body.relationshipId);
    const expectedParentPersonId = cleanUuid(
      body.expectedParentPersonId
    );
    const confirmRemove = body.confirmRemove === true;

    if (
      !familyId ||
      !childPersonId ||
      !relationshipId ||
      !expectedParentPersonId
    ) {
      return noStore(
        {
          success: false,
          error:
            "Valid family, child, relationship, and expected parent IDs are required.",
        },
        400
      );
    }

    if (!confirmRemove) {
      return noStore(
        {
          success: false,
          resultCode: "CONFIRMATION_REQUIRED",
          error:
            "Explicit confirmation is required before removing a parent relationship.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();
    const childResult = await loadChild(supabase, familyId, childPersonId);

    if (!childResult.ok) {
      return childResult.response;
    }

    const edge = await loadEdge(supabase, relationshipId);

    if (!edge) {
      return noStore(
        {
          success: false,
          resultCode: "RELATIONSHIP_NOT_FOUND",
          error: "The parent relationship no longer exists.",
        },
        404
      );
    }

    if (
      edge.child_person_id !== childPersonId ||
      edge.parent_person_id !== expectedParentPersonId
    ) {
      return noStore(
        {
          success: false,
          resultCode: "STALE_RELATIONSHIP",
          error:
            "This parent relationship changed after the page was loaded. Refresh before removing it.",
        },
        409
      );
    }

    const { data: deleted, error: deleteError } = await supabase
      .from("family_parent_child")
      .delete()
      .eq("id", relationshipId)
      .eq("child_person_id", childPersonId)
      .eq("parent_person_id", expectedParentPersonId)
      .select("id")
      .maybeSingle();

    if (deleteError) throw new Error(deleteError.message);

    if (!deleted?.id) {
      return noStore(
        {
          success: false,
          resultCode: "STALE_RELATIONSHIP",
          error:
            "This parent relationship changed before it could be removed. Refresh and try again.",
        },
        409
      );
    }

    return noStore({
      success: true,
      resultCode: "RELATIONSHIP_REMOVED",
      relationshipId,
      message:
        "Parent relationship removed. Generation and tree placement will be recalculated from the remaining genealogy graph.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to remove parent relationship.",
      },
      500
    );
  }
}
