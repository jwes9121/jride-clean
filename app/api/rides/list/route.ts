export const runtime = "nodejs"; // ensure server runtime

import { NextResponse } from "next/server";

export async function GET() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const srk = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!url || !srk) {
    return NextResponse.json(
      { status: "error", message: "Missing URL or SRK", info: { hasUrl: !!url, srkLen: (srk||"").length } },
      { status: 500 }
    );
  }

  // Use service role via REST (bypasses RLS)
  const res = await fetch(`${url}/rest/v1/rides?select=*&limit=100`, {
    headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { status: "error", message: "REST failed", info: { srkLen: srk.length }, body: text },
      { status: 500 }
    );
  }

  try {
    const data = JSON.parse(text);
    return NextResponse.json({ status: "ok", data });
  } catch {
    return NextResponse.json({ status: "ok", raw: text });
  }
}
