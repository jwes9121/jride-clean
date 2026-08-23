import { NextRequest, NextResponse } from "next/server";
import { createVendorMetricsAdmin } from "@/lib/vendorPerformanceServer";
import { requireVendorSession } from "@/lib/vendorSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function heartbeatBucketStart(nowMs: number): string {
  const bucketMs = 5 * 60 * 1000;
  return new Date(Math.floor(nowMs / bucketMs) * bucketMs).toISOString();
}

export async function POST(req: NextRequest) {
  try {
    const admin = createVendorMetricsAdmin();
    const vendorSession = await requireVendorSession(req, admin);

    if (!vendorSession.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: vendorSession.error,
          message: "A valid vendor session is required.",
        },
        { status: vendorSession.status }
      );
    }

    const now = new Date();
    const userAgent = String(req.headers.get("user-agent") || "").slice(0, 500);
    const surface = userAgent.includes("JRideVendorAndroid/1")
      ? "android_vendor_apk"
      : "web_vendor_portal";

    const current = await admin
      .from("vendor_presence_current")
      .upsert(
        {
          vendor_id: vendorSession.vendor.vendorId,
          last_seen_at: now.toISOString(),
          surface,
          user_agent: userAgent || null,
          updated_at: now.toISOString(),
        },
        { onConflict: "vendor_id" }
      );

    if (current.error) throw new Error(current.error.message);

    const bucket = await admin
      .from("vendor_presence_buckets")
      .upsert(
        {
          vendor_id: vendorSession.vendor.vendorId,
          bucket_start: heartbeatBucketStart(now.getTime()),
          surface,
        },
        { onConflict: "vendor_id,bucket_start", ignoreDuplicates: true }
      );

    if (bucket.error) throw new Error(bucket.error.message);

    return NextResponse.json({
      ok: true,
      vendor_id: vendorSession.vendor.vendorId,
      recorded_at: now.toISOString(),
      surface,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "VENDOR_HEARTBEAT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
