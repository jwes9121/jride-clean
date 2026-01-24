import { NextResponse } from "next/server";
import supabase from "@/lib/supabaseClient";

// Haversine distance in km between two lat/lng pairs
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371; // Earth radius in km
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = body.bookingId as string | undefined;
    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);

    if (!bookingId || Number.isNaN(pickupLat) || Number.isNaN(pickupLng)) {
      return NextResponse.json(
        { error: "MISSING_FIELDS" },
        { status: 400 }
      );
    }

    // 1) Load driver locations
    const { data: driverRows, error: locError } = await supabase
      .from("driver_locations")
      .select("driver_id, lat, lng, status, updated_at, town");

    if (locError) {
      console.error("driver_locations error", locError);
      throw locError;
    }

    if (!driverRows || driverRows.length === 0) {
      return NextResponse.json(
        { error: "NO_DRIVERS" },
        { status: 400 }
      );
    }

    // 2) Candidates: any driver with coordinates, not explicitly on_trip
    const candidates = driverRows.filter((row: any) => {
      if (row.lat == null || row.lng == null) return false;
    // ===== STEP 5B: filteredCandidates (loop-visible) =====
    let filteredCandidates = candidates;
// ===== END STEP 5B: filteredCandidates =====

    


      const statusText = String(row.status ?? "").toLowerCase();

      // treat "on_trip" as busy; everything else (online, available, offline) is allowed for now
      if (statusText === "on_trip") return false;

      return true;
    });

    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "NO_AVAILABLE_DRIVER" },
        { status: 400 }
      );
    }

    // 3) Find nearest by haversine distance
    let best: any = null;
    let bestDistance = Infinity;
    // ===== STEP 5B: ensure filteredCandidates exists in loop scope =====
    let filteredCandidates = candidates;
    // ===== END STEP 5B =====


    for (const d of filteredCandidates) {
      const distKm = haversine(
        pickupLat,
        pickupLng,
        Number(d.lat),
        Number(d.lng)
      );
      if (distKm < bestDistance) {
        bestDistance = distKm;
        best = d;
      }
    }

    if (!best) {
      return NextResponse.json(
        { error: "NO_DRIVER_FOUND" },
        { status: 400 }
      );
    }

    // 4) Update booking with assigned driver
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        assigned_driver_id: best.driver_id,
        status: "assigned",
      })
      .eq("id", bookingId);

    if (updateError) {
      console.error("update booking error", updateError);
      throw updateError;
    }

    return NextResponse.json({
      ok: true,
      assignedDriverId: best.driver_id,
      distanceKm: bestDistance,
    });
  } catch (err: any) {
    console.error("auto-assign error", err);
    return NextResponse.json(
      { error: err?.message ?? "SERVER_ERROR" },
      { status: 500 }
    );
  }
}
