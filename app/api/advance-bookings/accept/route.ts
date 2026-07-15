// app/api/advance-bookings/accept/route.ts
//
// POST /api/advance-bookings/accept
//
// Passenger accepts the driver's fare proposal.
//
// Transitions (atomic RPC):
//   booking:    fare_proposed -> fare_accepted
//   queue row:  tentative_committed -> locked_committed
//   Sets:       committed_driver_id, committed_at, fare_accepted_at
//   Clears:     passenger_response_expires_at
//
// Auth: passenger Bearer token (Supabase auth)
// Body: { advanceBookingId: string }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function noStore() {
  return { "Cache-Control": "no-store, no-cache", Pragma: "no-cache" };
}

function anonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function resolvePassengerUserId(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  const { data } = await anonClient().auth.getUser(token);
  return data?.user?.id ?? null;
}

export async function POST(req: NextRequest) {
  const userId = await resolvePassengerUserId(req);
  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Valid passenger session required." },
      { status: 401, headers: noStore() }
    );
  }

  const body = await req.json().catch(() => ({}));
  const advanceBookingId = String(body?.advanceBookingId ?? "").trim();

  if (!advanceBookingId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_BOOKING_ID", message: "advanceBookingId is required." },
      { status: 400, headers: noStore() }
    );
  }

  const { data, error } = await supabaseAdmin().rpc("accept_advance_booking_fare", {
    p_advance_booking_id: advanceBookingId,
    p_passenger_user_id:  userId,
  });

  if (error) {
    console.error("[advance-booking:accept:rpc]", error);
    return NextResponse.json(
      { ok: false, error: "RPC_FAILED", message: error.message },
      { status: 500, headers: noStore() }
    );
  }

  const result = data as {
    ok: boolean;
    error?: string;
    message?: string;
    currentStatus?: string;
    queueStatus?: string;
    advanceBookingId?: string;
    driverId?: string;
    fareAcceptedAt?: string;
  };

  if (!result.ok) {
    const status =
      result.error === "BOOKING_NOT_FOUND" ? 404 :
      result.error === "UNAUTHORIZED"       ? 403 :
      result.error === "RESPONSE_EXPIRED"   ? 410 :
      result.error === "INTERNAL_ERROR"     ? 500 :
      409;

    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status, headers: noStore() }
    );
  }

  return NextResponse.json(result, { headers: noStore() });
}
