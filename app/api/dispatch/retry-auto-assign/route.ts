import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const origin = new URL(req.url).origin;

    const res = await fetch(new URL("/api/dispatch/auto-assign", origin), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "scan_pending" }),
      cache: "no-store",
    });

    const json = await res.json().catch(() => null);
    return NextResponse.json({ ok: res.ok, status: res.status, result: json }, { status: res.ok ? 200 : res.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
