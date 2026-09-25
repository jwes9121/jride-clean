import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import { jsonNoStore } from "@/app/api/agrimarket/_lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const choices = ["motorcycle", "tricycle", "kolong_kolong"];

const fail = (status: number, error: string, message: string) => jsonNoStore(status, { ok: false, error, message });

export async function GET(req: Request) {
  try {
    const identity = await resolveDriverRequest(req, new URL(req.url).searchParams.get("driver_id"), { requireBearer: true });
    if (!identity.ok || !identity.driverId) return jsonNoStore(identity.status || 401, { ok: false, error: identity.error });
    const result = await supabaseAdmin({ noStore: true }).from("driver_profiles")
      .select("vehicle_type").eq("driver_id", identity.driverId).maybeSingle();
    if (result.error) return fail(503, "DRIVER_VEHICLE_UNAVAILABLE", "Your vehicle could not be loaded. Please retry.");
    if (!result.data) return fail(404, "DRIVER_NOT_FOUND", "Your driver profile could not be found.");
    return jsonNoStore(200, { ok: true, driver_id: identity.driverId, vehicle_type: result.data.vehicle_type, choices });
  } catch {
    return fail(503, "DRIVER_VEHICLE_UNAVAILABLE", "Your vehicle could not be loaded. Please retry.");
  }
}

export async function POST(req: Request) {
  let body: any;
  try { body = await req.json(); } catch { return fail(400, "INVALID_VEHICLE", "Choose a vehicle and try again."); }
  if (!body || !choices.includes(body.vehicle_type) ||
      !(body.expected_vehicle_type === null || typeof body.expected_vehicle_type === "string")) {
    return fail(400, "INVALID_VEHICLE", "Choose Motorcycle, Tricycle, or Kolong-Kolong.");
  }
  try {
    const identity = await resolveDriverRequest(req, body.driver_id, { requireBearer: true });
    if (!identity.ok || !identity.driverId) return jsonNoStore(identity.status || 401, { ok: false, error: identity.error });
    const admin = supabaseAdmin({ noStore: true });
    const driverId = identity.driverId;
    const [location, bookings, orders, offers] = await Promise.all([
      admin.from("driver_locations").select("status").eq("driver_id", driverId),
      admin.from("bookings").select("id").or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
        .in("status", ["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"]).limit(1),
      admin.from("agrimarket_orders").select("id").eq("assigned_driver_id", driverId)
        .in("status", ["driver_assigned", "picked_up", "delivering"]).limit(1),
      admin.from("agrimarket_driver_offers").select("id").eq("driver_id", driverId)
        .eq("status", "offered").gt("expires_at", new Date().toISOString()).limit(1),
    ]);
    if ([location, bookings, orders, offers].some(r => r.error)) {
      return fail(503, "DRIVER_VEHICLE_UNAVAILABLE", "Your duty status could not be checked. Please retry.");
    }
    if ((location.data || []).some((row: any) => String(row.status || "").toLowerCase() !== "offline")) {
      return fail(409, "DRIVER_MUST_BE_OFFLINE", "Go offline before changing your vehicle.");
    }
    if ([bookings, orders, offers].some(r => (r.data || []).length > 0)) {
      return fail(409, "DRIVER_HAS_ACTIVE_JOB", "Finish your current job or resolve your offer before changing vehicles.");
    }
    // Compare against the last server value, including null/legacy spellings.
    // The existing location ping reads this canonical profile before going online;
    // the client never writes vehicle_type directly into dispatch locations.
    let update = admin.from("driver_profiles").update({ vehicle_type: body.vehicle_type }).eq("driver_id", driverId);
    update = body.expected_vehicle_type === null
      ? update.is("vehicle_type", null) : update.eq("vehicle_type", body.expected_vehicle_type);
    const saved = await update.select("vehicle_type").maybeSingle();
    if (saved.error) return fail(503, "DRIVER_VEHICLE_UNAVAILABLE", "Your vehicle could not be saved. Please retry.");
    if (!saved.data) return fail(409, "DRIVER_VEHICLE_CHANGED", "Your vehicle changed elsewhere. Refresh and choose again.");
    return jsonNoStore(200, { ok: true, driver_id: driverId, vehicle_type: saved.data.vehicle_type, choices });
  } catch {
    return fail(503, "DRIVER_VEHICLE_UNAVAILABLE", "Your vehicle could not be saved. Please retry.");
  }
}
