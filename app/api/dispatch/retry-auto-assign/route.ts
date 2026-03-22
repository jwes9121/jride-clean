import { NextResponse } from "next/server";

export async function POST() {
  console.log("[DISPATCH_TRACE] retry:start", { at: new Date().toISOString() });
  try {
    const res = await fetch(process.env.NEXT_PUBLIC_BASE_URL + "/api/dispatch/auto-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "scan_pending" })
    });

    const json = await res.json();
        console.log("[DISPATCH_TRACE] retry:auto_assign_response", {
      ok: true,
      auto_assign_ok: json?.ok ?? null,
      mode: json?.mode ?? null,
      assigned_count: json?.assigned_count ?? null,
      skipped_count: json?.skipped_count ?? null,
      blocked_count: json?.blocked_count ?? null
    });
    return NextResponse.json({ ok: true, result: json });

  } catch (e: any) {
        console.error("[DISPATCH_TRACE] retry:error", {
      message: String(e?.message || e)
    });
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}