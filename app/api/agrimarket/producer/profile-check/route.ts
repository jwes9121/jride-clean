import { NextRequest } from "next/server";
import {
  agrimarketFarmerPortalDisabledResponse,
  agrimarketFarmerPortalEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../_lib/server";
import { isAgrimarketActiveTown } from "@/lib/agrimarket/farmer-towns";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function clean(value: unknown): string {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizePhilippineMobile(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `+63${digits}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return null;
}

export async function GET(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();

  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;

    const town = clean(req.nextUrl.searchParams.get("town"));
    const phone = clean(req.nextUrl.searchParams.get("phone"));
    const vendorName = clean(req.nextUrl.searchParams.get("vendor_name"));

    if (!isAgrimarketActiveTown(town)) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_FARMER_TOWN_INVALID",
        message: "Choose Lagawe, Hingyon, Banaue, or Lamut.",
      });
    }

    const normalizedPhone = normalizePhilippineMobile(phone);
    if (!normalizedPhone) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_FARMER_PHONE_INVALID",
        message: "Enter a valid Philippine mobile number.",
      });
    }

    if (vendorName.length > 60) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_STORE_NAME_INVALID",
        message: "Farm/store name must be 60 characters or fewer.",
      });
    }

    const result = await createServiceSupabase().rpc("agrimarket_farmer_profile_conflicts_v1", {
      p_producer_id: auth.producer.id,
      p_town: town,
      p_phone_normalized: normalizedPhone,
      p_vendor_name: vendorName,
    });

    if (result.error) {
      return jsonNoStore(503, {
        ok: false,
        error: "AGRIMARKET_PROFILE_CHECK_UNAVAILABLE",
        message: "JRide could not check the mobile number and store name. Try again.",
      });
    }

    const rows = Array.isArray(result.data) ? result.data : [];
    const row: any = rows[0] || result.data || {};
    return jsonNoStore(200, {
      ok: true,
      phone_available: row.phone_taken !== true,
      store_name_available: vendorName.length >= 2 ? row.vendor_name_taken !== true : null,
      normalized_phone: normalizedPhone,
      town,
      vendor_name: vendorName,
    });
  } catch {
    return jsonNoStore(503, {
      ok: false,
      error: "AGRIMARKET_PROFILE_CHECK_UNAVAILABLE",
      message: "JRide could not check the mobile number and store name. Try again.",
    });
  }
}
