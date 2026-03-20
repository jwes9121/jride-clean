import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function getAdminClientOrNull() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
  "on_trip",
];

export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerClient();
    const url = new URL(req.url);
    const bookingCode = String(url.searchParams.get("code") || "").trim();

    let booking: any = null;
    let error: any = null;
    let signedIn = false;

    if (bookingCode) {
      const res = await supabase
        .from("bookings")
        .select(
          [
            "id",
            "booking_code",
            "status",
            "driver_id",
            "assigned_driver_id",
            "created_at",
            "updated_at",
            "created_by_user_id",
            "proposed_fare",
            "passenger_fare_response",
          ].join(",")
        )
        .eq("booking_code", bookingCode)
        .maybeSingle();

      booking = res.data;
      error = res.error;
      signedIn = true;
    } else {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;

      if (!user) {
        return json(200, { ok: true, signed_in: false, booking: null });
      }

      signedIn = true;
      const res = await supabase
        .from("bookings")
        .select(
          [
            "id",
            "booking_code",
            "status",
            "driver_id",
            "assigned_driver_id",
            "created_at",
            "updated_at",
            "created_by_user_id",
            "proposed_fare",
            "passenger_fare_response",
          ].join(",")
        )
        .eq("created_by_user_id", user.id)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      booking = res.data;
      error = res.error;
    }

    if (error) {
      return json(500, {
        ok: false,
        code: "DB_ERROR",
        message: String(error.message || error),
        signed_in: signedIn,
      });
    }

    if (!booking) {
      return json(404, {
        ok: false,
        code: "NOT_FOUND",
        message: "Booking not found",
        signed_in: signedIn,
      });
    }

    return json(200, {
      ok: true,
      signed_in: signedIn,
      booking,
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