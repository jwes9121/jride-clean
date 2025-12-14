"use server";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { assertDriverCanAcceptNewJob } from "@/lib/walletGuard";

type AssignBody = {
  bookingId?: string;
  driverId?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AssignBody;
    const bookingId = body.bookingId;
    const driverId = body.driverId;

    if (!bookingId || !driverId) {
      return NextResponse.json(
        { error: "Missing bookingId or driverId" },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    // 1) Wallet guard: block if driver wallet below minimum
    const guardResult = await assertDriverCanAcceptNewJob({
      supabase,
      driverId,
    });

    if (!guardResult.ok) {
      return NextResponse.json(
        {
          error:
            guardResult.message ??
            "Driver cannot accept new job (wallet below minimum).",
          code: "WALLET_BELOW_MINIMUM",
        },
        { status: 400 }
      );
    }

    // 2) Call existing dispatch RPC to assign driver
    const { data, error } = await supabase.rpc(
      "dispatch_assign_driver",
      {
        p_booking_id: bookingId,
        p_driver_id: driverId,
      }
    );

    if (error) {
      console.error("dispatch_assign_driver error", error);
      return NextResponse.json(
        { error: "Failed to assign driver", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result: data });
  } catch (err: any) {
    console.error("assign API unexpected error", err);
    return NextResponse.json(
      {
        error: "Unexpected error while assigning driver",
        details: err?.message,
      },
      { status: 500 }
    );
  }
}
