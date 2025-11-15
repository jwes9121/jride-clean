// app/api/dispatch/assign/route.ts
// Assigns a trip to a driver by calling Supabase RPC assign_trip

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

type AssignBody = {
  bookingCode?: string;
  driverId?: string;
};

export async function POST(request: Request) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_MISCONFIGURED",
        message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      { status: 500 }
    );
  }

  let body: AssignBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "BAD_REQUEST", message: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const bookingCode = body.bookingCode;
  const driverId = body.driverId;

  if (!bookingCode || !driverId) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_FIELDS",
        message: "bookingCode and driverId are required",
      },
      { status: 400 }
    );
  }

  const url = `${supabaseUrl}/rest/v1/rpc/assign_trip`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        p_booking_code: bookingCode,
        p_driver_id: driverId,
      }),
      cache: "no-store",
    });

    const data = await res.json();

    if (!res.ok) {
      console.error("assign_trip RPC error:", data);
      return NextResponse.json(
        {
          ok: false,
          error: "UPSTREAM_ERROR",
          message: "Failed to assign trip in Supabase",
          details: data,
        },
        { status: res.status }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking: data,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("Assign route unexpected error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: "ASSIGN_ERROR",
        message: "Unexpected error while assigning trip",
      },
      { status: 500 }
    );
  }
}
