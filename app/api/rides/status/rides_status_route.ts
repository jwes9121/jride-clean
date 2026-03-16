import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// allowed statuses we can move to from the dispatch console
const ALLOWED_STATUSES = ["driver_accepted", "in_transit", "completed", "cancelled"] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
  },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bookingCode: string | undefined = body?.bookingCode;
    const status: AllowedStatus | undefined = body?.status;

    if (!bookingCode || !status) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    if (!ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS" },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("bookings")
      .update({
        status,
        updated_at: new Date().toISOString(),
      })
      .eq("booking_code", bookingCode)
      .select("*")
      .single();

    if (error) {
      console.error("UPDATE_STATUS_ERROR", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR_UPDATE", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, booking: data });
  } catch (err: any) {
    console.error("STATUS_ROUTE_ERROR", err);
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
