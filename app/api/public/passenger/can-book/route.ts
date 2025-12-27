import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type CanBookReq = {
  town?: string | null;
  service?: string | null;
};

function manilaNowParts() {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);
  return { hour, minute };
}

function isNightGateNow() {
  const { hour } = manilaNowParts();
  return hour >= 20 || hour < 5;
}

function truthy(v: any) {
  if (v === true) return true;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "yes" || t === "verified" || t === "tier1" || t === "tier2") return true;
  }
  if (typeof v === "number") return v > 0;
  return false;
}

async function resolvePassengerVerification(supabase: ReturnType<typeof createClient>) {
  const out = { verified: false, source: "none" as "none" | "passengers", note: "" as string };
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (!user) {
    out.note = "No auth user (not signed in).";
    return out;
  }

  const email = user.email ?? null;
  const userId = user.id;

  const selectors = "is_verified,verified,verification_tier";

  async function tryQuery(filterCol: "auth_user_id" | "user_id" | "email", filterVal: string) {
    return await supabase.from("passengers").select(selectors).eq(filterCol, filterVal).limit(1).maybeSingle();
  }

  {
    const r = await tryQuery("auth_user_id", userId);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.auth_user_id";
      return out;
    }
  }

  {
    const r = await tryQuery("user_id", userId);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.user_id";
      return out;
    }
  }

  if (email) {
    const r = await tryQuery("email", email);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.email";
      return out;
    }
  }

  out.note = "Could not resolve verification from passengers (no match, schema differs, or RLS blocked). Defaulting to unverified.";
  return out;
}

async function resolvePassengerWallet(supabase: ReturnType<typeof createClient>) {
  // Safe probing. We do NOT assume columns exist. If query fails (missing columns/RLS), we return a note.
  const out = {
    ok: true,
    wallet_locked: false,
    wallet_balance: null as number | null,
    min_wallet_required: null as number | null,
    source: "none" as "none" | "passengers",
    note: "" as string,
  };

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (!user) {
    out.source = "none";
    out.note = "No auth user (not signed in). Wallet precheck not enforced.";
    return out;
  }

  const email = user.email ?? null;
  const userId = user.id;

  const selectors = "wallet_balance,min_wallet_required,wallet_locked";

  async function tryQuery(filterCol: "auth_user_id" | "user_id" | "email", filterVal: string) {
    return await supabase.from("passengers").select(selectors).eq(filterCol, filterVal).limit(1).maybeSingle();
  }

  // Try auth_user_id, then user_id, then email
  const tries: Array<["auth_user_id" | "user_id" | "email", string | null, string]> = [
    ["auth_user_id", userId, "Matched passengers.auth_user_id"],
    ["user_id", userId, "Matched passengers.user_id"],
    ["email", email, "Matched passengers.email"],
  ];

  for (const [col, val, label] of tries) {
    if (!val) continue;

    const r = await tryQuery(col, val);

    if (r.error) {
      // Missing columns or RLS or no passengers table: fail-open, but tell the UI.
      out.source = "none";
      out.note = "Wallet probe failed: " + r.error.message;
      return out;
    }

    if (r.data) {
      const row: any = r.data;
      const bal = typeof row.wallet_balance === "number" ? row.wallet_balance : null;
      const min = typeof row.min_wallet_required === "number" ? row.min_wallet_required : null;
      const locked = row.wallet_locked === true;

      out.source = "passengers";
      out.wallet_balance = bal;
      out.min_wallet_required = min;
      out.wallet_locked = locked;
      out.note = label;

      // Enforce only if we have enough info to enforce:
      // - If wallet_locked true => block
      // - If min and balance are numbers and balance < min => block
      if (locked) {
        out.ok = false;
        return out;
      }
      if (typeof bal === "number" && typeof min === "number" && bal < min) {
        out.ok = false;
        return out;
      }

      out.ok = true;
      return out;
    }
  }

  out.source = "none";
  out.note = "No matching passenger row for wallet precheck (or schema differs). Wallet precheck not enforced.";
  return out;
}

export async function GET() {
  const supabase = createClient();

  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);
  const w = await resolvePassengerWallet(supabase);

  return NextResponse.json(
    {
      ok: true,
      nightGate,
      window: "20:00-05:00 Asia/Manila",
      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,

      wallet_ok: w.ok,
      wallet_locked: w.wallet_locked,
      wallet_balance: w.wallet_balance,
      min_wallet_required: w.min_wallet_required,
      wallet_source: w.source,
      wallet_note: w.note,
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as CanBookReq;

  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);
  const w = await resolvePassengerWallet(supabase);

  if (nightGate && !v.verified) {
    return NextResponse.json(
      {
        ok: false,
        code: "NIGHT_GATE_UNVERIFIED",
        message: "Booking is restricted from 8PM to 5AM unless verified.",
        nightGate: true,
        window: "20:00-05:00 Asia/Manila",
        verified: false,
        verification_source: v.source,
        verification_note: v.note,
      },
      { status: 403 }
    );
  }

  if (!w.ok) {
    return NextResponse.json(
      {
        ok: false,
        code: "WALLET_PRECHECK_FAILED",
        message: "Wallet precheck failed (locked or insufficient balance).",
        wallet_ok: false,
        wallet_locked: w.wallet_locked,
        wallet_balance: w.wallet_balance,
        min_wallet_required: w.min_wallet_required,
        wallet_source: w.source,
        wallet_note: w.note,
      },
      { status: 402 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      nightGate,
      allowed: true,
      town: body.town ?? null,
      service: body.service ?? null,

      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,

      wallet_ok: true,
      wallet_locked: w.wallet_locked,
      wallet_balance: w.wallet_balance,
      min_wallet_required: w.min_wallet_required,
      wallet_source: w.source,
      wallet_note: w.note,
    },
    { status: 200 }
  );
}