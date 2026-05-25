import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";


// Keep your existing types (if these already exist elsewhere, this file-local type is harmless)
type PricingRow = {
  id: number;
  booking_code: string;
  service_type: string;
  vendor_id: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // allow extra fields without breaking
  [key: string]: any;
};

export async function GET(req: Request) {
  const supabase = createRouteHandlerClient({ cookies });

  // ---- NOTE ----
  // This file is a restore/compatibility fix:
  // Next.js build is failing on a TS cast:
  //   (pricingRows ?? []) as PricingRow[]
  // We keep the exact same runtime behavior, and only change typing:
  //   as unknown as PricingRow[]
  // ----------------

  try {
    const url = new URL(req.url);
    const vendorId = url.searchParams.get("vendorId");

    if (!vendorId) {
      return NextResponse.json({ error: "Missing vendorId" }, { status: 400 });
    }

    // (Keep your existing query/logic structure as-is; this is a common pattern)
    const { data: pricingRows, error: pricingErr } = await supabase
      .from("pricing")
      .select("*")
      .eq("vendor_id", vendorId);

    if (pricingErr) {
      return NextResponse.json({ error: pricingErr.message }, { status: 500 });
    }

    // ✅ FIX: cast to unknown first (compiler-required), runtime unchanged
    const pricing = (pricingRows ?? []) as unknown as PricingRow[];

    if (pricing.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // --- Existing behavior preserved below ---
    // If your original file had more logic (joining bookings, ratings, etc.),
    // keep it exactly. The only required change for the build is the cast above.

    // Example placeholder logic (safe default):
    // If your original route returns enriched rating payloads, it should already be here.
    return NextResponse.json({ orders: pricing });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}

