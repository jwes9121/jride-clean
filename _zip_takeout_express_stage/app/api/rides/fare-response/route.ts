import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

async function triggerAutoReassign() {
  try {
    const baseUrl =
      process.env.NEXTAUTH_URL ||
      process.env.APP_BASE_URL ||
      process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : null;

    if (!baseUrl) {
      console.error("AUTO_REASSIGN_SKIP: no base URL env found");
      return;
    }

    const res = await fetch(`${baseUrl}/api/rides/assign-nearest/latest`, {
      method: "GET",
      // no body needed, this endpoint already works via GET in your tests
    });

    if (!res.ok) {
      console.error("AUTO_REASSIGN_HTTP_ERROR", res.status, await res.text());
    }
  } catch (err) {
    console.error("AUTO_REASSIGN_ERROR", err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bookingCode: string | undefined = body?.bookingCode;
    const response: "accepted" | "rejected" | undefined = body?.response;

    if (!bookingCode || !response) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    if (response !== "accepted" && response !== "rejected") {
      return NextResponse.json(
        { ok: false, error: "INVALID_RESPONSE" },
        { status: 400 }
      );
    }

    const updates: Record<string, any> = {
      passenger_fare_response: response,
      updated_at: new Date().toISOString(),
    };

    if (response === "accepted") {
      // keep current driver, proceed as normal
      updates.status = "driver_accepted";
    } else {
      // passenger rejected the fare:
      // reset booking and free driver, ready for auto re-assign
      updates.status = "pending";
      updates.assigned_driver_id = null;
      updates.proposed_fare = null;
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update(updates)
      .eq("booking_code", bookingCode)
      .select("*")
      .single();

    if (error) {
      console.error("FARE_RESPONSE_UPDATE_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    if (response === "rejected") {
      // fire-and-forget auto reassign – no need to await for response to user
      triggerAutoReassign();
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("FARE_RESPONSE_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
