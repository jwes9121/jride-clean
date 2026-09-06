import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import { jsonNoStore } from "@/app/api/agrimarket/_lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Available during pre-launch so native clients can establish individual identity.
export async function GET(req: Request) {
  try {
    const identity = await resolveDriverRequest(req, null, { requireBearer: true });
    if (!identity.ok) return jsonNoStore(identity.status || 401, { ok: false, error: identity.error });
    return jsonNoStore(200, { ok: true, driver_id: identity.driverId, auth_mode: "bearer" });
  } catch {
    return jsonNoStore(503, { ok: false, error: "DRIVER_AUTH_UNAVAILABLE" });
  }
}
