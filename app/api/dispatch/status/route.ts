import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type DeviceLockResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

async function ensureDriverDeviceLock(
  driverId: string,
  deviceId: string
): Promise<DeviceLockResult> {
  if (!driverId || !deviceId) {
    return {
      ok: false,
      code: "DEVICE_ID_MISSING",
      message: "Driver or device id missing",
    };
  }

  const { data: locks, error: lockErr } = await supabaseAdmin
    .from("driver_device_locks")
    .select("driver_id, device_id, claimed_at, last_seen")
    .eq("driver_id", driverId)
    .limit(1);

  if (lockErr) {
    return {
      ok: false,
      code: "DB_ERROR_DEVICE_LOCK",
      message: "Device lock lookup failed",
    };
  }

  if (!locks || locks.length === 0) {
    const now = new Date().toISOString();

    const { error: insertErr } = await supabaseAdmin
      .from("driver_device_locks")
      .insert([
        {
          driver_id: driverId,
          device_id: deviceId,
          claimed_at: now,
          last_seen: now,
        },
      ]);

    if (insertErr) {
      return {
        ok: false,
        code: "DEVICE_LOCK_CREATE_FAILED",
        message: insertErr.message,
      };
    }

    return { ok: true };
  }

  const existing = locks[0];

  if (existing.device_id !== deviceId) {
    return {
      ok: false,
      code: "DEVICE_LOCK_MISMATCH",
      message: "Driver already locked to another device",
    };
  }

  await supabaseAdmin
    .from("driver_device_locks")
    .update({ last_seen: new Date().toISOString() })
    .eq("driver_id", driverId)
    .eq("device_id", deviceId);

  return { ok: true };
}

function isDriverDeviceLockAllowed(body: any) {
  if (!body) return false;
  if (!body.driver_id) return false;
  if (!body.device_id) return false;
  return true;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const driverId =
      body.driver_id ||
      body.driverId ||
      null;

    const deviceId =
      body.device_id ||
      body.deviceId ||
      null;

    if (isDriverDeviceLockAllowed(body)) {
      const lock = await ensureDriverDeviceLock(driverId, deviceId);

      if (!lock.ok) {
        return NextResponse.json(lock);
      }
    }

    const bookingId =
      body.booking_id ||
      body.bookingId ||
      null;

    const bookingCode =
      body.booking_code ||
      body.bookingCode ||
      null;

    const status =
      body.status ||
      null;

    const proposedFareRaw = Number(body.proposed_fare);
    const baseFareRaw = Number(body.base_fare);
    const convenienceFeeRaw = Number(body.convenience_fee);

    let derivedProposedFare: number | null = null;
    if (Number.isFinite(proposedFareRaw) && proposedFareRaw >= 0) {
      derivedProposedFare = proposedFareRaw;
    } else if (Number.isFinite(baseFareRaw) && baseFareRaw >= 0) {
      const conv = Number.isFinite(convenienceFeeRaw) ? convenienceFeeRaw : 0;
      derivedProposedFare = baseFareRaw + conv;
    }

    if (!bookingId && !bookingCode) {
      return NextResponse.json({
        ok: false,
        code: "BOOKING_ID_MISSING",
        message: "Booking id or booking code required",
      });
    }

    const patch: any = {
      status: status,
      driver_id: driverId,
      assigned_driver_id: driverId,
      updated_at: new Date().toISOString(),
    };

    if (status === "fare_proposed" && derivedProposedFare !== null) {
      patch.proposed_fare = derivedProposedFare;
      patch.passenger_fare_response = null;
    }

    let query = supabaseAdmin
      .from("bookings")
      .update(patch);

    if (bookingId) {
      query = query.eq("id", bookingId);
    }

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    }

    const { error: updateErr } = await query;

    if (updateErr) {
      return NextResponse.json({
        ok: false,
        code: "BOOKING_UPDATE_FAILED",
        message: updateErr.message,
      });
    }

    return NextResponse.json({
      ok: true,
    });
  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      code: "UNHANDLED_ERROR",
      message: err?.message || "Unknown error",
    });
  }
}