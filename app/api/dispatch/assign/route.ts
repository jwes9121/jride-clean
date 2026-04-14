import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function cleanStatus(v: unknown): string {
  return text(v).toLowerCase();
}

function isUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function getNearbyTowns(town: string): string[] {
  const map: Record<string, string[]> = {
    lagawe: ["lamut", "hingyon"],
    lamut: ["lagawe", "kiangan"],
    hingyon: ["lagawe"],
    banaue: ["hingyon"],
  };
  return map[text(town).toLowerCase()] || [];
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function effectiveMinWalletRequired(raw: unknown): number {
  const configured = num(raw);
  return configured >= 250 ? configured : 250;
}

function ageSecondsFromIso(input: string | null | undefined): number | null {
  if (!input) return null;
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) return null;
  const now = Date.now();
  const ms = now - parsed;
  return Math.max(0, Math.floor(ms / 1000));
}

function ts(input: string | null | undefined): number {
  if (!input) return 0;
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? parsed : 0;
}

const DRIVER_STALE_AFTER_SECONDS = 120;
const ASSIGN_CUTOFF_MINUTES = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
const ASSIGN_CUTOFF_SECONDS = ASSIGN_CUTOFF_MINUTES * 60;
const ONLINE_LIKE_STATUSES = new Set(["online", "available", "idle", "waiting"]);

function evaluateDriverLocationEligibility(row: any) {
  const updatedAt = text(row?.updated_at) || text(row?.created_at) || "";
  const ageSeconds = ageSecondsFromIso(updatedAt || null);
  const rawStatus = cleanStatus(row?.status);
  const isStale = ageSeconds == null ? true : ageSeconds > DRIVER_STALE_AFTER_SECONDS;
  const effectiveStatus = isStale ? "offline" : rawStatus;
  const assignFresh = ageSeconds == null ? false : ageSeconds <= ASSIGN_CUTOFF_SECONDS;
  const assignOnlineEligible = ONLINE_LIKE_STATUSES.has(rawStatus);
  const assignEligible = assignFresh && assignOnlineEligible;

  return {
    updatedAt: updatedAt || null,
    ageSeconds,
    rawStatus,
    isStale,
    effectiveStatus,
    assignFresh,
    assignOnlineEligible,
    assignEligible,
  };
}

function keepLatestDriverLocationRows(rows: any[]): any[] {
  const latestByDriverId: Record<string, any> = {};

  for (const row of rows || []) {
    const driverId = text(row?.driver_id);
    if (!driverId) continue;

    const prev = latestByDriverId[driverId];
    if (!prev) {
      latestByDriverId[driverId] = row;
      continue;
    }

    const prevTs = ts(prev?.updated_at || prev?.created_at || null);
    const nextTs = ts(row?.updated_at || row?.created_at || null);

    if (nextTs > prevTs) {
      latestByDriverId[driverId] = row;
    }
  }

  return Object.values(latestByDriverId);
}

const ASSIGNABLE_STATUSES = new Set([
  "requested",
  "pending",
  "searching",
  "assigned",
  "accepted",
]);

async function isDriverWalletEligible(supabase: any, driverId: string) {
  const { data, error } = await supabase
    .from("drivers")
    .select("id, wallet_balance, min_wallet_required, wallet_locked")
    .eq("id", driverId)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: "driver_wallet_read_failed", message: error.message };
  }

  if (!data) {
    return { ok: false as const, error: "driver_not_found" };
  }

  const balance = num((data as any).wallet_balance);
  const minRequired = effectiveMinWalletRequired((data as any).min_wallet_required);
  const walletLocked = Boolean((data as any).wallet_locked);
  const eligible = !walletLocked && balance >= minRequired;

  return {
    ok: true as const,
    eligible,
    balance,
    minRequired,
    walletLocked,
  };
}

