import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type AssignReq = {
  booking_id?: string | null;
  booking_code?: string | null;
  town?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
};

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
  const lat = typeof row.lat === "number" ? row.lat : typeof row.latitude === "number" ? row.latitude : null;
  const lng = typeof row.lng === "number" ? row.lng : typeof row.longitude === "number" ? row.longitude : null;
  return { lat, lng };
}

async function fetchBookingByIdOrCode(
  supabase: ReturnType<typeof createClient>,
  booking_id?: string | null,
  booking_code?: string | null
) {
  if (booking_id) {
    const r = await supabase.from("bookings").select("*").eq("id", booking_id).maybeSingle();
    return { data: r.data, error: r.error?.message || null };
  }
  if (booking_code) {
    const r = await supabase.from("bookings").select("*").eq("booking_code", booking_code).maybeSingle();
    return { data: r.data, error: r.error?.message || null };
  }
  return { data: null, error: "Missing booking_id or booking_code" };
}

async function bestEffortUpdateBooking(
  supabase: ReturnType<typeof createClient>,
  bookingId: string,
  patch: Record<string, any>
) {
  // Best-effort update; do not throw to keep endpoint stable.
  const r = await supabase.from("bookings").update(patch).eq("id", bookingId).select("*").maybeSingle();
  if (r.error) return { ok: false, error: r.error.message, data: null as any };
  return { ok: true, error: null as any, data: r.data };
}

async function findNearestOnlineDriverInTown(
  supabase: ReturnType<typeof createClient>,
  town: string,
  pickup_lat: number,
  pickup_lng: number
) {
  const r = await supabase
    .from("driver_locations")
    .select("*")
    .eq("town", town)
    .eq("status", "online")
    .limit(300);

  if (r.error) {
    return { driver_id: null as string | null, note: "driver_locations query failed: " + r.error.message };
  }

  const rows = Array.isArray(r.data) ? r.data : [];
  let best: { driver_id: string; km: number } | null = null;
  let coordSeen = 0;

  for (const row of rows) {
    const dId = row.driver_id ? String(row.driver_id) : "";
    if (!dId) continue;

    const c = pickCoord(row);
    if (typeof c.lat !== "number" || typeof c.lng !== "number") continue;
    coordSeen++;

    const km = haversineKm(pickup_lat, pickup_lng, c.lat, c.lng);
    if (!best || km < best.km) best = { driver_id: dId, km };
  }

  if (!best) {
    return { driver_id: null as string | null, note: "No eligible ONLINE drivers in town (rows=" + rows.length + ", coords=" + coordSeen + ")." };
  }

  return { driver_id: best.driver_id, note: "Nearest ONLINE driver in town selected (km=" + best.km.toFixed(3) + ")." };
}

function normStatus(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

export async function POST(req: Request) {
  const supabase = createClient();
  const body = (await req.json().catch(() => ({}))) as AssignReq;

  const bookingRes = await fetchBookingByIdOrCode(supabase, body.booking_id ?? null, body.booking_code ?? null);
  if (!bookingRes.data) {
    return NextResponse.json(
      { ok: false, code: "BOOKING_NOT_FOUND", message: bookingRes.error || "Booking not found" },
      { status: 404 }
    );
  }

  const booking: any = bookingRes.data;

  // ----- HARDENING: idempotency / no overwrite -----
  const curStatus = normStatus(booking.status);
  const alreadyHasDriver = !!booking.driver_id;

  // If already assigned (or beyond), do NOT reassign.
  if (alreadyHasDriver && curStatus && curStatus !== "requested") {
    return NextResponse.json(
      {
        ok: true,
        assigned: false,
        code: "ALREADY_ASSIGNED",
        message: "Booking already has a driver and is not assignable.",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        driver_id: String(booking.driver_id),
        status: booking.status ?? null,
        booking,
      },
      { status: 200 }
    );
  }

  // If it has a driver but status is missing/empty/requested, treat as assigned and do not overwrite.
  if (alreadyHasDriver) {
    // Best-effort bump status to assigned if currently requested/empty.
    if (!curStatus || curStatus === "requested") {
      await bestEffortUpdateBooking(supabase, String(booking.id), { status: "assigned" });
      const reread = await fetchBookingByIdOrCode(supabase, String(booking.id), null);
      const b2: any = reread.data ?? booking;
      return NextResponse.json(
        {
          ok: true,
          assigned: true,
          code: "ALREADY_HAS_DRIVER",
          message: "Booking already had driver_id; status normalized to assigned (best-effort).",
          booking_id: String(b2.id),
          booking_code: b2.booking_code ?? null,
          driver_id: b2.driver_id ?? null,
          status: b2.status ?? null,
          booking: b2,
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        assigned: true,
        code: "ALREADY_HAS_DRIVER",
        message: "Booking already has driver_id.",
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        driver_id: booking.driver_id ?? null,
        status: booking.status ?? null,
        booking,
      },
      { status: 200 }
    );
  }

  // Only assign when status is requested OR empty (some schemas might not have status)
  if (curStatus && curStatus !== "requested") {
    return NextResponse.json(
      {
        ok: true,
        assigned: false,
        code: "NOT_ASSIGNABLE",
        message: "Booking status is not assignable: " + curStatus,
        booking_id: String(booking.id),
        booking_code: booking.booking_code ?? null,
        status: booking.status ?? null,
        booking,
      },
      { status: 200 }
    );
  }

  const town = (body.town ?? booking.town ?? "").toString();
  const pickup_lat = typeof body.pickup_lat === "number" ? body.pickup_lat : booking.pickup_lat;
  const pickup_lng = typeof body.pickup_lng === "number" ? body.pickup_lng : booking.pickup_lng;

  if (!town) return NextResponse.json({ ok: false, code: "MISSING_TOWN", message: "Missing town for assignment" }, { status: 400 });
  if (typeof pickup_lat !== "number" || typeof pickup_lng !== "number") {
    return NextResponse.json({ ok: false, code: "MISSING_PICKUP_COORDS", message: "Missing pickup_lat/pickup_lng for assignment" }, { status: 400 });
  }

  const pick = await findNearestOnlineDriverInTown(supabase, town, pickup_lat, pickup_lng);
  if (!pick.driver_id) {
    return NextResponse.json(
      { ok: false, code: "NO_DRIVER_AVAILABLE", message: "No available driver", note: pick.note },
      { status: 409 }
    );
  }

  // Update only if driver_id is still null (we already checked, but keep logic defensive)
  const upd = await bestEffortUpdateBooking(supabase, String(booking.id), { driver_id: pick.driver_id, status: "assigned" });

  return NextResponse.json(
    {
      ok: true,
      assigned: true,
      booking_id: String(booking.id),
      booking_code: booking.booking_code ?? null,
      driver_id: pick.driver_id,
      note: pick.note,
      update_ok: upd.ok,
      update_error: upd.error,
      booking: upd.data ?? null,
    },
    { status: 200 }
  );
}