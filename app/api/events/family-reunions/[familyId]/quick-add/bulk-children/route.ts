import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BULK_CHILDREN = 20;

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

type BulkChildInput = {
  clientRowId?: unknown;
  mode?: unknown;
  existingPersonId?: unknown;
  fullName?: unknown;
  sex?: unknown;
  locationText?: unknown;
  locationScope?: unknown;
  locationBucket?: unknown;
};

type BulkRpcRow = {
  success: boolean;
  result_code: string;
  processed_count: number;
  results: {
    clientRowId: string | null;
    mode: "create_new" | "use_existing";
    personId: string;
    relationshipId: string;
    resultCode: string;
    message: string;
  }[];
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
    const rawChildren = Array.isArray(body.children)
      ? (body.children as BulkChildInput[])
      : [];

    if (!anchorPersonId) {
      return noStore(
        { success: false, error: "Choose the parent for this batch." },
        400
      );
    }

    if (rawChildren.length < 1) {
      return noStore(
        { success: false, error: "Add at least one child." },
        400
      );
    }

    if (rawChildren.length > MAX_BULK_CHILDREN) {
      return noStore(
        {
          success: false,
          error: `A maximum of ${MAX_BULK_CHILDREN} children can be saved in one batch.`,
        },
        400
      );
    }

    const children = rawChildren.map((rawChild, index) => {
      const mode = cleanText(rawChild.mode, 20).toLowerCase();
      const clientRowId =
        cleanText(rawChild.clientRowId, 100) || `row-${index + 1}`;
      const existingPersonId = rawChild.existingPersonId
        ? cleanUuid(rawChild.existingPersonId)
        : "";
      const fullName = cleanText(rawChild.fullName, 200);
      const sex =
        cleanText(rawChild.sex, 20).toLowerCase() || "unspecified";
      const locationText = cleanText(rawChild.locationText, 200);
      const locationScope = cleanText(rawChild.locationScope, 40);
      const locationBucket = cleanText(rawChild.locationBucket, 120);

      if (!MODE_VALUES.has(mode)) {
        throw new Error(`Child row ${index + 1} has an invalid mode.`);
      }

      if (!SEX_VALUES.has(sex)) {
        throw new Error(`Child row ${index + 1} has an invalid sex value.`);
      }

      if (mode === "use_existing" && !existingPersonId) {
        throw new Error(
          `Child row ${index + 1} must choose an existing person.`
        );
      }

      if (mode === "create_new" && !fullName) {
        throw new Error(`Child row ${index + 1} requires a full name.`);
      }

      if (locationScope && !LOCATION_SCOPES.has(locationScope)) {
        throw new Error(
          `Child row ${index + 1} has an invalid location classification.`
        );
      }

      if (locationScope && !locationBucket) {
        throw new Error(
          `Child row ${index + 1} requires a reporting bucket.`
        );
      }

      if (!locationScope && locationBucket) {
        throw new Error(
          `Child row ${index + 1} must choose a location classification first.`
        );
      }

      return {
        clientRowId,
        mode,
        existingPersonId: existingPersonId || null,
        fullName: fullName || null,
        sex,
        locationText: locationText || null,
        locationScope: locationScope || null,
        locationBucket: locationBucket || null,
      };
    });

    const supabase = supabaseAdmin();

    const { data, error } = await supabase.rpc(
      "family_quick_entry_bulk_children",
      {
        p_family_id: familyId,
        p_anchor_person_id: anchorPersonId,
        p_children: children,
      }
    );

    if (error) {
      const message = error.message || "";
      const failure = message.match(
        /FAMILY_BULK_CHILD_ROW_FAILED\|(\d+)\|([^|]+)\|(.+)/
      );

      if (failure) {
        return noStore(
          {
            success: false,
            resultCode: failure[2],
            failedRow: Number(failure[1]),
            error: `Child row ${failure[1]} failed: ${failure[3]} The entire batch was cancelled.`,
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
            resultCode: "DUPLICATE_EDGE",
            error:
              "A child relationship in this batch already exists. The entire batch was cancelled.",
          },
          409
        );
      }

      throw new Error(message);
    }

    const row = (Array.isArray(data) ? data[0] : data) as BulkRpcRow | null;

    if (!row) {
      return noStore(
        { success: false, error: "Bulk child entry returned no result." },
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
        400
      );
    }

    return noStore(
      {
        success: true,
        resultCode: row.result_code,
        processedCount: row.processed_count,
        results: row.results || [],
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
            : "Bulk child entry failed.",
      },
      400
    );
  }
}
