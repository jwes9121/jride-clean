import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type CanBookReq = {
  town?: string | null;
  service?: string | null;
  // legacy: verified?: boolean | null; (ignored in Phase 6B)
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
  // Night gate window: 20:00 - 05:00 (Asia/Manila)
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
  // Default: not verified (fail-safe)
  const out = {
    verified: false,
    source: "none" as "none" | "passengers",
    note: "" as string,
  };

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (!user) {
    out.note = "No auth user (not signed in).";
    return out;
  }

  const email = user.email ?? null;
  const userId = user.id;

  // We DO NOT assume your passengers schema. We try common patterns and fail safe if not found.
  // Pattern A: passengers.auth_user_id = user.id
  // Pattern B: passengers.user_id = user.id
  // Pattern C: passengers.email = user.email
  // Columns we try to read if present: is_verified, verified, verification_tier
  const selectors = "is_verified,verified,verification_tier";

  async function tryQuery(filterCol: "auth_user_id" | "user_id" | "email", filterVal: string) {
    const q = supabase.from("passengers").select(selectors).eq(filterCol, filterVal).limit(1).maybeSingle();
    return await q;
  }

  // Try auth_user_id
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

  // Try user_id
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

  // Try email
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

  // If we reached here, either no matching passenger row or schema differs or RLS blocks.
  out.note = "Could not resolve verification from passengers (no match, schema differs, or RLS blocked). Defaulting to unverified.";
  return out;
}

export async function GET() {
  const supabase = createClient();

  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);

  return NextResponse.json(
    {
      ok: true,
      nightGate,
      window: "20:00-05:00 Asia/Manila",
      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,
    },
    { status: 200 }
  );
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as CanBookReq;

  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);

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
    },
    { status: 200 }
  );
}