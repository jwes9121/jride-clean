import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error("Missing env var: " + name);
  return v;
}
function s(v: any) { return String(v ?? "").trim(); }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const view = (url.searchParams.get("view") || "daily").toLowerCase();
    const driverId = s(url.searchParams.get("driver_id"));
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const source =
      view === "requests"
        ? "admin_driver_payout_requests_v1"
        : "admin_driver_payout_daily_v1";

    // We use select=* and best-effort filtering on driver_id (if exists).
    // If the view doesn't contain driver_id, Supabase REST will error.
    // To avoid breaking, we only apply driver_id filter when caller provided it AND view likely supports it.
    // For requests view, driver_id is expected. For daily view, it is likely but not assumed by UI.
    const qs = new URLSearchParams();
    qs.set("select", "*");
    qs.set("limit", String(limit));

    // Best-effort ordering (won't apply if unknown)
    // Avoid setting order to prevent schema-cache issues on views with no such column.

    if (driverId) {
      // Only apply on requests view (safe expectation for payouts request rows).
      if (source === "admin_driver_payout_requests_v1") {
        qs.set("driver_id", "eq." + driverId);
      }
    }

    const restUrl = `${SUPABASE_URL}/rest/v1/${source}?${qs.toString()}`;

    const res = await fetch(restUrl, {
      headers: { apikey: SERVICE_ROLE, Authorization: "Bearer " + SERVICE_ROLE },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, code: "DB_ERROR", message: "Failed to load " + source, details: text },
        { status: res.status }
      );
    }

    return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: e?.message || String(e) }, { status: 500 });
  }
}