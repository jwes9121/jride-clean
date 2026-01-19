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
  if (!need) return { ok: true, mode: "open" as const };
  const got = req.headers.get("x-admin-key") || "";
  if (got !== need) return { ok: false, mode: "locked" as const };
  return { ok: true, mode: "locked" as const };
}

async function callRpc(rpcName: string, payload: any) {
  const SUPABASE_URL = envFirst("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const SERVICE_KEY = envFirst(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SERVICE_ROLE_SECRET"
  );

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { ok: false, status: 500, error: "Missing SUPABASE_URL or service role key env vars." };
  }

  const url = `${SUPABASE_URL}/rest/v1/rpc/${rpcName}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(payload ?? {}),
  });

  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    return { ok: false, status: res.status, error: data?.message || data || "RPC failed", raw: data };
  }

  return { ok: true, status: res.status, data };
}

export async function POST(req: Request) {
  try {
    const gate = requireAdminKey(req);
    if (!gate.ok) return json(401, { ok: false, code: "UNAUTHORIZED", message: "Missing/invalid x-admin-key." });

    const body = await req.json().catch(() => ({}));
    const vendor_id = String(body?.vendor_id || "");
    const note = body?.note != null ? String(body.note) : "Cash payout settlement";

    if (!vendor_id) return json(400, { ok: false, code: "BAD_REQUEST", message: "vendor_id is required." });

    const r = await callRpc("settle_vendor_wallet", {
      v_vendor_id: vendor_id,
      v_note: note,
    });

    if (!r.ok) return json(502, { ok: false, code: "RPC_FAILED", stage: "settle_vendor_wallet", details: r });

    return json(200, { ok: true });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}

