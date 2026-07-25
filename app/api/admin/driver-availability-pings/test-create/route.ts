import { NextRequest, NextResponse } from "next/server";

import { requireStaff } from "@/lib/auth/requireStaff";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

export async function POST(req: NextRequest) {
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

  let body: any;

  try {
    body = await req.json();
  } catch {
    return json(400, {
      ok: false,
      error: "INVALID_JSON",
      message: "Request body must be valid JSON.",
    });
  }

  const driverId = text(body?.driver_id);
  const notes = text(body?.notes) || "Phase 1 observation-mode test";
  const requestedWindow = Number(body?.response_window_seconds ?? 180);

  if (!driverId) {
    return json(400, {
      ok: false,
      error: "DRIVER_ID_REQUIRED",
      message: "driver_id is required.",
    });
  }

  if (!isUuid(driverId)) {
    return json(400, {
      ok: false,
      error: "INVALID_DRIVER_ID",
      message: "driver_id must be a valid UUID.",
    });
  }

  if (
    !Number.isInteger(requestedWindow) ||
    requestedWindow < 30 ||
    requestedWindow > 600
  ) {
    return json(400, {
      ok: false,
      error: "INVALID_RESPONSE_WINDOW",
      message: "response_window_seconds must be an integer from 30 to 600.",
    });
  }

  const createdBy = isUuid(gate.staff.id) ? gate.staff.id : null;

  try {
    const admin = supabaseAdmin();

    const { data: driver, error: driverError } = await admin
      .from("driver_profiles")
      .select("driver_id,full_name,municipality")
      .eq("driver_id", driverId)
      .limit(1)
      .maybeSingle();

    if (driverError) {
      return json(500, {
        ok: false,
        error: "DRIVER_LOOKUP_FAILED",
        message: driverError.message,
      });
    }

    if (!driver) {
      return json(404, {
        ok: false,
        error: "DRIVER_NOT_FOUND",
        message: "No driver profile exists for the supplied driver_id.",
      });
    }

    const { data, error } = await admin.rpc(
      "jride_create_driver_availability_ping",
      {
        p_driver_id: driverId,
        p_created_by: createdBy,
        p_creation_source: "test",
        p_notes: notes,
        p_response_window_seconds: requestedWindow,
      }
    );

    if (error) {
      console.error(
        "[JRIDE_DUTY_CHECK_TEST_CREATE_RPC_FAILED]",
        error.message
      );

      return json(500, {
        ok: false,
        error: "DUTY_CHECK_CREATE_FAILED",
        message: error.message,
      });
    }

    const code = text(data?.code);

    if (code === "PING_ALREADY_PENDING") {
      return json(409, {
        ...data,
        driver,
      });
    }

    if (data?.ok === false) {
      return json(400, {
        ...data,
        driver,
      });
    }

    return json(201, {
      ...data,
      driver,
      observation_mode: true,
      incentive_enforcement_enabled: false,
    });
  } catch (error: any) {
    console.error(
      "[JRIDE_DUTY_CHECK_TEST_CREATE_UNEXPECTED]",
      error
    );

    return json(500, {
      ok: false,
      error: "DUTY_CHECK_CREATE_FAILED",
      message: error?.message ?? "Unable to create Duty Check.",
    });
  }
}
