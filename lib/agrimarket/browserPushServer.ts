import webpush from "web-push";
import { alertSendTtl, validPushEndpoint, validPushKeys } from "./browserAlerts";

type Database = { rpc: (name: string, args?: any) => PromiseLike<{ data: any; error: any }> };

export async function browserPushConfig(db: Database) {
  const result = await db.rpc("agrimarket_browser_config_v1");
  if (result.error) throw new Error("AGRIMARKET_BROWSER_ALERTS_NOT_CONFIGURED");
  const config = result.data;
  if (!config?.enabled || !config?.public_key || !config?.private_key) return null;
  return config as { enabled: boolean; public_key: string; private_key: string };
}

export async function sendFarmerBrowserAlerts(db: Database, producerId?: string) {
  const config = await browserPushConfig(db);
  if (!config) return { enabled: false, sent: 0, failed: 0 };
  const claim = await db.rpc("agrimarket_browser_claim_v1", { p_producer_id: producerId || null, p_limit: 10 });
  if (claim.error) throw new Error("AGRIMARKET_BROWSER_ALERT_CLAIM_FAILED");
  let sent = 0;
  let failed = 0;
  await Promise.all((claim.data || []).map(async (job: { id: string; lease_id: string }) => {
    let result = "STALE";
    try {
      // Re-check the order, account, credential version and deadline immediately before sending.
      const validation = await db.rpc("agrimarket_browser_validate_v1", { p_id: job.id, p_lease: job.lease_id });
      if (validation.error) throw new Error("VALIDATION_FAILED");
      const message = validation.data;
      const ttl = message ? alertSendTtl(message.expires_at) : 0;
      if (message && ttl > 0) {
        if (!validPushEndpoint(message.endpoint) || !validPushKeys(message.keys)) result = "INVALID_SUBSCRIPTION";
        else {
          await webpush.sendNotification({ endpoint: message.endpoint, keys: message.keys }, JSON.stringify({
            type: "jride-agrimarket", kind: message.kind, event_id: job.id,
            order_code: message.order_code, expires_at: message.expires_at,
          }), {
            vapidDetails: { subject: "https://app.jride.net", publicKey: config.public_key, privateKey: config.private_key },
            TTL: ttl, urgency: "high", timeout: 5000,
            topic: job.id.replace(/-/g, ""),
          });
          result = "SENT";
          sent++;
        }
      }
    } catch (error: any) {
      result = [404, 410].includes(Number(error?.statusCode)) ? "SUBSCRIPTION_GONE" : "SEND_FAILED";
      failed++;
    }
    const finish = await db.rpc("agrimarket_browser_finish_v1", { p_id: job.id, p_lease: job.lease_id, p_result: result });
    if (finish.error) throw new Error("AGRIMARKET_BROWSER_ALERT_FINISH_FAILED");
  }));
  return { enabled: true, sent, failed };
}
