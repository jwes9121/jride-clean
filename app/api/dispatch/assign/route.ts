// app/api/dispatch/assign/route.ts
// Assign a booking to a driver using SUPABASE REST (service role)

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

  const { bookingCode, driverId } = body;

  if (!bookingCode || !driverId) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_FIELDS",
        message: "Missing bookingCode or driverId",
      },
      { status: 400 }
    );
  }

  const url = `${supabaseUrl}/rest/v1/bookings?booking_code=eq.${encodeURIComponent(
    bookingCode
  )}`;

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        assigned_driver_id: driverId,
        status: "assigned",
        updated_at: new Date().toISOString(),
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("Supabase REST error:", res.status, text);
      return NextResponse.json(
        {
          ok: false,
          error: "UPSTREAM_ERROR",
          message: "Failed to update booking in Supabase",
          details: text,
        },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
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
