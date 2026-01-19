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

async function restGet(url: string, key: string) {
  const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

export async function GET(req: Request) {
  try {
    const gate = requireAdminKey(req);
    if (!gate.ok) return json(401, { ok: false, code: "UNAUTHORIZED" });

    const SUPABASE_URL = envFirst("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_KEY = envFirst(
      "SUPABASE_SERVICE_ROLE_KEY",
      "SUPABASE_SERVICE_KEY",
      "SUPABASE_SERVICE_ROLE",
      "SUPABASE_SERVICE_ROLE_SECRET"
    );
    if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { ok: false, code: "ENV_MISSING" });

    const { searchParams } = new URL(req.url);
    const limit = Math.max(10, Math.min(500, Number(searchParams.get("limit") || 120)));
    const threshold = Math.max(0, Number(searchParams.get("threshold") || 0.01)); // drift tolerance

    // Drivers: compare drivers.wallet_balance vs SUM(driver_wallet_transactions.amount)
    const drvUrl = `${SUPABASE_URL}/rest/v1/drivers?select=id,full_name,wallet_balance&order=updated_at.desc&limit=${limit}`;
    const drv = await restGet(drvUrl, SERVICE_KEY);
    if (!drv.ok) return json(502, { ok: false, code: "REST_FAILED", stage: "drivers", status: drv.status, data: drv.data });

    // Pull recent tx sums per driver (best-effort: do a broad query and sum in JS)
    const dtxUrl = `${SUPABASE_URL}/rest/v1/driver_wallet_transactions?select=driver_id,amount&limit=5000`;
    const dtx = await restGet(dtxUrl, SERVICE_KEY);
    const dSums: Record<string, number> = {};
    if (dtx.ok && Array.isArray(dtx.data)) {
      for (const r of dtx.data) {
        const id = String((r as any).driver_id || "");
        const amt = Number((r as any).amount || 0);
        if (!id) continue;
        dSums[id] = (dSums[id] || 0) + amt;
      }
    }

    const driverDrift = (drv.data || []).map((d: any) => {
      const id = String(d.id);
      const bal = Number(d.wallet_balance || 0);
      const sum = Number(dSums[id] || 0);
      const drift = bal - sum;
      return { driver_id: id, full_name: d.full_name || null, wallet_balance: bal, tx_sum: sum, drift };
    }).filter((r: any) => Math.abs(r.drift) > threshold);

    // Vendors: compare vendor_wallet.balance vs SUM(vendor_wallet_transactions.amount)
    const vwUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet?select=vendor_id,balance&limit=${limit}`;
    const vw = await restGet(vwUrl, SERVICE_KEY);

    const vtxUrl = `${SUPABASE_URL}/rest/v1/vendor_wallet_transactions?select=vendor_id,amount&limit=5000`;
    const vtx = await restGet(vtxUrl, SERVICE_KEY);
    const vSums: Record<string, number> = {};
    if (vtx.ok && Array.isArray(vtx.data)) {
      for (const r of vtx.data) {
        const id = String((r as any).vendor_id || "");
        const amt = Number((r as any).amount || 0);
        if (!id) continue;
        vSums[id] = (vSums[id] || 0) + amt;
      }
    }

    const vendorDrift = (vw.data || []).map((v: any) => {
      const id = String(v.vendor_id);
      const bal = Number(v.balance || 0);
      const sum = Number(vSums[id] || 0);
      const drift = bal - sum;
      return { vendor_id: id, wallet_balance: bal, tx_sum: sum, drift };
    }).filter((r: any) => Math.abs(r.drift) > threshold);

    return json(200, {
      ok: true,
      params: { limit, threshold },
      driver_drift: driverDrift,
      vendor_drift: vendorDrift,
      notes: [
        "This is a read-only drift detector.",
        "If tx limits are too low for your data size, we can switch to SQL views for exact sums.",
      ],
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}
