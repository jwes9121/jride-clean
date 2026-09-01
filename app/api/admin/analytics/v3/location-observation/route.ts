import { NextResponse } from "next/server";

import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const OBSERVATION_PAGE_SIZE = 1000;
const OBSERVATION_MAX_PAGES = 100;

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function readActivePeriod(admin: any) {
  return admin
    .from("driver_incentive_periods")
    .select("id,name,start_at,end_at,is_active")
    .eq("is_active", true)
    .order("start_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
}

async function readObservationRows(admin: any, periodId: string) {
  const rows: any[] = [];
  let totalCount: number | null = null;

  for (let page = 0; page < OBSERVATION_MAX_PAGES; page += 1) {
    const start = rows.length;
    const result = await admin
      .from("driver_location_observation_current_period_v1")
      .select("*", page === 0 ? { count: "exact" } : undefined)
      .eq("period_id", periodId)
      .order("driver_name", { ascending: true })
      .order("driver_id", { ascending: true })
      .range(start, start + OBSERVATION_PAGE_SIZE - 1);

    if (result.error) {
      return { rows: [] as any[], error: result.error, tooLarge: false };
    }

    if (page === 0) {
      const count = result.count;
      if (!Number.isSafeInteger(count) || count < 0) {
        return {
          rows: [] as any[],
          error: { message: "The observation row count was unavailable." },
          tooLarge: false,
        };
      }
      totalCount = count;
    }

    const pageRows = Array.isArray(result.data) ? result.data : [];
    rows.push(...pageRows);

    if (totalCount !== null && rows.length >= totalCount) {
      return { rows, error: null, tooLarge: false };
    }

    if (pageRows.length === 0) {
      return {
        rows: [] as any[],
        error: { message: "Observation pagination ended before all rows loaded." },
        tooLarge: false,
      };
    }
  }

  return { rows: [] as any[], error: null, tooLarge: true };
}

export async function GET() {
  const gate = await requireStaff(["admin", "dispatcher"]);

  if (!gate.ok) {
    return json(gate.status, {
      ok: false,
      error: gate.error,
      message:
        gate.error === "NOT_SIGNED_IN"
          ? "Staff sign-in required."
          : "Admin or dispatcher access required.",
    });
  }

  try {
    const admin = supabaseAdmin();
    const periodResult = await readActivePeriod(admin);

    if (periodResult.error) {
      console.error(
        "[JRIDE_LOCATION_OBSERVATION_PERIOD_READ_FAILED]",
        periodResult.error.message
      );
      return json(500, {
        ok: false,
        error: "INCENTIVE_PERIOD_READ_FAILED",
        message: "Unable to read the active incentive period.",
      });
    }

    const periodId = text((periodResult.data as any)?.id);
    const observationResult = periodId
      ? await readObservationRows(admin, periodId)
      : { rows: [] as any[], error: null, tooLarge: false };

    if (observationResult.error) {
      console.error(
        "[JRIDE_LOCATION_OBSERVATION_REPORT_READ_FAILED]",
        observationResult.error.message
      );
      return json(500, {
        ok: false,
        error: "LOCATION_OBSERVATION_READ_FAILED",
        message: "Unable to read driver location observations.",
      });
    }

    if (observationResult.tooLarge) {
      console.error("[JRIDE_LOCATION_OBSERVATION_REPORT_TOO_LARGE]", {
        period_id: periodId,
        maximum_rows: OBSERVATION_PAGE_SIZE * OBSERVATION_MAX_PAGES,
      });
      return json(500, {
        ok: false,
        error: "LOCATION_OBSERVATION_REPORT_TOO_LARGE",
        message: "The location observation report is too large to load safely.",
      });
    }

    const periodCheckResult = await readActivePeriod(admin);

    if (periodCheckResult.error) {
      console.error(
        "[JRIDE_LOCATION_OBSERVATION_PERIOD_RECHECK_FAILED]",
        periodCheckResult.error.message
      );
      return json(500, {
        ok: false,
        error: "INCENTIVE_PERIOD_READ_FAILED",
        message: "Unable to confirm the active incentive period.",
      });
    }

    if (text((periodCheckResult.data as any)?.id) !== periodId) {
      return json(409, {
        ok: false,
        error: "INCENTIVE_PERIOD_CHANGED",
        message:
          "The active incentive period changed while this report was loading. Refresh and try again.",
      });
    }

    const drivers = observationResult.rows.sort((left: any, right: any) => {
      const byName = text(left?.driver_name).localeCompare(
        text(right?.driver_name),
        "en",
        { sensitivity: "base" }
      );
      if (byName !== 0) return byName;
      return text(left?.driver_id).localeCompare(text(right?.driver_id));
    });

    const period = periodResult.data
      ? {
          id: (periodResult.data as any).id,
          name: (periodResult.data as any).name,
          start_at: (periodResult.data as any).start_at,
          end_at: (periodResult.data as any).end_at,
        }
      : null;

    return json(200, {
      ok: true,
      observation_mode: true,
      incentive_enforcement_enabled: false,
      official_service_area_boundary_available: false,
      trip_context_is_automatic_authorization: false,
      period,
      observation_window: drivers.length
        ? {
            start_at: (drivers[0] as any).observation_window_start_at,
            end_at: (drivers[0] as any).observation_window_end_at,
          }
        : null,
      drivers,
    });
  } catch (error: any) {
    console.error("[JRIDE_LOCATION_OBSERVATION_ROUTE_FAILED]", error);
    return json(500, {
      ok: false,
      error: "LOCATION_OBSERVATION_READ_FAILED",
      message: error?.message || "Unable to read driver location observations.",
    });
  }
}
