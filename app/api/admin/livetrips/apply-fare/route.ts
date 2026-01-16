import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function bad(code: string, status = 400, message?: string, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function asNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();

    const body = await req.json().catch(() => null);
    const booking_code = String(body?.booking_code || "").trim();
    const fare = Number(body?.fare);

    if (!booking_code) return bad("MISSING_BOOKING_CODE", 400);
    if (!Number.isFinite(fare) || fare <= 0) return bad("INVALID_FARE", 400);

    // Apply fare: prefer verified_fare, fallback proposed_fare (best-effort)
    let applied_field: "verified_fare" | "proposed_fare" = "verified_fare";
    const u1 = await supabase.from("bookings").update({ verified_fare: fare }).eq("booking_code", booking_code);
    if (u1.error) {
      const u2 = await supabase.from("bookings").update({ proposed_fare: fare }).eq("booking_code", booking_code);
      if (u2.error) return bad("UPDATE_FAILED", 500, u2.error.message);
      applied_field = "proposed_fare";
    }

    // Fetch bits used to compute passenger totals/cut/payout (best-effort)
    const { data: b, error: bErr } = await supabase
      .from("bookings")
      .select("booking_code, trip_type, pickup_distance_fee, platform_service_fee")
      .eq("booking_code", booking_code)
      .maybeSingle();

    if (bErr) {
      // Fare already applied; return OK with warning
      return ok({ ok: true, applied_field, warning: "BOOKING_FETCH_FAILED", details: bErr.message });
    }

    const tripType = String((b as any)?.trip_type ?? "").trim().toLowerCase();
    const isTakeout = tripType === "takeout";

    const pickupFee = asNum((b as any)?.pickup_distance_fee) ?? 0;
    const platformFee = asNum((b as any)?.platform_service_fee) ?? 0;

    // Conservative compute rule (rides only):
    // total_to_pay = base_fare + pickup_distance_fee + platform_service_fee
    // company_cut = platform_service_fee
    // driver_payout = base_fare + pickup_distance_fee
    const computed = {
      total_to_pay: Math.round((fare + pickupFee + platformFee) * 100) / 100,
      company_cut: Math.round(platformFee * 100) / 100,
      driver_payout: Math.round((fare + pickupFee) * 100) / 100,
    };

    if (isTakeout) {
      // Do not write payout/cut/total for takeout yet; informational only
      return ok({ ok: true, applied_field, computed, note: "TAKEOUT_SKIPPED_PAYOUT_RECOMPUTE" });
    }

    // Best-effort updates: never hard-fail if some columns don't exist
    const applied_computed_fields: string[] = [];

    async function tryUpdate(patch: Record<string, any>) {
      try {
        const r = await supabase.from("bookings").update(patch).eq("booking_code", booking_code);
        if (!r.error) {
          for (const k of Object.keys(patch)) {
            if (!applied_computed_fields.includes(k)) applied_computed_fields.push(k);
          }
        }
      } catch {}
    }

    await tryUpdate({ total_to_pay: computed.total_to_pay, company_cut: computed.company_cut, driver_payout: computed.driver_payout });
    await tryUpdate({ total_to_pay: computed.total_to_pay });
    await tryUpdate({ company_cut: computed.company_cut });
    await tryUpdate({ driver_payout: computed.driver_payout });

    return ok({ ok: true, applied_field, computed, applied_computed_fields });
  } catch (e: any) {
    return bad("SERVER_ERROR", 500, String(e?.message || e));
  }
}
