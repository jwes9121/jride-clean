import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createSupabaseServerClient } from "@/utils/supabase/server";
const __JRIDE_WANT_DRIVER_SECRET__ = String(
  (process.env.JRIDE_DRIVER_SECRET ?? process.env.DRIVER_PING_SECRET ?? process.env.DRIVER_API_SECRET ?? "")
).trim();

function jOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}
function jErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, code, message, ...(extra || {}) }, { status });
}

function normTown(s: any) {
  return String(s ?? "").trim().toLowerCase();
}
function isUuidLike(s: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s ?? "").trim());
}

function getAdminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function allowRequest(req: Request): Promise<{ ok: boolean; mode?: string; user_id?: string | null }> {
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_ASSIGN || "").trim() === "1";
  if (allowUnauth) return { ok: true, mode: "allowUnauth", user_id: null };

  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(
    req.headers.get("x-jride-admin-secret") ||
    req.headers.get("x-admin-secret") ||
    ""
  ).trim();

  const secretOk = Boolean(wantSecret) && Boolean(gotSecret) && gotSecret === wantSecret;
  if (secretOk) return { ok: true, mode: "adminSecret", user_id: null };

  // Browser admin UI lane: allow valid Supabase session (cookie)
  try {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase.auth.getUser();
    const uid = data?.user?.id ?? null;
    if (uid) return { ok: true, mode: "session", user_id: uid };
  } catch {
    // ignore
  }

  return { ok: false };
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  try {
    const gate = await allowRequest(req);
    if (!gate.ok) {
      return jErr("UNAUTHORIZED", "Not authenticated (admin secret or valid session required).", 401);
    }

    const body = await req.json().catch(() => ({} as any));
    const booking_code = String(body?.booking_code ?? body?.bookingCode ?? "").trim();
    const booking_id = String(body?.booking_id ?? body?.bookingId ?? "").trim();
    const requested_driver_id = String(body?.driver_id ?? body?.driverId ?? "").trim();

    if (!booking_code && !booking_id) {
      return jErr("BAD_REQUEST", "Provide booking_code or booking_id.", 400);
    }
    if (requested_driver_id && !isUuidLike(requested_driver_id)) {
      return jErr("BAD_REQUEST", "driver_id must be a UUID.", 400);
    }

    const admin = getAdminClient();

    // 1) Load booking
    const bookingSel =
      "id, booking_code, status, town, created_at, updated_at, assigned_driver_id, assigned_at, driver_id";
    let booking: any = null;

    if (booking_id) {
      const { data, error } = await admin
        .from("bookings")
        .select(bookingSel)
        .eq("id", booking_id)
        .limit(1);
      if (error) return jErr("DB_SELECT_BOOKING", error.message, 500);
      booking = Array.isArray(data) && data.length ? data[0] : null;
    } else {
      const { data, error } = await admin
        .from("bookings")
        .select(bookingSel)
        .eq("booking_code", booking_code)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return jErr("DB_SELECT_BOOKING", error.message, 500);
      booking = Array.isArray(data) && data.length ? data[0] : null;
    }

    if (!booking) {
      return jErr("BOOKING_NOT_FOUND", "Booking not found.", 404, { booking_code, booking_id });
    }

    const bTown = normTown(booking.town);
    const bStatus = String(booking.status ?? "").trim();

    // Only assign from these statuses (adjust if needed)
    const assignable = new Set(["requested", "booked_ok", "booked", "pending", "created", ""]);
    if (!assignable.has(bStatus)) {
      return jErr("NOT_ASSIGNABLE", "Booking status is not assignable.", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        status: bStatus,
      });
    }

    // 2) Determine candidate drivers from driver_locations
    const cutoffMinutes = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
    const cutoffIso = new Date(Date.now() - cutoffMinutes * 60 * 1000).toISOString();

    const { data: locs, error: locErr } = await admin
      .from("driver_locations")
      .select("driver_id, status, updated_at, town, home_town")
      .eq("status", "online")
      .gte("updated_at", cutoffIso)
      .order("updated_at", { ascending: false })
      .limit(200);

    if (locErr) return jErr("DB_SELECT_LOCATIONS", locErr.message, 500);

    const allOnline = (Array.isArray(locs) ? locs : []).filter((r: any) => isUuidLike(r?.driver_id));
    const townMatches = bTown
      ? allOnline.filter((r: any) => {
          const t1 = normTown(r?.town);
          const t2 = normTown(r?.home_town);
          return t1 === bTown || t2 === bTown;
        })
      : allOnline;

    const counts = {
      cutoff_minutes: cutoffMinutes,
      online_recent: allOnline.length,
      online_town_recent: townMatches.length,
      booking_town: booking.town ?? null,
    };

    let chosenDriverId = requested_driver_id || "";
    if (!chosenDriverId) {
      chosenDriverId = (townMatches.length ? townMatches : allOnline)[0]?.driver_id || "";
    }

    if (!chosenDriverId) {
      return jErr("NO_AVAILABLE_DRIVER", "No ONLINE drivers with recent location updates.", 409, counts);
    }

    // 3) Confirm chosen driver exists in driver_profiles
    const { data: prof, error: profErr } = await admin
      .from("driver_profiles")
      .select("driver_id, full_name, municipality")
      .eq("driver_id", chosenDriverId)
      .limit(1);

    if (profErr) return jErr("DB_SELECT_DRIVER_PROFILE", profErr.message, 500, { driver_id: chosenDriverId, counts });
    if (!Array.isArray(prof) || !prof.length) {
      return jErr("DRIVER_PROFILE_MISSING", "Chosen driver_id not found in driver_profiles.", 409, {
        driver_id: chosenDriverId,
        counts,
      });
    }

    // 4) Assign booking (atomic-ish: only if not already assigned)
    const patch: any = {
      status: "assigned",
      assigned_driver_id: chosenDriverId,
      assigned_at: new Date().toISOString(),
    };

    const { data: upd, error: updErr } = await admin
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .is("assigned_driver_id", null)
      .is("assigned_at", null)
      .select(bookingSel)
      .limit(1);

    if (updErr) {
      console.error("DISPATCH_ASSIGN_UPDATE_ERROR", { message: updErr.message, booking_id: booking.id, booking_code: booking.booking_code });
      return jErr("DB_UPDATE_ASSIGN", updErr.message, 500, { booking_id: booking.id, booking_code: booking.booking_code, driver_id: chosenDriverId });
    }

    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;
    if (!updated) {
      return jErr("ASSIGN_RACE_LOST", "Booking was already assigned or changed.", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        driver_id: chosenDriverId,
      });
    }

    return jOk({
      ok: true,
      assign_ok: true,
      booking_id: updated.id,
      booking_code: updated.booking_code,
      assigned_driver_id: chosenDriverId,
      counts,
      ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    console.error("DISPATCH_ASSIGN_FATAL", e);
    return jErr("SERVER_ERROR", String(e?.message || e), 500, { ms: Date.now() - startedAt });
  }
}