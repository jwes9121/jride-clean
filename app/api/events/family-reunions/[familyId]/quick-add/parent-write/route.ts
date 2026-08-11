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

type WriteRow = {
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
    const body = await req.json().catch(() => ({}));
    const childPersonId = cleanUuid(body.childPersonId);
    const mode = cleanText(body.mode, 20).toLowerCase();
    const existingPersonId = body.existingPersonId
      ? cleanUuid(body.existingPersonId)
      : "";
    const fullName = cleanText(body.fullName, 200);
    const sex =
      cleanText(body.sex, 20).toLowerCase() || "unspecified";
    const locationText = cleanText(body.locationText, 200);
    const locationScope = cleanText(body.locationScope, 40);
    const locationBucket = cleanText(body.locationBucket, 120);

    if (!familyId || !childPersonId) {
      return noStore(
        {
          success: false,
          error: "Valid family and child IDs are required.",
        },
        400
      );
    }

    if (!["create_new", "use_existing"].includes(mode)) {
      return noStore(
        { success: false, error: "Quick Parent Entry mode is invalid." },
        400
      );
    }

    if (mode === "use_existing" && !existingPersonId) {
      return noStore(
        { success: false, error: "Choose an existing parent." },
        400
      );
    }

    if (mode === "create_new" && !fullName) {
      return noStore(
        { success: false, error: "Full name is required." },
        400
      );
    }

    if (!SEX_VALUES.has(sex)) {
      return noStore(
        { success: false, error: "Invalid sex value." },
        400
      );
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
          error: "A reporting bucket is required for the selected location classification.",
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

    const { data, error } = await supabase.rpc(
      "family_quick_parent_entry_write",
      {
        p_family_id: familyId,
        p_child_person_id: childPersonId,
        p_mode: mode,
        p_existing_person_id: existingPersonId || null,
        p_full_name: mode === "create_new" ? fullName : null,
        p_sex: mode === "create_new" ? sex : "unspecified",
        p_location_text:
          mode === "create_new" ? locationText || null : null,
        p_location_scope:
          mode === "create_new" ? locationScope || null : null,
        p_location_bucket:
          mode === "create_new" ? locationBucket || null : null,
      }
    );

    if (error) {
      if (
        error.message.includes("FAMILY_PARENT_CHILD_CYCLE_DETECTED")
      ) {
        return noStore(
          {
            success: false,
            resultCode: "CYCLE_WOULD_BE_CREATED",
            error:
              "Cannot add this parent because it would create an ancestry loop.",
          },
          409
        );
      }

      if (
        error.code === "23505" ||
        error.message.toLowerCase().includes("duplicate") ||
        error.message.toLowerCase().includes("unique")
      ) {
        return noStore(
          {
            success: false,
            resultCode: "ALREADY_LINKED",
            error: "This biological parent-child relationship already exists.",
          },
          409
        );
      }

      throw new Error(error.message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as WriteRow | null;

    if (!row) {
      return noStore(
        { success: false, error: "Quick Parent Entry returned no result." },
        500
      );
    }

    if (!row.success) {
      const status =
        row.result_code === "ADVANCED_EDITOR_REQUIRED" ||
        row.result_code === "CYCLE_WOULD_BE_CREATED"
          ? 409
          : 400;

      return noStore(
        {
          success: false,
          resultCode: row.result_code,
          personId: row.person_id,
          relationshipId: row.relationship_id,
          error: row.message,
        },
        status
      );
    }

    return noStore(
      {
        success: true,
        resultCode: row.result_code,
        personId: row.person_id,
        relationshipId: row.relationship_id,
        message: row.message,
      },
      row.result_code === "CREATED" ? 201 : 200
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Quick Parent Entry failed.",
      },
      500
    );
  }
}
