import { NextRequest } from "next/server";
import { createServiceSupabase, jsonNoStore, agrimarketFarmerPortalEnabled } from "../../_lib/server";
import { farmerSessionHash, farmerSessionRequestAllowed, farmerSessionToken, newFarmerSessionToken,
  readFarmerSession, setFarmerSessionCookie } from "@/lib/agrimarket/farmerSessionServer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
function unavailable() { return jsonNoStore(503, { ok: false, message: "Farmer sign-in is temporarily unavailable. Try again." }); }
function allowed(req: NextRequest) { return agrimarketFarmerPortalEnabled() && farmerSessionRequestAllowed(req); }

export async function GET(req: NextRequest) {
  if (!allowed(req)) return jsonNoStore(403, { ok: false, message: "This farmer session request was not allowed." });
  try {
    const session = await readFarmerSession(req, createServiceSupabase());
    return session ? jsonNoStore(200, { ok: true, access_code: session.access_code })
      : setFarmerSessionCookie(jsonNoStore(401, { ok: false }), "");
  } catch { return unavailable(); }
}

export async function POST(req: NextRequest) {
  if (!allowed(req)) return jsonNoStore(403, { ok: false, message: "This farmer sign-in request was not allowed." });
  const raw = await req.text();
  if (raw.length > 512) return jsonNoStore(413, { ok: false });
  let body: any;
  try { body = JSON.parse(raw); } catch { return jsonNoStore(400, { ok: false }); }
  const code = String(body?.access_code || "").trim().toUpperCase();
  const pin = String(body?.pin || "").trim();
  if (!/^AGF-[A-Z0-9]{6,12}$/.test(code) || !/^[0-9]{6}$/.test(pin)) return jsonNoStore(401, { ok: false, message: "Enter your farmer access code and 6-digit PIN." });
  try {
    const db = createServiceSupabase();
    const token = newFarmerSessionToken();
    const result = await db.rpc("agrimarket_farmer_session_login_v1", {
      p_access_code: code, p_pin: pin, p_token_hash: farmerSessionHash(token),
    });
    if (result.error) return unavailable();
    if (!result.data) return jsonNoStore(401, { ok: false, message: "The farmer access code or PIN is invalid, inactive, or temporarily locked." });
    const old = farmerSessionToken(req);
    if (old) await db.rpc("agrimarket_farmer_session_logout_v1", { p_token_hash: farmerSessionHash(old) });
    return setFarmerSessionCookie(jsonNoStore(200, { ok: true, access_code: result.data.access_code }), token);
  } catch { return unavailable(); }
}

export async function DELETE(req: NextRequest) {
  if (!allowed(req)) return jsonNoStore(403, { ok: false });
  try {
    const token = farmerSessionToken(req);
    const id = req.nextUrl.searchParams.get("subscription_id");
    if (token) {
      const result = await createServiceSupabase().rpc("agrimarket_farmer_session_logout_v1", {
        p_token_hash: farmerSessionHash(token), p_subscription_id: /^[a-f0-9-]{36}$/i.test(id || "") ? id : null,
      });
      if (result.error) return unavailable();
    }
    return setFarmerSessionCookie(jsonNoStore(200, { ok: true }), "");
  } catch { return unavailable(); }
}
