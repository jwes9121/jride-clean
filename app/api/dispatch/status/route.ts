import { NextRequest, NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  assigned: ["accepted"],
  accepted: ["fare_proposed"],
  fare_proposed: ["ready"],
  ready: ["on_the_way"],
  on_the_way: ["arrived"],
  arrived: ["on_trip"],
  on_trip: ["completed"],
};

function clean(v: any): string {
  return typeof v === "string" ? v.trim() : "";
}

function getAdminClient(req: NextRequest) {
  const headerSecret = clean(req.headers.get("x-jride-driver-secret"));
  const expected = clean(process.env.DRIVER_PING_SECRET);

  if (!headerSecret || headerSecret !== expected) return null;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const bookingCode = clean(body?.bookingCode || body?.booking_code);
    const bookingId = clean(body?.bookingId || body?.booking_id);
    const nextStatus = clean(body?.status || body?.newStatus).toLowerCase();

    if ((!bookingCode && !bookingId) || !nextStatus) {
      return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    const routeClient = createRouteHandlerClient({ cookies });
    const adminClient = getAdminClient(req);
    const supabase = adminClient ?? routeClient;

    let query = supabase.from("bookings").select("id, booking_code, status").limit(1);

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    } else {
      query = query.eq("id", bookingId);
    }

    const { data: booking, error } = await query.single();

    if (error || !booking) {
      return NextResponse.json({ ok: false, error: "booking_not_found" }, { status: 404 });
    }

    const current = clean(booking.status).toLowerCase();
    const allowed = ALLOWED_TRANSITIONS[current] || [];

    if (!allowed.includes(nextStatus)) {
      return NextResponse.json(
        { ok: false, error: "invalid_transition", from: current, to: nextStatus },
        { status: 409 }
      );
    }

    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking.id);

    if (updateError) {
      return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
