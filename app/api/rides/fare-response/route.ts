import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function normalizeBaseUrl(v: string): string {
  return String(v || "").trim().replace(/\/+$/, "");
}

function requestOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return normalizeBaseUrl(u.origin);
  } catch {}

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (host) return normalizeBaseUrl(`${proto}://${host}`);

  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const booking_code = String(body?.booking_code || "").trim();
    const action = String(body?.action || "").trim().toLowerCase();

    if (!booking_code || !action) {
      return NextResponse.json({ ok: false, error: "MISSING_FIELDS" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", booking_code)
      .single();

    if (bookingErr) {
      return NextResponse.json({ ok: false, error: bookingErr.message }, { status: 500 });
    }

    if (!booking) {
      return NextResponse.json({ ok: false, error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }

    if (action === "accept") {
      const { error } = await supabase
        .from("bookings")
        .update({
          passenger_fare_response: "accepted",
          status: "ready",
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id)
        .eq("status", "fare_proposed");

      if (error) throw error;

      return NextResponse.json({ ok: true, accepted: true }, { status: 200 });
    }

    if (action === "reject") {
      const { error } = await supabase
        .from("bookings")
        .update({
          passenger_fare_response: "rejected",
          status: "assigned",
          driver_id: null,
          assigned_driver_id: null,
          assigned_at: null,
          proposed_fare: null,
          verified_fare: null,
          verified_by: null,
          verified_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id)
        .eq("status", "fare_proposed");

      if (error) throw error;

      const baseUrl = normalizeBaseUrl(
        envAny([
          "INTERNAL_BASE_URL",
          "NEXTAUTH_URL",
          "NEXT_PUBLIC_BASE_URL",
        ]) || requestOrigin(req)
      );

      if (!baseUrl) {
        return NextResponse.json(
          { ok: false, error: "BASE_URL_MISSING_AFTER_REJECT" },
          { status: 500 }
        );
      }

      const autoAssignUrl = `${baseUrl}/api/dispatch/auto-assign`;

      const reassignRes = await fetch(autoAssignUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ bookingId: booking.id }),
      });

      let reassignJson: any = null;
      try {
        reassignJson = await reassignRes.json();
      } catch {
        reassignJson = null;
      }

      return NextResponse.json({
        ok: true,
        rejected: true,
        reassigned: reassignRes.ok,
        reassign_status: reassignRes.status,
        reassign_result: reassignJson,
      }, { status: 200 });
    }

    return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });

  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message || "UNKNOWN_ERROR"
    }, { status: 500 });
  }
}