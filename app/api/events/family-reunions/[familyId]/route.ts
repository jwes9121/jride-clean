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

export async function GET(
  _req: NextRequest,
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

    const supabase = supabaseAdmin();

    const { data: family, error: familyError } = await supabase
      .from("families")
      .select("id,name,description,created_at,updated_at")
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
      .select(
        "id,family_id,full_name,nickname,sex,birth_date,death_date,is_living,location_text,location_scope,location_bucket"
      )
      .eq("family_id", familyId)
      .order("full_name", { ascending: true });

    if (peopleError) throw new Error(peopleError.message);

    return noStore({
      success: true,
      family: {
        id: family.id,
        name: family.name,
        description: family.description,
        createdAt: family.created_at,
        updatedAt: family.updated_at,
      },
      people: (peopleRows ?? []).map((person) => ({
        id: person.id,
        familyId: person.family_id,
        fullName: person.full_name,
        nickname: person.nickname,
        sex: person.sex,
        birthDate: person.birth_date,
        deathDate: person.death_date,
        isLiving: person.is_living,
        locationText: person.location_text,
        locationScope: person.location_scope,
        locationBucket: person.location_bucket,
      })),
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load family reunion.",
      },
      500
    );
  }
}
