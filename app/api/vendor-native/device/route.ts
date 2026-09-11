import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireVendorSession, verifyVendorSession, VENDOR_SESSION_COOKIE } from "@/lib/vendorSession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (status: number, body: object) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function input(req: NextRequest) {
  // A native-only endpoint. These headers prevent a browser form from registering a device.
  const origin = req.headers.get("origin");
  if (req.headers.get("x-jride-native") !== "vendor-v1" || (origin && origin !== req.nextUrl.origin)) return null;
  if (!req.headers.get("content-type")?.startsWith("application/json")) return null;
  if (Number(req.headers.get("content-length") || 0) > 8192) return null;
  const secret = req.headers.get("x-jride-device-secret") || "";
  if (!/^[0-9a-f-]{72}$/i.test(secret)) return null;
  const text = await req.text();
  if (text.length > 8192) return null;
  let body: any;
  try { body = JSON.parse(text); } catch { return null; }
  if (!uuid.test(body?.installation_id || "")) return null;
  return { body, secret: hash(secret) };
}

export async function POST(req: NextRequest) {
  try {
    const parsed = await input(req);
    if (!parsed) return json(400, { ok: false, error: "INVALID_DEVICE_REQUEST" });
    const admin = supabaseAdmin({ noStore: true });
    const auth = await requireVendorSession(req, admin);
    if (!auth.ok) return json(auth.status, { ok: false, error: auth.error });
    const session = req.cookies.get(VENDOR_SESSION_COOKIE)?.value || "";
    const claims = verifyVendorSession(session);
    if (!claims || !uuid.test(auth.vendor.vendorId)) return json(401, { ok: false, error: "VENDOR_SESSION_INVALID" });
    const { body, secret } = parsed;
    if (typeof body.token !== "string" || !/^[A-Za-z0-9_:.-]{32,4096}$/.test(body.token) ||
      typeof body.notifications_enabled !== "boolean" || typeof body.sound_enabled !== "boolean") {
      return json(400, { ok: false, error: "INVALID_DEVICE_REQUEST" });
    }
    const sessionHash = hash(session);
    const result = await admin.rpc("vendor_native_register", {
      p_installation: body.installation_id, p_vendor: auth.vendor.vendorId, p_token: body.token,
      p_secret: secret, p_session: sessionHash, p_expires: new Date(claims.exp * 1000).toISOString(),
      p_notifications: body.notifications_enabled, p_sound: body.sound_enabled,
    });
    if (result.error || result.data !== true) return json(409, { ok: false, error: "DEVICE_REGISTRATION_FAILED" });
    const ready = await admin.rpc("vendor_native_ready");
    return json(200, { ok: true, vendor_id: auth.vendor.vendorId, session_hash: sessionHash,
      expires_at: claims.exp * 1000, delivery_ready: !ready.error && ready.data === true });
  } catch {
    return json(503, { ok: false, error: "DEVICE_REGISTRATION_UNAVAILABLE" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const parsed = await input(req);
    if (!parsed) return json(400, { ok: false, error: "INVALID_DEVICE_REQUEST" });
    // Revocation requires the per-installation secret; it also works after cookie expiry.
    const { error } = await supabaseAdmin().from("vendor_native_devices").delete()
      .eq("installation_id", parsed.body.installation_id).eq("secret_hash", parsed.secret);
    return error ? json(503, { ok: false, error: "DEVICE_REVOCATION_UNAVAILABLE" }) : json(200, { ok: true });
  } catch { return json(503, { ok: false, error: "DEVICE_REVOCATION_UNAVAILABLE" }); }
}
