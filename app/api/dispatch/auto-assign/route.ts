import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DriverRow = {
  driver_id: string;
  status: string | null;
  updated_at: string | null;
  lat: number | null;
  lng: number | null;
};

type BookingRow = {
  id: string;
  booking_code: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  status?: string | null;
  driver_id?: string | null;
};

const ASSIGN_FRESHNESS_SECONDS = 10;
const SCAN_LIMIT = 5;

function norm(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

function isoNow(): string {
  return new Date().toISOString();
}

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function modeNormalized(v: any): "scan_requested" | "single" | "unknown" {
  const m = norm(v);
  if (m === "scan_requested") return "scan_requested";
  if (m === "scan_pending") return "scan_requested"; // legacy alias
  if (m === "single") return "single";
  return "unknown";
}

function buildBaseDebug(extra?: Record<string, any>) {
  return {
    freshness_seconds_threshold: ASSIGN_FRESHNESS_SECONDS,
    scan_limit: SCAN_LIMIT,
    timestamp: isoNow(),
    ...(extra || {}),
  };
}

function compareDrivers(a: DriverRow, b: DriverRow): number {
  const aMs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
  const bMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;

  if (aMs !== bMs) return bMs - aMs; // freshest first
  return String(a.driver_id || "").localeCompare(String(b.driver_id || ""));
}

type MatchDebug = {
  booking_id: string | null;
  booking_code: string | null;
  booking_status_seen: string | null;
  booking_driver_id_seen: string | null;
  scanned_driver_count: number;
  rejected_wrong_status_count: number;
  rejected_missing_updated_at_count: number;
  rejected_invalid_updated_at_count: number;
  rejected_stale_count: number;
  eligible_count: number;
  chosen_driver_id: string | null;
  freshness_seconds_threshold: number;
};

async function matchSingle(
  supabase: any,
  booking: BookingRow
): Promise<{
  assigned: boolean;
  driver_id?: string | null;
  booking_code?: string | null;
  reason?: string;
  decision: "assigned" | "skipped" | "blocked";
  debug: MatchDebug;
}> {
  const debug: MatchDebug = {
    booking_id: booking?.id ?? null,
    booking_code: booking?.booking_code ?? null,
    booking_status_seen: booking?.status ? String(booking.status) : null,
    booking_driver_id_seen: booking?.driver_id ? String(booking.driver_id) : null,
    scanned_driver_count: 0,
    rejected_wrong_status_count: 0,
    rejected_missing_updated_at_count: 0,
    rejected_invalid_updated_at_count: 0,
    rejected_stale_count: 0,
    eligible_count: 0,
    chosen_driver_id: null,
    freshness_seconds_threshold: ASSIGN_FRESHNESS_SECONDS,
  };

  if (!booking?.id) {
    return {
      assigned: false,
      reason: "INVALID_BOOKING",
      decision: "blocked",
      debug,
    };
  }

  if (norm(booking.status) !== "requested") {
    return {
      assigned: false,
      reason: "BOOKING_NOT_REQUESTED",
      decision: "blocked",
      debug,
    };
  }

  if (booking.driver_id) {
    return {
      assigned: false,
      reason: "BOOKING_ALREADY_ASSIGNED",
      decision: "blocked",
      debug,
    };
  }

  const nowMs = Date.now();

  const { data: drivers, error: driversError } = await supabase
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng");

  if (driversError) {
    return {
      assigned: false,
      reason: "DRIVER_SCAN_FAILED",
      decision: "blocked",
      debug,
    };
  }

  const allDrivers = (drivers || []) as DriverRow[];
  debug.scanned_driver_count = allDrivers.length;

  const eligible: DriverRow[] = [];

  for (const d of allDrivers) {
    const st = norm(d.status);

    if (st !== "online") {
      debug.rejected_wrong_status_count++;
      continue;
    }

    if (!d.updated_at) {
      debug.rejected_missing_updated_at_count++;
      continue;
    }

    const updatedMs = new Date(d.updated_at).getTime();
    if (!Number.isFinite(updatedMs)) {
      debug.rejected_invalid_updated_at_count++;
      continue;
    }

    const ageSec = (nowMs - updatedMs) / 1000;
    if (ageSec > ASSIGN_FRESHNESS_SECONDS) {
      debug.rejected_stale_count++;
      continue;
    }

    eligible.push(d);
  }

  eligible.sort(compareDrivers);
  debug.eligible_count = eligible.length;

  if (eligible.length === 0) {
    return {
      assigned: false,
      reason: "NO_ELIGIBLE_DRIVERS",
      decision: "skipped",
      debug,
    };
  }

  const chosen = eligible[0];
  debug.chosen_driver_id = chosen.driver_id;

  const nowIso = isoNow();

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      driver_id: chosen.driver_id,
      assigned_driver_id: chosen.driver_id,
      status: "assigned",
      assigned_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", booking.id)
    .eq("status", "requested")
    .is("driver_id", null);

  if (updateError) {
    return {
      assigned: false,
      reason: "BOOKING_UPDATE_FAILED",
      decision: "blocked",
      debug,
    };
  }

  return {
    assigned: true,
    driver_id: chosen.driver_id,
    booking_code: booking.booking_code ?? null,
    decision: "assigned",
    debug,
  };
}

export async function POST(req: Request) {
  console.log("[DISPATCH_TRACE] auto_assign:start", { at: new Date().toISOString() });
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = supabaseAdmin();

    const mode = modeNormalized(body?.mode);

    if (mode === "scan_requested") {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, booking_code, pickup_lat, pickup_lng, status, driver_id")
        .eq("status", "requested")
        .is("driver_id", null)
        .order("created_at", { ascending: true })
        .limit(SCAN_LIMIT);

      if (error) {
              console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
          ok: false,
          error: "BOOKINGS_SCAN_FAILED",
          message: error.message,
          mode: "scan_requested",
          debug: buildBaseDebug(),
        }, 500);
      }

      const scanRows = (bookings || []) as BookingRow[];
      const results: Array<{
        booking_id: string;
        booking_code: string | null;
        assigned: boolean;
        decision: "assigned" | "skipped" | "blocked";
        driver_id: string | null;
        reason: string | null;
        debug: MatchDebug;
      }> = [];

      let assigned_count = 0;
      let skipped_count = 0;
      let blocked_count = 0;

      for (const booking of scanRows) {
        const result = await matchSingle(supabase, booking);

        if (result.decision === "assigned") assigned_count++;
        else if (result.decision === "skipped") skipped_count++;
        else blocked_count++;

        results.push({
          booking_id: booking.id,
          booking_code: booking.booking_code ?? null,
          assigned: !!result.assigned,
          decision: result.decision,
          driver_id: result.driver_id ?? null,
          reason: result.reason ?? null,
          debug: result.debug,
        });
      }

            console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
        ok: true,
        mode: "scan_requested",
        accepted_legacy_mode_name: norm(body?.mode) === "scan_pending",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count,
        results,
        debug: buildBaseDebug({
          booking_status_target: "requested",
          booking_driver_target: "driver_id is null",
        }),
      });
    }

    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) {
            console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
        ok: false,
        error: "MISSING_BOOKING_ID",
        mode: "single",
        debug: buildBaseDebug(),
      }, 400);
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, booking_code, pickup_lat, pickup_lng, status, driver_id")
      .eq("id", bookingId)
      .single();

    if (bookingError) {
            console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
        ok: false,
        error: "BOOKING_READ_FAILED",
        message: bookingError.message,
        mode: "single",
        booking_id: bookingId,
        debug: buildBaseDebug(),
      }, 500);
    }

    if (!booking) {
            console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
        ok: false,
        error: "BOOKING_NOT_FOUND",
        mode: "single",
        booking_id: bookingId,
        debug: buildBaseDebug(),
      }, 404);
    }

        const result = await matchSingle(supabase, booking as BookingRow);
    console.log("[DISPATCH_TRACE] auto_assign:single_result", {
      booking_id: booking.id,
      booking_code: booking.booking_code ?? null,
      decision: result.decision,
      reason: result.reason ?? null,
      driver_id: result.driver_id ?? null,
      debug: result.debug
    });

          console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
      ok: true,
      mode: "single",
      booking_id: booking.id,
      booking_code: booking.booking_code ?? null,
      assigned: !!result.assigned,
      decision: result.decision,
      driver_id: result.driver_id ?? null,
      reason: result.reason ?? null,
      debug: result.debug,
    });
  } catch (e: any) {
          console.log("[DISPATCH_TRACE] auto_assign:scan_summary", {
        mode: "scan_requested",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count
      });

      return json({
      ok: false,
      error: "AUTO_ASSIGN_FAILED",
      message: String(e?.message || e),
      debug: buildBaseDebug(),
    }, 500);
  }
}