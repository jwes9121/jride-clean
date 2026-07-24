import { randomBytes } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  isCheckinOpen,
  EVENT_NOT_OPERATIONAL_RESPONSE,
} from "@/lib/events/checkinLifecycle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HONGA_PROGRAM_KEY = "honga-pahing";
const HONGA_ITEM_KEY = "pahing";
const HONGA_ITEM_NAME = "Pahing";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function nullableText(value: unknown) {
  const text = cleanText(value);
  return text || null;
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function createBeneficiaryCode() {
  const date = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  const suffix = randomBytes(3)
    .toString("hex")
    .toUpperCase();

  return `HH-${date}-${suffix}`;
}

function parsePositiveQuantity(value: unknown) {
  const quantity = Number(value);

  if (
    !Number.isFinite(quantity) ||
    quantity <= 0
  ) {
    return null;
  }

  return quantity;
}

function parseMemberCount(value: unknown) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  const count = Number(value);

  if (
    !Number.isInteger(count) ||
    count < 0
  ) {
    return undefined;
  }

  return count;
}

async function authorizeStaff() {
  return requireStaff([
    "admin",
    "dispatcher",
  ]);
}

async function resolveEventAndProgram(
  eventSlug: string
) {
  const supabase = supabaseAdmin();

  const { data: event, error: eventError } =
    await supabase
      .from("events")
      .select("id,slug,name,status")
      .eq("slug", eventSlug)
      .maybeSingle();

  if (eventError) {
    throw new Error(eventError.message);
  }

  if (!event?.id) {
    return {
      supabase,
      event: null,
      program: null,
    };
  }

  const { data: program, error: programError } =
    await supabase
      .from("event_distribution_programs")
      .select(
        "id,event_id,program_key,program_name,beneficiary_label,item_label,claim_label,status,starts_at,ends_at"
      )
      .eq("event_id", event.id)
      .eq("program_key", HONGA_PROGRAM_KEY)
      .maybeSingle();

  if (programError) {
    throw new Error(programError.message);
  }

  return {
    supabase,
    event,
    program,
  };
}

export async function GET(
  _req: NextRequest,
  {
    params,
  }: {
    params: {
      eventSlug: string;
    };
  }
) {
  try {
    const authorization =
      await authorizeStaff();

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          reason: "staff_auth_required",
          error: authorization.error,
        },
        authorization.status
      );
    }

    const eventSlug = cleanText(
      params.eventSlug
    );

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    const {
      supabase,
      event,
      program,
    } = await resolveEventAndProgram(
      eventSlug
    );

    if (!event?.id) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    if (!program?.id) {
      return noStore(
        {
          success: false,
          reason: "program_not_found",
          message:
            "Honga Pahing program was not found.",
        },
        404
      );
    }

    const {
      data: beneficiaries,
      error: beneficiariesError,
    } = await supabase
      .from(
        "event_distribution_beneficiaries"
      )
      .select(
        "id,beneficiary_type,beneficiary_code,display_name,household_head_name,mobile_number,municipality,barangay,address_text,member_count,status,notes,created_at,updated_at"
      )
      .eq("event_id", event.id)
      .eq("program_id", program.id)
      .order("created_at", {
        ascending: false,
      });

    if (beneficiariesError) {
      throw new Error(
        beneficiariesError.message
      );
    }

    const beneficiaryIds = (
      beneficiaries || []
    ).map((row) => row.id);

    let entitlements: Array<{
      id: string;
      beneficiary_id: string;
      item_key: string;
      item_name: string;
      quantity: number | string;
      unit_label: string;
      claim_token: string;
      status: string;
      allocated_at: string;
      claimed_at: string | null;
      cancelled_at: string | null;
      cancellation_reason: string | null;
    }> = [];

    if (beneficiaryIds.length > 0) {
      const {
        data: entitlementRows,
        error: entitlementsError,
      } = await supabase
        .from(
          "event_distribution_entitlements"
        )
        .select(
          "id,beneficiary_id,item_key,item_name,quantity,unit_label,claim_token,status,allocated_at,claimed_at,cancelled_at,cancellation_reason"
        )
        .eq("event_id", event.id)
        .eq("program_id", program.id)
        .in(
          "beneficiary_id",
          beneficiaryIds
        )
        .order("allocated_at", {
          ascending: false,
        });

      if (entitlementsError) {
        throw new Error(
          entitlementsError.message
        );
      }

      entitlements =
        entitlementRows || [];
    }

    const entitlementByBeneficiary =
      new Map(
        entitlements.map((row) => [
          row.beneficiary_id,
          row,
        ])
      );

    const households = (
      beneficiaries || []
    ).map((beneficiary) => ({
      ...beneficiary,
      entitlement:
        entitlementByBeneficiary.get(
          beneficiary.id
        ) || null,
    }));

    const claimedCount =
      households.filter(
        (row) =>
          row.entitlement?.status ===
          "claimed"
      ).length;

    const allocatedCount =
      households.filter(
        (row) =>
          row.entitlement?.status ===
          "allocated"
      ).length;

    const cancelledCount =
      households.filter(
        (row) =>
          row.entitlement?.status ===
          "cancelled"
      ).length;

    return noStore({
      success: true,
      event,
      program,
      summary: {
        households: households.length,
        allocated: allocatedCount,
        claimed: claimedCount,
        cancelled: cancelledCount,
        activeBeneficiaries:
          households.filter(
            (row) =>
              row.status === "active"
          ).length,
      },
      households,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load households.",
      },
      500
    );
  }
}

