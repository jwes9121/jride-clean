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
const MODE_VALUES = new Set(["create_new", "use_existing"]);
const PARENT_RELATIONSHIP_STATUSES = new Set([
  "married",
  "partner",
  "separated",
  "divorced",
  "widowed",
]);

type ParentInput = {
  clientSlot?: unknown;
  mode?: unknown;
  existingPersonId?: unknown;
  fullName?: unknown;
  sex?: unknown;
  locationText?: unknown;
  locationScope?: unknown;
  locationBucket?: unknown;
};

type RpcRow = {
  success: boolean;
  result_code: string;
  processed_count: number;
  parent_results: {
    clientSlot: string | null;
    mode: "create_new" | "use_existing";
    personId: string;
    relationshipId: string;
    resultCode: string;
    message: string;
  }[];
  spouse_relationship_id: string | null;
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
    const rawParents = Array.isArray(body.parents)
      ? (body.parents as ParentInput[])
      : [];
    const relationshipStatusRaw = cleanText(
      body.parentRelationshipStatus,
      20
    ).toLowerCase();
    const parentRelationshipStatus =
      relationshipStatusRaw &&
      relationshipStatusRaw !== "not_recorded"
        ? relationshipStatusRaw
        : "";

    if (!familyId || !childPersonId) {
      return noStore(
        {
          success: false,
          error: "Valid family and child IDs are required.",
        },
        400
      );
    }

    if (rawParents.length < 1 || rawParents.length > 2) {
      return noStore(
        {
          success: false,
          error: "Parent Pair Entry requires one or two remaining parent slots.",
        },
        400
      );
    }

    if (
      parentRelationshipStatus &&
      !PARENT_RELATIONSHIP_STATUSES.has(parentRelationshipStatus)
    ) {
      return noStore(
        {
          success: false,
          error: "Invalid relationship status between the parents.",
        },
        400
      );
    }

    const parents = rawParents.map((rawParent, index) => {
      const mode = cleanText(rawParent.mode, 20).toLowerCase();
      const clientSlot =
        cleanText(rawParent.clientSlot, 40) || `parent-${index + 1}`;
      const existingPersonId = rawParent.existingPersonId
        ? cleanUuid(rawParent.existingPersonId)
        : "";
      const fullName = cleanText(rawParent.fullName, 200);
      const sex =
        cleanText(rawParent.sex, 20).toLowerCase() || "unspecified";
      const locationText = cleanText(rawParent.locationText, 200);
      const locationScope = cleanText(rawParent.locationScope, 40);
      const locationBucket = cleanText(rawParent.locationBucket, 120);

      if (!MODE_VALUES.has(mode)) {
        throw new Error(`Parent slot ${index + 1} has an invalid mode.`);
      }

      if (!SEX_VALUES.has(sex)) {
        throw new Error(`Parent slot ${index + 1} has an invalid sex value.`);
      }

      if (mode === "use_existing" && !existingPersonId) {
        throw new Error(
          `Parent slot ${index + 1} must choose an existing person.`
        );
      }

      if (mode === "create_new" && !fullName) {
        throw new Error(
          `Parent slot ${index + 1} requires a full name.`
        );
      }

      if (locationScope && !LOCATION_SCOPES.has(locationScope)) {
        throw new Error(
          `Parent slot ${index + 1} has an invalid location classification.`
        );
      }

      if (locationScope && !locationBucket) {
        throw new Error(
          `Parent slot ${index + 1} requires a reporting bucket.`
        );
      }

      if (!locationScope && locationBucket) {
        throw new Error(
          `Parent slot ${index + 1} must choose a location classification first.`
        );
      }

      return {
        clientSlot,
        mode,
        existingPersonId: existingPersonId || null,
        fullName: fullName || null,
        sex,
        locationText: locationText || null,
        locationScope: locationScope || null,
        locationBucket: locationBucket || null,
      };
    });

    if (
      parents.length === 2 &&
      parents[0].mode === "use_existing" &&
      parents[1].mode === "use_existing" &&
      parents[0].existingPersonId === parents[1].existingPersonId
    ) {
      return noStore(
        {
          success: false,
          resultCode: "SAME_PARENT_SELECTED",
          error: "Parent 1 and Parent 2 cannot be the same person.",
        },
        400
      );
    }

    if (
      parents.length === 2 &&
      parents[0].mode === "create_new" &&
      parents[1].mode === "create_new" &&
      parents[0].fullName?.toLowerCase() ===
        parents[1].fullName?.toLowerCase()
    ) {
      return noStore(
        {
          success: false,
          resultCode: "DUPLICATE_PAIR_NAME",
          error: "Parent 1 and Parent 2 cannot have the same exact name.",
        },
        400
      );
    }

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc(
      "family_quick_parent_pair_entry",
      {
        p_family_id: familyId,
        p_child_person_id: childPersonId,
        p_parents: parents,
        p_parent_relationship_status:
          parentRelationshipStatus || null,
      }
    );

    if (error) {
      const failure = (error.message || "").match(
        /FAMILY_PARENT_PAIR_FAILED\|(\d+)\|([^|]+)\|(.+)/
      );

      if (failure) {
        return noStore(
          {
            success: false,
            resultCode: failure[2],
            failedSlot: Number(failure[1]),
            error: `Parent slot ${failure[1]} failed: ${failure[3]} Nothing from the parent pair was saved.`,
          },
          409
        );
      }

      const spouseConflict = (error.message || "").match(
        /FAMILY_PARENT_PAIR_SPOUSE_STATUS_CONFLICT\|([^|]+)\|([^|]+)/
      );

      if (spouseConflict) {
        return noStore(
          {
            success: false,
            resultCode: "SPOUSE_STATUS_CONFLICT",
            error:
              `These two parents already have a recorded spouse/partner status of ${spouseConflict[1]}. ` +
              `The pair entry requested ${spouseConflict[2]}. Nothing from the parent pair was saved. ` +
              "Use the Spouses / Partners editor to change an existing status.",
          },
          409
        );
      }

      throw new Error(error.message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as RpcRow | null;

    if (!row) {
      return noStore(
        { success: false, error: "Parent Pair Entry returned no result." },
        500
      );
    }

    if (!row.success) {
      return noStore(
        {
          success: false,
          resultCode: row.result_code,
          error: row.message,
        },
        row.result_code === "ADVANCED_EDITOR_REQUIRED" ? 409 : 400
      );
    }

    return noStore(
      {
        success: true,
        resultCode: row.result_code,
        processedCount: row.processed_count,
        parentResults: row.parent_results || [],
        spouseRelationshipId: row.spouse_relationship_id,
        message: row.message,
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Parent Pair Entry failed.",
      },
      500
    );
  }
}
