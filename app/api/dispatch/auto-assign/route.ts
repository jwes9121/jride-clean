import { NextResponse } from "next/server";
import supabase from "@/lib/supabaseClient";

// Haversine distance in km between two lat/lng pairs
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function str(x: any) {
  return String(x ?? "").trim();
}

// STEP 5C pickup fee matrix (PHP) - emergency only
function computeEmergencyPickupFeePhp(distKm: number) {
  const FREE_KM = 1.5;
  if (!Number.isFinite(distKm) || distKm <= FREE_KM) return 0;

  if (distKm <= 2.0) return 20;
  if (distKm <= 2.5) return 40;
  if (distKm <= 3.0) return 50;

  const extraKm = distKm - 3.0;
  const steps = Math.ceil(extraKm / 0.5);
  return 50 + steps * 10;
}

// Best-effort update for OPTIONAL fields only.
// Do NOT use this for lifecycle-critical fields like status/assignment.
async function updateBookingBestEffort(bookingId: string, base: any, extras: any) {
  const attempts: any[] = [];

  attempts.push({ ...base, ...extras });

  const dropKeys = [
    "pickup_distance_km",
    "pickup_distance",
    "pickup_distance_m",
    "pickup_surcharge_php",
    "pickup_extra_fee_php",
    "emergency_pickup_fee_php",
  ];

  for (let i = 0; i < dropKeys.length; i++) {
    const k = dropKeys[i];
    const prev = attempts[attempts.length - 1];
    if (prev && Object.prototype.hasOwnProperty.call(prev, k)) {
      const next: any = { ...prev };
      delete next[k];
      attempts.push(next);
    }
  }

  attempts.push({ ...base });

  for (const payload of attempts) {
    const { error } = await supabase.from("bookings").update(payload).eq("id", bookingId);
    if (!error) return { ok: true, payloadUsed: payload };

    const msg = String((error as any)?.message ?? "");
    const missingCol =
      msg.toLowerCase().includes("does not exist") ||
      msg.toLowerCase().includes("column") ||
      msg.toLowerCase().includes("unknown column");

    if (!missingCol) {
      return { ok: false, error: msg };
    }
  }

  return {
    ok: true,
    payloadUsed: base,
    warning: "Columns for distance/fee not found; persisted base update only.",
  };
}

export async function POST(req: Request) {
  try {
    const body: any = await req.json().catch(() => ({}));

    const bookingId = str(body.bookingId);
    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);

    if (!bookingId || Number.isNaN(pickupLat) || Number.isNaN(pickupLng)) {
      return NextResponse.json({ error: "MISSING_FIELDS" }, { status: 400 });
    }

    // ===== STEP 5B: Emergency cross-town mode (town gate) =====
    let isEmergency = body?.is_emergency === true || body?.isEmergency === true;
    let bookingTown = "";

    try {
      const { data: bk, error: bookingReadError } = await supabase
        .from("bookings")
        .select("*")
        .eq("id", bookingId)
        .maybeSingle();

      if (!bookingReadError && bk) {
        if ((bk as any)?.is_emergency === true) {
          isEmergency = true;
        }

        const candidatesTown: any[] = [
          (bk as any)?.pickup_town,
          (bk as any)?.town,
          (bk as any)?.passenger_town,
          (bk as any)?.pickupTown,
          (bk as any)?.pickup_town_name,
        ];

        for (const t of candidatesTown) {
          const s = str(t);
          if (s) {
            bookingTown = s;
            break;
          }
        }
      }
    } catch {
      // safe fallback
    }
    // ===== END STEP 5B =====

    // 1) Load driver locations
    const { data: driverRows, error: driverLocationsError } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, status, updated_at, town");

    if (driverLocationsError) {
      console.error("driver_locations error", driverLocationsError);
      throw driverLocationsError;
    }

    if (!driverRows || driverRows.length === 0) {
      return NextResponse.json({ error: "NO_DRIVERS" }, { status: 400 });
    }

    // 2) Candidates: any driver with coords, not explicitly on_trip
    const candidates = (driverRows as any[]).filter((row: any) => {
      if (row?.lat == null || row?.lng == null) return false;
      const statusText = str(row?.status).toLowerCase();
      if (statusText === "on_trip") return false;
      return true;
    });

    if (candidates.length === 0) {
      return NextResponse.json({ error: "NO_AVAILABLE_DRIVER" }, { status: 400 });
    }

    // 2.5) Town gate (normal mode only)
    let filteredCandidates = candidates;
    if (!isEmergency && bookingTown) {
      const bt = bookingTown.toLowerCase();
      const sameTown = candidates.filter((d: any) => str(d?.town).toLowerCase() === bt);
      filteredCandidates = sameTown.length > 0 ? sameTown : candidates;
    }

    // 3) Find nearest by haversine distance
    let best: any = null;
    let bestDistanceKm = Infinity;

    for (const d of filteredCandidates) {
      const distKm = haversine(pickupLat, pickupLng, Number(d.lat), Number(d.lng));
      if (distKm < bestDistanceKm) {
        bestDistanceKm = distKm;
        best = d;
      }
    }

    if (!best) {
      return NextResponse.json({ error: "NO_DRIVER_FOUND" }, { status: 400 });
    }

    // ===== STEP 5C: pickup fee (emergency only) =====
    const pickup_distance_km = Number(bestDistanceKm);
    const free_pickup_km = 1.5;
    const emergency_pickup_fee_php = isEmergency
      ? computeEmergencyPickupFeePhp(pickup_distance_km)
      : 0;
    // ===== END STEP 5C =====

    // 4) CRITICAL WRITE: assignment + lifecycle state must be atomic
    const criticalUpdate = {
      assigned_driver_id: best.driver_id,
      driver_id: best.driver_id,
      status: "assigned",
    };

    const { error: criticalWriteError } = await supabase
      .from("bookings")
      .update(criticalUpdate)
      .eq("id", bookingId);

    if (criticalWriteError) {
      return NextResponse.json(
        {
          ok: false,
          error: "ASSIGN_FAILED",
          details: criticalWriteError.message,
        },
        { status: 500 }
      );
    }

    // 5) OPTIONAL write: persist distance/fee fields best-effort only
    const optionalExtras = {
      pickup_distance_km,
      pickup_distance: pickup_distance_km,
      pickup_distance_m: Math.round(pickup_distance_km * 1000),
      pickup_surcharge_php: emergency_pickup_fee_php,
      pickup_extra_fee_php: emergency_pickup_fee_php,
      emergency_pickup_fee_php,
      is_emergency: isEmergency,
    };

    const optionalUpdateResult = await updateBookingBestEffort(bookingId, {}, optionalExtras);
    if (!optionalUpdateResult.ok) {
      console.warn("[auto-assign] optional booking update failed", optionalUpdateResult.error);
    }

    return NextResponse.json({
      ok: true,
      assignedDriverId: best.driver_id,
      status: "assigned",

      // STEP 5B/5C info for UI
      is_emergency: isEmergency,
      bookingTown: bookingTown || null,
      pickup_distance_km,
      free_pickup_km,
      emergency_pickup_fee_php,

      // Debug counts
      candidates_total: candidates.length,
      candidates_used: filteredCandidates.length,

      // Optional persistence note
      persisted: true,
      persistence_warning: (optionalUpdateResult as any)?.warning || null,
    });
  } catch (err: any) {
    console.error("auto-assign error", err);
    return NextResponse.json(
      { error: err?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}