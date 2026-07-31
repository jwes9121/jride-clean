import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function env(name: string) {
  const value = process.env[name];
  return value && String(value).trim() ? String(value).trim() : "";
}

function parseCsv(value: string) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function lowerList(values: string[]) {
  return values.map((item) => item.trim().toLowerCase()).filter(Boolean);
}

function emailInList(email: string | null | undefined, values: string[]) {
  const normalized = String(email || "").trim().toLowerCase();
  return normalized ? values.includes(normalized) : false;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

// Identical to app/api/admin/driver-availability-pings/route.ts's
// getAuthorizedUser() — same session shape, same admin/dispatcher
// resolution, kept in sync deliberately rather than re-derived.
async function getAuthorizedUser() {
  const session = await auth();
  const user = (session?.user || null) as
    | {
        id?: string | null;
        email?: string | null;
        name?: string | null;
        role?: string | null;
      }
    | null;

  if (!user) {
    return { ok: false as const, status: 401, error: "Not signed in" };
  }

  const email = String(user.email || "").trim().toLowerCase();
  const role = String(user.role || "user").trim().toLowerCase();
  const name = String(user.name || "").trim();
  const id = String(user.id || "").trim();

  const adminEmails = lowerList(
    parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS"))
  );
  const dispatcherEmails = lowerList(
    parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS"))
  );

  const isAdmin = role === "admin" || emailInList(email, adminEmails);
  const isDispatcher =
    role === "dispatcher" || emailInList(email, dispatcherEmails);

  if (!isAdmin && !isDispatcher) {
    return {
      ok: false as const,
      status: 403,
      error: "Forbidden (admin/dispatcher only).",
    };
  }

  return {
    ok: true as const,
    id,
    email,
    name,
    role: isAdmin ? "admin" : "dispatcher",
    isAdmin,
    isDispatcher,
  };
}

const CLAIMABILITY_COLUMNS =
  "driver_id,driver_name,policy_code,display_name,cycle_number,cycle_weeks,cycle_start,cycle_end,achieved_presence_days,required_presence_days,achieved_total_hours,required_total_hours,achieved_booking_count,required_booking_count,cycle_missed_checks,calendar_cumulative_missed_checks,allowed_missed_checks,miss_check_scope,presence_requirement_met,hours_requirement_met,booking_requirement_met,duty_check_requirement_met,qualified,already_awarded,claimable";

const AWARD_COLUMNS =
  "id,driver_id,policy_code,cycle_number,cycle_start,cycle_end,qualified,reward_given,reward_given_at,awarded_by,remarks,created_at";

export async function GET(request: NextRequest) {
  try {
    const authorization = await getAuthorizedUser();
    if (!authorization.ok) {
      return NextResponse.json(
        { ok: false, error: authorization.error },
        { status: authorization.status }
      );
    }

    const params = request.nextUrl.searchParams;
    const driverId = String(params.get("driver_id") || "").trim();
    const policyCode = String(params.get("policy_code") || "")
      .trim()
      .toUpperCase();
    const onlyClaimable =
      String(params.get("only_claimable") || "true").trim().toLowerCase() !==
      "false";

    const admin = supabaseAdmin();

    let claimabilityQuery = admin
      .from("driver_incentive_claimability_v1")
      .select(CLAIMABILITY_COLUMNS)
      .order("driver_name", { ascending: true });

    if (driverId) claimabilityQuery = claimabilityQuery.eq("driver_id", driverId);
    if (policyCode) claimabilityQuery = claimabilityQuery.eq("policy_code", policyCode);
    if (onlyClaimable) claimabilityQuery = claimabilityQuery.eq("claimable", true);

    const claimabilityRes = await claimabilityQuery;

    if (claimabilityRes.error) {
      console.error(
        "[INCENTIVE_AWARDS_LIST_FAILED]",
        JSON.stringify({ message: claimabilityRes.error.message })
      );
      return NextResponse.json(
        { ok: false, error: claimabilityRes.error.message },
        { status: 500 }
      );
    }

    let historyQuery = admin
      .from("driver_incentive_awards")
      .select(AWARD_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(200);

    if (driverId) historyQuery = historyQuery.eq("driver_id", driverId);
    if (policyCode) historyQuery = historyQuery.eq("policy_code", policyCode);

    const historyRes = await historyQuery;

    if (historyRes.error) {
      console.error(
        "[INCENTIVE_AWARDS_HISTORY_FAILED]",
        JSON.stringify({ message: historyRes.error.message })
      );
    }

    const historyRows = historyRes.error ? [] : (historyRes.data as any[]) || [];
    const historyDriverIds = Array.from(
      new Set(historyRows.map((h: any) => String(h?.driver_id || "")).filter(Boolean))
    );

    let driverNameById: Record<string, string> = {};
    if (historyDriverIds.length > 0) {
      const driversRes = await admin
        .from("drivers")
        .select("id,driver_name")
        .in("id", historyDriverIds);
      if (!driversRes.error && Array.isArray(driversRes.data)) {
        for (const d of driversRes.data as any[]) {
          if (d?.id) driverNameById[String(d.id)] = d.driver_name || "Unknown driver";
        }
      }
    }

    const historyPolicyCodes = Array.from(
      new Set(historyRows.map((h: any) => String(h?.policy_code || "")).filter(Boolean))
    );

    const policyByCode: Record<string, { display_name: string; cycle_weeks: number }> = {};
    if (historyPolicyCodes.length > 0) {
      const policiesRes = await admin
        .from("driver_incentive_policies")
        .select("policy_code,display_name,cycle_weeks")
        .in("policy_code", historyPolicyCodes);

      if (!policiesRes.error && Array.isArray(policiesRes.data)) {
        for (const p of policiesRes.data as any[]) {
          const code = String(p?.policy_code || "");
          if (code) {
            policyByCode[code] = {
              display_name: String(p?.display_name || code),
              cycle_weeks: Number(p?.cycle_weeks || 0),
            };
          }
        }
      }
    }

    const historyWithNames = historyRows.map((h: any) => {
      const policy = policyByCode[String(h?.policy_code || "")];
      return {
        ...h,
        driver_name: driverNameById[String(h?.driver_id || "")] || "Unknown driver",
        display_name: policy?.display_name || String(h?.policy_code || ""),
        cycle_weeks: policy?.cycle_weeks || 0,
      };
    });

    return NextResponse.json({
      ok: true,
      rows: claimabilityRes.data || [],
      history: historyWithNames,
      auth_debug: {
        requester_email: authorization.email,
        requester_role: authorization.role,
        is_admin: authorization.isAdmin,
        is_dispatcher: authorization.isDispatcher,
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authorization = await getAuthorizedUser();
    if (!authorization.ok) {
      return NextResponse.json(
        { ok: false, error: authorization.error },
        { status: authorization.status }
      );
    }

    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_JSON",
          error: "Request body must be valid JSON.",
        },
        { status: 400 }
      );
    }

    const action = String(body?.action || "").trim();
    if (action !== "award") {
      return NextResponse.json(
        { ok: false, code: "UNKNOWN_ACTION", error: "Unsupported action." },
        { status: 400 }
      );
    }

    const driverId = String(body?.driver_id || "").trim();
    const policyCode = String(body?.policy_code || "").trim().toUpperCase();
    const cycleNumber = Number(body?.cycle_number);
    const remarks = String(body?.remarks || "").trim();

    if (!isUuid(driverId)) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_DRIVER_ID",
          error: "Select a valid driver.",
        },
        { status: 400 }
      );
    }
    if (!policyCode) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_POLICY_CODE",
          error: "Select a valid incentive.",
        },
        { status: 400 }
      );
    }
    if (!Number.isFinite(cycleNumber) || cycleNumber < 1) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_CYCLE_NUMBER",
          error: "Invalid cycle number.",
        },
        { status: 400 }
      );
    }
    if (remarks.length > 500) {
      return NextResponse.json(
        {
          ok: false,
          code: "REMARKS_TOO_LONG",
          error: "Remarks must not exceed 500 characters.",
        },
        { status: 400 }
      );
    }

    const admin = supabaseAdmin();

    // Re-derive current truth directly from the engine right before
    // writing — never trust a qualified/claimable value the client already
    // had, since it may be stale (another dispatcher may have already
    // awarded this exact cycle in the meantime, or the driver's
    // qualification may have changed since the page loaded).
    const currentRes = await admin
      .from("driver_incentive_claimability_v1")
      .select(
        "driver_id,policy_code,cycle_number,cycle_start,cycle_end,qualified,already_awarded,claimable"
      )
      .eq("driver_id", driverId)
      .eq("policy_code", policyCode)
      .eq("cycle_number", cycleNumber)
      .maybeSingle();

    if (currentRes.error || !currentRes.data) {
      return NextResponse.json(
        {
          ok: false,
          code: "CYCLE_NOT_FOUND",
          error: "This driver has no matching qualification cycle.",
        },
        { status: 404 }
      );
    }

    const current = currentRes.data as any;

    if (!current.claimable) {
      return NextResponse.json(
        {
          ok: false,
          code: current.already_awarded ? "ALREADY_AWARDED" : "NOT_QUALIFIED",
          error: current.already_awarded
            ? "This reward has already been awarded."
            : "This driver is not currently qualified for this cycle.",
        },
        { status: 409 }
      );
    }

    const { data: award, error: awardError } = await admin
      .from("driver_incentive_awards")
      .insert({
        driver_id: driverId,
        policy_code: policyCode,
        cycle_number: cycleNumber,
        cycle_start: current.cycle_start,
        cycle_end: current.cycle_end,
        qualified: current.qualified,
        reward_given: true,
        reward_given_at: new Date().toISOString(),
        awarded_by: isUuid(authorization.id) ? authorization.id : null,
        remarks: remarks || null,
      })
      .select(AWARD_COLUMNS)
      .single();

    if (awardError) {
      // The two partial unique indexes on driver_incentive_awards (one per
      // WEEKLY cycle, one ever per one-time tier) are the actual safety net
      // against a double-award race between two dispatchers acting on the
      // same stale claimable=true at once — a 23505 here means someone else
      // won that race in the moments between our SELECT and this INSERT.
      if (String((awardError as any).code) === "23505") {
        return NextResponse.json(
          {
            ok: false,
            code: "ALREADY_AWARDED",
            error: "This reward has already been awarded.",
          },
          { status: 409 }
        );
      }
      console.error(
        "[INCENTIVE_AWARD_INSERT_FAILED]",
        JSON.stringify({
          message: awardError.message,
          code: (awardError as any).code || null,
        })
      );
      return NextResponse.json(
        { ok: false, code: "AWARD_FAILED", error: awardError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, award }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: "AWARD_FAILED",
        error: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}
