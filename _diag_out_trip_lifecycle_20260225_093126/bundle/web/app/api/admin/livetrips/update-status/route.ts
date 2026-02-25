export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// All statuses we allow updates to
const ALLOWED_STATUSES = [
  "pending",
  "searching",
  "assigned",
  "driver_accepted",
  "driver_arrived",
  "passenger_onboard",
  "in_transit",
  "dropoff",
  "completed",
];

export async function POST(req: NextRequest) {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error(
        "[admin/livetrips/update-status] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars"
      );
      return NextResponse.json(
        { error: "ENV_MISSING", message: "Supabase env vars missing" },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);

    const bookingId: string | undefined = body?.bookingId;
    const nextStatus: string | undefined = body?.nextStatus;

    if (!bookingId || !nextStatus) {
      return NextResponse.json(
        {
          error: "BAD_REQUEST",
          message: "bookingId and nextStatus are required",
        },
        { status: 400 }
      );
    }

    if (!ALLOWED_STATUSES.includes(nextStatus)) {
      return NextResponse.json(
        {
          error: "INVALID_STATUS",
          message: `nextStatus must be one of: ${ALLOWED_STATUSES.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const url = `${SUPABASE_URL}/rest/v1/bookings?id=eq.${encodeURIComponent(
      bookingId
    )}`;

    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ status: nextStatus }),
    });

    const raw = await res.text();
    let json: any = null;

    try {
      json = raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error(
        "[admin/livetrips/update-status] Failed to parse Supabase response JSON:",
        e,
        "raw=",
        raw
      );
    }

    if (!res.ok) {
      console.error(
        "[admin/livetrips/update-status] Supabase error:",
        res.status,
        raw
      );
      return NextResponse.json(
        {
          error: "DB_ERROR_UPDATE",
          status: res.status,
          message: json?.message ?? raw ?? "Unknown Supabase error",
        },
        { status: 500 }
      );
    }

    const updatedRow =
      Array.isArray(json) && json.length > 0 ? json[0] : json ?? null;

    return NextResponse.json(
      { ok: true, booking: updatedRow },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[admin/livetrips/update-status] SERVER ERROR:", error);
    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: error?.message ?? "Unknown server error",
      },
      { status: 500 }
    );
  }
}

