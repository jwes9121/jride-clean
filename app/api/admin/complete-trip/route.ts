import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const adminClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

function bad(code: string, message: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(payload: any) {
  return NextResponse.json(
    { ok: true, ...payload },
    { headers: { "Cache-Control": "no-store" } }
  );
}

async function finalizeTripSafe(input: { bookingCode?: string; bookingId?: string }) {
  const rpcName = "admin_finalize_trip_and_credit_wallets";

  const code = (input.bookingCode || "").trim();
  const id = (input.bookingId || "").trim();

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

  for (let i = 0; i < attempts.length; i++) {
    const args = attempts[i];
    const { data, error } = await adminClient.rpc(rpcName as any, args);
    if (!error) return { data, usedArgs: args, error: null as any };
  }

  const last = await adminClient.rpc(rpcName as any);
  if (!last.error) return { data: last.data, usedArgs: null, error: null as any };

  return { data: null, usedArgs: null, error: String(last.error?.message || last.error) };
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingCode = (body?.bookingCode as string | undefined) || undefined;
    const bookingId = (body?.bookingId as string | undefined) || undefined;

    if (!bookingCode && !bookingId) {
      return bad("MISSING_IDENTIFIER", "bookingCode (or bookingId) is required", 400);
    }

    console.log("COMPLETE_TRIP_API_START", { bookingCode: bookingCode || null, bookingId: bookingId || null });

    const res = await finalizeTripSafe({ bookingCode, bookingId });

    if (res.error) {
      console.error("COMPLETE_TRIP_FINALIZE_RPC_ERROR", res.error);
      return bad(
        "COMPLETE_TRIP_FINALIZE_RPC_ERROR",
        "Finalize RPC failed. This route does not directly update bookings.",
        500,
        { details: res.error }
      );
    }

    console.log("COMPLETE_TRIP_FINALIZE_OK", { usedArgs: res.usedArgs || null });
    return ok({ result: res.data, usedArgs: res.usedArgs || null });
  } catch (err: any) {
    console.error("COMPLETE_TRIP_API_CATCH", err);
    return bad("COMPLETE_TRIP_API_CATCH", String(err?.message || err), 500);
  }
}
