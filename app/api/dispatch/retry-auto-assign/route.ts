import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assignErrandStage0 } from "@/lib/errand/assignStage0";

const ERRAND_MATCHING_STATUSES = ["requested", "pending", "searching"];
const ERRAND_RETRY_SECONDS = 10;
const ERRAND_SCAN_LIMIT = 5;

function text(value: unknown): string {
  return String(value ?? "").trim();
}

async function retryWaitingErrands() {
  const admin = supabaseAdmin();
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - ERRAND_RETRY_SECONDS * 1000
  ).toISOString();

  const scan = await admin
    .from("bookings")
    .select("id,booking_code,status,updated_at")
    .eq("service_type", "errand")
    .is("assigned_driver_id", null)
    .in("status", ERRAND_MATCHING_STATUSES)
    .lte("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(ERRAND_SCAN_LIMIT);

  if (scan.error) {
    return {
      ok: false,
      scanned: 0,
      assigned: 0,
      error: "ERRAND_RETRY_SCAN_FAILED",
      message: scan.error.message,
      results: [],
    };
  }

  const rows = Array.isArray(scan.data) ? scan.data : [];
  const results: any[] = [];
  let assigned = 0;

  for (const row of rows) {
    const bookingId = text((row as any).id);
    const bookingCode = text((row as any).booking_code);
    if (!bookingId) continue;

    const claimTime = new Date().toISOString();
    const claim = await admin
      .from("bookings")
      .update({ updated_at: claimTime })
      .eq("id", bookingId)
      .is("assigned_driver_id", null)
      .in("status", ERRAND_MATCHING_STATUSES)
      .lte("updated_at", cutoff)
      .select("id")
      .maybeSingle();

    if (claim.error) {
      results.push({
        booking_id: bookingId,
        booking_code: bookingCode || null,
        ok: false,
        error: "ERRAND_RETRY_CLAIM_FAILED",
        message: claim.error.message,
      });
      continue;
    }

    if (!claim.data?.id) continue;

    const result = await assignErrandStage0({
      bookingId,
      bookingCode,
    });

    if ((result as any)?.assigned === true) assigned += 1;

    results.push({
      booking_id: bookingId,
      booking_code: bookingCode || null,
      ...result,
    });
  }

  if (rows.length > 0) {
    console.log(
      "[JRIDE_ERRAND_DRIVER_PING_RETRY]",
      JSON.stringify({
        scanned: rows.length,
        assigned,
        results,
      })
    );
  }

  return {
    ok: true,
    scanned: rows.length,
    assigned,
    results,
  };
}

export async function POST(req: NextRequest) {
  try {
    const origin = new URL(req.url).origin;

    const [genericResponse, errandRetry] = await Promise.all([
      fetch(new URL("/api/dispatch/auto-assign", origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "scan_pending" }),
        cache: "no-store",
      }),
      retryWaitingErrands(),
    ]);

    const genericJson = await genericResponse.json().catch(() => null);
    const ok = genericResponse.ok && errandRetry.ok !== false;

    return NextResponse.json(
      {
        ok,
        status: genericResponse.status,
        result: genericJson,
        errand_retry: errandRetry,
      },
      { status: ok ? 200 : genericResponse.ok ? 500 : genericResponse.status }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
