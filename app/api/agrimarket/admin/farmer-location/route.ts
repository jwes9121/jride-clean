import { NextRequest } from "next/server";
import {
  AGRIMARKET_LAUNCH_TOWNS,
  reverseGeocodeFarmerPin,
  searchFarmerLocations,
} from "../../_lib/admin-farmer-location";
import { jsonNoStore, requireAgrimarketStaff } from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function finiteCoordinate(value: string | null, kind: "lat" | "lng"): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (kind === "lat" && (parsed < -90 || parsed > 90)) return null;
  if (kind === "lng" && (parsed < -180 || parsed > 180)) return null;
  return parsed;
}

export async function GET(req: NextRequest) {
  const staff = await requireAgrimarketStaff(true);
  if (!staff.ok) return staff.response;

  const query = String(req.nextUrl.searchParams.get("q") || "").trim();
  const lat = finiteCoordinate(req.nextUrl.searchParams.get("lat"), "lat");
  const lng = finiteCoordinate(req.nextUrl.searchParams.get("lng"), "lng");

  try {
    if (query) {
      if (query.length < 2 || query.length > 180) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_LOCATION_SEARCH_INVALID",
          message: "Enter at least two characters and no more than 180 characters.",
        });
      }

      const results = await searchFarmerLocations(query);
      return jsonNoStore(200, {
        ok: true,
        results,
        launch_towns: AGRIMARKET_LAUNCH_TOWNS,
      });
    }

    if (lat == null || lng == null) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_LOCATION_COORDINATES_REQUIRED",
        message: "A valid latitude and longitude are required.",
      });
    }

    const location = await reverseGeocodeFarmerPin(lat, lng);
    if (!location) {
      return jsonNoStore(422, {
        ok: false,
        error: "AGRIMARKET_PICKUP_PIN_UNRESOLVED",
        message: "JRide could not verify this pin as an Ifugao location. Move the pin to the exact pickup point and try again.",
      });
    }

    return jsonNoStore(200, {
      ok: true,
      location,
      launch_towns: AGRIMARKET_LAUNCH_TOWNS,
    });
  } catch (error: any) {
    const message = String(error?.message || error || "");
    const tokenMissing = message.includes("MAPBOX_TOKEN_MISSING");
    return jsonNoStore(tokenMissing ? 503 : 502, {
      ok: false,
      error: tokenMissing
        ? "AGRIMARKET_LOCATION_SERVICE_NOT_CONFIGURED"
        : "AGRIMARKET_LOCATION_SERVICE_UNAVAILABLE",
      message: tokenMissing
        ? "The map location service is not configured. Farmer provisioning is blocked until it is restored."
        : "The map location service is temporarily unavailable. Try again before creating farmer access.",
    });
  }
}
