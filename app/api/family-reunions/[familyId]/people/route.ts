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
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function cleanDate(value: unknown) {
  const text = String(value || "").trim();

  if (!text) return null;

  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

const SEX_VALUES = new Set(["male", "female", "unspecified"]);
const LOCATION_SCOPES = new Set([
  "ifugao_municipality",
  "philippines_province",
  "philippines_ncr",
  "overseas_country",
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

    const fullName = cleanText(body.fullName, 200);
    const nickname = cleanText(body.nickname, 100);
    const sex = cleanText(body.sex, 20) || "unspecified";
    const birthDate = cleanDate(body.birthDate);
    const deathDate = cleanDate(body.deathDate);
    const locationText = cleanText(body.locationText, 200);
    const locationScope = cleanText(body.locationScope, 40);
    const locationBucket = cleanText(body.locationBucket, 120);
    const notes = cleanText(body.notes, 2000);

    if (!fullName) {
      return noStore(
        {
          success: false,
          error: "Full name is required.",
        },
        400
      );
    }

    if (!SEX_VALUES.has(sex)) {
      return noStore(
        {
          success: false,
          error: "Invalid sex value.",
        },
        400
      );
    }

    if (birthDate === "" || deathDate === "") {
      return noStore(
        {
          success: false,
          error: "Birth and death dates must use YYYY-MM-DD.",
        },
        400
      );
    }

    if (locationScope && !LOCATION_SCOPES.has(locationScope)) {
      return noStore(
        {
          success: false,
          error: "Invalid location classification.",
        },
        400
      );
    }

    if (locationScope && !locationBucket) {
      return noStore(
        {
          success: false,
          error: "A reporting bucket is required when location classification is set.",
        },
        400
      );
    }

    if (!locationScope && locationBucket) {
      return noStore(
        {
          success: false,
          error: "Choose a location classification before setting a reporting bucket.",
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

    const { data: person, error: insertError } = await supabase
      .from("family_people")
      .insert({
        family_id: familyId,
        full_name: fullName,
        nickname: nickname || null,
        sex,
        birth_date: birthDate,
        death_date: deathDate,
        is_living: deathDate ? false : true,
        location_text: locationText || null,
        location_scope: locationScope || null,
        location_bucket: locationBucket || null,
        notes: notes || null,
      })
      .select(
        "id,family_id,full_name,nickname,sex,birth_date,death_date,is_living,location_text,location_scope,location_bucket"
      )
      .single();

    if (insertError) throw new Error(insertError.message);

    return noStore(
      {
        success: true,
        person: {
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
        },
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to add family member.",
      },
      500
    );
  }
}
