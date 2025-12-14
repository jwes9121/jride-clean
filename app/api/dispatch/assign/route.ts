import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

type GuardResult = { ok: true } | { ok: false; reason: string };

/**
 * Minimal inline wallet guard (no external imports).
 * Behavior: if driver wallet is below minimum required, block assignment.
 * If wallet tables/columns don't exist, fail OPEN (do not block assignment).
 */
async function assertDriverCanAcceptNewJobInline(
  supabase: any,
  driverId: string
): Promise<GuardResult> {
  try {
    // Try common wallet table patterns. If your schema differs, this will safely fail-open.
    // 1) driver_wallets (driver_id, balance, min_required)
    const w1 = await supabase
      .from("driver_wallets")
      .select("balance,min_required,minimum_required,min_wallet_required,wallet_balance")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (!w1?.error && w1?.data) {
      const d = w1.data as any;
      const balance =
        Number(d.wallet_balance ?? d.balance ?? d.wallet_balance ?? 0) || 0;
      const minReq =
        Number(d.min_wallet_required ?? d.minimum_required ?? d.min_required ?? 0) || 0;

      if (minReq > 0 && balance < minReq) {
        return { ok: false, reason: "Driver wallet below minimum required" };
      }
      return { ok: true };
    }

    // 2) driver_wallet (driver_id, wallet_balance, min_wallet_required)
    const w2 = await supabase
      .from("driver_wallet")
      .select("wallet_balance,min_wallet_required,minimum_required,balance,min_required")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (!w2?.error && w2?.data) {
      const d = w2.data as any;
      const balance = Number(d.wallet_balance ?? d.balance ?? 0) || 0;
      const minReq = Number(d.min_wallet_required ?? d.minimum_required ?? d.min_required ?? 0) || 0;

      if (minReq > 0 && balance < minReq) {
        return { ok: false, reason: "Driver wallet below minimum required" };
      }
      return { ok: true };
    }

    // If wallet table not found or no row, do not block assignment
    return { ok: true };
  } catch {
    // Fail open (do not block assignment) if anything unexpected happens
    return { ok: true };
  }
}

export async function POST(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  const body = await req.json();
  const { bookingId, driverId } = body;

  if (!bookingId || !driverId) {
    return NextResponse.json(
      { error: "Missing bookingId or driverId" },
      { status: 400 }
    );
  }

  // Wallet guard (inline, no imports)
  const guard = await assertDriverCanAcceptNewJobInline(supabase, driverId);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.reason }, { status: 403 });
  }

  const { error } = await supabase
    .from("bookings")
    .update({
      assigned_driver_id: driverId,
      status: "assigned",
    })
    .eq("id", bookingId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
