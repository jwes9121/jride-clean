import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Create server-side Supabase client safely
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const bookingCode = searchParams.get("bookingCode");

  if (!bookingCode) {
    return NextResponse.json(
      { ok: false, code: "MISSING_BOOKING", message: "bookingCode required" },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("dispatch_assign_audit")
    .select("created_at, actor, ok, code, message")
    .eq("booking_code", bookingCode)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) {
    return NextResponse.json(
      { ok: false, code: "DB_ERROR", message: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, data });
}
