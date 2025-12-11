import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

function num(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

type PricingRow = {
  id: string;
  booking_code: string;
  service_type: string;
  vendor_id: string | null;
  vendor_status: string | null;
  customer_status: string | null;
  total_service_fare: number | null;
  platform_fee_10pct: number | null;
  vendor_earnings_90pct: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type RatingRow = {
  booking_code: string;
  rating: number | null;
  comment: string | null;
  created_at: string | null;
};

async function resolveVendorIdFromSession() {
  const session = await auth();

  if (!session || !session.user || !session.user.email) {
    throw new Error("Unauthorized: vendor email missing from session");
  }

  if (!supabase) {
    throw new Error("Supabase not configured");
  }

  const email = String(session.user.email);
  const displayName = session.user.name ?? null;

  const { data, error } = await supabase.rpc(
    "get_or_create_vendor_id_by_email",
    {
      p_email: email,
      p_display_name: displayName,
    }
  );

  if (error) {
    console.error("❌ get_or_create_vendor_id_by_email error:", error);
    throw new Error(error.message || "Failed to resolve vendor ID");
  }

  const vendorId = data as string | null;
  if (!vendorId) {
    throw new Error("Unable to resolve vendor ID for email " + email);
  }

  return vendorId;
}

export async function GET() {
  try {
    if (!supabase) {
      console.error("❌ Supabase env vars missing");
      return NextResponse.json(
        { error: "Supabase not configured" },
        { status: 500 }
      );
    }

    const vendorId = await resolveVendorIdFromSession();

    // 1) Load pricing rows for THIS vendor from the 10% view
    const { data: pricingRows, error: pricingError } = await supabase
      .from("takeout_pricing_10pct_view")
      .select(
        [
          "id",
          "booking_code",
          "service_type",
          "vendor_id",
          "vendor_status",
          "customer_status",
          "total_service_fare",
          "platform_fee_10pct",
          "vendor_earnings_90pct",
          "created_at",
          "updated_at",
        ].join(",")
      )
      .eq("service_type", "takeout")
      .eq("vendor_id", vendorId)
      .order("created_at", { ascending: false })
      .limit(500);

    if (pricingError) {
      console.error("❌ Error loading pricing rows:", pricingError);
      return NextResponse.json(
        { error: pricingError.message },
        { status: 500 }
      );
    }

    const pricing = (pricingRows ?? []) as PricingRow[];

    if (pricing.length === 0) {
      return NextResponse.json({ orders: [] });
    }

    // 2) Load ratings for these bookings
    const bookingCodes = Array.from(
      new Set(pricing.map((p) => p.booking_code).filter(Boolean))
    );

    const { data: ratingRows, error: ratingError } = await supabase
      .from("order_ratings")
      .select("booking_code,rating,comment,created_at")
      .in("booking_code", bookingCodes);

    if (ratingError) {
      console.error("❌ Error loading ratings:", ratingError);
      return NextResponse.json(
        { error: ratingError.message },
        { status: 500 }
      );
    }

    const ratings = (ratingRows ?? []) as RatingRow[];

    // 3) Aggregate ratings per booking_code
    const ratingByBooking = new Map<
      string,
      {
        sum: number;
        count: number;
        latestComment: string | null;
        latestCreatedAt: string | null;
      }
    >();

    for (const r of ratings) {
      if (!r.booking_code) continue;
      const key = r.booking_code;
      const current =
        ratingByBooking.get(key) ?? {
          sum: 0,
          count: 0,
          latestComment: null as string | null,
          latestCreatedAt: null as string | null,
        };

      if (typeof r.rating === "number" && Number.isFinite(r.rating)) {
        current.sum += r.rating;
        current.count += 1;
      }

      if (r.comment) {
        const createdAt = r.created_at ?? null;
        if (
          !current.latestCreatedAt ||
          (createdAt && createdAt > current.latestCreatedAt)
        ) {
          current.latestComment = r.comment;
          current.latestCreatedAt = createdAt;
        }
      }

      ratingByBooking.set(key, current);
    }

    // 4) Build response objects for the UI
    const orders = pricing.map((row) => {
      const ratingInfo = ratingByBooking.get(row.booking_code) ?? null;

      const ratingCount = ratingInfo?.count ?? 0;
      const ratingAvg =
        ratingInfo && ratingInfo.count > 0
          ? ratingInfo.sum / ratingInfo.count
          : null;

      return {
        id: row.id,
        booking_code: row.booking_code,
        status: row.vendor_status ?? row.customer_status ?? null,
        vendor_status: row.vendor_status,
        customer_status: row.customer_status,
        created_at: row.created_at,
        updated_at: row.updated_at,
        total_bill: num(row.total_service_fare),
        platform_fee: num(row.platform_fee_10pct),
        items_total: num(row.total_service_fare),
        driver_payout: num(row.vendor_earnings_90pct),
        rating_avg: ratingAvg,
        rating_count: ratingCount,
        rating_comment: ratingInfo?.latestComment ?? null,
      };
    });

    return NextResponse.json({ orders });
  } catch (err: any) {
    console.error("❌ vendor-ratings server error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Unknown server error" },
      { status: 500 }
    );
  }
}
