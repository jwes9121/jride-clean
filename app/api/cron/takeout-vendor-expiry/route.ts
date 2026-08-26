import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function headers() {
  return {
    "Cache-Control": "no-store, no-cache, max-age=0",
    Pragma: "no-cache",
  };
}

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  return (req.headers.get("authorization") || "") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: headers() }
    );
  }

  const admin = supabaseAdmin();
  const nowIso = new Date().toISOString();
  const result = await admin.rpc("expire_takeout_vendor_pending_v1", {
    p_now: nowIso,
  });

  if (result.error) {
    console.error("[takeout-vendor-expiry] sweep failed", {
      generatedAt: nowIso,
      message: result.error.message,
      code: result.error.code || null,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_VENDOR_EXPIRY_SWEEP_FAILED",
        message: result.error.message,
      },
      { status: 500, headers: headers() }
    );
  }

  const expired = Array.isArray(result.data) ? result.data : [];

  console.log("[takeout-vendor-expiry] sweep completed", {
    generatedAt: nowIso,
    expiredCount: expired.length,
    bookingCodes: expired
      .map((row: any) => String(row?.booking_code || ""))
      .filter(Boolean),
  });

  return NextResponse.json(
    {
      ok: true,
      generatedAt: nowIso,
      expiredCount: expired.length,
      expired,
    },
    { status: 200, headers: headers() }
  );
}
