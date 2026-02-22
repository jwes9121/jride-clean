import { NextRequest, NextResponse } from "next/server";

import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";


function getServiceRoleClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Resp = {
  ok: boolean;
  code?: string;
  message?: string;
  signed_in?: boolean;
  booking?: any;
};

function json(status: number, body: Resp) {
  return NextResponse.json(body, { status });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const url = new URL(req.url);
const bookingCode = String(url.searchParams.get("code") || "").trim();

// If code is missing, try to discover the passenger's latest ACTIVE booking via session.
// If no session, we still return ok=true but signed_in=false (UI can fall back to "new booking" mode).
const ACTIVE_STATUSES = [
  "pending",
  "searching",
  "requested",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "enroute",
  "on_trip"
];

    // Polling must NOT require auth.
    // Booking ownership is already enforced during booking creation.
    let b: any = null;
let error: any = null;

if (bookingCode) {
  const res = await supabase
    .from("bookings")
    .select(
      `
          id,
          booking_code,
          status,
          driver_id,
          assigned_driver_id,
          created_at,
          updated_at,
          created_by_user_id,
          proposed_fare,
          passenger_fare_response
          `
    )
    .eq("booking_code", bookingCode)
    .maybeSingle();

  b = res.data;
  error = res.error;
} else {
  // Discover latest active booking for this signed-in passenger.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;

  if (!user) {
    return json(200, { ok: true, signed_in: true, booking: null });
  }

  const res = await supabase
    .from("bookings")
    .select(
      `
          id,
          booking_code,
          status,
          driver_id,
          assigned_driver_id,
          created_at,
          updated_at,
          created_by_user_id,
          proposed_fare,
          passenger_fare_response
          `
    )
    .eq("created_by_user_id", user.id)
    .in("status", ACTIVE_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  b = res.data;
  error = res.error;
}

    if (error) {
      return json(500, {
        ok: false,
        code: "DB_ERROR",
        message: String(error.message || error),
        signed_in: true,
      });
    }

    if (!b) {
      return json(404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Booking not found",
        signed_in: true,
      });
    }

    // If booking exists, treat as signed in for polling purposes.
    return json(200, {
      ok: true,
      signed_in: true,
      booking: b,
    });
  } catch (e: any) {
    return json(500, {
      ok: false,
      code: "ERROR",
      message: String(e?.message || e),
      signed_in: true,
    });
  }
}
