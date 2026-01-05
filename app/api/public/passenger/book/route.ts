import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";


function inIfugaoBBox(lat: number, lng: number): boolean {
  // Conservative backend geofence (matches UI)
  return lat >= 16.5 && lat <= 17.2 && lng >= 120.8 && lng <= 121.4;
}
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

type BookReq = {
  passenger_name?: string | null;
  town?: string | null;

  from_label?: string | null;
  to_label?: string | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;

  service?: string | null;
};

function codeNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  return `${y}${m}${day}${hh}${mm}${ss}`;
}

function rand4() {
  return Math.floor(Math.random() * 10000).toString().padStart(4, "0");
}

async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const out: any = { ok: true };

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes?.user;

  let verified = false;
  if (user) {
    const email = user.email ?? null;
    const userId = user.id;
    const selV = "is_verified,verified,verification_tier";
    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase.from("passengers").select(selV).eq(col, val).limit(1).maybeSingle();
      if (!r.error && r.data) {
        const row: any = r.data;
        const truthy = (v: any) =>
          v === true ||
          (typeof v === "string" && v.trim().toLowerCase() !== "" && v.trim().toLowerCase() !== "false") ||
          (typeof v === "number" && v > 0);
        verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
        break;
      }
    }
  }

  if (nightGate && !verified) {
    out.ok = false;
    out.status = 403;
    out.code = "NIGHT_GATE_UNVERIFIED";
    out.message = "Booking is restricted from 8PM to 5AM unless verified.";
    throw out;
  }

  if (user) {
    const email = user.email ?? null;
    const userId = user.id;
    const selW = "wallet_balance,min_wallet_required,wallet_locked";
    const tries: Array<["auth_user_id" | "user_id" | "email", string | null]> = [
      ["auth_user_id", userId],
      ["user_id", userId],
      ["email", email],
    ];

    for (const [col, val] of tries) {
      if (!val) continue;
      const r = await supabase.from("passengers").select(selW).eq(col, val).limit(1).maybeSingle();
      if (r.error) break; // fail-open
      if (r.data) {
        const row: any = r.data;
        const locked = row.wallet_locked === true;
        const bal = typeof row.wallet_balance === "number" ? row.wallet_balance : null;
        const min = typeof row.min_wallet_required === "number" ? row.min_wallet_required : null;

        if (locked) {
          out.ok = false;
          out.status = 402;
          out.code = "WALLET_LOCKED";
          out.message = "Wallet is locked.";
          throw out;
        }
        if (typeof bal === "number" && typeof min === "number" && bal < min) {
          out.ok = false;
          out.status = 402;
          out.code = "WALLET_INSUFFICIENT";
          out.message = "Insufficient wallet balance.";
          throw out;
        }
        break;
      }
    }
  }

  return true;
}

async function getBaseUrlFromHeaders(req: Request) {
  const h = req.headers;
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as BookReq;

  // PHASE13-B_BACKEND_GEO_GATE
  // Booking must include location and must be inside Ifugao (conservative bbox).
  const lat = Number((body as any)?.pickup_lat);
  const lng = Number((body as any)?.pickup_lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json(
      { ok: false, code: "GEO_REQUIRED", message: "Location is required to book a ride." },
      { status: 400 }
    );
  }

  if (!inIfugaoBBox(lat, lng)) {
    return NextResponse.json(
      { ok: false, code: "GEO_OUTSIDE_IFUGAO", message: "Booking is only allowed inside Ifugao." },
      { status: 403 }
    );
  }


  try {
    await canBookOrThrow(supabase);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: e.code || "CAN_BOOK_FAILED", message: e.message || "Not allowed" },
      { status: e.status || 403 }
    );
  }

  const booking_code = `JR-UI-${codeNow()}-${rand4()}`;

  const payload: any = {
    booking_code,
    passenger_name: body.passenger_name ?? null,
    from_label: body.from_label ?? null,
    to_label: body.to_label ?? null,
    town: body.town ?? null,
    pickup_lat: body.pickup_lat ?? null,
    pickup_lng: body.pickup_lng ?? null,
    dropoff_lat: body.dropoff_lat ?? null,
    dropoff_lng: body.dropoff_lng ?? null,
    status: "requested",
  };

  const ins = await supabase.from("bookings").insert(payload).select("*").maybeSingle();
  if (ins.error) {
    const payload2: any = { ...payload };
    delete payload2.status;

    const ins2 = await supabase.from("bookings").insert(payload2).select("*").maybeSingle();
    if (ins2.error) {
      console.error("[passenger/book] insert error", ins2.error);
      return NextResponse.json({ ok: false, code: "BOOKING_INSERT_FAILED", message: ins2.error.message }, { status: 500 });
    }

    let booking: any = ins2.data;

    // best-effort set status requested
    await supabase.from("bookings").update({ status: "requested" }).eq("id", String(booking.id));

    // Phase 6H2: CALL DISPATCH ASSIGN (single source of truth, includes busy lock)
    const baseUrl = await getBaseUrlFromHeaders(req);
    let assign: any = { ok: false, note: "Assignment skipped." };
    try {
      const resp = await fetch(`${baseUrl}/api/dispatch/assign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ booking_id: String(booking.id) }),
      });
      const j = await resp.json().catch(() => ({}));
      assign = j;
    } catch (err: any) {
      assign = { ok: false, note: "Assign call failed: " + String(err?.message || err) };
    }

    // re-read booking for final status/driver_id
    const reread = await supabase.from("bookings").select("*").eq("id", String(booking.id)).maybeSingle();
    if (!reread.error && reread.data) booking = reread.data;

    return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign }, { status: 200 });
  }

  let booking: any = ins.data;

  // Phase 6H2: CALL DISPATCH ASSIGN (single source of truth, includes busy lock)
  const baseUrl = await getBaseUrlFromHeaders(req);
  let assign: any = { ok: false, note: "Assignment skipped." };
  try {
    const resp = await fetch(`${baseUrl}/api/dispatch/assign`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ booking_id: String(booking.id) }),
    });
    const j = await resp.json().catch(() => ({}));
    assign = j;
  } catch (err: any) {
    assign = { ok: false, note: "Assign call failed: " + String(err?.message || err) };
  }

  // re-read booking for final status/driver_id
  const reread = await supabase.from("bookings").select("*").eq("id", String(booking.id)).maybeSingle();
  if (!reread.error && reread.data) booking = reread.data;

  return NextResponse.json({ ok: true, env: jrideEnvEcho(), booking_code, booking, assign }, { status: 200 });
}

