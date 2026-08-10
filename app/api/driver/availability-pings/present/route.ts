import { NextRequest, NextResponse } from "next/server";

import {
  noStoreHeaders,
  resolveAuthenticatedDriver,
} from "@/lib/advance-booking/driverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, {
    status,
    headers: noStoreHeaders(),
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

const SUCCESS_CODES = new Set([
  "PRESENTED",
  "ALREADY_PRESENTED",
  "LEGACY_PING",
  "LATE_ACK_REQUIRED",
  "ALREADY_ACKNOWLEDGED",
  "ALREADY_LATE_ACKNOWLEDGED",
  "PING_RESOLVED",
]);

const CONFLICT_CODES = new Set([
  "PING_EXPIRED",
  "PING_CANCELLED",
  "PING_DELIVERY_EXPIRED",
  "PING_PRESENT_RACE",
  "PING_NOT_PRESENTABLE",
]);

export async function POST(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return json(auth.status, {
      ok: false,
      error: auth.error,
      message: auth.message,
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

  const pingId = text(body?.ping_id);
  const headerDeviceId = text(req.headers.get("x-jride-device-id"));
  const bodyDeviceId = text(body?.device_id);
  const deviceId = headerDeviceId || bodyDeviceId || null;

  if (!pingId) {
    return json(400, {
      ok: false,
      error: "PING_ID_REQUIRED",
      message: "ping_id is required.",
    });
  }

  if (!isUuid(pingId)) {
    return json(400, {
      ok: false,
      error: "INVALID_PING_ID",
      message: "ping_id must be a valid UUID.",
    });
  }

  try {
    const admin = supabaseAdmin();

    const { data, error } = await admin.rpc(
      "jride_present_driver_availability_ping",
      {
        p_ping_id: pingId,
        p_driver_id: auth.driverId,
        p_device_id: deviceId,
      }
    );

    if (error) {
      console.error(
        "[JRIDE_DUTY_CHECK_PRESENT_RPC_FAILED]",
        error.message
      );

      return json(500, {
        ok: false,
        error: "DUTY_CHECK_PRESENT_FAILED",
        message: error.message,
      });
    }

    const code = text(data?.code);

    if (SUCCESS_CODES.has(code)) {
      return json(200, data);
    }

    if (code === "PING_NOT_FOUND") {
      return json(404, data);
    }

    if (CONFLICT_CODES.has(code)) {
      return json(409, data);
    }

    return json(data?.ok === false ? 400 : 200, data);
  } catch (error: any) {
    console.error(
      "[JRIDE_DUTY_CHECK_PRESENT_UNEXPECTED]",
      error
    );

    return json(500, {
      ok: false,
      error: "DUTY_CHECK_PRESENT_FAILED",
      message: error?.message ?? "Unable to present Duty Check.",
    });
  }
}