import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export async function GET() {
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, code: "NOT_AUTHENTICATED" },
      { status: 401 }
    );
  }

  const { data: passenger } = await supabase
    .from("passengers")
    .select("verification_status")
    .eq("id", user.id)
    .single();

  const verified =
    passenger?.verification_status === "verified" ||
    passenger?.verification_status === "approved_admin";

  // TEST MODE: no geo block, no pilot-town block
  return NextResponse.json({
    ok: true,
    verified,
    nightGate: false,
    window: "20:00-05:00 Asia/Manila",
    verification_status: passenger?.verification_status ?? null,
    wallet_ok: true,
    wallet_locked: false,
    wallet_balance: null,
    min_wallet_required: null
  });
}