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

  if (!headerSecret || !expected || headerSecret !== expected) return null;

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function finalizeTripSafe(supabase: any, input: { bookingCode?: string; bookingId?: string }) {
  const rpcName = "admin_finalize_trip_and_credit_wallets";
  const code = clean(input.bookingCode);
  const id = clean(input.bookingId);
  const attempts: any[] = [];

  if (code) {
    attempts.push({ booking_code: code });
    attempts.push({ p_booking_code: code });
    attempts.push({ in_booking_code: code });
    attempts.push({ _booking_code: code });
    attempts.push({ code });
    attempts.push({ bookingCode: code });
  }

  if (id) {
    attempts.push({ booking_id: id });
    attempts.push({ p_booking_id: id });
    attempts.push({ in_booking_id: id });
    attempts.push({ _booking_id: id });
    attempts.push({ id });
    attempts.push({ bookingId: id });
  }

  for (const args of attempts) {
    const { data, error } = await supabase.rpc(rpcName as any, args);
    if (!error) {
      return { ok: true, data, usedArgs: args };
    }
  }

  const fallback = await supabase.rpc(rpcName as any);
  if (!fallback.error) {
    return { ok: true, data: fallback.data, usedArgs: null };
  }

  return {
    ok: false,
    error: String(fallback.error?.message || fallback.error || "FINALIZE_RPC_FAILED"),
  };
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

    if (nextStatus === "completed") {
      const finalized = await finalizeTripSafe(supabase, {
        bookingCode: booking.booking_code || bookingCode,
        bookingId: booking.id || bookingId,
      });

      if (!finalized.ok) {
        return NextResponse.json(
          { ok: false, error: finalized.error || "complete_finalize_failed" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        completed_via: "admin_finalize_trip_and_credit_wallets",
        result: finalized.data ?? null,
      });
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
