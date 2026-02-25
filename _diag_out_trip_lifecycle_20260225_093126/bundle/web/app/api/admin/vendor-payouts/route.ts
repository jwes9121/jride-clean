import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error("Missing env var: " + name);
  return v;
}

function jsonOk(body: any, status = 200) {
  return NextResponse.json(body, { status });
}

function jsonErr(code: string, message: string, status: number, extra?: any) {
  return NextResponse.json({ ok: false, code, message, ...(extra || {}) }, { status });
}

async function restGetOneById(SUPABASE_URL: string, SERVICE_ROLE: string, id: string) {
  const qs = new URLSearchParams();
  qs.set("select", "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by");
  qs.set("id", "eq." + id);
  qs.set("limit", "1");

  const url = SUPABASE_URL + "/rest/v1/vendor_payout_requests?" + qs.toString();
  const res = await fetch(url, {
    headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let arr: any[] = [];
  try { arr = JSON.parse(text || "[]"); } catch { arr = []; }
  const row = Array.isArray(arr) && arr.length ? arr[0] : null;
  return { ok: true, row };
}

async function restPatchById(SUPABASE_URL: string, SERVICE_ROLE: string, id: string, patch: Record<string, any>) {
  const qs = new URLSearchParams();
  qs.set("id", "eq." + id);
  qs.set("select", "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by");

  const url = SUPABASE_URL + "/rest/v1/vendor_payout_requests?" + qs.toString();
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: "Bearer " + SERVICE_ROLE,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(patch),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text };

  let out: any[] = [];
  try { out = JSON.parse(text || "[]"); } catch { out = []; }
  return { ok: true, row: Array.isArray(out) && out.length ? out[0] : null };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const status = (url.searchParams.get("status") || "pending").toLowerCase();
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 200);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const qs = new URLSearchParams();
    qs.set("select", "id,vendor_id,requested_amount,status,note,created_at,reviewed_at,reviewed_by");
    qs.set("order", "created_at.desc");
    qs.set("limit", String(limit));
    if (status && status !== "all") qs.set("status", "eq." + status);

    const restUrl = SUPABASE_URL + "/rest/v1/vendor_payout_requests?" + qs.toString();
    const res = await fetch(restUrl, {
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) return NextResponse.json({ error: text }, { status: res.status });

    return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

type ActionReq = {
  id?: string | null;
  action?: "mark_paid" | string | null;
  reviewed_by?: string | null;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ActionReq;

    const idRaw = body?.id;
    const action = String(body?.action || "").trim().toLowerCase();

    if (!idRaw) return jsonErr("BAD_REQUEST", "Missing id", 400);
    if (!action) return jsonErr("BAD_REQUEST", "Missing action", 400);

    if (action !== "mark_paid") {
      return jsonErr("BAD_REQUEST", "Invalid action (mark_paid only)", 400, { action });
    }

    const id = String(idRaw);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const cur = await restGetOneById(SUPABASE_URL, SERVICE_ROLE, id);
    if (!cur.ok) return jsonErr("DB_ERROR", cur.text || "Failed to load vendor payout request", 500);
    if (!cur.row) return jsonErr("NOT_FOUND", "Vendor payout request not found", 404, { id });

    const currentStatus = String(cur.row.status || "").toLowerCase();

    // If already paid, idempotent success
    if (currentStatus === "paid") {
      return jsonOk({ ok: true, changed: false, idempotent: true, id, status: currentStatus, row: cur.row });
    }

    // Only allow pending -> paid (safest, avoids unknown status constraints)
    if (currentStatus !== "pending") {
      return jsonErr("INVALID_STATE", "Cannot mark_paid when status is " + currentStatus, 409, {
        id,
        current_status: currentStatus,
        target_status: "paid",
      });
    }

    // IMPORTANT: NO wallet mutations. Only update payout request row fields.
    const patch: any = {
      status: "paid",
      reviewed_at: new Date().toISOString(),
      reviewed_by: (body.reviewed_by != null && String(body.reviewed_by).trim().length)
        ? String(body.reviewed_by).trim()
        : "admin",
    };

    const upd = await restPatchById(SUPABASE_URL, SERVICE_ROLE, id, patch);
    if (!upd.ok) return jsonErr("DB_ERROR", upd.text || "Failed to update vendor payout request", 500);

    return jsonOk({ ok: true, changed: true, id, status: "paid", row: upd.row });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", e?.message || String(e), 500);
  }
}