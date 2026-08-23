import { NextRequest, NextResponse } from "next/server";
import { createVendorMetricsAdmin } from "@/lib/vendorPerformanceServer";
import { requireVendorSession } from "@/lib/vendorSession";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const admin = createVendorMetricsAdmin();
    const vendorSession = await requireVendorSession(req, admin);

    if (!vendorSession.ok) {
      return NextResponse.json(
        { ok: false, error: vendorSession.error },
        { status: vendorSession.status }
      );
    }

    const result = await admin
      .from("bookings")
      .select("id,booking_code,vendor_status,created_at,updated_at,vendor_responded_at,vendor_accepted_at,vendor_rejected_at,vendor_timeout_at")
      .eq("service_type", "takeout")
      .eq("vendor_id", vendorSession.vendor.vendorId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (result.error) throw new Error(result.error.message);

    return NextResponse.json({
      ok: true,
      orders: Array.isArray(result.data) ? result.data : [],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "VENDOR_ORDER_AUDIT_FAILED",
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
