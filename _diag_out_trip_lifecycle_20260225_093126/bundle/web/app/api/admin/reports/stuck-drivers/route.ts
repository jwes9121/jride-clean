import { NextResponse } from "next/server";

export const runtime = "nodejs";

function pickEnv(keys: string[]) {
  for (const k of keys) {
    const v = process.env[k];
    if (v && v.trim().length > 0) return v.trim();
  }
  return null;
}

export async function GET(req: Request) {
  const url = pickEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
  const srk = pickEnv(["SUPABASE_SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY"]);

  if (!url || !srk) {
    return NextResponse.json(
      { error: "Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  const u = new URL(req.url);
  const days = Math.max(1, Math.min(60, parseInt(u.searchParams.get("days") || "7", 10)));

  // We sort primarily by open_count then stuck_7d/stuck_30d.
  // The view already contains 24h/7d/30d counts, but we keep "days" as a UI filter only.
  const endpoint =
    `${url.replace(/\/$/, "")}/rest/v1/admin_stuck_driver_scorecard_v1` +
    `?select=driver_id,stuck_24h,stuck_7d,stuck_30d,open_count,avg_minutes,last_detected_at` +
    `&order=open_count.desc&order=stuck_7d.desc&order=stuck_30d.desc&limit=500`;

  const r = await fetch(endpoint, {
    headers: {
      apikey: srk,
      Authorization: `Bearer ${srk}`,
    },
    cache: "no-store",
  });

  const text = await r.text();
  if (!r.ok) {
    return NextResponse.json({ error: text }, { status: r.status });
  }

  let rows: any[] = [];
  try { rows = JSON.parse(text); } catch { rows = []; }

  // Optional UI filter:
  // If days=1 => emphasize stuck_24h; days=7 => stuck_7d; days=30 => stuck_30d
  // We don't remove rows; we just add a computed "score" for sorting client-side.
  const scoreKey = days <= 1 ? "stuck_24h" : (days <= 7 ? "stuck_7d" : "stuck_30d");
  const out = rows.map(r => ({
    ...r,
    _score: Number(r?.[scoreKey] ?? 0),
    _scoreKey: scoreKey,
  }));

  return NextResponse.json({ days, rows: out });
}
