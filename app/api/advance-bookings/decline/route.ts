// app/api/advance-bookings/decline/route.ts
//
// POST /api/advance-bookings/decline
//
// Passenger declines the driver's fare proposal.
//
// Transitions (atomic RPC):
//   booking:    fare_proposed -> open (stale fare fields cleared)
//   queue row:  tentative_committed -> released (removal_reason = passenger_declined[:reason])
//   total_passenger_declines: incremented
//
// After the RPC, the route awaits re-offer with the declined driver excluded.
// Awaited (not fire-and-forget) because Vercel may suspend the invocation
// before background work completes after the response is returned.
//
// Auth: passenger Bearer token (Supabase auth)
// Body: { advanceBookingId: string, declineReason?: string }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { offerAdvanceBooking } from "@/lib/advance-booking/offer";
import type { VehicleType } from "@/lib/advance-booking/types";
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
  const declineReason = String(body?.declineReason ?? "").trim() || null;

  if (!advanceBookingId) {
    return NextResponse.json(
      { ok: false, error: "MISSING_BOOKING_ID", message: "advanceBookingId is required." },
      { status: 400, headers: noStore() }
    );
  }

  // Step 1: atomic decline via RPC
  const { data, error } = await supabaseAdmin().rpc("decline_advance_booking_fare", {
    p_advance_booking_id: advanceBookingId,
    p_passenger_user_id:  userId,
    p_decline_reason:     declineReason,
  });

  if (error) {
    console.error("[advance-booking:decline:rpc]", error);
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
    declinedDriverId?: string;
    totalDeclines?: number;
    rerequestOffer?: boolean;
  };

  if (!result.ok) {
    const status =
      result.error === "BOOKING_NOT_FOUND" ? 404 :
      result.error === "UNAUTHORIZED"       ? 403 :
      result.error === "INTERNAL_ERROR"     ? 500 :
      409;

    return NextResponse.json(
      { ok: false, error: result.error, message: result.message },
      { status, headers: noStore() }
    );
  }

  // Step 2: re-offer to the next eligible driver.
  // Awaited so the offer is guaranteed to be triggered before the invocation ends.
  // Excludes the driver whose fare was just declined to prevent immediately
  // re-selecting the same driver.
  if (result.rerequestOffer) {
    const supabase = supabaseAdmin();

    const { data: bookingRow, error: bookingError } = await supabase
      .from("advance_bookings")
      .select(
        "id, pickup_lat, pickup_lng, pickup_town, vehicle_type, scheduled_pickup_at, status"
      )
      .eq("id", advanceBookingId)
      .eq("status", "open")
      .single();

    if (bookingError || !bookingRow) {
      // Booking not retrievable -- log and continue. Response already declined successfully.
      console.error("[advance-booking:decline:reload-booking]",
        bookingError?.message ?? "Booking row not found after decline.");
    } else {
      const excludedDriverIds: string[] = result.declinedDriverId
        ? [result.declinedDriverId]
        : [];

      const pickupTown = String(
        (bookingRow as any).pickup_town || ""
      ).trim();

      if (!pickupTown) {
        console.error(
          "[advance-booking:decline:re-offer]",
          "Booking pickup_town is missing."
        );
      } else {
        await offerAdvanceBooking({
          advanceBookingId,
          pickupLat: Number((bookingRow as any).pickup_lat),
          pickupLng: Number((bookingRow as any).pickup_lng),
          pickupTown,
          vehicleType: String(
            (bookingRow as any).vehicle_type
          ) as VehicleType,
        scheduledPickupAt: new Date((bookingRow as any).scheduled_pickup_at),
          excludedDriverIds,
        }).catch((err) => {
          console.error("[advance-booking:decline:re-offer]", err);
        });
      }
    }
  }

  return NextResponse.json(
    {
      ok:            true,
      advanceBookingId,
      totalDeclines: result.totalDeclines,
    },
    { headers: noStore() }
  );
}
