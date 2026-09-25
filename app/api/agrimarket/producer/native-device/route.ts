import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase, requireAgrimarketProducer } from "../../_lib/server";
import { farmerSessionHash, farmerSessionToken } from "@/lib/agrimarket/farmerSessionServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_SECRET = /^[0-9a-f-]{72}$/i;
const TOKEN = /^[A-Za-z0-9_:.-]{32,4096}$/;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (status: number, body: object) => NextResponse.json(body, {
  status,
  headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" },
});

async function input(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (req.headers.get("x-jride-native") !== "agrimarket-v1" ||
      req.headers.get("x-jride-agrimarket-session") !== "1" ||
      (origin && origin !== req.nextUrl.origin)) return null;
  if (!req.headers.get("content-type")?.startsWith("application/json")) return null;
  if (Number(req.headers.get("content-length") || 0) > 8192) return null;
  const secret = req.headers.get("x-jride-device-secret") || "";
  if (!DEVICE_SECRET.test(secret)) return null;
  const text = await req.text();
  if (text.length > 8192) return null;
  let body: any;
  try { body = JSON.parse(text); } catch { return null; }
  if (!UUID.test(body?.installation_id || "")) return null;
  return { body, secret: hash(secret) };
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await input(req);
    if (!parsed) return json(400, { ok: false, error: "INVALID_DEVICE_REQUEST" });
    const sessionToken = farmerSessionToken(req);
    if (!sessionToken) return json(401, { ok: false, error: "AGRIMARKET_SESSION_REQUIRED" });
    const admin = createServiceSupabase();
    const auth = await requireAgrimarketProducer(req);
    if (!auth.ok) return auth.response;
    const { body, secret } = parsed;
    if (!TOKEN.test(body.token || "") || typeof body.notifications_enabled !== "boolean" ||
        typeof body.sound_enabled !== "boolean") {
      return json(400, { ok: false, error: "INVALID_DEVICE_REQUEST" });
    }
    const sessionHash = farmerSessionHash(sessionToken);
    const sessionRes = await admin.from("agrimarket_farmer_browser_sessions")
      .select("expires_at,producer_id").eq("token_hash", sessionHash).maybeSingle();
    if (sessionRes.error || !sessionRes.data || sessionRes.data.producer_id !== auth.producer.id) {
      return json(401, { ok: false, error: "AGRIMARKET_SESSION_REQUIRED" });
    }
    const result = await admin.rpc("agrimarket_native_register", {
      p_installation: body.installation_id,
      p_producer: auth.producer.id,
      p_token: body.token,
      p_secret: secret,
      p_session: sessionHash,
      p_expires: sessionRes.data.expires_at,
      p_notifications: body.notifications_enabled,
      p_sound: body.sound_enabled,
    });
    if (result.error || result.data !== true) {
      return json(409, { ok: false, error: "DEVICE_REGISTRATION_FAILED" });
    }
    // Old APKs omit this field and must never receive the new harvest event.
    // Bind capability to the registration that just passed the existing
    // installation secret, producer identity and session checks.
    const capability = await admin.from("agrimarket_native_devices")
      .update({ harvest_alerts_enabled: body.harvest_alerts_supported === true })
      .eq("installation_id", body.installation_id)
      .eq("producer_id", auth.producer.id)
      .eq("secret_hash", secret)
      .eq("session_hash", sessionHash)
      .select("installation_id").maybeSingle();
    if (capability.error || !capability.data) {
      return json(503, { ok: false, error: "DEVICE_CAPABILITY_REGISTRATION_FAILED" });
    }
    const ready = await admin.rpc("agrimarket_native_ready");
    return json(200, {
      ok: true,
      producer_id: auth.producer.id,
      session_hash: sessionHash,
      expires_at: Date.parse(sessionRes.data.expires_at),
      delivery_ready: !ready.error && ready.data === true,
    });
  } catch {
    return json(503, { ok: false, error: "DEVICE_REGISTRATION_UNAVAILABLE" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const parsed = await input(req);
    if (!parsed) return json(400, { ok: false, error: "INVALID_DEVICE_REQUEST" });
    const { error } = await createServiceSupabase().from("agrimarket_native_devices")
      .delete().eq("installation_id", parsed.body.installation_id).eq("secret_hash", parsed.secret);
    return error ? json(503, { ok: false, error: "DEVICE_REVOCATION_UNAVAILABLE" }) : json(200, { ok: true });
  } catch {
    return json(503, { ok: false, error: "DEVICE_REVOCATION_UNAVAILABLE" });
  }
}
