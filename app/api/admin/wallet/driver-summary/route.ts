import { NextResponse } from "next/server";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function envFirst(...keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
}

function requireAdminKey(req: Request) {
  const need = envFirst("ADMIN_API_KEY");
  if (!need) return { ok: true };
  const got = req.headers.get("x-admin-key") || "";
  if (got !== need) return { ok: false };
  return { ok: true };
}

export async function GET(req: Request) {
  try {
    const gate = requireAdminKey(req);
    if (!gate.ok) return json(401, { ok: false, code: "UNAUTHORIZED" });

    const { searchParams } = new URL(req.url);
    const driver_id = String(searchParams.get("driver_id") || "");
    if (!driver_id) return json(400, { ok: false, code: "BAD_REQUEST", message: "driver_id is required" });

    const SUPABASE_URL = envFirst("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_KEY = envFirst(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_SERVICE_ROLE",
      "SUPABASE_SERVICE_ROLE_SECRET"
    );

    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, code: "ENV_MISSING" });

    const balUrl = `${SUPABASE_URL}/rest/v1/driver_wallet_balances_v1?driver_id=eq.${driver_id}`;
    const balRes = await fetch(balUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const bal = await balRes.json();

    const txUrl = `${SUPABASE_URL}/rest/v1/driver_wallet_transactions?driver_id=eq.${driver_id}&order=created_at.desc&limit=20`;
    const txRes = await fetch(txUrl, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const tx = await txRes.json();

    return json(200, { ok: true, balance: bal?.[0] || null, recent: tx || [] });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}
