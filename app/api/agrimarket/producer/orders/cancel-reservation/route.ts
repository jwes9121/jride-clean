import type { NextRequest } from "next/server";
import { reservationCancelReason } from "@/lib/agrimarket/reservationCancellation";
import { agrimarketEnabled, agrimarketDisabledResponse, requireAgrimarketProducer, createServiceSupabase, jsonNoStore } from "../../../_lib/server";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();
  if ((req.headers.get("origin") && req.headers.get("origin") !== req.nextUrl.origin) || req.headers.get("sec-fetch-site") === "cross-site") {
    return jsonNoStore(403, { ok: false, message: "Open the reservation from your JRide farmer workspace." });
  }
  try {
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;
    const raw = await req.text();
    if (raw.length > 12000) return jsonNoStore(413, { ok: false, message: "The cancellation request is too large." });
    let body;
    try { body = JSON.parse(raw); } catch { return jsonNoStore(400, { ok: false, message: "Check the cancellation details." }); }
    const code = typeof body?.order_code === "string" ? body.order_code.trim() : "";
    const note = typeof body?.reason_note === "string" ? body.reason_note.trim() : "";
    const ids = body?.affected_product_ids;
    const version = body?.expected_updated_at;
    if (!/^AG-[A-Z0-9-]{1,80}$/i.test(code) || !reservationCancelReason(body?.reason_code) ||
        body?.confirm_cancel_all !== true || !Array.isArray(ids) || ids.length < 1 || ids.length > 50 ||
        ids.some(id => typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) ||
        new Set(ids).size !== ids.length || typeof version !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(version) || !Number.isFinite(Date.parse(version)) ||
        note.length > 500 || (body.reason_code === "other" && note.length < 5)) {
      return jsonNoStore(400, { ok: false, message: "Choose a reason and the unavailable cuts, then confirm cancellation of the entire reservation. Other reasons need an explanation." });
    }
    const result = await createServiceSupabase().rpc("agrimarket_producer_cancel_reservation_v1", {
      p_order_code: code, p_producer_id: auth.producer.id, p_reason_code: body.reason_code,
      p_affected_product_ids: ids, p_reason_note: note || null,
      // Preserve the database's microseconds; converting to JS ISO would truncate them.
      p_expected_updated_at: version,
    });
    if (result.error) return jsonNoStore(503, { ok: false, message: "Cancellation could not be confirmed. Refresh this reservation before retrying." });
    if (result.data?.ok !== true) return jsonNoStore(result.data?.error === "AGRIMARKET_ORDER_NOT_FOUND" ? 404 : 409, {
      ok: false, error: result.data?.error || "AGRIMARKET_RESERVATION_CANCEL_FAILED",
      message: result.data?.message || "The reservation changed or can no longer be cancelled here. Refresh it; contact JRide if a driver, cash or goods are involved.",
    });
    return jsonNoStore(200, { ok: true, result: result.data,
      message: result.data.already_done === true
        ? "This reservation was already cancelled. No stock or other orders were changed by this retry."
        : "The entire reservation is cancelled. The selected unavailable cuts are paused for new orders. Update their actual stock before turning them on again. Other reservations were not cancelled; review any remaining reservations for these cuts." });
  } catch {
    return jsonNoStore(503, { ok: false, message: "Cancellation could not be confirmed. Refresh the reservation to check its status." });
  }
}