async function getLatestDriverLocationForDriver(supabase: any, driverId: string) {
  const { data, error } = await supabase
    .from("driver_locations")
    .select("driver_id, town, lat, lng, updated_at, created_at, status")
    .eq("driver_id", driverId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { ok: false as const, error: "driver_location_read_failed", message: error.message };
  }

  if (!data) {
    return { ok: false as const, error: "driver_location_not_found" };
  }

  const eligibility = evaluateDriverLocationEligibility(data);
  return {
    ok: true as const,
    row: data,
    eligibility,
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabase = getSupabase();
    const body = await req.json().catch(() => ({}));

    const bookingCode = text(body?.bookingCode || body?.booking_code);
    const bookingId = text(body?.bookingId || body?.booking_id || body?.id);
    const explicitDriverId = text(body?.driverId || body?.driver_id);
    const emergencyMode = body?.emergency_mode === true;

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        { ok: false, error: "missing_booking" },
        { status: 400 }
      );
    }

    if (explicitDriverId && !isUuid(explicitDriverId)) {
      return NextResponse.json(
        { ok: false, error: "invalid_driver_id" },
        { status: 400 }
      );
    }

    let bookingQuery = supabase
      .from("bookings")
      .select("id, booking_code, town, status, driver_id, assigned_driver_id, pickup_lat, pickup_lng")
      .limit(1);

    bookingQuery = bookingCode
      ? bookingQuery.eq("booking_code", bookingCode)
      : bookingQuery.eq("id", bookingId);

    const { data: booking, error: bookingError } = await bookingQuery.maybeSingle();

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: "booking_read_failed", message: bookingError.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "booking_not_found" },
        { status: 404 }
      );
    }

    const currentStatus = cleanStatus((booking as any).status);
    if (!ASSIGNABLE_STATUSES.has(currentStatus)) {
      return NextResponse.json(
        { ok: false, error: "booking_not_assignable", status: currentStatus },
        { status: 409 }
      );
    }

    if (explicitDriverId) {
      // ðŸ”’ HARD LOCK: prevent driver with active trip
      const { data: activeTripManual } = await supabase
        .from("bookings")
        .select("booking_code, status")
        .eq("assigned_driver_id", explicitDriverId)
        .in("status", [
          "assigned",
          "accepted",
          "fare_proposed",
          "ready",
          "on_the_way",
          "arrived",
          "on_trip"
        ])
        .limit(1)
        .maybeSingle();

      if (activeTripManual) {
        return NextResponse.json(
          {
            ok: false,
            error: "driver_already_has_active_trip",
            existing_booking_code: activeTripManual.booking_code,
            existing_status: activeTripManual.status
          },
          { status: 409 }
        );
      }

      const driverLocation = await getLatestDriverLocationForDriver(supabase, explicitDriverId);
      if (!driverLocation.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: driverLocation.error,
            message: (driverLocation as any).message || null,
            driver_id: explicitDriverId,
          },
          { status: driverLocation.error === "driver_location_not_found" ? 404 : 500 }
        );
      }

      if (!driverLocation.eligibility.assignEligible) {
        return NextResponse.json(
          {
            ok: false,
            error: "driver_not_assign_eligible",
            driver_id: explicitDriverId,
            driver_status: driverLocation.eligibility.rawStatus,
            effective_status: driverLocation.eligibility.effectiveStatus,
            is_stale: driverLocation.eligibility.isStale,
            assign_fresh: driverLocation.eligibility.assignFresh,
            assign_online_eligible: driverLocation.eligibility.assignOnlineEligible,
            assign_eligible: driverLocation.eligibility.assignEligible,
            updated_at: driverLocation.eligibility.updatedAt,
            age_seconds: driverLocation.eligibility.ageSeconds,
            assign_cutoff_minutes: ASSIGN_CUTOFF_MINUTES,
          },
          { status: 409 }
        );
      }

      const explicitEligibility = await isDriverWalletEligible(supabase, explicitDriverId);
      if (!explicitEligibility.ok) {
        return NextResponse.json(
          { ok: false, error: explicitEligibility.error, message: (explicitEligibility as any).message || null },
          { status: explicitEligibility.error === "driver_not_found" ? 404 : 500 }
        );
      }
      if (!explicitEligibility.eligible) {
        return NextResponse.json(
          {
            ok: false,
            error: explicitEligibility.walletLocked ? "driver_wallet_locked" : "driver_wallet_below_minimum",
            driver_id: explicitDriverId,
            wallet_balance: explicitEligibility.balance,
            min_wallet_required: explicitEligibility.minRequired,
          },
          { status: 409 }
        );
      }
    }

    let chosenDriverId = explicitDriverId;

    if (!chosenDriverId) {
      const baseTown = text((booking as any).town);
      const townsToSearch = emergencyMode
        ? [baseTown, ...getNearbyTowns(baseTown)]
        : [baseTown];

      const normalizedTowns = townsToSearch
        .map((x) => text(x))
        .filter((x) => !!x);

      const { data: drivers, error: driverError } = await supabase
        .from("driver_locations")
        .select("driver_id, town, lat, lng, updated_at, created_at, status")
        .in("town", normalizedTowns);

      if (driverError) {
        return NextResponse.json(
          { ok: false, error: "driver_query_failed", message: driverError.message },
          { status: 500 }
        );
      }

      const pickupLat = num((booking as any).pickup_lat);
      const pickupLng = num((booking as any).pickup_lng);

      const ranked = keepLatestDriverLocationRows(drivers || [])
        .map((row: any) => {
          const eligibility = evaluateDriverLocationEligibility(row);
          const driverTown = text(row?.town).toLowerCase();
          const sameTown = driverTown === baseTown.toLowerCase();
          const lat = num(row?.lat);
          const lng = num(row?.lng);
          const distKm = haversineKm(lat, lng, pickupLat, pickupLng);

          return {
            ...row,
            eligibility,
            sameTown,
            distKm,
            townPriority: sameTown ? 0 : 1,
          };
        })
        .sort((a: any, b: any) => {
          if (a.townPriority !== b.townPriority) return a.townPriority - b.townPriority;
          if (a.distKm !== b.distKm) return a.distKm - b.distKm;

          const aUpdated = ts(a.updated_at || a.created_at || null);
          const bUpdated = ts(b.updated_at || b.created_at || null);
          return bUpdated - aUpdated;
        });

      let eligibleDriverId = "";

      for (const row of ranked) {
        const candidateDriverId = text(row?.driver_id);
        if (!candidateDriverId) continue;
        if (!row?.eligibility?.assignEligible) continue;
        // ðŸ”’ HARD LOCK: skip drivers already in active trip
        const { data: activeTrip } = await supabase
          .from("bookings")
          .select("id")
          .eq("assigned_driver_id", candidateDriverId)
          .in("status", [
            "assigned",
            "accepted",
            "fare_proposed",
            "ready",
            "on_the_way",
            "arrived",
            "on_trip"
          ])
          .limit(1)
          .maybeSingle();

        if (activeTrip) continue;


        const eligibility = await isDriverWalletEligible(supabase, candidateDriverId);
        if (!eligibility.ok) continue;
        if (!eligibility.eligible) continue;

        eligibleDriverId = candidateDriverId;
        break;
      }

      if (!eligibleDriverId) {
        return NextResponse.json(
          {
            ok: false,
            error: emergencyMode ? "no_drivers_even_in_emergency" : "no_local_drivers",
            town: baseTown || null,
            reason: "NO_ASSIGN_ELIGIBLE_DRIVER_WITH_MIN_WALLET",
            assign_cutoff_minutes: ASSIGN_CUTOFF_MINUTES,
          },
          { status: 404 }
        );
      }

      chosenDriverId = eligibleDriverId;
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      driver_id: chosenDriverId,
      assigned_driver_id: chosenDriverId,
      status: "assigned",
      assigned_at: nowIso,
      updated_at: nowIso,
    };

    if (typeof body?.emergency_mode === "boolean") {
      updatePayload.is_emergency = body.emergency_mode;
    }

    const { data: updatedRows, error: assignError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id)
      .select("id, booking_code, status, driver_id, assigned_driver_id, assigned_at")
      .limit(1);

    if (assignError) {
      return NextResponse.json(
        { ok: false, error: "assignment_failed", message: assignError.message },
        { status: 500 }
      );
    }

    const updated = updatedRows?.[0] ?? null;

    return NextResponse.json({
      ok: true,
      booking_id: text(updated?.id || (booking as any).id),
      booking_code: text(updated?.booking_code || (booking as any).booking_code),
      driver_id: text(updated?.driver_id || chosenDriverId),
      assigned_driver_id: text(updated?.assigned_driver_id || chosenDriverId),
      status: text(updated?.status || "assigned"),
      assigned_at: updated?.assigned_at ?? nowIso,
      emergency_mode: emergencyMode,
      assignment_mode: explicitDriverId ? "manual" : "auto",
      assign_cutoff_minutes: ASSIGN_CUTOFF_MINUTES,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "server_error", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}

