import { NextRequest } from "next/server";
import {
  agrimarketFarmerPortalDisabledResponse,
  agrimarketFarmerPortalEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../_lib/server";
import { reverseGeocodeFarmerPin, searchFarmerLocations } from "../../_lib/admin-farmer-location";
import { FARMER_TOWN_CENTERS } from "@/lib/agrimarket/farmer-towns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Profile editing is authenticated farmer activity, not a public application.
// During first setup, the farmer may correct the preassigned municipality.
// After the farm/store name is confirmed, municipality becomes JRide-managed.
export async function GET(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  const auth = await requireAgrimarketProducer(req);
  if (!auth.ok) return auth.response;

  const profile = await createServiceSupabase()
    .from("agrimarket_producers")
    .select("town,vendor_name_locked_at")
    .eq("id", auth.producer.id)
    .limit(1)
    .maybeSingle();

  if (profile.error) {
    return jsonNoStore(503, {
      ok: false,
      error: "AGRIMARKET_FARMER_PROFILE_READ_FAILED",
      message: "JRide could not verify your farm municipality. Please try again.",
    });
  }
  if (!profile.data) {
    return jsonNoStore(404, {
      ok: false,
      error: "AGRIMARKET_PRODUCER_NOT_FOUND",
      message: "This farmer account could not be found.",
    });
  }

  const params = req.nextUrl.searchParams;
  const assignedTown = String(profile.data.town || "").trim();
  const requestedTown = (params.get("town") || "").trim();
  const townLocked = Boolean(profile.data.vendor_name_locked_at);
  const town = requestedTown || assignedTown;

  if (!Object.hasOwn(FARMER_TOWN_CENTERS, town)) {
    return jsonNoStore(400, {
      ok: false,
      error: "AGRIMARKET_FARMER_TOWN_INVALID",
      message: "Choose Lagawe, Hingyon, Banaue, or Lamut.",
    });
  }
  if (townLocked && town !== assignedTown) {
    return jsonNoStore(409, {
      ok: false,
      error: "AGRIMARKET_FARMER_TOWN_LOCKED",
      message: "Municipality is locked after farm setup. Contact JRide for a correction.",
    });
  }

  try {
    const query = (params.get("q") || "").trim();
    if (query) {
      if (query.length < 2 || query.length > 180) {
        return jsonNoStore(400, { ok: false, message: "Enter a place name between 2 and 180 characters." });
      }
      const results = await searchFarmerLocations(query, town);
      return jsonNoStore(200, {
        ok: true,
        results: results.filter((place) => place.town === town && place.launch_eligible),
      });
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
      return jsonNoStore(422, {
        ok: false,
        message: "JRide could not verify this pickup point in Ifugao. Move the pin and try again.",
      });
    }
    if (!location.launch_eligible || location.town !== town) {
      return jsonNoStore(422, { ok: false, message: `The pickup pin must be inside ${town}.` });
    }
    return jsonNoStore(200, { ok: true, location });
  } catch {
    return jsonNoStore(502, { ok: false, message: "The location service is unavailable. Please try again." });
  }
}
