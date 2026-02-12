import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

function getSupabaseEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  return { url, key };
}

function pickFirst(body: any, keys: string[]) {
  for (const k of keys) {
    const v = body?.[k];
    if (v !== undefined && v !== null && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));

    // Accept both camelCase and snake_case
    const bookingCode = pickFirst(body, ["bookingCode", "booking_code"]);
    const bookingId   = pickFirst(body, ["bookingId", "booking_id"]);
    const driverId    = pickFirst(body, ["driverId", "driver_id"]);

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: "Missing booking_id or booking_code" },
        { status: 400 }
      );
    }

        // driverId is optional:
    // - if provided, assign exactly that driver
    // - if missing, auto-pick an ONLINE driver with a recent location ping
    let finalDriverId = driverId;

    if (finalDriverId && !isUuidLike(finalDriverId)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_DRIVER_ID", message: "Invalid driver_id/driverId (uuid)" },
        { status: 400 }
      );
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json(
        {
          ok: false,
          code: "MISSING_SUPABASE_ENV",
          message:
            "Missing SUPABASE env. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL + SUPABASE_ANON_KEY).",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(env.url, env.key);

    // Fetch booking by id or code
    let booking: any = null;

    if (bookingId) {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_code, status, town, zone_id, assigned_at, assigned_driver_id, driver_id, created_at")
        .eq("id", bookingId)
        .limit(1);

      if (error) {
        return NextResponse.json({ ok: false, code: "DB_SELECT_ERROR", message: error.message }, { status: 500 });
      }
      booking = Array.isArray(data) && data.length ? data[0] : null;
    } else {
      const { data, error } = await supabase
        .from("bookings")
        .select("id, booking_code, status, town, zone_id, assigned_at, assigned_driver_id, driver_id, created_at")
        .eq("booking_code", bookingCode)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) {
        return NextResponse.json({ ok: false, code: "DB_SELECT_ERROR", message: error.message }, { status: 500 });
      }
      booking = Array.isArray(data) && data.length ? data[0] : null;
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_NOT_FOUND", message: "Booking not found", booking_id: bookingId || null, booking_code: bookingCode || null },
        { status: 404 }
      );
    }

    const currentStatus = String(booking.status || "").trim();

    // permissive assignable statuses
    const allowedCurrent = ["requested", "booked_ok", "booked", "pending", "created", ""];
    if (allowedCurrent.indexOf(currentStatus) === -1) {
      return NextResponse.json(
        {
          ok: false,
          code: "CANNOT_ASSIGN_FROM_STATUS",
          message: "Booking status is not assignable",
          booking_id: booking.id,
          booking_code: booking.booking_code,
          current_status: currentStatus,
        },
        { status: 409 }
      );
    }

    async function pickOnlineDriverAuto(bookingRow: any): Promise<string> {
      // Uses your confirmed schema:
      // - drivers.driver_status, drivers.updated_at
      // - driver_locations_latest.updated_at (plus driver_id)
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

      // Prefer same zone if booking has zone_id (does not assume drivers has zone_id in your filter list)
      // If drivers.zone_id exists, this helps; if not, we just pick any ONLINE recent driver.
      let q = supabase
        .from("drivers")
        .select("id, driver_id, driver_status, updated_at, zone_id")
        .in("driver_status", ["ONLINE", "online"])
        .order("updated_at", { ascending: false })
        .limit(80);

      // Try to filter by zone_id if present (safe even if bookingRow.zone_id is null)
      if (bookingRow?.zone_id) {
        q = q.eq("zone_id", bookingRow.zone_id);
      }

      // We canâ€™t reliably know whether drivers primary key is `id` or `driver_id`,
      // so we query both columns and match against recentIds.
      const { data: drsZone, error: drErrZone } = await q;
      if (drErrZone) {
        // If zone_id column doesn't exist or other error, fall back without zone filter.
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

      // If none in zone matched, pick any ONLINE recent driver (no zone)
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

    // AUTO-PICK when driverId missing
    if (!finalDriverId) {
      try {
        finalDriverId = await pickOnlineDriverAuto(booking);
      } catch (e: any) {
        return NextResponse.json(
          { ok: false, code: "AUTO_PICK_FAILED", message: String(e?.message || e) },
          { status: 500 }
        );
      }
      if (!finalDriverId) {
        return NextResponse.json(
          { ok: false, code: "NO_AVAILABLE_DRIVER", message: "No ONLINE drivers with recent location updates." },
          { status: 409 }
        );
      }
    }
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
      .select("id, booking_code, status, town, zone_id, assigned_at, assigned_driver_id, driver_id, created_at")
      .limit(1);

    if (updErr) {
      return NextResponse.json(
        { ok: false, code: "DB_UPDATE_ERROR", message: updErr.message, booking_id: booking.id, booking_code: booking.booking_code },
        { status: 500 }
      );
    }

    const updated = Array.isArray(upd) && upd.length ? upd[0] : null;

    return NextResponse.json({
      ok: true,
      note: "ASSIGNED_OK",
      booking_id: updated?.id || booking.id,
      booking_code: updated?.booking_code || booking.booking_code,
      driver_id: finalDriverId,
      updated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, code: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
