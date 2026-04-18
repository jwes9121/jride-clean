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

async function finalizePromoSafe(supabase: any, booking: any) {
  const promoStatus = clean(booking?.promo_status).toLowerCase();
  const promoProgramCode = clean(booking?.promo_program_code) || "ANDROID_FIRST_RIDE_40";
  const driverId = clean(booking?.driver_id || booking?.assigned_driver_id);
  const bookingId = clean(booking?.id);
  const bookingCode = clean(booking?.booking_code);

  if (!bookingId || !driverId || promoStatus !== "reserved") {
    return { ok: true, skipped: true };
  }

  const proposedFareRaw = Number(booking?.proposed_fare ?? 0);
  const pickupFeeRaw = Number(booking?.pickup_distance_fee ?? 0);
  const promoAppliedRaw = Number(booking?.promo_applied_amount ?? 0);
  const proposedFare = Number.isFinite(proposedFareRaw) && proposedFareRaw > 0 ? proposedFareRaw : 0;
  const pickupFee = Number.isFinite(pickupFeeRaw) && pickupFeeRaw > 0 ? pickupFeeRaw : 0;
  const promoApplied = Number.isFinite(promoAppliedRaw) && promoAppliedRaw > 0 ? promoAppliedRaw : 0;
  const completedTotal = Number(Math.max(proposedFare + pickupFee + 15 - promoApplied, 0).toFixed(2));

  const { data, error } = await supabase.rpc("jride_promo_finalize_completed_booking", {
    p_booking_id: bookingId,
    p_completed_total: completedTotal,
    p_driver_id: driverId,
    p_booking_code: bookingCode,
    p_program_code: promoProgramCode,
  });

  if (error) {
    return { ok: false, error: String(error?.message || error) };
  }

  return { ok: true, data: data ?? null, completed_total: completedTotal };
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

    let query = supabase.from("bookings").select("id, booking_code, status, driver_id, assigned_driver_id, proposed_fare, pickup_distance_fee, promo_applied_amount, promo_status, promo_program_code").limit(1);

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

      const promoFinalized = await finalizePromoSafe(supabase, booking);
      if (!promoFinalized.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: promoFinalized.error || "promo_finalize_failed",
            completed_via: "admin_finalize_trip_and_credit_wallets",
            result: finalized.data ?? null,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        completed_via: "admin_finalize_trip_and_credit_wallets",
        result: finalized.data ?? null,
        promo_finalize: promoFinalized,
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
