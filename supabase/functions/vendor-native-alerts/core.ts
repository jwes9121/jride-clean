export const PROJECT = "jride-notifications";
export type Claim = { installation_id: string; lease_id: string };
export type Alert = { token: string; vendor_id: string; session_hash: string; event_id: string;
  type: "order" | "clear"; pending_count: number; sent_at: number; expires_at: number; sound_enabled: boolean };
export type Account = { project_id: string; client_email: string; private_key: string };
export type Dependencies = {
  rpc: (name: string, args?: object) => Promise<any>;
  send: (alert: Alert, account: Account) => Promise<void>;
  now: () => number;
};

export async function matchesSecret(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map(s => crypto.subtle.digest("SHA-256", enc.encode(s))));
  const one = new Uint8Array(x), two = new Uint8Array(y);
  let difference = 0;
  for (let i = 0; i < one.length; i++) difference |= one[i] ^ two[i];
  return difference === 0;
}

export function payload(alert: Alert, now: number) {
  if (!Number.isFinite(alert.expires_at) || !Number.isFinite(alert.sent_at) || alert.expires_at <= now ||
    alert.expires_at - alert.sent_at > 300000 || alert.sent_at > now + 60000 ||
    !["order", "clear"].includes(alert.type) || (alert.type === "order" && alert.pending_count < 1)) {
    throw new Error("STALE_ALERT");
  }
  const ttl = Math.max(0, Math.min(25, Math.floor((alert.expires_at - now) / 1000)));
  return { message: { token: alert.token, data: {
    type: alert.type, vendor_id: alert.vendor_id, session_hash: alert.session_hash,
    event_id: alert.event_id, pending_count: String(alert.pending_count),
    sent_at: String(alert.sent_at), expires_at: String(alert.expires_at),
    sound_enabled: String(alert.sound_enabled),
  }, android: { priority: alert.type === "order" ? "HIGH" : "NORMAL", ttl: `${ttl}s`,
    collapse_key: "vendor-pending-orders", restricted_package_name: "com.jride.vendor" } } };
}

export async function handle(request: Request, deps: Dependencies): Promise<Response> {
  const reply = (status: number, body: object) => Response.json(body, { status });
  if (request.method !== "POST") return reply(405, { error: "METHOD_NOT_ALLOWED" });
  const supplied = request.headers.get("x-vendor-native-hook") || "";
  if (supplied.length < 32 || supplied.length > 256) return reply(401, { error: "UNAUTHORIZED" });
  try {
    const config = await deps.rpc("vendor_native_worker_config");
    if (!config?.hook_secret || !await matchesSecret(supplied, config.hook_secret)) return reply(401, { error: "UNAUTHORIZED" });
    if (!config.enabled) return reply(200, { enabled: false, sent: 0 });
    const account: Account = config.firebase;
    if (account?.project_id !== PROJECT || !account.client_email?.endsWith(".iam.gserviceaccount.com") || !account.private_key) {
      return reply(503, { error: "FIREBASE_SENDER_NOT_CONFIGURED" });
    }
    const claims: Claim[] = await deps.rpc("vendor_native_claim");
    let sent = 0, failed = 0, skipped = 0;
    // SQL caps this claim at 24 devices. Start them together so later devices do
    // not wait behind network timeouts and outlive their 45-second lease.
    await Promise.all(claims.map(async claim => {
        const args = { p_installation: claim.installation_id, p_lease: claim.lease_id };
        let ok = false, error: string | null = null;
        try {
          const alert: Alert | null = await deps.rpc("vendor_native_validate_claim", args);
          if (!alert || alert.expires_at <= deps.now()) { skipped++; return; }
          // Validate again locally after the DB read, before any network send.
          payload(alert, deps.now());
          await deps.send(alert, account);
          sent++;
          ok = true;
        } catch (e) {
          failed++;
          const code = e instanceof Error ? e.message : "SEND_FAILED";
          error = ["UNREGISTERED", "STALE_ALERT", "FCM_AUTH_FAILED", "FCM_RATE_LIMITED"].includes(code) ? code : "SEND_FAILED";
        } finally {
          await deps.rpc("vendor_native_finish", { ...args, p_ok: ok, p_error: error });
        }
    }));
    return reply(200, { sent, failed, skipped });
  } catch { return reply(503, { error: "DISPATCH_UNAVAILABLE" }); }
}
