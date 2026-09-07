import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jsonNoStore } from "@/app/api/agrimarket/_lib/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Requests only create pending access. UUID knowledge never approves a phone.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { id, driver_id, device_id, token_sha256, client_version = "" } = body || {};
    if (typeof id !== "string" || !UUID.test(id) || typeof driver_id !== "string" || !UUID.test(driver_id) ||
        typeof device_id !== "string" || !/^[0-9a-f]{16}$/.test(device_id) || typeof token_sha256 !== "string" || !/^[0-9a-f]{64}$/.test(token_sha256) || typeof client_version !== "string" || client_version.length > 60) {
      return jsonNoStore(400, { ok: false, error: "DRIVER_DEVICE_REQUEST_INVALID", message: "Check the saved driver UUID and try again." });
    }
    const result = await supabaseAdmin().rpc("agrimarket_request_driver_device_v1", { p_id: id, p_driver_id: driver_id, p_device_id: device_id, p_token_sha256: token_sha256, p_client_version: client_version });
    if (result.error) {
      const reason = String(result.error.message || "");
      const status = reason.includes("LIMIT") ? 429 : reason.includes("NOT_FOUND") ? 404 : reason.includes("CONFLICT") ? 409 : 503;
      return jsonNoStore(status, { ok: false, error: status === 429 ? "DRIVER_DEVICE_REQUEST_LIMIT" : "DRIVER_DEVICE_REQUEST_FAILED", message: status === 429 ? "Too many phone requests today. Contact JRide staff." : status === 404 ? "JRide could not find that driver record." : "Phone registration is unavailable. Please try again." });
    }
    return jsonNoStore(200, { ok: true, device: result.data });
  } catch {
    return jsonNoStore(400, { ok: false, error: "DRIVER_DEVICE_REQUEST_INVALID", message: "Phone registration could not be completed." });
  }
}
