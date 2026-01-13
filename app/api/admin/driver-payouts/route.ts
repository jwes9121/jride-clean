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
  qs.set("select", "id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note");
  qs.set("id", "eq." + id);
  qs.set("limit", "1");

  const url = SUPABASE_URL + "/rest/v1/driver_payout_requests?" + qs.toString();
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

async function restPatchById(
  SUPABASE_URL: string,
  SERVICE_ROLE: string,
  id: string,
  patch: Record<string, any>
) {
  const qs = new URLSearchParams();
  qs.set("id", "eq." + id);
  qs.set("select", "id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note");

  const url = SUPABASE_URL + "/rest/v1/driver_payout_requests?" + qs.toString();
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
    qs.set("select", "id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref,receipt_url,admin_note");
    qs.set("order", "id.desc");
    qs.set("limit", String(limit));
    if (status && status !== "all") qs.set("status", "eq." + status);

    const restUrl = SUPABASE_URL + "/rest/v1/driver_payout_requests?" + qs.toString();
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
  id?: string | number | null;
  action?: "approve" | "reject" | "mark_paid" | string | null;
  payout_method?: string | null;
  payout_ref?: string | null;
  receipt_url?: string | null;
  admin_note?: string | null;
};

export async function POST(req: Request) {
try {
    const body = (await req.json().catch(() => ({}))) as ActionReq;

    const idRaw = body?.id;
    const action = String(body?.action || "").trim().toLowerCase();

    if (!idRaw) return jsonErr("BAD_REQUEST", "Missing id", 400);
    if (!action) return jsonErr("BAD_REQUEST", "Missing action", 400);

    const id = String(idRaw);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const cur = await restGetOneById(SUPABASE_URL, SERVICE_ROLE, id);
    if (!cur.ok) return jsonErr("DB_ERROR", cur.text || "Failed to load payout request", 500);
    if (!cur.row) return jsonErr("NOT_FOUND", "Payout request not found", 404, { id });

    const currentStatus = String(cur.row.status || "").toLowerCase();

    let targetStatus: string | null = null;
    if (action === "approve") targetStatus = "approved";
    else if (action === "reject") targetStatus = "rejected";
    else if (action === "mark_paid") targetStatus = "paid";
    else return jsonErr("BAD_REQUEST", "Invalid action (approve|reject|mark_paid)", 400, { action });

    if (currentStatus === targetStatus) {
      return jsonOk({ ok: true, changed: false, idempotent: true, id, status: currentStatus, row: cur.row });
    }

    if ((targetStatus === "approved" || targetStatus === "rejected") && currentStatus !== "pending") {
      return jsonErr(
        "INVALID_STATE",
        "Cannot " + targetStatus + " when status is " + currentStatus,
        409,
        { id, current_status: currentStatus, target_status: targetStatus }
      );
    }

    if (targetStatus === "paid" && !(currentStatus === "approved" || currentStatus === "pending")) {
      return jsonErr(
        "INVALID_STATE",
        "Cannot mark_paid when status is " + currentStatus,
        409,
        { id, current_status: currentStatus, target_status: targetStatus }
      );
    }

        // ----- PHASE 3N.3 V4: DEDUCT DRIVER WALLET ON MARK_PAID (REST, IDEMPOTENT) -----
    // When admin marks payout as PAID, create a driver_wallet_transactions debit once.
    // Idempotency key: reason = payout_request:<id>
    if (targetStatus === "paid") {
      const driverId = String(cur.row?.driver_id || "");
      const payoutAmt = Number(cur.row?.amount || 0);
      const reason = `payout_request:${id}`;

      if (!driverId) return jsonErr("BAD_DATA", "Missing driver_id on payout request", 400, { id });
      if (!(payoutAmt > 0)) return jsonErr("BAD_DATA", "Invalid payout amount", 400, { id, amount: cur.row?.amount });

      // check existing debit (idempotent)
      const exQs = new URLSearchParams();
      exQs.set("select", "id");
      exQs.set("driver_id", "eq." + driverId);
      exQs.set("reason", "eq." + reason);
      exQs.set("limit", "1");

      const exUrl = SUPABASE_URL + "/rest/v1/driver_wallet_transactions?" + exQs.toString();
      const exRes = await fetch(exUrl, {
        headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
        cache: "no-store",
      });
      const exText = await exRes.text();
      if (!exRes.ok) return jsonErr("DB_ERROR", exText || "Failed to check existing wallet tx", 500, { stage: "wallet_existing", id });

      let exArr: any[] = [];
      try { exArr = JSON.parse(exText || "[]"); } catch { exArr = []; }
      const already = Array.isArray(exArr) && exArr.length > 0;

      if (!already) {
        // balance lookup
        const bQs = new URLSearchParams();
        bQs.set("select", "driver_id,balance");
        bQs.set("driver_id", "eq." + driverId);
        bQs.set("limit", "1");

        const bUrl = SUPABASE_URL + "/rest/v1/driver_wallet_balances_v1?" + bQs.toString();
        const bRes = await fetch(bUrl, {
          headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
          cache: "no-store",
        });
        const bText = await bRes.text();
        if (!bRes.ok) return jsonErr("DB_ERROR", bText || "Failed to load wallet balance", 500, { stage: "wallet_balance", id });

        let bArr: any[] = [];
        try { bArr = JSON.parse(bText || "[]"); } catch { bArr = []; }
        const balanceBefore = Number((Array.isArray(bArr) && bArr[0] ? bArr[0].balance : 0) || 0);

        if (balanceBefore < payoutAmt) {
          return jsonErr("INSUFFICIENT_BALANCE", "Driver wallet balance is insufficient for payout", 409, {
            id,
            driver_id: driverId,
            balance: balanceBefore,
            payout_amount: payoutAmt,
          });
        }

        const balanceAfter = Number((balanceBefore - payoutAmt).toFixed(2));

        // insert debit
        const insUrl = SUPABASE_URL + "/rest/v1/driver_wallet_transactions?select=id";
        const insRes = await fetch(insUrl, {
          method: "POST",
          headers: {
            apikey: SERVICE_ROLE,
            Authorization: "Bearer " + SERVICE_ROLE,
            "Content-Type": "application/json",
            Prefer: "return=representation",
          },
          body: JSON.stringify([{
            driver_id: driverId,
            amount: -Math.abs(payoutAmt),
            balance_after: balanceAfter,
            reason,
            booking_id: null,
          }]),
          cache: "no-store",
        });

        const insText = await insRes.text();
        if (!insRes.ok) return jsonErr("DB_ERROR", insText || "Failed to insert wallet debit", 500, { stage: "wallet_insert", id });
      }
    }
    // ----- END PHASE 3N.3 V4 -----
const patch: any = {
      status: targetStatus,
      processed_at: new Date().toISOString(),
    };

    if (body.payout_method != null) patch.payout_method = body.payout_method;
    if (body.payout_ref != null) patch.payout_ref = body.payout_ref;
    if (body.receipt_url != null) patch.receipt_url = body.receipt_url;
    if (body.admin_note != null) patch.admin_note = body.admin_note;

    const upd = await restPatchById(SUPABASE_URL, SERVICE_ROLE, id, patch);
    if (!upd.ok) return jsonErr("DB_ERROR", upd.text || "Failed to update payout request", 500);

    return jsonOk({ ok: true, changed: true, id, status: targetStatus, row: upd.row });
  } catch (e: any) {
    return jsonErr("SERVER_ERROR", e?.message || String(e), 500);
  }
}