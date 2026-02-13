export type TripEtaPhase = "to_pickup" | "on_trip";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface TripEtaResult {
  etaMinutes: number | null;
  distanceKm: number | null;
  durationSec: number | null;
}

/**
 * Centralized ETA calculator using Mapbox Directions (mapbox/cycling).
 * This is designed to be called from client components (BookingMapClient, TripEtaPhase, etc.)
 *
 * - phase "to_pickup": driver -> pickup
 * - phase "on_trip"  : driver -> dropoff (fallback to pickup -> dropoff if driver is missing)
 */
export async function getTripEta(args: {
  driver?: LatLng | null;
  pickup: LatLng;
  dropoff: LatLng;
  phase: TripEtaPhase;
}): Promise<TripEtaResult> {
  const { driver, pickup, dropoff, phase } = args;

  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  if (!token) {
    console.warn("[TripEtaCalc] NEXT_PUBLIC_MAPBOX_TOKEN is missing.");
    return {
      etaMinutes: null,
      distanceKm: null,
      durationSec: null,
    };
  }

  // Decide origin / destination based on phase
  let origin: LatLng | undefined;
  let dest: LatLng | undefined;

  if (phase === "to_pickup") {
    if (!driver) {
      console.warn("[TripEtaCalc] phase=to_pickup but driver location is missing.");
      return {
        etaMinutes: null,
        distanceKm: null,
        durationSec: null,
      };
    }
    origin = driver;
    dest = pickup;
  } else {
    // on_trip
    if (driver) {
      origin = driver;
      dest = dropoff;
    } else {
      origin = pickup;
      dest = dropoff;
    }
  }

  if (!origin || !dest) {
    console.warn("[TripEtaCalc] origin/dest not resolved.");
    return {
      etaMinutes: null,
      distanceKm: null,
      durationSec: null,
    };
  }

  const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`;

  // mapbox/cycling as recommended for JRide
  const profile = "mapbox/cycling";

  const url = new URL(
    `https://api.mapbox.com/directions/v5/${profile}/${coords}`
  );
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("overview", "simplified");
  url.searchParams.set("annotations", "duration,distance");
  url.searchParams.set("access_token", token);
  // 1 route is enough
  url.searchParams.set("alternatives", "false");

  try {
    const res = await fetch(url.toString());
    if (!res.ok) {
      console.error("[TripEtaCalc] Mapbox response not ok:", res.status, res.statusText);
      return {
        etaMinutes: null,
        distanceKm: null,
        durationSec: null,
      };
    }

    const data = await res.json();

    if (!data.routes || !data.routes[0]) {
      console.warn("[TripEtaCalc] No routes returned from Mapbox.");
      return {
        etaMinutes: null,
        distanceKm: null,
        durationSec: null,
      };
    }

    const route = data.routes[0];

    const durationSec = typeof route.duration === "number" ? route.duration : null;
    const distanceMeters = typeof route.distance === "number" ? route.distance : null;

    const etaMinutes =
      durationSec !== null ? Math.round(durationSec / 60) : null;
    const distanceKm =
      distanceMeters !== null
        ? Math.round((distanceMeters / 1000) * 10) / 10
        : null;

    return {
      etaMinutes,
      distanceKm,
      durationSec,
    };
  } catch (err) {
    console.error("[TripEtaCalc] Error calling Mapbox:", err);
    return {
      etaMinutes: null,
      distanceKm: null,
      durationSec: null,
    };
  }
}
