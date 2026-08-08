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

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { familyId: string } }
) {
  try {
    const authorization = await requireStaff(["admin", "dispatcher"]);
    if (!authorization.ok) {
      return noStore({ success: false, error: authorization.error }, authorization.status);
    }

    const familyId = cleanUuid(params.familyId);
    const query = cleanText(req.nextUrl.searchParams.get("q"), 200);
    const rawParent = req.nextUrl.searchParams.get("proposedParentId");
    const proposedParentId = rawParent ? cleanUuid(rawParent) : "";

    if (!familyId) {
      return noStore({ success: false, error: "Invalid family ID." }, 400);
    }

    if (query.length < 2) {
      return noStore(
        { success: false, error: "Enter at least 2 characters to search." },
        400
      );
    }

    if (rawParent && !proposedParentId) {
      return noStore({ success: false, error: "Invalid proposed parent ID." }, 400);
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

    if (proposedParentId) {
      const { data: parent, error: parentError } = await supabase
        .from("family_people")
        .select("id")
        .eq("id", proposedParentId)
        .maybeSingle();

      if (parentError) throw new Error(parentError.message);
      if (!parent?.id) {
        return noStore({ success: false, error: "Proposed parent not found." }, 404);
      }
    }

    const { data, error } = await supabase.rpc("family_quick_add_candidates", {
      p_family_id: familyId,
      p_name: query,
      p_proposed_parent_id: proposedParentId || null,
      p_limit: 12,
    });

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as any[];

    const mapCandidate = (row: any) => ({
      candidateId: row.candidate_id,
      fullName: row.full_name,
      nickname: row.nickname,
      locationText: row.location_text,
      locationBucket: row.location_bucket,
      matchScope: row.match_scope,
      organizationalFamily: row.organizational_family_id
        ? {
            id: row.organizational_family_id,
            name: row.organizational_family_name,
          }
        : null,
      similarityScore: row.similarity_score,
      biologicalParentCount: row.biological_parent_count,
      biologicalParents: row.biological_parents ?? [],
      proposedParentAlreadyLinked: row.proposed_parent_already_linked,
      cycleWouldBeCreated: row.cycle_would_be_created,
      quickAddDecision: row.quick_add_decision,
    });

    return noStore({
      success: true,
      query,
      family: { id: family.id, name: family.name },
      proposedParentId: proposedParentId || null,
      currentFamilyMatches: rows
        .filter((row) => row.match_scope === "CURRENT_FAMILY")
        .map(mapCandidate),
      otherFamilyMatches: rows
        .filter((row) => row.match_scope === "OTHER_FAMILY")
        .map(mapCandidate),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Failed to search family candidates.",
      },
      500
    );
  }
}
