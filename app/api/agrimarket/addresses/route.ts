import { NextRequest } from "next/server";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketPassenger,
} from "../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const passengerAuth = await requireAgrimarketPassenger(req);
    if (passengerAuth.ok === false) return passengerAuth.response;

    const admin = createServiceSupabase();
    const addressRes = await admin
      .from("passenger_addresses")
      .select("id,label,address_text,landmark,lat,lng,is_primary,updated_at")
      .eq("created_by_user_id", passengerAuth.user.id)
      .eq("is_active", true)
      .order("is_primary", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(25);

    if (addressRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_ADDRESSES_FAILED",
        message: addressRes.error.message,
      });
    }

    const addresses = (Array.isArray(addressRes.data) ? addressRes.data : []).map((row: any) => ({
      id: row.id,
      label: row.label || row.address_text,
      address_text: row.address_text,
      landmark: row.landmark || null,
      has_valid_pin: Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng)),
      is_primary: Boolean(row.is_primary),
      updated_at: row.updated_at,
    }));

    return jsonNoStore(200, {
      ok: true,
      addresses,
      selection_required: true,
      note: addresses.length
        ? "Select a delivery address before loading Agrimarket products."
        : "Add a saved JRide address with a map pin before using Agrimarket.",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_ADDRESSES_FAILED",
      message: String(error?.message || error),
    });
  }
}
