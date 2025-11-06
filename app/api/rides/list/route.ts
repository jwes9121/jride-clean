export const runtime = "nodejs";
import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const secret = process.env.SUPABASE_SECRET!;
  if (!url || !secret) {
    return NextResponse.json(
      { status: "error", message: "Missing URL or SUPABASE_SECRET" },
      { status: 500 }
    );
  }

  // Use server-only Secret key (replaces old service_role) via REST
  const res = await fetch(`${url}/rest/v1/rides?select=*&limit=100`, {
    headers: { apikey: secret, Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });

  const txt = await res.text();
  if (!res.ok) {
    return NextResponse.json({ status: "error", body: txt }, { status: 500 });
  }
  try {
    return NextResponse.json({ status: "ok", data: JSON.parse(txt) });
  } catch {
    return NextResponse.json({ status: "ok", raw: txt });
  }
}
