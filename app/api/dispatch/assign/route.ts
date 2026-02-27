import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { auth } from "@/auth";

function jsonOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}
function jsonErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, code, message, ...(extra || {}) }, { status });
}
function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function pickFirst(body: any, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    if (v !== undefined && v !== null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

async function requireDispatcherAuth(req: Request) {
  // Dev/testing escape hatch (ONLY for debugging):
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_ASSIGN || "").trim() === "1";

  // Optional secret gate for server-to-server/admin tooling
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(
    req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || ""
  ).trim();
  const secretOk = Boolean(wantSecret) && Boolean(gotSecret) && gotSecret === wantSecret;

  if (allowUnauth || secretOk) return { ok: true as const, mode: secretOk ? "secret" : "allowUnauth" };

  try {
    const session = await auth();
    const uid = (session as any)?.user?.id || (session as any)?.user?.email || null;
    if (!uid) return { ok: false as const, code: "UNAUTHORIZED", message: "Not authenticated" };
    return { ok: true as const, mode: "nextauth" };
  } catch {
    return { ok: false as const, code: "UNAUTHORIZED", message: "Not authenticated" };
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireDispatcherAuth(req);
    if (!gate.ok) return jsonErr(gate.code, gate.message, 401);

    const body = await req.json().catch(() => ({} as any));

    const bookingCode = pickFirst(body, ["bookingCode", "booking_code"]);
    const bookingId = pickFirst(body, ["bookingId", "booking_id"]);
    const requestedDriverId = pickFirst(body, ["driverId", "driver_id"]);

    if (!bookingCode && !bookingId) {
      return jsonErr("BOOKING_NOT_FOUND", "Missing booking_id or booking_code", 400);
    }
    if (requestedDriverId && !isUuidLike(requestedDriverId)) {
      return jsonErr("INVALID_DRIVER_ID", "Invalid driver_id/driverId (uuid)", 400);
    }

    const supabase = createClient();

    // 1) Load booking
    const bookingSel = "id, booking_code, status, town, created_at, assigned_at, assigned_driver_id, driver_id";
    let booking: any = null;

    if (bookingId) {
      const { data, error } = await supabase
        .from("bookings")
        .select(bookingSel)
        .eq("id", bookingId)
        .limit(1);
      if (error) return jsonErr("DB_SELECT_ERROR", error.message, 500);
      booking = Array.isArray(data) && data.length ? data[0] : null;
    } else {
      const { data, error } = await supabase
        .from("bookings")
        .select(bookingSel)
        .eq("booking_code", bookingCode)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error) return jsonErr("DB_SELECT_ERROR", error.message, 500);
      booking = Array.isArray(data) && data.length ? data[0] : null;
    }

    if (!booking) {
      return jsonErr("BOOKING_NOT_FOUND", "Booking not found", 404, {
        booking_id: bookingId || null,
        booking_code: bookingCode || null,
      });
    }

    const currentStatus = String(booking.status || "").trim();
    const allowedCurrent = ["requested", "booked_ok", "booked", "pending", "created", ""];

    if (!allowedCurrent.includes(currentStatus)) {
      return jsonErr("CANNOT_ASSIGN_FROM_STATUS", "Booking status is not assignable", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        current_status: currentStatus,
      });
    }

    // 2) Pick driver
    const town = String(booking.town || "").trim();
    let finalDriverId = requestedDriverId;

    // Auto-pick from driver_locations (your real online signal)
    if (!finalDriverId) {
      const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      // Prefer same town / home_town if present
      const { data: locs, error: locErr } = await supabase
        .from("driver_locations")
        .select("driver_id, updated_at, status, town, home_town")
        .eq("status", "online")
        .gte("updated_at", cutoffIso)
        .order("updated_at", { ascending: false })
        .limit(80);

      if (locErr) return jsonErr("DB_LOCATIONS_ERROR", locErr.message, 500);

      const candidates = (Array.isArray(locs) ? locs : [])
        .map((r: any) => ({
          driver_id: String(r?.driver_id || "").trim(),
          town: String(r?.town || "").trim(),
          home_town: String(r?.home_town || "").trim(),
        }))
        .filter((r: any) => isUuidLike(r.driver_id));

      // town-first filter
      const townMatches = town
        ? candidates.filter((c: any) => c.town === town || c.home_town === town)
        : candidates;

      const chosen = (townMatches.length ? townMatches : candidates)[0];
      finalDriverId = chosen?.driver_id || "";
    }

    if (!finalDriverId) {
      return jsonErr("NO_AVAILABLE_DRIVER", "No ONLINE drivers with recent location updates.", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        town,
      });
    }

    // 3) Confirm driver exists in driver_profiles (prevents junk IDs)
    const { data: prof, error: profErr } = await supabase
      .from("driver_profiles")
      .select("driver_id, municipality, full_name")
      .eq("driver_id", finalDriverId)
      .limit(1);

    if (profErr) return jsonErr("DB_DRIVERPROFILE_ERROR", profErr.message, 500);
    if (!Array.isArray(prof) || !prof.length) {
      return jsonErr("DRIVER_NOT_FOUND", "Chosen driver_id not found in driver_profiles", 409, {
        driver_id: finalDriverId,
      });
    }

    // 4) Atomic assign
    const patch: any = {
      assigned_driver_id: finalDriverId,
      assigned_at: new Date().toISOString(),
      status: "assigned",
    };

    const { data: upd, error: updErr } = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .in("status", allowedCurrent)
      .is("assigned_driver_id", null)
      .is("assigned_at", null)
      .select(bookingSel)
      .limit(1);

    if (updErr) return jsonErr("DB_UPDATE_ERROR", updErr.message, 500, { booking_id: booking.id });

    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;
    if (!updated) {
      return jsonErr("ASSIGN_RACE_LOST", "Booking was already assigned or status changed.", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
      });
    }

    return jsonOk({
      ok: true,
      note: "ASSIGNED_OK",
      booking_id: updated.id,
      booking_code: updated.booking_code,
      assigned_driver_id: finalDriverId,
      updated,
    });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", String(e?.message || e), 500);
  }
}