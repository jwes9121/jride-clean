import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ClaimRpcRow = {
  inserted: boolean;
  claim_id: string;
  effective_claimed_at: string;
  entitlement_id: string;
  beneficiary_id: string;
  program_id: string;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
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
    const authorization = await requireStaff([
      "admin",
      "dispatcher",
    ]);

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

    const eventSlug = cleanText(params.eventSlug);

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

    const body = await req.json().catch(() => ({}));

    const claimToken = cleanText(body.claimToken);
    const claimMethod = cleanText(body.claimMethod) || "qr";
    const counterName = cleanText(body.counterName);
    const notes = cleanText(body.notes);

    if (!claimToken) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message: "Claim token is required.",
        },
        400
      );
    }

    if (
      !["qr", "printed_stub", "manual_search"].includes(
        claimMethod
      )
    ) {
      return noStore(
        {
          success: false,
          reason: "invalid_request",
          message: "Claim method is invalid.",
        },
        400
      );
    }

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
      return noStore(
        {
          success: false,
          reason: "event_not_found",
          message: "Event was not found.",
        },
        404
      );
    }

    const { data: entitlement, error: entitlementError } =
      await supabase
        .from("event_distribution_entitlements")
        .select(
          "id,event_id,program_id,beneficiary_id,item_key,item_name,quantity,unit_label,status,claim_token,claimed_at"
        )
        .eq("event_id", event.id)
        .eq("claim_token", claimToken)
        .maybeSingle();

    if (entitlementError) {
      throw new Error(entitlementError.message);
    }

    if (!entitlement?.id) {
      return noStore(
        {
          success: false,
          reason: "invalid_token",
          message: "Claim stub is invalid.",
        },
        404
      );
    }

    const [
      programResult,
      beneficiaryResult,
    ] = await Promise.all([
      supabase
        .from("event_distribution_programs")
        .select(
          "id,program_key,program_name,beneficiary_label,item_label,claim_label,status,starts_at,ends_at"
        )
        .eq("id", entitlement.program_id)
        .eq("event_id", event.id)
        .maybeSingle(),

      supabase
        .from("event_distribution_beneficiaries")
        .select(
          "id,beneficiary_type,beneficiary_code,display_name,household_head_name,mobile_number,municipality,barangay,address_text,member_count,status,notes"
        )
        .eq("id", entitlement.beneficiary_id)
        .eq("program_id", entitlement.program_id)
        .eq("event_id", event.id)
        .maybeSingle(),
    ]);

    if (programResult.error) {
      throw new Error(programResult.error.message);
    }

    if (beneficiaryResult.error) {
      throw new Error(beneficiaryResult.error.message);
    }

    const program = programResult.data;
    const beneficiary = beneficiaryResult.data;

    if (!program?.id) {
      return noStore(
        {
          success: false,
          reason: "program_not_found",
          message: "Distribution program was not found.",
        },
        404
      );
    }

    if (program.program_key !== "honga-pahing") {
      return noStore(
        {
          success: false,
          reason: "program_mismatch",
          message:
            "This claim token does not belong to the Honga Pahing program.",
        },
        409
      );
    }

    if (!beneficiary?.id) {
      return noStore(
        {
          success: false,
          reason: "beneficiary_not_found",
          message: "Beneficiary was not found.",
        },
        404
      );
    }

    const claimedByEmail = cleanText(
      authorization.staff.email
    ).toLowerCase();

    if (!claimedByEmail) {
      return noStore(
        {
          success: false,
          reason: "staff_auth_required",
          message: "Authorized staff email is required.",
        },
        401
      );
    }

    const { data: rpcData, error: rpcError } =
      await supabase.rpc(
        "record_event_distribution_claim",
        {
          p_event_id: event.id,
          p_entitlement_id: entitlement.id,
          p_claimed_by_email: claimedByEmail,
          p_claim_method: claimMethod,
          p_counter_name: counterName || null,
          p_notes: notes || null,
        }
      );

    if (rpcError) {
      const message = rpcError.message || "";

      const knownReason =
        message.includes("PROGRAM_NOT_ACTIVE")
          ? "program_not_active"
          : message.includes("PROGRAM_NOT_STARTED")
          ? "program_not_started"
          : message.includes("PROGRAM_ENDED")
          ? "program_ended"
          : message.includes("BENEFICIARY_NOT_ACTIVE")
          ? "beneficiary_not_active"
          : message.includes("ENTITLEMENT_CANCELLED")
          ? "entitlement_cancelled"
          : "claim_failed";

      return noStore(
        {
          success: false,
          reason: knownReason,
          message:
            knownReason === "program_not_active"
              ? "Distribution program is not active."
              : knownReason === "program_not_started"
              ? "Distribution program has not started."
              : knownReason === "program_ended"
              ? "Distribution program has ended."
              : knownReason === "beneficiary_not_active"
              ? "Beneficiary is not active."
              : knownReason === "entitlement_cancelled"
              ? "Claim entitlement was cancelled."
              : message || "Claim failed.",
        },
        409
      );
    }

    const row = (
      Array.isArray(rpcData)
        ? rpcData[0]
        : rpcData
    ) as ClaimRpcRow | null;

    if (
      !row?.claim_id ||
      !row.effective_claimed_at
    ) {
      throw new Error(
        "Distribution claim returned no result."
      );
    }

    const duplicate = row.inserted !== true;

    return noStore({
      success: true,
      reason: duplicate
        ? "already_claimed"
        : "claimed",
      duplicate,
      claim: {
        id: row.claim_id,
        claimedAt:
          row.effective_claimed_at,
        method: claimMethod,
        counterName: counterName || null,
        claimedByEmail,
      },
      event: {
        id: event.id,
        slug: event.slug,
        name: event.name,
      },
      program: {
        id: program.id,
        key: program.program_key,
        name: program.program_name,
        beneficiaryLabel:
          program.beneficiary_label,
        itemLabel: program.item_label,
        claimLabel: program.claim_label,
        status: program.status,
      },
      beneficiary: {
        id: beneficiary.id,
        type: beneficiary.beneficiary_type,
        code: beneficiary.beneficiary_code,
        displayName: beneficiary.display_name,
        householdHeadName:
          beneficiary.household_head_name,
        mobileNumber:
          beneficiary.mobile_number,
        municipality:
          beneficiary.municipality,
        barangay: beneficiary.barangay,
        addressText:
          beneficiary.address_text,
        memberCount:
          beneficiary.member_count,
        status: beneficiary.status,
      },
      entitlement: {
        id: entitlement.id,
        itemKey: entitlement.item_key,
        itemName: entitlement.item_name,
        quantity: entitlement.quantity,
        unitLabel: entitlement.unit_label,
        status: "claimed",
      },
      message: duplicate
        ? "Pahing was already claimed."
        : "Pahing released successfully.",
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Distribution claim failed.",
      },
      500
    );
  }
}
