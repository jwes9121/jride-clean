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

type PersonRow = {
  id: string;
  family_id: string | null;
  full_name: string;
};

type ParentLinkRow = {
  parent_person_id: string;
};

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
    const query = String(req.nextUrl.searchParams.get("q") || "")
      .trim()
      .slice(0, 200);

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

    const { data: childData, error: childError } = await supabase
      .from("family_people")
      .select("id,family_id,full_name")
      .eq("id", childPersonId)
      .maybeSingle();

    if (childError) throw new Error(childError.message);

    const child = (childData || null) as PersonRow | null;

    if (!child) {
      return noStore(
        { success: false, error: "Selected family member was not found." },
        404
      );
    }

    if (child.family_id !== familyId) {
      return noStore(
        {
          success: false,
          error: "Selected family member does not belong to this family project.",
        },
        409
      );
    }

    const { data: parentLinksData, error: parentLinksError } =
      await supabase
        .from("family_parent_child")
        .select("parent_person_id")
        .eq("child_person_id", childPersonId)
        .eq("relationship_type", "biological");

    if (parentLinksError) throw new Error(parentLinksError.message);

    const parentLinks = (parentLinksData || []) as ParentLinkRow[];
    const parentIds = parentLinks.map((row) => row.parent_person_id);

    let existingParents: {
      id: string;
      fullName: string;
    }[] = [];

    if (parentIds.length > 0) {
      const { data: parentsData, error: parentsError } = await supabase
        .from("family_people")
        .select("id,full_name")
        .in("id", parentIds);

      if (parentsError) throw new Error(parentsError.message);

      existingParents = (parentsData || [])
        .map((parent) => ({
          id: parent.id,
          fullName: parent.full_name,
        }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "en"));
    }

    if (query.length < 2) {
      return noStore({
        success: true,
        child: {
          id: child.id,
          fullName: child.full_name,
          biologicalParentCount: existingParents.length,
          biologicalParents: existingParents,
        },
        currentFamilyMatches: [],
        otherFamilyMatches: [],
      });
    }

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

    const candidates = ((data || []) as CandidateRow[]).map(
      (candidate) => ({
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
        childBiologicalParentCount:
          candidate.child_biological_parent_count,
        childBiologicalParents:
          candidate.child_biological_parents || [],
        alreadyParentOfChild: candidate.already_parent_of_child,
        cycleWouldBeCreated: candidate.cycle_would_be_created,
        quickParentDecision: candidate.quick_parent_decision,
      })
    );

    return noStore({
      success: true,
      child: {
        id: child.id,
        fullName: child.full_name,
        biologicalParentCount: existingParents.length,
        biologicalParents: existingParents,
      },
      currentFamilyMatches: candidates.filter(
        (candidate) => candidate.matchScope === "CURRENT_FAMILY"
      ),
      otherFamilyMatches: candidates.filter(
        (candidate) => candidate.matchScope === "OTHER_FAMILY"
      ),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to search possible parent records.",
      },
      500
    );
  }
}
