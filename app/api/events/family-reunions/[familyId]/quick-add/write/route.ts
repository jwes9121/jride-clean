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

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

const SEX_VALUES = new Set(["male", "female", "unspecified"]);
const LOCATION_SCOPES = new Set([
  "ifugao_municipality",
  "philippines_province",
  "philippines_ncr",
  "overseas_country",
]);

type RpcRow = {
  success: boolean;
  result_code: string;
  person_id: string | null;
  relationship_id: string | null;
  message: string;
};

export async function POST(
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

    if (!familyId) {
      return noStore({ success: false, error: "Invalid family ID." }, 400);
    }

    const body = await req.json().catch(() => ({}));

    const anchorPersonId = cleanUuid(body.anchorPersonId);
    const relationshipKind = cleanText(body.relationshipKind, 20);
    const mode = cleanText(body.mode, 20);
    const existingPersonId = body.existingPersonId
      ? cleanUuid(body.existingPersonId)
      : "";

    const fullName = cleanText(body.fullName, 200);
    const sex = cleanText(body.sex, 20) || "unspecified";
    const locationText = cleanText(body.locationText, 200);
    const locationScope = cleanText(body.locationScope, 40);
    const locationBucket = cleanText(body.locationBucket, 120);

    if (!anchorPersonId) {
      return noStore(
        { success: false, error: "Choose the family member to add to." },
        400
      );
    }

    if (!["child", "spouse"].includes(relationshipKind)) {
      return noStore(
        { success: false, error: "Relationship must be child or spouse." },
        400
      );
    }

    if (!["create_new", "use_existing"].includes(mode)) {
      return noStore(
        { success: false, error: "Quick Entry mode is invalid." },
        400
      );
    }

    if (mode === "use_existing" && !existingPersonId) {
      return noStore(
        { success: false, error: "Choose an existing person." },
        400
      );
    }

    if (mode === "create_new") {
      if (!fullName) {
        return noStore({ success: false, error: "Full name is required." }, 400);
      }

      if (!SEX_VALUES.has(sex)) {
        return noStore({ success: false, error: "Invalid sex value." }, 400);
      }

      if (locationScope && !LOCATION_SCOPES.has(locationScope)) {
        return noStore(
          { success: false, error: "Invalid location classification." },
          400
        );
      }

      if (locationScope && !locationBucket) {
        return noStore(
          {
            success: false,
            error:
              "A reporting bucket is required when location classification is set.",
          },
          400
        );
      }

      if (!locationScope && locationBucket) {
        return noStore(
          {
            success: false,
            error:
              "Choose a location classification before setting a reporting bucket.",
          },
          400
        );
      }
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc("family_quick_entry_write", {
      p_family_id: familyId,
      p_anchor_person_id: anchorPersonId,
      p_relationship_kind: relationshipKind,
      p_mode: mode,
      p_existing_person_id: existingPersonId || null,
      p_full_name: fullName || null,
      p_sex: sex,
      p_location_text: locationText || null,
      p_location_scope: locationScope || null,
      p_location_bucket: locationBucket || null,
    });

    if (error) {
      const message = error.message || "";

      if (message.includes("FAMILY_PARENT_CHILD_CYCLE_DETECTED")) {
        return noStore(
          {
            success: false,
            resultCode: "CYCLE_WOULD_BE_CREATED",
            error:
              "Cannot add this relationship because it would create an ancestry loop.",
          },
          409
        );
      }

      if (
        error.code === "23505" ||
        message.toLowerCase().includes("duplicate") ||
        message.toLowerCase().includes("unique")
      ) {
        return noStore(
          {
            success: false,
            resultCode: "ALREADY_LINKED",
            error: "That relationship already exists.",
          },
          409
        );
      }

      throw new Error(message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;

    if (!row) {
      return noStore(
        { success: false, error: "Quick Entry returned no result." },
        500
      );
    }

    const statusByCode: Record<string, number> = {
      FAMILY_NOT_FOUND: 404,
      ANCHOR_NOT_FOUND: 404,
      PERSON_NOT_FOUND: 404,
      ANCHOR_OUTSIDE_FAMILY: 409,
      SELF_RELATIONSHIP: 409,
      CYCLE_WOULD_BE_CREATED: 409,
      ADVANCED_EDITOR_REQUIRED: 409,
      INVALID_RELATIONSHIP_KIND: 400,
      INVALID_MODE: 400,
      PERSON_REQUIRED: 400,
      NAME_REQUIRED: 400,
      INVALID_SEX: 400,
      INVALID_LOCATION_SCOPE: 400,
      LOCATION_BUCKET_REQUIRED: 400,
      LOCATION_SCOPE_REQUIRED: 400,
    };

    if (!row.success) {
      return noStore(
        {
          success: false,
          resultCode: row.result_code,
          error: row.message,
        },
        statusByCode[row.result_code] || 400
      );
    }

    return noStore(
      {
        success: true,
        resultCode: row.result_code,
        message: row.message,
        personId: row.person_id,
        relationshipId: row.relationship_id,
      },
      row.result_code === "CREATED" ? 201 : 200
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Quick Entry failed.",
      },
      500
    );
  }
}
