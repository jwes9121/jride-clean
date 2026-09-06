import { NextRequest } from "next/server";
import { agrimarketOnboardingEnabled, agrimarketOnboardingDisabledResponse, jsonNoStore, requireAgrimarketStaff } from "../_lib/server";
import { reverseGeocodeFarmerPin, searchFarmerLocations } from "../_lib/admin-farmer-location";
import { FARMER_TOWN_CENTERS } from "@/lib/agrimarket/farmer-towns";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!agrimarketOnboardingEnabled()) {
    const staff = await requireAgrimarketStaff(false);
    if (!staff.ok) return agrimarketOnboardingDisabledResponse();
  }
  const params = req.nextUrl.searchParams;
  const query = (params.get("q") || "").trim();
  const town = params.get("town") || "";
  try {
    if (query) {
      if (query.length < 2 || query.length > 180 || !Object.hasOwn(FARMER_TOWN_CENTERS, town)) return jsonNoStore(400, { ok: false, message: "Choose a municipality and enter a place name." });
      return jsonNoStore(200, { ok: true, results: await searchFarmerLocations(query, town) });
    }
    const latRaw = params.get("lat"); const lngRaw = params.get("lng");
    const lat = Number(latRaw); const lng = Number(lngRaw);
    if (!latRaw?.trim() || !lngRaw?.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return jsonNoStore(400, { ok: false, message: "Place a valid pickup pin." });
    const location = await reverseGeocodeFarmerPin(lat, lng);
    return location ? jsonNoStore(200, { ok: true, location }) : jsonNoStore(422, { ok: false, message: "JRide could not verify this pickup point in Ifugao." });
  } catch {
    return jsonNoStore(502, { ok: false, message: "The location service is unavailable. Please try again." });
  }
}
