import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  override?: boolean | null;
  source?: string | null;
};

function normalizeStatus(s: unknown): string {
  return String(s ?? "").trim().toLowerCase();
}

function isTerminalStatus(s: string): boolean {
  return s === "on_trip" || s === "completed" || s === "cancelled";
}

function isPostAcceptStatus(s: string): boolean {
  return (
    s === "accepted" ||
    s === "fare_proposed" ||
    s === "ready" ||
    s === "on_the_way" ||
    s === "arrived"
  );
}

function nextAssignableStatus(current: string): string {
  const s = normalizeStatus(current);
  if (!s) return "assigned";
  if (
    s === "new" ||
    s === "pending" ||
    s === "searching" ||
    s === "unassigned" ||
    s === "queued" ||
    s === "assigning"
  ) {
    return "assigned";
  }
  return s;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const driverId = String(body.driverId ?? "").trim();
    const override = body.override === true;
    const source = String(body.source ?? (override ? "override" : "unknown")).trim();

    if (!driverId) {
      return NextResponse.json({ error: "MISSING_DRIVER_ID" }, { status: 400 });
    }
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }

    let readQ = supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, assigned_driver_id, assigned_at")
      .limit(1);

    if (bookingId) readQ = readQ.eq("id", bookingId);
    else readQ = readQ.eq("booking_code", bookingCode);

    const { data: curRows, error: curErr } = await readQ;
    if (curErr) {
      console.error("DISPATCH_ASSIGN_READ_ERROR", curErr);
      return NextResponse.json(
        { error: "DISPATCH_ASSIGN_READ_ERROR", message: curErr.message },
        { status: 500 }
      );
    }

    const cur = (curRows ?? [])[0] as any;
    const currentStatus = normalizeStatus(cur?.status);
    const fromDriverId = String(cur?.assigned_driver_id ?? cur?.driver_id ?? "").trim();
    const resolvedBookingId = String(cur?.id ?? "").trim();
    const resolvedBookingCode = String(cur?.booking_code ?? bookingCode ?? "").trim();

    if (!resolvedBookingId) {
      return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }

    
    // ===== DRIVER ELIGIBILITY GUARD (LIVE PRESENCE) =====
    try {
      const { data: locRows, error: locErr } = await supabase
        .from("driver_locations")
        .select("driver_id, status, updated_at")
        .eq("driver_id", driverId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (locErr) {
        console.error("DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR", locErr);
        return NextResponse.json(
          { error: "DISPATCH_ASSIGN_DRIVER_LOCATION_READ_ERROR", message: locErr.message },
          { status: 500 }
        );
      }

      const loc = (locRows ?? [])[0] as any;

      if (!loc) {
        return NextResponse.json(
          { error: "DRIVER_LOCATION_NOT_FOUND", driverId },
          { status: 409 }
        );
      }

      const updatedAtMs = new Date(loc.updated_at ?? 0).getTime();
      const ageSeconds = Number.isFinite(updatedAtMs)
        ? Math.floor((Date.now() - updatedAtMs) / 1000)
        : 999999;

      const STALE_THRESHOLD_SEC = 60;
      const isStale = ageSeconds > STALE_THRESHOLD_SEC;

      const rawStatus = String(loc.status ?? "").trim().toLowerCase();
      const effectiveStatus = isStale ? "offline" : rawStatus;

      const assignEligible =
        !isStale &&
        (
          effectiveStatus === "online" ||
          effectiveStatus === "available" ||
          effectiveStatus === "idle" ||
          effectiveStatus === "waiting"
        );

      if (!assignEligible) {
        return NextResponse.json(
          {
            error: "DRIVER_NOT_ELIGIBLE",
            driverId,
            effectiveStatus,
            isStale,
            ageSeconds,
          },
          { status: 409 }
        );
      }
    } catch (e: any) {
      console.error("DISPATCH_ASSIGN_DRIVER_LOCATION_THROWN", e);
      return NextResponse.json(
        {
          error: "DISPATCH_ASSIGN_DRIVER_LOCATION_THROWN",
          message: e?.message ?? "Unexpected driver eligibility error",
        },
        { status: 500 }
      );
    }
if (driverId === fromDriverId) {
      return NextResponse.json(
        {
          ok: true,
          bookingId: resolvedBookingId,
          bookingCode: resolvedBookingCode,
          fromDriverId: fromDriverId || null,
          toDriverId: driverId,
          status: currentStatus || null,
          assignedAt: cur?.assigned_at ?? null,
          noChange: true,
        },
        { status: 200 }
      );
    }

    if (isTerminalStatus(currentStatus)) {
      return NextResponse.json(
        {
          error: "ASSIGN_LOCKED",
          message: `Assignment locked when status='${currentStatus}'.`,
        },
        { status: 409 }
      );
    }

    if (isPostAcceptStatus(currentStatus) && !override) {
      return NextResponse.json(
        {
          error: "ASSIGN_REQUIRES_OVERRIDE",
          message: `Reassignment after accept requires override when status='${currentStatus}'.`,
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();
    const nextStatus = override ? currentStatus || "assigned" : nextAssignableStatus(currentStatus);

    const updatePayload: Record<string, any> = {
      driver_id: driverId,
      assigned_driver_id: driverId,
      assigned_at: nowIso,
      updated_at: nowIso,
    };

    if (nextStatus) updatePayload.status = nextStatus;

    const { data: updRows, error: updErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", resolvedBookingId)
      .select("id, booking_code, status, driver_id, assigned_driver_id, assigned_at")
      .limit(1);

    if (updErr) {
      console.error("DISPATCH_ASSIGN_DB_ERROR", updErr);
      return NextResponse.json(
        { error: "DISPATCH_ASSIGN_DB_ERROR", message: updErr.message },
        { status: 500 }
      );
    }

    const upd = (updRows ?? [])[0] as any;
    if (!upd?.id) {
      return NextResponse.json(
        { error: "ASSIGN_NO_ROWS", message: "No rows updated (identifier mismatch)." },
        { status: 409 }
      );
    }

    try {
      await supabase.from("booking_assignment_log").insert({
        booking_id: resolvedBookingId || null,
        booking_code: resolvedBookingCode || null,
        from_driver_id: fromDriverId || null,
        to_driver_id: driverId,
        source,
        actor: "admin",
        note: override ? `Override used from status='${currentStatus || "unknown"}'` : null,
      });
    } catch (e) {
      console.warn("ASSIGN_LOG_INSERT_FAILED", e);
    }

    try {
      const { error: syncErr } = await supabase.rpc("sync_drivers_from_bookings");
      if (syncErr) console.warn("SYNC_DRIVERS_FROM_BOOKINGS_FAILED", syncErr);
    } catch (e) {
      console.warn("SYNC_DRIVERS_FROM_BOOKINGS_THROWN", e);
    }

    return NextResponse.json(
      {
        ok: true,
        bookingId: resolvedBookingId,
        bookingCode: resolvedBookingCode,
        fromDriverId: fromDriverId || null,
        toDriverId: driverId,
        status: String(upd.status ?? nextStatus ?? currentStatus ?? "assigned"),
        assignedAt: upd?.assigned_at ?? nowIso,
        override,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("DISPATCH_ASSIGN_UNEXPECTED", err);
    return NextResponse.json(
      { error: "DISPATCH_ASSIGN_UNEXPECTED", message: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
