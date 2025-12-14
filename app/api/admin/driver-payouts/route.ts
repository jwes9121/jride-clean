import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
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
    if (status && status !== "all") {
      qs.set("status", `eq.${status}`);
    }

    const restUrl = `${SUPABASE_URL}/rest/v1/driver_payout_requests?${qs.toString()}`;
    const res = await fetch(restUrl, {
      headers: {
        apikey: SERVICE_ROLE,
        Authorization: `Bearer ${SERVICE_ROLE}`,
      },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) return NextResponse.json({ error: text }, { status: res.status });

    return new NextResponse(text, { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
