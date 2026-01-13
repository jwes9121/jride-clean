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
    const view = (url.searchParams.get("view") || "monthly").toLowerCase();
    const vendorId = s(url.searchParams.get("vendor_id"));
    const monthStart = s(url.searchParams.get("month_start"));
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10) || 200, 500);

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SERVICE_ROLE = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const source =
      view === "summary"
        ? "admin_vendor_payout_summary"
        : "admin_vendor_payout_monthly";

    const qs = new URLSearchParams();
    qs.set("select", "*");
    qs.set("limit", String(limit));

    // Safe ordering for monthly (known column exists)
    if (source === "admin_vendor_payout_monthly") {
      qs.set("order", "month_start.desc");
      if (monthStart) qs.set("month_start", "eq." + monthStart);
    }

    if (vendorId) qs.set("vendor_id", "eq." + vendorId);

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