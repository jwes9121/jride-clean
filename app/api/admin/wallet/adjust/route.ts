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
  // If ADMIN_API_KEY is set, require it. If not set, allow (dev convenience).
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

    const kind = String(body?.kind || "driver_adjust");
    if (kind !== "driver_adjust" && kind !== "vendor_adjust") {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "kind must be driver_adjust or vendor_adjust." });
    }

    if (kind === "driver_adjust") {
      const driver_id = String(body?.driver_id || "");
      const amount = Number(body?.amount || 0);
      const reason = body?.reason != null ? String(body.reason) : "";
      const created_by = body?.created_by != null ? String(body.created_by) : "admin";

      if (!driver_id) return json(400, { ok: false, code: "BAD_REQUEST", message: "driver_id is required." });
      if (!amount || Number.isNaN(amount)) return json(400, { ok: false, code: "BAD_REQUEST", message: "amount must be non-zero number." });

      // Uses your SECURITY DEFINER function which also prevents negative wallet
      const r = await callRpc("admin_adjust_driver_wallet", {
        p_driver_id: driver_id,
        p_amount: amount,
        p_reason: reason,
        p_created_by: created_by,
      });

      if (!r.ok) return json(502, { ok: false, code: "RPC_FAILED", stage: "admin_adjust_driver_wallet", details: r });
      return json(200, { ok: true, result: r.data });
    }

    // vendor_adjust: insert a ledger entry directly into vendor_wallet_transactions
    // We do NOT guess any other tables; just write the ledger entry.
    const vendor_id = String(body?.vendor_id || "");
    const amount = Number(body?.amount || 0);
    const note = body?.note != null ? String(body.note) : "";
    const kind2 = body?.kind2 != null ? String(body.kind2) : "adjustment";

    if (!vendor_id) return json(400, { ok: false, code: "BAD_REQUEST", message: "vendor_id is required." });
    if (!amount || Number.isNaN(amount)) return json(400, { ok: false, code: "BAD_REQUEST", message: "amount must be non-zero number." });

    const SUPABASE_URL = envFirst("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_KEY = envFirst(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_SERVICE_ROLE",
      "SUPABASE_SERVICE_ROLE_SECRET"
    );
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, code: "ENV_MISSING", message: "Missing SUPABASE_URL or service role key." });
    }

    const insertUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet_transactions`;
    const payload = {
      vendor_id,
      booking_code: null,
      amount,
      kind: kind2,
      note,
    };

    const res = await fetch(insertUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Prefer": "return=representation",
        "apikey": SERVICE_KEY,
        "Authorization": `Bearer ${SERVICE_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) {
      return json(502, { ok: false, code: "DB_INSERT_FAILED", status: res.status, raw: data });
    }

    return json(200, { ok: true, inserted: data });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}

