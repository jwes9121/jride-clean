import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DriverRow = {
  driver_id: string;
  status: string | null;
  updated_at: string | null;
  lat: number | null;
  lng: number | null;
  town?: string | null;
};

type BookingRow = {
  id: string;
  booking_code: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  town?: string | null;
  status?: string | null;
  driver_id?: string | null;
  is_emergency?: boolean | null;
};

const ASSIGN_FRESHNESS_SECONDS = 10;
const SCAN_LIMIT = 5;

function norm(v: any): string {
  return String(v ?? "").trim().toLowerCase();
}

function text(v: any): string {
  return String(v ?? "").trim();
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function isoNow(): string {
  return new Date().toISOString();
}


function effectiveMinWalletRequired(raw: any): number {
  const configured = num(raw);
  return configured != null && configured >= 250 ? configured : 250;
}

async function isDriverWalletEligible(supabase: any, driverId: string): Promise<{
  eligible: boolean;
  balance: number;
  minRequired: number;
  walletLocked: boolean;
}> {
  const { data } = await supabase
    .from("drivers")
    .select("id, wallet_balance, min_wallet_required, wallet_locked")
    .eq("id", driverId)
    .maybeSingle();

  const balance = num((data as any)?.wallet_balance) ?? 0;
  const minRequired = effectiveMinWalletRequired((data as any)?.min_wallet_required);
  const walletLocked = Boolean((data as any)?.wallet_locked);

  return {
    eligible: Boolean(data) && !walletLocked && balance >= minRequired,
    balance,
    minRequired,
    walletLocked,
  };
}

function json(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function modeNormalized(v: any): "scan_requested" | "single" | "unknown" {
  const m = norm(v);
  if (m === "scan_requested") return "scan_requested";
  if (m === "scan_pending") return "scan_requested";
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

function getNearbyTowns(town: string): string[] {
  const map: Record<string, string[]> = {
    Lagawe: ["Lamut", "Hingyon"],
    Lamut: ["Lagawe", "Kiangan"],
    Hingyon: ["Lagawe"],
    Banaue: ["Hingyon"],
  };
  return map[town] || [];
}

function allowedTownsForBooking(bookingTown: string, emergencyMode: boolean): string[] {
  const town = text(bookingTown);
  if (!town) return [];
  if (!emergencyMode) return [town];
  return [town, ...getNearbyTowns(town)];
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return r * c;
}

function isAssignableSearchingState(status: any): boolean {
  const s = norm(status);
  return s === "requested" || s === "searching";
}

function compareDrivers(a: DriverRow, b: DriverRow, pickupLat: number | null, pickupLng: number | null): number {
  const aLat = num(a.lat);
  const aLng = num(a.lng);
  const bLat = num(b.lat);
  const bLng = num(b.lng);

  const aHasCoords = aLat != null && aLng != null && pickupLat != null && pickupLng != null;
  const bHasCoords = bLat != null && bLng != null && pickupLat != null && pickupLng != null;

  if (aHasCoords && bHasCoords) {
    const aKm = haversineKm(aLat as number, aLng as number, pickupLat as number, pickupLng as number);
    const bKm = haversineKm(bLat as number, bLng as number, pickupLat as number, pickupLng as number);
    if (aKm !== bKm) return aKm - bKm;
  } else if (aHasCoords && !bHasCoords) {
    return -1;
  } else if (!aHasCoords && bHasCoords) {
    return 1;
  }

  const aMs = a.updated_at ? new Date(a.updated_at).getTime() : 0;
  const bMs = b.updated_at ? new Date(b.updated_at).getTime() : 0;

  if (aMs !== bMs) return bMs - aMs;
  return String(a.driver_id || "").localeCompare(String(b.driver_id || ""));
}

type MatchDebug = {
  booking_id: string | null;
  booking_code: string | null;
  booking_status_seen: string | null;
  booking_driver_id_seen: string | null;
  booking_town_seen: string | null;
  emergency_mode: boolean;
  allowed_towns: string[];
  scanned_driver_count: number;
  rejected_wrong_status_count: number;
  rejected_missing_updated_at_count: number;
  rejected_invalid_updated_at_count: number;
  rejected_stale_count: number;
  rejected_excluded_count: number;
  rejected_wrong_town_count: number;
  rejected_low_wallet_count: number;
  eligible_count: number;
  chosen_driver_id: string | null;
  chosen_driver_town: string | null;
  chosen_driver_distance_km: number | null;
  freshness_seconds_threshold: number;
  excluded_driver_ids: string[];
};

async function matchSingle(
  supabase: any,
  booking: BookingRow,
  excludeDriverIds: string[]
): Promise<{
  assigned: boolean;
  driver_id?: string | null;
  booking_code?: string | null;
  reason?: string;
  decision: "assigned" | "skipped" | "blocked";
  debug: MatchDebug;
}> {
  const excluded = (excludeDriverIds || []).map((x) => String(x || "").trim()).filter(Boolean);
  const bookingTown = text(booking?.town);
  const emergencyMode = !!booking?.is_emergency;
  const allowedTowns = allowedTownsForBooking(bookingTown, emergencyMode);
  const pickupLat = num(booking?.pickup_lat);
  const pickupLng = num(booking?.pickup_lng);

  const debug: MatchDebug = {
    booking_id: booking?.id ?? null,
    booking_code: booking?.booking_code ?? null,
    booking_status_seen: booking?.status ? String(booking.status) : null,
    booking_driver_id_seen: booking?.driver_id ? String(booking.driver_id) : null,
    booking_town_seen: bookingTown || null,
    emergency_mode: emergencyMode,
    allowed_towns: allowedTowns,
    scanned_driver_count: 0,
    rejected_wrong_status_count: 0,
    rejected_missing_updated_at_count: 0,
    rejected_invalid_updated_at_count: 0,
    rejected_stale_count: 0,
    rejected_excluded_count: 0,
    rejected_wrong_town_count: 0,
    rejected_low_wallet_count: 0,
    eligible_count: 0,
    chosen_driver_id: null,
    chosen_driver_town: null,
    chosen_driver_distance_km: null,
    freshness_seconds_threshold: ASSIGN_FRESHNESS_SECONDS,
    excluded_driver_ids: excluded,
  };

  if (!booking?.id) {
    return {
      assigned: false,
      reason: "INVALID_BOOKING",
      decision: "blocked",
      debug,
    };
  }

  if (!isAssignableSearchingState(booking.status)) {
    return {
      assigned: false,
      reason: "BOOKING_NOT_ASSIGNABLE",
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

  if (!bookingTown) {
    return {
      assigned: false,
      reason: "BOOKING_TOWN_MISSING",
      decision: "blocked",
      debug,
    };
  }

  if (allowedTowns.length === 0) {
    return {
      assigned: false,
      reason: "NO_ALLOWED_TOWNS",
      decision: "blocked",
      debug,
    };
  }

  const nowMs = Date.now();

  const { data: drivers, error: driversError } = await supabase
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng, town");

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

  const allowedTownSet = new Set(allowedTowns.map((x) => text(x).toLowerCase()));
  const eligible: DriverRow[] = [];

  for (const d of allDrivers) {
    const st = norm(d.status);
    const driverTown = text(d.town).toLowerCase();

    if (excluded.includes(String(d.driver_id || "").trim())) {
      debug.rejected_excluded_count++;
      continue;
    }

    if (st !== "online") {
      debug.rejected_wrong_status_count++;
      continue;
    }

    if (!driverTown || !allowedTownSet.has(driverTown)) {
      debug.rejected_wrong_town_count++;
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

    const wallet = await isDriverWalletEligible(supabase, String(d.driver_id || ""));
    if (!wallet.eligible) {
      debug.rejected_low_wallet_count++;
      continue;
    }

    eligible.push(d);
  }

  eligible.sort((a, b) => compareDrivers(a, b, pickupLat, pickupLng));
  debug.eligible_count = eligible.length;

  if (eligible.length === 0) {
    return {
      assigned: false,
      reason: emergencyMode ? "NO_ELIGIBLE_DRIVERS_IN_EMERGENCY_TOWNS" : "NO_ELIGIBLE_LOCAL_DRIVERS",
      decision: "skipped",
      debug,
    };
  }

  const chosen = eligible[0];
  debug.chosen_driver_id = chosen.driver_id;
  debug.chosen_driver_town = text(chosen.town) || null;

  const chosenLat = num(chosen.lat);
  const chosenLng = num(chosen.lng);
  if (chosenLat != null && chosenLng != null && pickupLat != null && pickupLng != null) {
    debug.chosen_driver_distance_km = Number(
      haversineKm(chosenLat, chosenLng, pickupLat, pickupLng).toFixed(2)
    );
  }

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
    .in("status", ["requested", "searching"])
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
    const excludeDriverIds: string[] = Array.isArray(body?.exclude_driver_ids)
      ? body.exclude_driver_ids.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];

    if (mode === "scan_requested") {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, booking_code, pickup_lat, pickup_lng, town, status, driver_id, is_emergency")
        .in("status", ["requested", "searching"])
        .is("driver_id", null)
        .order("created_at", { ascending: true })
        .limit(SCAN_LIMIT);

      if (error) {
        return json(
          {
            ok: false,
            error: "BOOKINGS_SCAN_FAILED",
            message: error.message,
            mode: "scan_requested",
            debug: buildBaseDebug(),
          },
          500
        );
      }

      const scanRows = (bookings || []) as BookingRow[];

      let assigned_count = 0;
      let skipped_count = 0;
      let blocked_count = 0;

      const results: Array<{
        booking_id: string;
        booking_code: string | null;
        assigned: boolean;
        decision: "assigned" | "skipped" | "blocked";
        driver_id: string | null;
        reason: string | null;
        debug: MatchDebug;
      }> = [];

      for (const booking of scanRows) {
        const result = await matchSingle(supabase, booking, excludeDriverIds);

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
        blocked_count,
        exclude_driver_ids: excludeDriverIds,
      });

      return json({
        ok: true,
        mode: "scan_requested",
        accepted_legacy_mode_name: norm(body?.mode) === "scan_pending",
        scanned_bookings_count: scanRows.length,
        assigned_count,
        skipped_count,
        blocked_count,
        exclude_driver_ids: excludeDriverIds,
        results,
        debug: buildBaseDebug({
          booking_status_target: "requested or searching",
          booking_driver_target: "driver_id is null",
          booking_town_rule: "same town only unless booking.is_emergency = true",
        }),
      });
    }

    if (mode !== "single") {
      return json(
        {
          ok: false,
          error: "INVALID_MODE",
          mode: String(body?.mode ?? ""),
          debug: buildBaseDebug(),
        },
        400
      );
    }

    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) {
      return json(
        {
          ok: false,
          error: "MISSING_BOOKING_ID",
          mode: "single",
          debug: buildBaseDebug(),
        },
        400
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, booking_code, pickup_lat, pickup_lng, town, status, driver_id, is_emergency")
      .eq("id", bookingId)
      .single();

    if (bookingError) {
      return json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: bookingError.message,
          mode: "single",
          booking_id: bookingId,
          debug: buildBaseDebug(),
        },
        500
      );
    }

    if (!booking) {
      return json(
        {
          ok: false,
          error: "BOOKING_NOT_FOUND",
          mode: "single",
          booking_id: bookingId,
          debug: buildBaseDebug(),
        },
        404
      );
    }

    const result = await matchSingle(supabase, booking as BookingRow, excludeDriverIds);

    console.log("[DISPATCH_TRACE] auto_assign:single_result", {
      booking_id: booking.id,
      booking_code: booking.booking_code ?? null,
      decision: result.decision,
      reason: result.reason ?? null,
      driver_id: result.driver_id ?? null,
      exclude_driver_ids: excludeDriverIds,
      debug: result.debug,
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
      exclude_driver_ids: excludeDriverIds,
      debug: result.debug,
    });
  } catch (e: any) {
    return json(
      {
        ok: false,
        error: "AUTO_ASSIGN_FAILED",
        message: String(e?.message || e),
        debug: buildBaseDebug(),
      },
      500
    );
  }
}
