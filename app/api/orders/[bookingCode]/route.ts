import { NextResponse } from "next/server";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

function n(value: any): number {
  const out = Number(value ?? 0);
  return Number.isFinite(out) ? out : 0;
}

function roundMoney(value: number): number {
  return Math.round(n(value) * 100) / 100;
}

function firstNumber(...values: any[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const out = n(value);
    if (out > 0) return out;
  }
  return 0;
}

export async function GET(
  req: Request,
  { params }: { params: { bookingCode: string } }
) {
  const supabase = createRouteHandlerClient({ cookies });
  const { bookingCode } = params;

  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("booking_code", bookingCode)
    .single();

  if (error || !data || typeof data !== "object") {
    return NextResponse.json(
      { error: error?.message ?? "Booking not found" },
      { status: 404 }
    );
  }

  const booking = data as any;
  const fare_breakdown = booking.fare_breakdown ?? {};
  const serviceType = String(booking.service_type ?? "").trim().toLowerCase();
  const isTakeout = serviceType === "takeout";

  const takeoutItemsSubtotal = firstNumber(
    booking.takeout_items_subtotal,
    booking.items_subtotal,
    booking.subtotal,
    booking.total_bill,
    booking.totalBill,
    booking.fare,
    fare_breakdown.items_total,
    fare_breakdown.base_fee
  );

  const deliveryFee = firstNumber(
    booking.delivery_fee,
    booking.deliveryFee,
    fare_breakdown.delivery_fee
  );

  const otherFees = firstNumber(
    booking.other_fees,
    booking.otherFees,
    fare_breakdown.other_fees
  );

  const takeoutPlatformFee = roundMoney(takeoutItemsSubtotal * 0.10);
  const takeoutVendorEarnings = roundMoney(takeoutItemsSubtotal - takeoutPlatformFee);
  const takeoutGrandTotal = roundMoney(takeoutItemsSubtotal + deliveryFee + otherFees);

  return NextResponse.json({
    id: booking.id,
    booking_code: booking.booking_code,
    passenger_name: booking.passenger_name,
    customer_name: booking.customer_name ?? booking.passenger_name ?? null,
    customer_phone: booking.customer_phone ?? booking.rider_phone ?? null,
    service_type: booking.service_type,
    status: booking.status,
    customer_status: booking.customer_status,
    vendor_status: booking.vendor_status,
    vendor_id: booking.vendor_id ?? null,
    vendor_name: booking.vendor_name ?? booking.merchant_name ?? null,
    from_label: booking.from_label ?? booking.pickup_label ?? null,
    to_label: booking.to_label ?? booking.dropoff_label ?? null,
    pickup_lat: booking.pickup_lat ?? null,
    pickup_lng: booking.pickup_lng ?? null,
    dropoff_lat: booking.dropoff_lat ?? null,
    dropoff_lng: booking.dropoff_lng ?? null,

    base_fee: isTakeout
      ? takeoutItemsSubtotal
      : fare_breakdown.base_fee,
    extra_stop_fee: fare_breakdown.extra_stop_fee,
    company_cut: isTakeout
      ? takeoutPlatformFee
      : fare_breakdown.company_cut,
    driver_payout: Number(booking.driver_payout ?? 0),

    takeout_items_subtotal: isTakeout ? takeoutItemsSubtotal : booking.takeout_items_subtotal ?? null,
    items_subtotal: isTakeout ? takeoutItemsSubtotal : booking.items_subtotal ?? null,
    items_total: isTakeout ? takeoutItemsSubtotal : fare_breakdown.items_total ?? null,
    delivery_fee: isTakeout ? deliveryFee : fare_breakdown.delivery_fee ?? null,
    platform_fee: isTakeout ? takeoutPlatformFee : fare_breakdown.platform_fee ?? null,
    vendor_earnings: isTakeout ? takeoutVendorEarnings : booking.vendor_earnings ?? null,
    other_fees: isTakeout ? otherFees : fare_breakdown.other_fees ?? null,
    grand_total: isTakeout ? takeoutGrandTotal : fare_breakdown.grand_total ?? null,
    total_bill: isTakeout ? takeoutGrandTotal : booking.total_bill ?? null,
    fare_breakdown: isTakeout
      ? {
          items_total: takeoutItemsSubtotal,
          delivery_fee: deliveryFee,
          platform_fee: takeoutPlatformFee,
          other_fees: otherFees,
          grand_total: takeoutGrandTotal,
          vendor_earnings: takeoutVendorEarnings,
        }
      : fare_breakdown,

    created_at: booking.created_at,
    updated_at: booking.updated_at,
    vendor_driver_arrived_at: booking.vendor_driver_arrived_at,
  });
}
