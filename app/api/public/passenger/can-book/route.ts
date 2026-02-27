import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

function manilaHour(): number {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
    return parseInt(fmt.format(new Date()), 10);
  } catch {
    // fallback: local server hour (best effort)
    return new Date().getHours();
  }
}

function truthy(v: any): boolean {
  if (v === true) return true;
  if (typeof v === "number") return v > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "false" && s !== "0" && s !== "no";
  }
  return false;
}

async function computeVerified(supabase: any, user: any): Promise<{ verified: boolean; verification_status: string | null; source: string | null }> {
  if (!user?.id) return { verified: false, verification_status: null, source: null };

  // 1) Canonical: passenger_verifications (status like: pending, approved_admin, ...)
  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const st = String((pv?.data as any)?.status ?? "").toLowerCase().trim();
    if (st) {
      const ok = (st === "approved_admin" || st === "approved" || st === "verified");
      return { verified: ok, verification_status: st, source: "passenger_verifications" };
    }
  } catch {
    // ignore
  }

  // 2) Legacy: passenger_verification_requests (status like: submitted/pending_admin/approved/rejected)
  try {
    const pr = await supabase
      .from("passenger_verification_requests")
      .select("status")
      .eq("passenger_id", user.id)
      .maybeSingle();

    const st = String((pr?.data as any)?.status ?? "").toLowerCase().trim();
    if (st) {
      const ok = (st === "approved_admin" || st === "approved" || st === "verified");
      return { verified: ok, verification_status: st, source: "passenger_verification_requests" };
    }
  } catch {
    // ignore
  }

  // 3) Fallback: passengers flags (best-effort; donâ€™t assume schema)
  try {
    const email = user?.email ?? null;
    const userId = user.id;

    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase
        .from("passengers")
        .select("is_verified,verified,verification_tier,night_allowed")
        .eq(col, val)
        .limit(1)
        .maybeSingle();

      if (!r?.error && r?.data) {
        const row: any = r.data;
        const ok =
          truthy(row.is_verified) ||
          truthy(row.verified) ||
          truthy(row.verification_tier) ||
          truthy(row.night_allowed);

        return {
          verified: ok,
          verification_status: ok ? "verified" : null,
          source: "passengers_fallback"
        };
      }
    }
  } catch {
    // ignore
  }

  return { verified: false, verification_status: null, source: null };
}

async function computeWallet(supabase: any, user: any): Promise<{ wallet_ok?: boolean; wallet_locked?: boolean; wallet_balance?: number | null; min_wallet_required?: number | null }> {
  if (!user?.id) return {};

  try {
    const email = user?.email ?? null;
    const userId = user.id;

    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase
        .from("passengers")
        .select("wallet_balance,min_wallet_required,wallet_locked")
        .eq(col, val)
        .limit(1)
        .maybeSingle();

      if (r?.error) break; // fail-open
      if (r?.data) {
        const row: any = r.data;
        const locked = row.wallet_locked === true;
        const bal = (typeof row.wallet_balance === "number") ? row.wallet_balance : null;
        const min = (typeof row.min_wallet_required === "number") ? row.min_wallet_required : null;

        if (locked) {
          return { wallet_ok: false, wallet_locked: true, wallet_balance: bal, min_wallet_required: min };
        }
        if (typeof bal === "number" && typeof min === "number") {
          return { wallet_ok: bal >= min, wallet_locked: false, wallet_balance: bal, min_wallet_required: min };
        }
        return { wallet_ok: true, wallet_locked: false, wallet_balance: bal, min_wallet_required: min };
      }
    }
  } catch {
    // ignore
  }

  return {};
}

export async function GET(req: Request) {
  const supabase = createClient();

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (userErr || !user?.id) {
    return NextResponse.json({ ok: true, authed: false }, { status: 200 });
  }

  const url = new URL(req.url);
  const town = String(url.searchParams.get("town") || "").trim();

  const hour = manilaHour();
  const nightGate = hour >= 20 || hour < 5;

  const v = await computeVerified(supabase as any, user);
  const w = await computeWallet(supabase as any, user);

  // NOTE: /can-book is informational; it should not hard-block booking insert by itself.
  // It provides a consistent "verified" signal for the UI.
  const code =
    (nightGate && !v.verified) ? "NIGHT_GATE_UNVERIFIED" : null;

  const message =
    code === "NIGHT_GATE_UNVERIFIED"
      ? "Booking is restricted from 8PM to 5AM unless verified."
      : null;

  return NextResponse.json(
    {
      ok: true,
      authed: true,
      town,
      hour,
      window: "20:00-05:00",
      nightGate,
      verified: v.verified,
      verification_status: v.verification_status,
      verification_source: v.source,
      code,
      message,
      ...w
    },
    { status: 200 }
  );
}