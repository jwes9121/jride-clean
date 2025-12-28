import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const q = s1 * s1 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(q)));
}

function pickCoord(row: any) {
  const lat =
    typeof row.lat === "number" ? row.lat :
    typeof row.latitude === "number" ? row.latitude :
    typeof row.pickup_lat === "number" ? row.pickup_lat :
    null;

  const lng =
    typeof row.lng === "number" ? row.lng :
    typeof row.longitude === "number" ? row.longitude :
    typeof row.pickup_lng === "number" ? row.pickup_lng :
    null;

  return { lat, lng };
}

function pickTown(row: any) {
  const t = (row.town ?? row.zone ?? row.home_town ?? row.municipality ?? row.city ?? null);
  return t ? String(t) : null;
}

function pickOnline(row: any) {
  const v = row.status ?? row.driver_status ?? row.state ?? row.availability ?? null;
  if (v === null || v === undefined) return { hasField: false, isOnline: true, raw: null };
  const s = String(v).trim().toLowerCase();
  const online = s === "online" || s === "available" || s === "idle" || s === "active";
  const notOnline = s === "offline" || s === "on_trip" || s === "busy" || s === "assigned";
  return { hasField: true, isOnline: online && !notOnline, raw: s };
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

async function bestEffortUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
) {
  const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
  if (r.error) return { ok: false, error: r.error.message, data: null as any };
  return { ok: true, error: null as any, data: r.data };
}

async function findNearestDriverSmart(
  supabase: ReturnType<typeof createClient>,
  town: string,
  pickup_lat: number,
  pickup_lng: number
) {
  const r = await supabase.from("driver_locations").select("*").limit(500);
  if (r.error) return { driver_id: null as string | null, note: "driver_locations_latest query failed: " + r.error.message };

  const rows = Array.isArray(r.data) ? r.data : [];
  let best: { driver_id: string; km: number } | null = null;

  let usedTownField = false;
  let statusFieldSeen = false;

  for (const row of rows) {
    const dId = row.driver_id ? String(row.driver_id) : "";
    if (!dId) continue;

    const t = pickTown(row);
    if (t !== null) usedTownField = true;
    if (t !== null && t !== town) continue;

    const st = pickOnline(row);
    if (st.hasField) statusFieldSeen = true;
    if (st.hasField && !st.isOnline) continue;

    const c = pickCoord(row);
    if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;

    const km = haversineKm(pickup_lat, pickup_lng, c.lat, c.lng);
    if (!best || km < best.km) best = { driver_id: dId, km };
  }

  if (!best) {
    let note = "No eligible drivers found.";
    if (!usedTownField) note += " (No town/zone field detected; could not filter by town.)";
    if (!statusFieldSeen) note += " (No status field detected; could not filter online only.)";
    return { driver_id: null as string | null, note };
  }

  let note = "Nearest driver selected (km=" + best.km.toFixed(3) + ").";
  if (!statusFieldSeen) note += " Note: no status field detected; selection may include offline drivers.";
  if (!usedTownField) note += " Note: no town field detected; selection not town-filtered.";
  return { driver_id: best.driver_id, note };
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as BookReq;

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

    const booking: any = ins2.data;

    await bestEffortUpdateBooking(supabase, String(booking.id), { status: "requested" });

    const town = String(booking.town || body.town || "");
    const pLat = booking.pickup_lat;
    const pLng = booking.pickup_lng;

    let assign: any = { ok: false, note: "Assignment skipped." };
    if (town && typeof pLat === "number" && typeof pLng === "number") {
      const pick = await findNearestDriverSmart(supabase, town, pLat, pLng);
      if (pick.driver_id) {
        const upd = await bestEffortUpdateBooking(supabase, String(booking.id), { driver_id: pick.driver_id, status: "assigned" });
        assign = { ok: true, driver_id: pick.driver_id, note: pick.note, update_ok: upd.ok, update_error: upd.error };
      } else {
        assign = { ok: false, note: pick.note };
      }
    }

    return NextResponse.json({ ok: true, booking_code, booking: booking ?? null, assign }, { status: 200 });
  }

  const booking: any = ins.data;

  const town = String(booking.town || body.town || "");
  const pLat = booking.pickup_lat;
  const pLng = booking.pickup_lng;

  let assign: any = { ok: false, note: "Assignment skipped." };
  if (town && typeof pLat === "number" && typeof pLng === "number") {
    const pick = await findNearestDriverSmart(supabase, town, pLat, pLng);
    if (pick.driver_id) {
      const upd = await bestEffortUpdateBooking(supabase, String(booking.id), { driver_id: pick.driver_id, status: "assigned" });
      assign = { ok: true, driver_id: pick.driver_id, note: pick.note, update_ok: upd.ok, update_error: upd.error };
    } else {
      assign = { ok: false, note: pick.note };
    }
  }

  return NextResponse.json({ ok: true, booking_code, booking: booking ?? null, assign }, { status: 200 });
}