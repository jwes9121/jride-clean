import { NextResponse } from "next/server";

export async function POST() {
  try {
    const res = await fetch(process.env.NEXT_PUBLIC_BASE_URL + "/api/dispatch/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "scan_pending" })
    });

    const json = await res.json();
    return NextResponse.json({ ok: true, result: json });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}