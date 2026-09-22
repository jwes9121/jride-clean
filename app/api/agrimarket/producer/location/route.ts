import { NextRequest } from "next/server";
import {
  agrimarketFarmerPortalDisabledResponse,
  agrimarketFarmerPortalEnabled,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../_lib/server";
import { reverseGeocodeFarmerPin, searchFarmerLocations } from "../../_lib/admin-farmer-location";
import { FARMER_TOWN_CENTERS } from "@/lib/agrimarket/farmer-towns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Profile editing is authenticated farmer activity, not a public application.
// Keep this route within the existing farmer session cookie path.
export async function GET(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  const auth = await requireAgrimarketProducer(req);
  if (!auth.ok) return auth.response;

  const params = req.nextUrl.searchParams;
  const town = String(auth.producer.town || "").trim();
  const requestedTown = (params.get("town") || "").trim();
  if (!Object.hasOwn(FARMER_TOWN_CENTERS, town) || (requestedTown && requestedTown !== town)) {
    return jsonNoStore(400, { ok: false, message: "Use the municipality assigned to your farmer account." });
  }

  try {
    const query = (params.get("q") || "").trim();
    if (query) {
      if (query.length < 2 || query.length > 180) {
        return jsonNoStore(400, { ok: false, message: "Enter a place name between 2 and 180 characters." });
      }
      const results = await searchFarmerLocations(query, town);
      return jsonNoStore(200, { ok: true, results: results.filter((place) => place.town === town && place.launch_eligible) });
    }

    const latRaw = params.get("lat");
    const lngRaw = params.get("lng");
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!latRaw?.trim() || !lngRaw?.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return jsonNoStore(400, { ok: false, message: "Place a valid pickup pin." });
    }
    const location = await reverseGeocodeFarmerPin(lat, lng);
    if (!location) {
      return jsonNoStore(422, { ok: false, message: "JRide could not verify this pickup point in Ifugao. Move the pin and try again." });
    }
    if (!location.launch_eligible || location.town !== town) {
      return jsonNoStore(422, { ok: false, message: `The pickup pin must be inside ${town}.` });
    }
    return jsonNoStore(200, { ok: true, location });
  } catch {
    return jsonNoStore(502, { ok: false, message: "The location service is unavailable. Please try again." });
  }
}
