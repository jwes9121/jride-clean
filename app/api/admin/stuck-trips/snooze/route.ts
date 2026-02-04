import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function sbPATCH(SUPABASE_URL: string, SR: string, path: string, body: any) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      apikey: SR,
      Authorization: `Bearer ${SR}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  try { return JSON.parse(text); } catch { return text; }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const logId = body?.logId;
    const minutes = Number(body?.minutes);

    if (logId === undefined || logId === null) {
      return NextResponse.json({ error: "logId is required" }, { status: 400 });
    }
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      return NextResponse.json({ error: "minutes must be between 1 and 1440" }, { status: 400 });
    }

    const SUPABASE_URL = mustEnv("NEXT_PUBLIC_SUPABASE_URL");
    const SR = mustEnv("SUPABASE_SERVICE_ROLE_KEY");

    const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const updated = await sbPATCH(
      SUPABASE_URL,
      SR,
      `/rest/v1/driver_stuck_alert_log?id=eq.${encodeURIComponent(String(logId))}`,
      { snooze_until: snoozeUntil, acknowledged_at: new Date().toISOString() } // snooze implies ack
    );

    return NextResponse.json({ ok: true, snooze_until: snoozeUntil, updated });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
