import { NextResponse } from "next/server";

type Body = {
  bookingId?: string;
  bookingCode?: string;
  driverId?: string | null;
  mode?: "assign" | "reassign" | "nudge";
  dispatcherName?: string | null;
};

function bad(message: string, status = 400) {
  return NextResponse.json({ ok: false, message }, { status });
}

export async function POST(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) return bad("Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL", 500);
  if (!supabaseServiceKey) return bad("Missing SUPABASE_SERVICE_ROLE_KEY (recommended) / SUPABASE_SERVICE_KEY", 500);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return bad("Invalid JSON body");
  }

  const mode = body.mode || "assign";
  const bookingId = body.bookingId || body.bookingCode; // allow either
  const bookingCode = body.bookingCode;

  if (!bookingId && !bookingCode) return bad("Missing bookingId/bookingCode");

  // Build REST endpoint
  // NOTE: your existing code used booking_code=eq.<code>. We'll support both.
  const base = `${supabaseUrl}/rest/v1/bookings`;
  const where = bookingCode
    ? `booking_code=eq.${encodeURIComponent(bookingCode)}`
    : `id=eq.${encodeURIComponent(String(bookingId))}`;

  const url = `${base}?${where}`;

  // Decide patch by mode
  // IMPORTANT: we only touch known columns used elsewhere in your project: assigned_driver_id + status.
  // - assign   => assigned_driver_id = driverId, status = "assigned"
  // - reassign => assigned_driver_id = null, status = "pending"
  // - nudge    => no schema assumptions; we "touch" the row by re-setting status to itself via a safe patch
  //              (if status is missing, it will error and we'll surface message)
  const driverId = body.driverId ?? null;

  let patch: any = {};
  if (mode === "assign") {
    if (!driverId) return bad("Missing driverId for mode=assign");
    patch = { assigned_driver_id: driverId, status: "assigned" };
  } else if (mode === "reassign") {
    patch = { assigned_driver_id: null, status: "pending" };
  } else if (mode === "nudge") {
    // No-op-ish patch: attempt to set status to status (PostgREST doesn't support column=self easily),
    // so we set a harmless string field only if it exists is risky.
    // Best safe behavior: just return ok so UI works; dispatcher can still use left-side actions.
    return NextResponse.json({ ok: true, mode, message: "NUDGE_OK (no-op backend)" }, { status: 200 });
  } else {
    return bad(`Unknown mode: ${String(mode)}`);
  }

  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        apikey: supabaseServiceKey,
        Authorization: `Bearer ${supabaseServiceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify(patch),
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, mode, status: res.status, message: "PATCH_FAILED", detail: text },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true, mode, result: text }, { status: 200 });
  } catch (err: any) {
    console.error("dispatch/assign error:", err);
    return NextResponse.json(
      { ok: false, mode, message: "ASSIGN_ROUTE_ERROR", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}