import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

/* JRIDE_ENV_ECHO */
function jrideEnvEcho() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let host = "";
  try { host = u ? new URL(u).host : ""; } catch { host = ""; }
  return {
    supabase_host: host || null,
    vercel_env: process.env.VERCEL_ENV || null,
    nextauth_url: process.env.NEXTAUTH_URL || null
  };
}
/* JRIDE_ENV_ECHO_END */

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
  const out = {
    verified: false,
    source: "none" as "none" | "passengers" | "passenger_verifications",
    note: "" as string,
    status: "not_submitted" as "not_submitted" | "submitted" | "pending_admin" | "verified" | "rejected",
    raw_status: "" as string,
  };

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  if (!user) {
    out.note = "No auth user (not signed in).";
    return out;
  }

  const email = user.email ?? null;
  const userId = user.id;

  function mapRawStatus(raw: any): "not_submitted" | "submitted" | "pending_admin" | "verified" | "rejected" {
    const s = String(raw || "").trim();
    const u = s.toLowerCase();
    if (!u) return "not_submitted";
    if (u === "approved_admin") return "verified";
    if (u === "pre_approved_dispatcher") return "pending_admin";
    if (u === "pending") return "submitted";
    if (u === "rejected") return "rejected";
    if (u.indexOf("approved") >= 0) return "verified";
    if (u.indexOf("pre_approved") >= 0) return "pending_admin";
    if (u.indexOf("pending") >= 0) return "submitted";
    if (u.indexOf("reject") >= 0) return "rejected";
    return "submitted";
  }

  async function trySelectFromPassengerVerifications(): Promise<boolean> {
    const table = "passenger_verifications";
    const selectors = ["status,updated_at", "status,created_at", "status"];
    const keys = ["user_id", "passenger_id"];

    for (let i = 0; i < selectors.length; i++) {
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        try {
          const query: any = (supabase as any).from(table)
  .select(selectors[i])
  .eq(key as any, userId)
  .order("updated_at", { ascending: false })
  .limit(1);

const { data, error } = await query;

          if (!error && data && (data as any[]).length > 0) {
            const row: any = (data as any[])[0];
            const raw = String(row.status || "");
            out.raw_status = raw;
            out.status = mapRawStatus(raw);
            out.source = "passenger_verifications";
            out.note = "Matched passenger_verifications." + key;
            out.verified = (out.status === "verified");
            return true;
          }
        } catch {
          // ignore
        }
      }
    }
    return false;
  }

  const gotPipeline = await trySelectFromPassengerVerifications();
  if (gotPipeline) return out;

  // Fallback to passengers table (legacy verified flag)
  const selectors = "is_verified,verified,verification_tier";

  async function tryQuery(col: string, val: any) {
    try {
      const { data, error } = await (supabase as any).from("passengers")
        .select(selectors)
        .eq(col as any, val)
        .limit(1)
        .maybeSingle();
      return { data, error };
    } catch (e: any) {
      return { data: null, error: e };
    }
  }

  const rId = await tryQuery("id", userId);
  if (!rId.error && rId.data) {
    const row: any = rId.data;
    out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
    out.source = "passengers";
    out.note = "Matched passengers.id";
    out.status = out.verified ? "verified" : "not_submitted";
    return out;
  }

  if (email) {
    const r = await tryQuery("email", email);
    if (!r.error && r.data) {
      const row: any = r.data;
      out.verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
      out.source = "passengers";
      out.note = "Matched passengers.email";
      out.status = out.verified ? "verified" : "not_submitted";
      return out;
    }
  }

  out.note = "Could not resolve verification (no match, schema differs, or RLS blocked). Defaulting to unverified.";
  out.status = "not_submitted";
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
    return await (supabase as any).from("passengers").select(selectors).eq(filterCol, filterVal).limit(1).maybeSingle();
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
  // JRIDE_UNVERIFIED_ONE_DAY_RIDE_V1D
  // Policy:
  // - Unverified: allow ONE daytime ride
  // - Unverified: block at night
  // - After first ride: verification required
  if (!v.verified) {
    const night = isNightGateNow();

    if (night) {
      return NextResponse.json(
        { allowed: false, reason: "UNVERIFIED_NIGHT_BLOCKED", message: "Night bookings require passenger verification." },
        { status: 200 }
      );
    }

    const firstRide = await resolvePassengerFirstRideUsage(supabase);

    if (firstRide.used) {
      return NextResponse.json(
        {
          allowed: false,
          reason: "UNVERIFIED_LIMIT_REACHED",
          message: "You have already used your one daytime ride. Please complete verification to book again.",
          meta: { firstRide }
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        reason: "UNVERIFIED_ONE_DAY_RIDE_ALLOWED",
        message: "You may book one daytime ride. Verification will be required for your next booking.",
        meta: { firstRide }
      },
      { status: 200 }
    );
  }

  const w = await resolvePassengerWallet(supabase);

  return NextResponse.json({
  env: jrideEnvEcho(),
      ok: true,
      nightGate,
      window: "20:00-05:00 Asia/Manila",
      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,

      
      verification_status: v.status,
      verification_raw_status: v.raw_status,wallet_ok: w.ok,
      wallet_locked: w.wallet_locked,
      wallet_balance: w.wallet_balance,
      min_wallet_required: w.min_wallet_required,
      wallet_source: w.source,
      wallet_note: w.note,
    },
    { status: 200 }
  );
}

