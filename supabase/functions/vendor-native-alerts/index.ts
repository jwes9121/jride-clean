import { Account, Alert, handle, payload, PROJECT } from "./core.ts";

const base = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const encoder = new TextEncoder();
let cachedAccess: { email: string; token: string; expires: number } | null = null;
let tokenRequest: Promise<string> | null = null;
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
const encoded = (value: object) => b64url(encoder.encode(JSON.stringify(value)));

async function accessToken(account: Account): Promise<string> {
  if (cachedAccess?.email === account.client_email && cachedAccess.expires > Date.now() + 60000) return cachedAccess.token;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const unsigned = encoded({ alg: "RS256", typ: "JWT" }) + "." + encoded({
      iss: account.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    });
    const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
    const bytes = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", signal: AbortSignal.timeout(6000),
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + b64url(signature) }) });
    if (!response.ok) throw new Error("FCM_AUTH_FAILED");
    const data = await response.json();
    if (typeof data.access_token !== "string" || !data.access_token) throw new Error("FCM_AUTH_FAILED");
    cachedAccess = { email: account.client_email, token: data.access_token, expires: Date.now() + Number(data.expires_in || 3600) * 1000 };
    return data.access_token;
  })();
  try { return await tokenRequest; } finally { tokenRequest = null; }
}

async function rpc(name: string, args: object = {}) {
  const response = await fetch(`${base}/rest/v1/rpc/${name}`, { method: "POST", signal: AbortSignal.timeout(6000),
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  if (!response.ok) throw new Error("DATABASE_UNAVAILABLE");
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function send(alert: Alert, account: Account) {
  const token = await accessToken(account);
  // The Google token exchange can take time. Recheck expiry before sending.
  const message = payload(alert, Date.now());
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT}/messages:send`, {
    method: "POST", signal: AbortSignal.timeout(6000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(message),
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  if (body.error?.details?.some((d: { errorCode?: string }) => d.errorCode === "UNREGISTERED")) throw new Error("UNREGISTERED");
  if (response.status === 401 || response.status === 403) { cachedAccess = null; throw new Error("FCM_AUTH_FAILED"); }
  if (response.status === 429) throw new Error("FCM_RATE_LIMITED");
  throw new Error("SEND_FAILED");
}

Deno.serve(request => handle(request, { rpc, send, now: Date.now }));
