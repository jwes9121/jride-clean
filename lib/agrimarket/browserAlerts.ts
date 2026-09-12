// Shared, side-effect-free rules. Never import server credentials here.
export const AGRI_ALERT_SCOPE = "/agrimarket/producer";
export const AGRI_ALERT_WORKER = "/agrimarket-alerts-sw.js";
export const AGRI_ALERT_REPEAT_MS = 30_000;
export const AGRI_ALERT_STALE_MS = 25_000;

export type PendingFarmerOrder = {
  order_code: string;
  producer_confirm_expires_at: string;
};

export function pendingFarmerOrders(rows: PendingFarmerOrder[], now: number): PendingFarmerOrder[] {
  return rows.filter(row => /^AG-[A-Z0-9-]+$/i.test(row.order_code)
    && Date.parse(row.producer_confirm_expires_at) > now)
    .sort((a, b) => Date.parse(a.producer_confirm_expires_at) - Date.parse(b.producer_confirm_expires_at));
}

export function farmerOrderHref(code?: string): string {
  return AGRI_ALERT_SCOPE + (code && /^AG-[A-Z0-9-]+$/i.test(code) ? "#agri-order-" + code : "");
}

// Strict destination allowlist: a submitted endpoint must never become an SSRF proxy.
export function validPushEndpoint(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const allowed = host === "fcm.googleapis.com" || host === "updates.push.services.mozilla.com"
      || /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host)
      || host === "web.push.apple.com" || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
    return allowed && url.protocol === "https:" && !url.port && !url.username && !url.password
      && !url.hash && url.pathname.length > 1;
  } catch { return false; }
}

export function validPushKeys(keys: unknown): keys is { p256dh: string; auth: string } {
  if (!keys || typeof keys !== "object") return false;
  const { p256dh, auth } = keys as Record<string, unknown>;
  return typeof p256dh === "string" && /^[A-Za-z0-9_-]{87}=?$/.test(p256dh)
    && typeof auth === "string" && /^[A-Za-z0-9_-]{22}={0,2}$/.test(auth);
}

export function alertSendTtl(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.min(300, Math.floor((Date.parse(expiresAt) - now) / 1000))) || 0;
}