async function resolvePassengerFirstRideUsage(supabase: any) {
  // Determine if passenger already used their 1 daytime ride.
  // We do NOT assume schema, so we try multiple possible passenger linkage columns.
  const out = {
    ok: true,
    used: false,
    count: null as number | null,
    note: "",
    source: "none" as "none" | "bookings"
  };

  let userId: string | null = null;
  let email: string | null = null;

  try {
    const { data } = await supabase.auth.getUser();
    userId = data?.user?.id ?? null;
    email = data?.user?.email ?? null;
  } catch {
    // ignore
  }

  if (!userId && !email) {
    out.note = "No auth user; default allow one daytime ride.";
    return out;
  }

  const statuses = ["pending","assigned","on_the_way","on_trip","completed"];

  const candidates: Array<{ col: string; val: string | null; label: string }> = [
    { col: "passenger_id", val: userId, label: "bookings.passenger_id" },
    { col: "rider_id", val: userId, label: "bookings.rider_id" },
    { col: "user_id", val: userId, label: "bookings.user_id" },
    { col: "auth_user_id", val: userId, label: "bookings.auth_user_id" },
    { col: "passenger_user_id", val: userId, label: "bookings.passenger_user_id" },
    { col: "email", val: email, label: "bookings.email" },
    { col: "passenger_email", val: email, label: "bookings.passenger_email" }
  ];

  for (const c of candidates) {
    if (!c.val) continue;
    try {
      const resp = await supabase
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq(c.col, c.val)
        .in("status", statuses);

      if (!resp?.error) {
        const cnt = (typeof resp.count === "number") ? resp.count : null;
        out.source = "bookings";
        out.count = cnt;
        out.used = (typeof cnt === "number") ? (cnt >= 1) : false;
        out.note = "Matched " + c.label;
        return out;
      }
    } catch {
      // try next candidate
    }
  }

  out.note = "Could not probe bookings (schema/RLS); default allow one daytime ride.";
  out.used = false;
  return out;
}
export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as CanBookReq;

  // ---- JRIDE local verification bypass (can-book only) ----
  // If local_verification_code matches JRIDE_LOCAL_VERIFY_CODE, bypass the verification gate in this endpoint only.
  const expectedLocal = String(process.env.JRIDE_LOCAL_VERIFY_CODE || "").trim();
  const providedLocal = String((body as any)?.local_verification_code || (body as any)?.local_verify || "").trim();
  const localOk = !!expectedLocal && !!providedLocal && (providedLocal === expectedLocal);
  // --------------------------------------------------------


  const nightGate = isNightGateNow();
  const v = await resolvePassengerVerification(supabase);
  // JRIDE_UNVERIFIED_ONE_DAY_RIDE_V1D
  // Policy:
  // - Unverified: allow ONE daytime ride
  // - Unverified: block at night
  // - After first ride: verification required
  if (!v.verified) {
    const night = isNightGateNow();

    if (night) {
      return NextResponse.json(
        { allowed: false, reason: "UNVERIFIED_NIGHT_BLOCKED", message: "Night bookings require passenger verification." },
        { status: 200 }
      );
    }

    const firstRide = await resolvePassengerFirstRideUsage(supabase);

    if (firstRide.used) {
      return NextResponse.json(
        {
          allowed: false,
          reason: "UNVERIFIED_LIMIT_REACHED",
          message: "You have already used your one daytime ride. Please complete verification to book again.",
          meta: { firstRide }
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        allowed: true,
        reason: "UNVERIFIED_ONE_DAY_RIDE_ALLOWED",
        message: "You may book one daytime ride. Verification will be required for your next booking.",
        meta: { firstRide }
      },
      { status: 200 }
    );
  }

  const w = await resolvePassengerWallet(supabase);
  // Authoritative verification gate:
  // - If not verified, booking is blocked at all times.
  // - Night gate just changes the message/code (still blocked when unverified).
  if (!v.verified && !localOk) {
    const code = nightGate ? "NIGHT_GATE_UNVERIFIED" : "VERIFICATION_REQUIRED";
    const message = nightGate
      ? "Booking is restricted from 8PM to 5AM unless verified."
      : "Please verify your passenger account before booking.";

    return NextResponse.json(
      {
        env: jrideEnvEcho(),
        ok: false,
        local_bypass_used: localOk,
        allowed: false,
        code,
        message,
        nightGate: !!nightGate,
        window: "20:00-05:00 Asia/Manila",
        verified: false,
        verification_source: v.source,
        verification_note: v.note,
        verification_status: v.status,
        verification_raw_status: v.raw_status
      },
      { status: 403 }
    );
  }
if (!w.ok) {
    return NextResponse.json({
  env: jrideEnvEcho(),
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

  return NextResponse.json({
  env: jrideEnvEcho(),
      ok: true,
      local_bypass_used: localOk,
      nightGate,
      allowed: true,
      town: body.town ?? null,
      service: body.service ?? null,

      verified: v.verified,
      verification_source: v.source,
      verification_note: v.note,

      
      verification_status: v.status,
      verification_raw_status: v.raw_status,wallet_ok: true,
      wallet_locked: w.wallet_locked,
      wallet_balance: w.wallet_balance,
      min_wallet_required: w.min_wallet_required,
      wallet_source: w.source,
      wallet_note: w.note,
    },
    { status: 200 }
  );
}

