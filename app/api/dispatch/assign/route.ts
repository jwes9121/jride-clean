export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ACTIVE_STATUSES = ["assigned", "enroute", "on_the_way", "arrived"];

async function isDriverBusy(driverId: string) {
  const { count, error } = await supabase
    .from("bookings")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .in("status", ACTIVE_STATUSES);

  if (error) return true; // fail-safe

  return (count ?? 0) > 0;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingId =
      body.bookingId ||
      body.booking_id ||
      body.bookingUUID ||
      body.booking_uuid;

    const driverId =
      body.driverId ||
      body.driver_id;

    const forceAssign = Boolean(body.forceAssign);

    if (!bookingId || !driverId) {
      return NextResponse.json(
        { ok: false, code: "BAD_REQUEST", message: "Missing bookingId or driverId" },
        { status: 400 }
      );
    }

    // 🔒 Busy enforcement
    if (!forceAssign) {
      const busy = await isDriverBusy(driverId);
      if (busy) {
        return NextResponse.json(
          {
            ok: false,
            code: "DRIVER_BUSY",
            message: "Driver has an active trip",
          },
          { status: 409 }
        );
      }
    }

    const { error } = await supabase
      .from("bookings")
      .update({
        driver_id: driverId,
        status: "assigned",
      })
      .eq("id", bookingId);

    if (error) {
      return NextResponse.json(
        { ok: false, code: "ASSIGN_FAILED", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
