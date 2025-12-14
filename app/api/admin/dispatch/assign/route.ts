import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isWalletLockError(msg: string) {
  const m = (msg || "").toUpperCase();
  return m.includes("WALLET_LOCK:");
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const bookingId: string | undefined = body.bookingId;
    const pickupLat: number | null | undefined = body.pickupLat;
    const pickupLng: number | null | undefined = body.pickupLng;

    if (!bookingId) {
      return NextResponse.json({ error: "Missing bookingId" }, { status: 400 });
    }

    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error("ASSIGN_ROUTE: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env.");
      return NextResponse.json(
        { error: "Server configuration error (Supabase env vars missing)." },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    let driverId: string | null = null;

    // Try auto-assign only if we have coordinates
    if (pickupLat != null && pickupLng != null) {
      const { data, error: rpcError } = await supabase.rpc(
        "select_next_available_driver",
        { pickup_lat: pickupLat, pickup_lng: pickupLng }
      );

      if (rpcError) {
        console.error("ASSIGN_ROUTE RPC ERROR:", rpcError);
      } else {
        driverId = (data as string | null) ?? null;
      }
    }

    // Update booking (DB trigger enforces wallet lock)
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        status: "assigned",
        assigned_driver_id: driverId,
      })
      .eq("id", bookingId);

    if (updateError) {
      const msg = updateError.message || "Update failed";
      console.error("ASSIGN_ROUTE UPDATE ERROR:", updateError);

      // Wallet lock => return 409 so UI can show a clear message
      if (isWalletLockError(msg)) {
        return NextResponse.json(
          { error: "wallet_locked", message: msg, driverId },
          { status: 409 }
        );
      }

      return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({ success: true, driverId });
  } catch (err: any) {
    console.error("ASSIGN_ROUTE FATAL ERROR:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unexpected server error" },
      { status: 500 }
    );
  }
}