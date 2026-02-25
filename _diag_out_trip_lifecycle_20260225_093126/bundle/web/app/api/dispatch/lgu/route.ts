import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function jsonError(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

function mustAuth(req: NextRequest) {
  const required = String(process.env.DISPATCH_ADMIN_TOKEN || "");
  if (!required) return { ok: false, status: 500, msg: "Missing DISPATCH_ADMIN_TOKEN" };

  const got = String(req.headers.get("x-dispatch-admin-token") || "");
  if (!got || got !== required) return { ok: false, status: 403, msg: "Forbidden" };

  return { ok: true, status: 200, msg: "OK" };
}

function asNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function POST(req: NextRequest) {
  try {
    const a = mustAuth(req);
    if (!a.ok) return jsonError(a.msg, a.status);

    const body = await req.json().catch(() => null);
    if (!body) return jsonError("Invalid JSON", 400);

    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) return jsonError("Missing bookingId", 400);

    const from_label = body.from_label != null ? String(body.from_label).trim() : null;
    const to_label = body.to_label != null ? String(body.to_label).trim() : null;
    const verified_fare = asNum(body.verified_fare);

    const distance_km = asNum(body.distance_km);

    // passenger_fare_response is stored as json/text in your schema; we write a minimal JSON object
    // that includes distance_km so reporting can extract it safely.
    let passenger_fare_response: any = null;
    if (distance_km != null) {
      passenger_fare_response = { distance_km };
    }

    const patch: any = {};
    if (from_label !== null) patch.from_label = from_label === "" ? null : from_label;
    if (to_label !== null) patch.to_label = to_label === "" ? null : to_label;
    if (verified_fare !== null) patch.verified_fare = verified_fare;
    if (passenger_fare_response !== null) patch.passenger_fare_response = passenger_fare_response;

    if (Object.keys(patch).length === 0) return jsonError("No fields to update", 400);

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("bookings")
      .update(patch)
      .eq("id", bookingId)
      .select("id, booking_code, town, status, from_label, to_label, verified_fare, passenger_fare_response, updated_at")
      .single();

    if (error) return jsonError(error.message, 500);

    return NextResponse.json({ ok: true, row: data });
  } catch (e: any) {
    return jsonError(String(e?.message || e), 500);
  }
}