import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const HONGA_PROGRAM_KEY = "honga-pahing";
const UNASSIGNED_LABEL = "Unspecified";

type BeneficiaryRow = {
  id: string;
  beneficiary_code: string;
  display_name: string;
  household_head_name: string | null;
  mobile_number: string | null;
  municipality: string | null;
  barangay: string | null;
  address_text: string | null;
  member_count: number | null;
  status: string;
  created_at: string;
};

type EntitlementRow = {
  id: string;
  beneficiary_id: string;
  item_name: string;
  quantity: number | string;
  unit_label: string;
  claim_token: string;
  status: string;
  allocated_at: string;
  claimed_at: string | null;
  cancelled_at: string | null;
};

type ClaimRow = {
  id: string;
  beneficiary_id: string;
  entitlement_id: string;
  claimed_quantity: number | string;
  unit_label: string;
  claim_method: string;
  counter_name: string | null;
  claimed_by_email: string;
  claimed_at: string;
  notes: string | null;
};

type BreakdownAccumulator = {
  key: string;
  households: number;
  activeHouseholds: number;
  members: number;
  allocatedHouseholds: number;
  claimedHouseholds: number;
  cancelledHouseholds: number;
  allocatedQuantity: number;
  claimedQuantity: number;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizedLabel(value: string | null) {
  return cleanText(value) || UNASSIGNED_LABEL;
}

function numericValue(value: number | string | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percentage(part: number, whole: number) {
  if (whole <= 0) {
    return 0;
  }

  return Math.round((part / whole) * 10000) / 100;
}

function noStore(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function buildBreakdown(
  beneficiaries: BeneficiaryRow[],
  entitlementByBeneficiary: Map<string, EntitlementRow>,
  field: "municipality" | "barangay"
) {
  const rows = new Map<string, BreakdownAccumulator>();

  for (const beneficiary of beneficiaries) {
    const key = normalizedLabel(beneficiary[field]);
    const entitlement = entitlementByBeneficiary.get(
      beneficiary.id
    );

    const current =
      rows.get(key) ||
      {
        key,
        households: 0,
        activeHouseholds: 0,
        members: 0,
        allocatedHouseholds: 0,
        claimedHouseholds: 0,
        cancelledHouseholds: 0,
        allocatedQuantity: 0,
        claimedQuantity: 0,
      };

    current.households += 1;

    if (beneficiary.status === "active") {
      current.activeHouseholds += 1;
    }

    current.members +=
      beneficiary.member_count || 0;

    if (entitlement) {
      if (entitlement.status === "allocated") {
        current.allocatedHouseholds += 1;
      }

      if (entitlement.status === "claimed") {
        current.claimedHouseholds += 1;
      }

      if (entitlement.status === "cancelled") {
        current.cancelledHouseholds += 1;
      }

      if (entitlement.status !== "cancelled") {
        current.allocatedQuantity += numericValue(
          entitlement.quantity
        );
      }

      if (entitlement.status === "claimed") {
        current.claimedQuantity += numericValue(
          entitlement.quantity
        );
      }
    }

    rows.set(key, current);
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      unclaimedHouseholds:
        row.allocatedHouseholds,
      claimCompletionPercent: percentage(
        row.claimedHouseholds,
        row.allocatedHouseholds +
          row.claimedHouseholds
      ),
      quantityCompletionPercent: percentage(
        row.claimedQuantity,
        row.allocatedQuantity
      ),
    }))
    .sort((a, b) => {
      if (b.households !== a.households) {
        return b.households - a.households;
      }

      return a.key.localeCompare(b.key);
    });
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

    const [
      beneficiariesResult,
      entitlementsResult,
      claimsResult,
    ] = await Promise.all([
      supabase
        .from("event_distribution_beneficiaries")
        .select(
          "id,beneficiary_code,display_name,household_head_name,mobile_number,municipality,barangay,address_text,member_count,status,created_at"
        )
        .eq("event_id", event.id)
        .eq("program_id", program.id)
        .order("created_at", {
          ascending: false,
        }),

      supabase
        .from("event_distribution_entitlements")
        .select(
          "id,beneficiary_id,item_name,quantity,unit_label,claim_token,status,allocated_at,claimed_at,cancelled_at"
        )
        .eq("event_id", event.id)
        .eq("program_id", program.id)
        .order("allocated_at", {
          ascending: false,
        }),

      supabase
        .from("event_distribution_claims")
        .select(
          "id,beneficiary_id,entitlement_id,claimed_quantity,unit_label,claim_method,counter_name,claimed_by_email,claimed_at,notes"
        )
        .eq("event_id", event.id)
        .eq("program_id", program.id)
        .order("claimed_at", {
          ascending: false,
        }),
    ]);

    if (beneficiariesResult.error) {
      throw new Error(
        beneficiariesResult.error.message
      );
    }

    if (entitlementsResult.error) {
      throw new Error(
        entitlementsResult.error.message
      );
    }

    if (claimsResult.error) {
      throw new Error(
        claimsResult.error.message
      );
    }

    const beneficiaries =
      (beneficiariesResult.data ||
        []) as BeneficiaryRow[];

    const entitlements =
      (entitlementsResult.data ||
        []) as EntitlementRow[];

    const claims =
      (claimsResult.data ||
        []) as ClaimRow[];

    const entitlementByBeneficiary =
      new Map(
        entitlements.map((row) => [
          row.beneficiary_id,
          row,
        ])
      );

    const beneficiaryById =
      new Map(
        beneficiaries.map((row) => [
          row.id,
          row,
        ])
      );

    const claimByEntitlement =
      new Map(
        claims.map((row) => [
          row.entitlement_id,
          row,
        ])
      );

    const householdRows =
      beneficiaries.map((beneficiary) => {
        const entitlement =
          entitlementByBeneficiary.get(
            beneficiary.id
          ) || null;

        const claim = entitlement
          ? claimByEntitlement.get(
              entitlement.id
            ) || null
          : null;

        return {
          beneficiaryId: beneficiary.id,
          beneficiaryCode:
            beneficiary.beneficiary_code,
          displayName:
            beneficiary.display_name,
          householdHeadName:
            beneficiary.household_head_name,
          mobileNumber:
            beneficiary.mobile_number,
          municipality:
            beneficiary.municipality,
          barangay:
            beneficiary.barangay,
          addressText:
            beneficiary.address_text,
          memberCount:
            beneficiary.member_count,
          beneficiaryStatus:
            beneficiary.status,
          registeredAt:
            beneficiary.created_at,
          entitlement: entitlement
            ? {
                id: entitlement.id,
                itemName:
                  entitlement.item_name,
                quantity:
                  numericValue(
                    entitlement.quantity
                  ),
                unitLabel:
                  entitlement.unit_label,
                claimToken:
                  entitlement.claim_token,
                status:
                  entitlement.status,
                allocatedAt:
                  entitlement.allocated_at,
                claimedAt:
                  entitlement.claimed_at,
                cancelledAt:
                  entitlement.cancelled_at,
              }
            : null,
          claim: claim
            ? {
                id: claim.id,
                claimedQuantity:
                  numericValue(
                    claim.claimed_quantity
                  ),
                unitLabel:
                  claim.unit_label,
                method:
                  claim.claim_method,
                counterName:
                  claim.counter_name,
                claimedByEmail:
                  claim.claimed_by_email,
                claimedAt:
                  claim.claimed_at,
                notes: claim.notes,
              }
            : null,
        };
      });

    const totalHouseholds =
      beneficiaries.length;

    const activeHouseholds =
      beneficiaries.filter(
        (row) => row.status === "active"
      ).length;

    const totalMembers =
      beneficiaries.reduce(
        (sum, row) =>
          sum + (row.member_count || 0),
        0
      );

    const allocatedEntitlements =
      entitlements.filter(
        (row) => row.status === "allocated"
      );

    const claimedEntitlements =
      entitlements.filter(
        (row) => row.status === "claimed"
      );

    const cancelledEntitlements =
      entitlements.filter(
        (row) => row.status === "cancelled"
      );

    const allocatedQuantity =
      entitlements
        .filter(
          (row) =>
            row.status !== "cancelled"
        )
        .reduce(
          (sum, row) =>
            sum +
            numericValue(row.quantity),
          0
        );

    const claimedQuantity =
      claims.reduce(
        (sum, row) =>
          sum +
          numericValue(
            row.claimed_quantity
          ),
        0
      );

    const municipalityBreakdown =
      buildBreakdown(
        beneficiaries,
        entitlementByBeneficiary,
        "municipality"
      );

    const barangayBreakdown =
      buildBreakdown(
        beneficiaries,
        entitlementByBeneficiary,
        "barangay"
      );

    const claimedHouseholds =
      householdRows
        .filter(
          (row) =>
            row.entitlement?.status ===
            "claimed"
        )
        .sort((a, b) =>
          String(
            b.claim?.claimedAt || ""
          ).localeCompare(
            String(
              a.claim?.claimedAt || ""
            )
          )
        );

    const unclaimedHouseholds =
      householdRows
        .filter(
          (row) =>
            row.entitlement?.status ===
            "allocated"
        )
        .sort((a, b) =>
          a.displayName.localeCompare(
            b.displayName
          )
        );

    const recentClaims = claims
      .slice(0, 50)
      .map((claim) => {
        const beneficiary =
          beneficiaryById.get(
            claim.beneficiary_id
          );

        return {
          claimId: claim.id,
          beneficiaryId:
            claim.beneficiary_id,
          beneficiaryCode:
            beneficiary?.beneficiary_code ||
            null,
          displayName:
            beneficiary?.display_name ||
            "Unknown household",
          householdHeadName:
            beneficiary?.household_head_name ||
            null,
          municipality:
            beneficiary?.municipality ||
            null,
          barangay:
            beneficiary?.barangay ||
            null,
          claimedQuantity:
            numericValue(
              claim.claimed_quantity
            ),
          unitLabel:
            claim.unit_label,
          method: claim.claim_method,
          counterName:
            claim.counter_name,
          claimedByEmail:
            claim.claimed_by_email,
          claimedAt:
            claim.claimed_at,
        };
      });

    const csvRows = householdRows.map(
      (row) => ({
        beneficiary_code:
          row.beneficiaryCode,
        household_name:
          row.displayName,
        household_head:
          row.householdHeadName || "",
        mobile_number:
          row.mobileNumber || "",
        municipality:
          row.municipality || "",
        barangay:
          row.barangay || "",
        address:
          row.addressText || "",
        member_count:
          row.memberCount ?? "",
        beneficiary_status:
          row.beneficiaryStatus,
        entitlement_status:
          row.entitlement?.status ||
          "none",
        item_name:
          row.entitlement?.itemName ||
          "",
        quantity:
          row.entitlement?.quantity ??
          "",
        unit_label:
          row.entitlement?.unitLabel ||
          "",
        claim_token:
          row.entitlement?.claimToken ||
          "",
        allocated_at:
          row.entitlement?.allocatedAt ||
          "",
        claimed_at:
          row.claim?.claimedAt || "",
        claim_method:
          row.claim?.method || "",
        counter_name:
          row.claim?.counterName || "",
        claimed_by_email:
          row.claim?.claimedByEmail ||
          "",
      })
    );

    return noStore({
      success: true,
      generatedAt:
        new Date().toISOString(),
      event,
      program,
      summary: {
        totalHouseholds,
        activeHouseholds,
        totalMembers,
        allocatedHouseholds:
          allocatedEntitlements.length,
        claimedHouseholds:
          claimedEntitlements.length,
        unclaimedHouseholds:
          allocatedEntitlements.length,
        cancelledHouseholds:
          cancelledEntitlements.length,
        claimCompletionPercent:
          percentage(
            claimedEntitlements.length,
            allocatedEntitlements.length +
              claimedEntitlements.length
          ),
        allocatedQuantity,
        claimedQuantity,
        unclaimedQuantity:
          Math.max(
            0,
            allocatedQuantity -
              claimedQuantity
          ),
        quantityCompletionPercent:
          percentage(
            claimedQuantity,
            allocatedQuantity
          ),
        municipalityCount:
          municipalityBreakdown.length,
        barangayCount:
          barangayBreakdown.length,
      },
      municipalityBreakdown,
      barangayBreakdown,
      largestMunicipalities:
        municipalityBreakdown.slice(0, 10),
      claimedHouseholds,
      unclaimedHouseholds,
      recentClaims,
      csvRows,
    });
  } catch (error) {
    return noStore(
      {
        success: false,
        reason: "server_error",
        message:
          error instanceof Error
            ? error.message
            : "Unable to load distribution report.",
      },
      500
    );
  }
}
