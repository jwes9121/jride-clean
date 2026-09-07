import type { NextRequest } from "next/server";
import { agrimarketFarmerPortalEnabled, agrimarketFarmerPortalDisabledResponse, requireAgrimarketProducer, createServiceSupabase, jsonNoStore } from "../../_lib/server";
import { normalizeButchering } from "@/lib/agrimarket/butchering";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return agrimarketFarmerPortalDisabledResponse();
  const auth = await requireAgrimarketProducer(req);
  if (!auth.ok) return auth.response;
  let body;
  try {
    const reader = req.body?.getReader();
    if (!reader) throw new Error("Enter the butchering details.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 65536) { await reader.cancel(); return jsonNoStore(413, { ok: false, message: "Use no more than 30 cuts and a shorter description." }); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { return jsonNoStore(400, { ok: false, message: "Enter the butchering details." }); }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(body?.request_id || ""))) return jsonNoStore(400, { ok: false, message: "Refresh the form and try again." });
  let payload;
  try { payload = normalizeButchering(body); }
  catch (error) { return jsonNoStore(400, { ok: false, message: error instanceof Error ? error.message : "Check the meat cuts and schedule." }); }
  const result = await createServiceSupabase().rpc("agrimarket_create_butchering_batch_v1", { p_producer_id: auth.producer.id, p_request_id: body.request_id, p_payload: payload });
  if (result.error) {
    const reason = String(result.error.message || "");
    const invalid = /BUTCHERING_(INPUT|SCHEDULE)_INVALID/.test(reason);
    const conflict = reason.includes("BUTCHERING_REQUEST_CONFLICT");
    return jsonNoStore(invalid ? 400 : conflict ? 409 : 503, { ok: false, error: conflict ? "BUTCHERING_REQUEST_CONFLICT" : "BUTCHERING_SAVE_FAILED", message: invalid ? "Choose a future reservation cutoff before the butchering date, and check every cut." : conflict ? "This saved request has different details. Refresh your products before starting another schedule." : "The schedule could not be confirmed. Retry the same form to check what was saved." });
  }
  return jsonNoStore(200, { ok: true, batch: result.data });
}
