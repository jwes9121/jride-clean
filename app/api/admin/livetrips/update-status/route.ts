import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const ALLOWED_STATUSES = [
  "pending",
  "searching",
  "assigned",
  "driver_accepted",
  "driver_arrived",
  "passenger_onboard",
  "in_transit",
  "dropoff",
  "completed"
];

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      return NextResponse.json({ error: "ENV_MISSING" }, { status: 500 });
    }

    const body = await req.json().catch(() => null);

    const bookingId: string | undefined = body?.bookingId;
    const nextStatus: string | undefined = body?.nextStatus;

    if (!bookingId || !nextStatus) {
      return NextResponse.json(
        { error: "BAD_REQUEST", message: "bookingId and nextStatus required" },
        { status: 400 }
      );
    }

    if (!ALLOWED_STATUSES.includes(nextStatus)) {
      return NextResponse.json(
        { error: "INVALID_STATUS", message: \Invalid status: \\ },
        { status: 400 }
      );
    }

    const url = \\/rest/v1/bookings?id=eq.\\;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: \Bearer \\,
        "Content-Type": "application/json",
        Prefer: "return=representation"
      },
      body: JSON.stringify({ status: nextStatus })
    });

    const raw = await res.text();
    const json = raw ? JSON.parse(raw) : null;

    if (!res.ok) {
      return NextResponse.json({ error: "DB_ERROR_UPDATE", message: raw }, { status: 500 });
    }

    return NextResponse.json({ ok: true, booking: json?.[0] ?? json }, { status: 200 });

  } catch (err: any) {
    return NextResponse.json({ error: "SERVER_ERROR", message: err?.message }, { status: 500 });
  }
}
