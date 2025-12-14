import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function sbGET(SUPABASE_URL: string, SR: string, path: string) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: { apikey: SR, Authorization: `Bearer ${SR}` },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);

    const from = u.searchParams.get("from"); // YYYY-MM-DD
    const to = u.searchParams.get("to");     // YYYY-MM-DD
    const bookingCode = u.searchParams.get("booking_code");
    const fromDriver = u.searchParams.get("from_driver_id");
    const toDriver = u.searchParams.get("to_driver_id");
    const limit = Math.min(Number(u.searchParams.get("limit") || "200") || 200, 500);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SR = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    // Build PostgREST filters
    const filters: string[] = [];
    if (from) filters.push(`created_at=gte.${encodeURIComponent(from)}T00:00:00Z`);
    if (to)   filters.push(`created_at=lte.${encodeURIComponent(to)}T23:59:59Z`);
    if (bookingCode) filters.push(`booking_code=ilike.*${encodeURIComponent(bookingCode)}*`);
    if (fromDriver)  filters.push(`from_driver_id=eq.${encodeURIComponent(fromDriver)}`);
    if (toDriver)    filters.push(`to_driver_id=eq.${encodeURIComponent(toDriver)}`);

    const q = filters.length ? "&" + filters.join("&") : "";
    const rows = await sbGET(
      SUPABASE_URL,
      SR,
      `/rest/v1/admin_reassign_audit?select=id,created_at,created_by,booking_id,booking_code,from_driver_id,to_driver_id,reason&order=id.desc&limit=${limit}${q}`
    );

    return NextResponse.json({ ok: true, count: Array.isArray(rows) ? rows.length : 0, rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