export async function POST(
  req: NextRequest,
  {
    params,
  }: {
    params: {
      eventSlug: string;
    };
  }
) {
  try {
    const authorization =
      await authorizeStaff();

    if (!authorization.ok) {
      return noStore(
        {
          success: false,
          reason: "staff_auth_required",
          error: authorization.error,
        },
        authorization.status
      );
    }

    const eventSlug = cleanText(
      params.eventSlug
    );

    if (!eventSlug) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    const body = await req
      .json()
      .catch(() => ({}));

    const displayName = cleanText(
      body.displayName
    );

    const householdHeadName =
      nullableText(
        body.householdHeadName
      );

    const mobileNumber = nullableText(
      body.mobileNumber
    );

    const municipality = nullableText(
      body.municipality
    );

    const barangay = nullableText(
      body.barangay
    );

    const addressText = nullableText(
      body.addressText
    );

    const notes = nullableText(
      body.notes
    );

    const memberCount =
      parseMemberCount(
        body.memberCount
      );

    const quantity =
      parsePositiveQuantity(
        body.quantity ?? 1
      );

    const unitLabel =
      cleanText(body.unitLabel) ||
      "portion";

    if (displayName.length < 2) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Household display name is required.",
        },
        400
      );
    }

    if (memberCount === undefined) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Member count must be a whole number of zero or more.",
        },
        400
      );
    }

    if (!quantity) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Pahing quantity must be greater than zero.",
        },
        400
      );
    }

    if (!unitLabel) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message:
            "Pahing unit label is required.",
        },
        400
      );
    }

    const {
      supabase,
      event,
      program,
    } = await resolveEventAndProgram(
      eventSlug
    );

    if (!event?.id) {
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    if (!isCheckinOpen(event.status)) {
      return noStore(EVENT_NOT_OPERATIONAL_RESPONSE, 409);
    }

    if (!program?.id) {
      return noStore(
        {
          success: false,
          reason: "program_not_found",
          message:
            "Honga Pahing program was not found.",
        },
        404
      );
    }

    if (
      program.status === "cancelled" ||
      program.status === "closed"
    ) {
      return noStore(
        {
          success: false,
          reason: "program_not_open",
          message:
            "Honga Pahing program is not open for household registration.",
        },
        409
      );
    }

    const staffEmail = cleanText(
      authorization.staff.email
    ).toLowerCase();

    let beneficiary:
      | {
          id: string;
          beneficiary_code: string;
          display_name: string;
          household_head_name:
            | string
            | null;
          mobile_number:
            | string
            | null;
          municipality:
            | string
            | null;
          barangay: string | null;
          address_text:
            | string
            | null;
          member_count:
            | number
            | null;
          status: string;
          notes: string | null;
          created_at: string;
        }
      | null = null;

    let lastInsertError = "";

    for (
      let attempt = 0;
      attempt < 3;
      attempt += 1
    ) {
      const beneficiaryCode =
        createBeneficiaryCode();

      const {
        data: insertedBeneficiary,
        error: beneficiaryError,
      } = await supabase
        .from(
          "event_distribution_beneficiaries"
        )
        .insert({
          event_id: event.id,
          program_id: program.id,
          beneficiary_type:
            "household",
          beneficiary_code:
            beneficiaryCode,
          display_name: displayName,
          household_head_name:
            householdHeadName,
          mobile_number: mobileNumber,
          municipality,
          barangay,
          address_text: addressText,
          member_count: memberCount,
          status: "active",
          notes,
          created_by_email:
            staffEmail,
        })
        .select(
          "id,beneficiary_code,display_name,household_head_name,mobile_number,municipality,barangay,address_text,member_count,status,notes,created_at"
        )
        .single();

      if (!beneficiaryError) {
        beneficiary =
          insertedBeneficiary;
        break;
      }

      lastInsertError =
        beneficiaryError.message;

      if (
        beneficiaryError.code !==
        "23505"
      ) {
        break;
      }
    }

    if (!beneficiary?.id) {
      throw new Error(
        lastInsertError ||
          "Unable to create household."
      );
    }

    const {
      data: entitlement,
      error: entitlementError,
    } = await supabase
      .from(
        "event_distribution_entitlements"
      )
      .insert({
        event_id: event.id,
        program_id: program.id,
        beneficiary_id:
          beneficiary.id,
        item_key: HONGA_ITEM_KEY,
        item_name: HONGA_ITEM_NAME,
        quantity,
        unit_label: unitLabel,
        status: "allocated",
        allocated_by_email:
          staffEmail,
      })
      .select(
        "id,beneficiary_id,item_key,item_name,quantity,unit_label,claim_token,status,allocated_at,claimed_at"
      )
      .single();

    if (entitlementError) {
      const { error: cleanupError } =
        await supabase
          .from(
            "event_distribution_beneficiaries"
          )
          .delete()
          .eq("id", beneficiary.id)
          .eq("event_id", event.id)
          .eq("program_id", program.id);

      const cleanupMessage =
        cleanupError
          ? ` Cleanup failed: ${cleanupError.message}`
          : "";

      throw new Error(
        `${entitlementError.message}${cleanupMessage}`
      );
    }

    return noStore(
      {
        success: true,
        reason: "household_created",
        message:
          "Household and Pahing entitlement created.",
        event,
        program,
        household: {
          ...beneficiary,
          entitlement,
        },
      },
      201
    );
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to create household.",
      },
      500
    );
  }
}
