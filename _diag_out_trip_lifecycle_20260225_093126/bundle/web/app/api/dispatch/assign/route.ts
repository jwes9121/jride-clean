import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { auth } from "@/auth";

function jsonOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function jsonErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json(Object.assign({ ok: false, code, message }, extra || {}), { status });
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
  // Dev/testing escape hatch (do NOT enable in prod):
  const allowUnauth = String(process.env.JRIDE_ALLOW_UNAUTH_DISPATCH_ASSIGN || "").trim() === "1";

  // Optional secret gate for server-to-server/admin tooling (not for browser)
  const wantSecret = String(process.env.JRIDE_ADMIN_SECRET || "").trim();
  const gotSecret = String(
    req.headers.get("x-jride-admin-secret") || req.headers.get("x-admin-secret") || ""
  ).trim();
  const secretOk = Boolean(wantSecret) && Boolean(gotSecret) && gotSecret === wantSecret;

  if (allowUnauth || secretOk) return { ok: true as const, mode: secretOk ? "secret" : "allowUnauth" };

  // Primary gate: NextAuth session (works with your Google OAuth login)
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

    // Accept both camelCase and snake_case
    const bookingCode = pickFirst(body, ["bookingCode", "booking_code"]);
    const bookingId = pickFirst(body, ["bookingId", "booking_id"]);
    const driverId = pickFirst(body, ["driverId", "driver_id"]);

    if (!bookingCode && !bookingId) {
      return jsonErr("BOOKING_NOT_FOUND", "Missing booking_id or booking_code", 400);
    }

    // driverId optional:
    // - if provided: assign exactly that driver
    // - if missing: auto-pick an ONLINE driver with recent ping
    let finalDriverId = driverId;

    if (finalDriverId && !isUuidLike(finalDriverId)) {
      return jsonErr("INVALID_DRIVER_ID", "Invalid driver_id/driverId (uuid)", 400);
    }

    const supabase = createClient();

    // Fetch booking by id or code
    let booking: any = null;

    if (bookingId) {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_code, status, town, zone_id, assigned_at, assigned_driver_id, driver_id, created_at")
        .eq("id", bookingId)
        .limit(1);

      if (error) return jsonErr("DB_SELECT_ERROR", error.message, 500);
      booking = Array.isArray(data) && data.length ? data[0] : null;
    } else {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_code, status, town, zone_id, assigned_at, assigned_driver_id, driver_id, created_at")
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

    // permissive assignable statuses
    const allowedCurrent = ["requested", "booked_ok", "booked", "pending", "created", ""];

    if (allowedCurrent.indexOf(currentStatus) === -1) {
      return jsonErr("CANNOT_ASSIGN_FROM_STATUS", "Booking status is not assignable", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        current_status: currentStatus,
      });
    }

    async function pickOnlineDriverAuto(bookingRow: any): Promise<string> {
      const cutoffIso = new Date(Date.now() - 5 * 60 * 1000).toISOString();

      const { data: recentLocs, error: locErr } = await supabase
        .from("driver_locations_latest")
        .select("driver_id, updated_at")
        .gte("updated_at", cutoffIso)
        .order("updated_at", { ascending: false })
        .limit(60);

      if (locErr) throw new Error("driver_locations_latest query failed: " + locErr.message);

      const recentIds = (Array.isArray(recentLocs) ? recentLocs : [])
        .map((r: any) => String(r?.driver_id || "").trim())
        .filter((x: string) => isUuidLike(x));

      if (!recentIds.length) return "";

      // Prefer same zone_id if booking has one (if drivers.zone_id exists, it helps; otherwise fallback)
      let q = supabase
        .from("drivers")
        .select("id, driver_id, driver_status, updated_at, zone_id")
        .in("driver_status", ["ONLINE", "online"])
        .order("updated_at", { ascending: false })
        .limit(80);

      if (bookingRow?.zone_id) q = q.eq("zone_id", bookingRow.zone_id);

      const { data: drsZone, error: drErrZone } = await q;

      if (drErrZone) {
        const { data: drsAny, error: drErrAny } = await supabase
          .from("drivers")
          .select("id, driver_id, driver_status, updated_at")
          .in("driver_status", ["ONLINE", "online"])
          .order("updated_at", { ascending: false })
          .limit(120);

        if (drErrAny) throw new Error("drivers query failed: " + drErrAny.message);

        const rowsAny = Array.isArray(drsAny) ? drsAny : [];
        for (const d of rowsAny as any[]) {
          const a = String(d?.id || "").trim();
          const b = String(d?.driver_id || "").trim();
          if (isUuidLike(a) && recentIds.indexOf(a) >= 0) return a;
          if (isUuidLike(b) && recentIds.indexOf(b) >= 0) return b;
        }
        return "";
      }

      const rowsZone = Array.isArray(drsZone) ? drsZone : [];
      for (const d of rowsZone as any[]) {
        const a = String(d?.id || "").trim();
        const b = String(d?.driver_id || "").trim();
        if (isUuidLike(a) && recentIds.indexOf(a) >= 0) return a;
        if (isUuidLike(b) && recentIds.indexOf(b) >= 0) return b;
      }

      const { data: drsAny2, error: drErrAny2 } = await supabase
        .from("drivers")
        .select("id, driver_id, driver_status, updated_at")
        .in("driver_status", ["ONLINE", "online"])
        .order("updated_at", { ascending: false })
        .limit(120);

      if (drErrAny2) throw new Error("drivers query failed: " + drErrAny2.message);

      const rowsAny2 = Array.isArray(drsAny2) ? drsAny2 : [];
      for (const d of rowsAny2 as any[]) {
        const a = String(d?.id || "").trim();
        const b = String(d?.driver_id || "").trim();
        if (isUuidLike(a) && recentIds.indexOf(a) >= 0) return a;
        if (isUuidLike(b) && recentIds.indexOf(b) >= 0) return b;
      }

      return "";
    }

    if (!finalDriverId) {
      try {
        finalDriverId = await pickOnlineDriverAuto(booking);
      } catch (e: any) {
        return jsonErr("AUTO_PICK_FAILED", String(e?.message || e), 500);
      }
      if (!finalDriverId) {
        return jsonErr("NO_AVAILABLE_DRIVER", "No ONLINE drivers with recent location updates.", 409);
      }
    }

    // Atomic assign: only if still unassigned AND still assignable
    const patch: any = {
      assigned_driver_id: finalDriverId,
      driver_id: finalDriverId,
      assigned_at: new Date().toISOString(),
      status: "assigned",
    };

    const { data: upd, error: updErr } = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", booking.id)
      .in("status", allowedCurrent)
      .is("driver_id", null)
      .is("assigned_driver_id", null)
      .select("id, booking_code, status, town, zone_id, assigned_at, assigned_driver_id, driver_id, created_at")
      .limit(1);

    if (updErr) {
      return jsonErr("DB_UPDATE_ERROR", updErr.message, 500, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
      });
    }

    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;

    if (!updated) {
      return jsonErr("ASSIGN_RACE_LOST", "Booking was already assigned or status changed.", 409, {
        booking_id: booking.id,
        booking_code: booking.booking_code,
        current_status: currentStatus,
      });
    }

    return jsonOk({
      ok: true,
      note: "ASSIGNED_OK",
      booking_id: updated.id,
      booking_code: updated.booking_code,
      driver_id: finalDriverId,
      updated,
    });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", String(e?.message || e), 500);
  }
}