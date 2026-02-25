import { NextResponse } from "next/server";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function s(v: any) { return String(v ?? "").trim(); }

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

async function sbGet(SUPABASE_URL: string, SERVICE_KEY: string, path: string) {
  const url = `${SUPABASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

function pick(o: any, keys: string[]) {
  for (const k of keys) {
    const v = o?.[k];
    if (v !== null && v !== undefined && String(v).trim().length > 0) return String(v).trim();
  }
  return "";
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

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, code: "ENV_MISSING" });
    }

    // 1) Try RPC wallet snapshot (may contain driver_name/town)
    const rpcTry = await sbGet(SUPABASE_URL, SERVICE_KEY, "/rest/v1/rpc/admin_get_wallet_snapshots_v1");
    if (rpcTry.ok && Array.isArray(rpcTry.data)) {
      const out = rpcTry.data
        .map((r: any) => {
          const id = pick(r, ["driver_id", "id"]);
          const name = pick(r, ["driver_name", "full_name", "name", "display_name"]);
          const town = pick(r, ["town", "municipality", "home_municipality"]);
          return { id, name, town };
        })
        .filter((x: any) => s(x.id).length > 0);

      const hasNames = out.some((x: any) => s(x.name).length > 0);
      if (hasNames) return json(200, { ok: true, source: "rpc", drivers: out });
    }

    // 2) Try drivers table with likely column combos (do not assume schema)
    const tries = [
      "/rest/v1/drivers?select=id,full_name,municipality&order=full_name.asc&limit=5000",
      "/rest/v1/drivers?select=id,name,municipality&order=name.asc&limit=5000",
      "/rest/v1/drivers?select=id,full_name,town&order=full_name.asc&limit=5000",
      "/rest/v1/drivers?select=id,name,town&order=name.asc&limit=5000",
      "/rest/v1/drivers?select=id&order=id.asc&limit=5000",
    ];

    for (const p of tries) {
      const r = await sbGet(SUPABASE_URL, SERVICE_KEY, p);
      if (!r.ok || !Array.isArray(r.data)) continue;

      const out = r.data.map((row: any) => {
        const id = pick(row, ["id"]);
        const name = pick(row, ["full_name", "name", "display_name"]);
        const town = pick(row, ["municipality", "town", "home_municipality"]);
        return { id, name, town };
      }).filter((x: any) => s(x.id).length > 0);

      return json(200, { ok: true, source: "drivers", drivers: out });
    }

    return json(200, { ok: true, source: "none", drivers: [] });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || String(e) });
  }
}