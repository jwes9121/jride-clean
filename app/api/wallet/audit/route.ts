import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}
function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}
function requireAdminKey(req: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return true;
  const got = req.headers.get("x-admin-key") || "";
  return got === expected;
}

export async function GET(req: Request) {
  try {
    if (!requireAdminKey(req)) return bad("Invalid admin key", "BAD_ADMIN_KEY", 401);

    const url = new URL(req.url);
    const driver_id = String(url.searchParams.get("driver_id") || "").trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || 50)));

    if (!isUuid(driver_id)) return bad("Invalid driver_id UUID", "BAD_DRIVER_ID");

    const { data, error } = await supabase
      .from("wallet_admin_audit")
      .select("*")
      .eq("driver_id", driver_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) return bad("Audit fetch failed", "AUDIT_FETCH_FAILED", 500, { details: error.message });

    return ok({ driver_id, rows: data ?? [] });
  } catch (e: any) {
    return bad("Unhandled error", "UNHANDLED", 500, { details: String(e?.message || e) });
  }
}
