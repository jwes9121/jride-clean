import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { createServiceSupabase, jsonNoStore, agrimarketFarmerPortalEnabled } from "@/app/api/agrimarket/_lib/server";
import { sendFarmerBrowserAlerts } from "@/lib/agrimarket/browserPushServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET || "";
  const expected = Buffer.from("Bearer " + secret);
  const actual = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return jsonNoStore(401, { ok: false, error: "UNAUTHORIZED" });
  }
  if (!agrimarketFarmerPortalEnabled()) return jsonNoStore(200, { ok: true, enabled: false });
  const start = Date.now();
  console.log(JSON.stringify({ level: "info", route: "agrimarket-browser-alerts", event: "start" }));
  try {
    const result = await sendFarmerBrowserAlerts(createServiceSupabase());
    console.log(JSON.stringify({ level: "info", route: "agrimarket-browser-alerts", event: "done", ms: Date.now() - start, ...result }));
    return jsonNoStore(200, { ok: true, ...result });
  } catch {
    console.error(JSON.stringify({ level: "error", route: "agrimarket-browser-alerts", event: "failed", ms: Date.now() - start }));
    return jsonNoStore(503, { ok: false, error: "AGRIMARKET_BROWSER_ALERT_WORKER_FAILED" });
  }
}
