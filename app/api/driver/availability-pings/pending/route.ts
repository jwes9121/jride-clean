import { NextRequest, NextResponse } from "next/server";

import {
  noStoreHeaders,
  resolveAuthenticatedDriver,
} from "@/lib/advance-booking/driverAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { guardDriverOnlineForDutyCheck } from "@/lib/driver-duty-check/onlineGuard";

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

export async function GET(req: NextRequest) {
  const auth = await resolveAuthenticatedDriver(req);

  if (!auth.ok) {
    return json(auth.status, {
      ok: false,
      error: auth.error,
      message: auth.message,
    });
  }

  const deviceId = text(req.headers.get("x-jride-device-id")) || null;

  try {
    const admin = supabaseAdmin();

    const onlineGuard = await guardDriverOnlineForDutyCheck(admin, {
      driverId: auth.driverId,
      source: "driver_pending_fetch",
      deviceId,
    });

    if (!onlineGuard.online) {
      return json(200, {
        ok: true,
        code: "DRIVER_OFFLINE",
        ping: null,
        message: "Duty Check is not delivered while the driver is offline.",
        presence: onlineGuard.presence,
        cancellation: onlineGuard.cancellation,
      });
    }

    const { data, error } = await admin.rpc(
      "jride_fetch_driver_availability_ping",
      {
        p_driver_id: auth.driverId,
        p_device_id: deviceId,
      }
    );

    if (error) {
      console.error(
        "[JRIDE_DUTY_CHECK_PENDING_RPC_FAILED]",
        error.message
      );

      return json(500, {
        ok: false,
        error: "DUTY_CHECK_FETCH_FAILED",
        message: error.message,
      });
    }

    return json(200, data ?? {
      ok: true,
      code: "NO_PENDING_PING",
      ping: null,
    });
  } catch (error: any) {
    console.error(
      "[JRIDE_DUTY_CHECK_PENDING_UNEXPECTED]",
      error
    );

    return json(500, {
      ok: false,
      error: "DUTY_CHECK_FETCH_FAILED",
      message: error?.message ?? "Unable to fetch Duty Check.",
    });
  }
}
