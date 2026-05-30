import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

type PeriodKey = "today" | "week" | "month" | "all";

type BookingRow = {
  id?: string | null;
  booking_code?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  status?: string | null;
  vendor_status?: string | null;
  customer_status?: string | null;
  takeout_items_subtotal?: number | string | null;
  total_bill?: number | string | null;
  takeout_total_payable?: number | string | null;
  takeout_delivery_fee?: number | string | null;
  takeout_service_fee?: number | string | null;
  packaging_fee?: number | string | null;
  receipt_requested?: boolean | null;
  vendor_cancel_reason?: string | null;
  cancel_reason?: string | null;
};

type ItemRow = {
  booking_id?: string | null;
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
};

function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cents(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function normalizePeriod(v: unknown): PeriodKey {
  const s = text(v).toLowerCase();
  if (s === "week" || s === "weekly" || s === "this_week") return "week";
  if (s === "month" || s === "monthly" || s === "this_month") return "month";
  if (s === "all" || s === "all_time" || s === "alltime") return "all";
  return "today";
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = startOfToday();
  const day = d.getDay(); // Sunday=0
  const diff = day === 0 ? 6 : day - 1; // Monday start
  d.setDate(d.getDate() - diff);
  return d;
}

function startOfMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

function periodStart(period: PeriodKey): Date | null {
  if (period === "today") return startOfToday();
  if (period === "week") return startOfWeek();
  if (period === "month") return startOfMonth();
  return null;
}

function rowDate(row: BookingRow): Date | null {
  const raw = row.created_at || row.updated_at || "";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

function inPeriod(row: BookingRow, period: PeriodKey): boolean {
  const start = periodStart(period);
  if (!start) return true;
  const d = rowDate(row);
  if (!d) return false;
  return d.getTime() >= start.getTime();
}

function statusOf(row: BookingRow): string {
  return text(row.customer_status || row.vendor_status || row.status).toLowerCase();
}

function isCompleted(row: BookingRow): boolean {
  const s = statusOf(row);
  return s === "completed" || s === "delivered" || s === "done";
}

function isCancelled(row: BookingRow): boolean {
  const s = statusOf(row);
  return s === "cancelled" || s === "canceled" || s === "rejected";
}

function foodSubtotal(row: BookingRow): number {
  const subtotal = num(row.takeout_items_subtotal);
  if (subtotal > 0) return subtotal;
  const totalBill = num(row.total_bill);
  if (totalBill > 0) return totalBill;
  const totalPayable = num(row.takeout_total_payable);
  const delivery = num(row.takeout_delivery_fee);
  const service = num(row.takeout_service_fee);
  return Math.max(0, totalPayable - delivery - service);
}

function cancelReason(row: BookingRow): string {
  return text(row.vendor_cancel_reason || row.cancel_reason || "Unspecified");
}

function dayKey(row: BookingRow): string {
  const d = rowDate(row);
  if (!d) return "Unknown date";
  return d.toISOString().slice(0, 10);
}

function hourKey(row: BookingRow): string {
  const d = rowDate(row);
  if (!d) return "Unknown";
  const h = String(d.getHours()).padStart(2, "0");
  return h + ":00";
}

function topEntries(map: Record<string, number>, limit: number) {
  return Object.entries(map)
    .map(([name, value]) => ({ name, value: cents(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

export async function GET(req: NextRequest) {
  const vendorId = text(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId"));
  const period = normalizePeriod(req.nextUrl.searchParams.get("period"));

  if (!vendorId) {
    return json(400, {
      ok: false,
      error: "vendor_id_required",
      message: "vendor_id is required.",
    });
  }

  const admin = adminClient();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing Supabase service role configuration.",
    });
  }

  const bookingsRes = await admin
    .from("bookings")
    .select("*")
    .eq("vendor_id", vendorId)
    .eq("service_type", "takeout")
    .order("created_at", { ascending: false });

  if (bookingsRes.error) {
    return json(500, {
      ok: false,
      error: "DB_ERROR",
      message: bookingsRes.error.message,
    });
  }

  const allRows = (Array.isArray(bookingsRes.data) ? bookingsRes.data : []) as BookingRow[];
  const rows = allRows.filter((row) => inPeriod(row, period));
  const bookingIds = rows.map((row) => text(row.id)).filter(Boolean);

  const itemsByBooking: Record<string, ItemRow[]> = {};
  if (bookingIds.length) {
    const itemsRes = await admin
      .from("takeout_order_items")
      .select("booking_id,name,price,quantity")
      .in("booking_id", bookingIds);

    if (!itemsRes.error && Array.isArray(itemsRes.data)) {
      for (const item of itemsRes.data as ItemRow[]) {
        const bid = text(item.booking_id);
        if (!bid) continue;
        if (!itemsByBooking[bid]) itemsByBooking[bid] = [];
        itemsByBooking[bid].push(item);
      }
    }
  }

  const completedRows = rows.filter(isCompleted);
  const cancelledRows = rows.filter(isCancelled);

  let grossFoodSales = 0;
  let grossPayable = 0;
  let deliveryFees = 0;
  let serviceFees = 0;
  let packagingRevenue = 0;
  let receiptRequests = 0;

  const cancelReasonCounts: Record<string, number> = {};
  const salesByDay: Record<string, number> = {};
  const ordersByHour: Record<string, number> = {};
  const itemQty: Record<string, number> = {};
  const itemSales: Record<string, number> = {};

  for (const row of completedRows) {
    const food = foodSubtotal(row);
    const payable = num(row.takeout_total_payable);
    const delivery = num(row.takeout_delivery_fee);
    const service = num(row.takeout_service_fee);

    grossFoodSales += food;
    grossPayable += payable > 0 ? payable : food + delivery + service;
    deliveryFees += delivery;
    serviceFees += service;
    packagingRevenue += num(row.packaging_fee);

    if (row.receipt_requested === true) receiptRequests += 1;

    const dKey = dayKey(row);
    salesByDay[dKey] = (salesByDay[dKey] || 0) + food;

    const hKey = hourKey(row);
    ordersByHour[hKey] = (ordersByHour[hKey] || 0) + 1;

    const bid = text(row.id);
    for (const item of itemsByBooking[bid] || []) {
      const name = text(item.name) || "Unnamed item";
      const qty = Math.max(1, parseInt(String(item.quantity ?? 1), 10) || 1);
      const price = num(item.price);
      itemQty[name] = (itemQty[name] || 0) + qty;
      itemSales[name] = (itemSales[name] || 0) + price * qty;
    }
  }

  for (const row of cancelledRows) {
    const reason = cancelReason(row);
    cancelReasonCounts[reason] = (cancelReasonCounts[reason] || 0) + 1;
  }

  const totalOrders = rows.length;
  const completedOrders = completedRows.length;
  const cancelledOrders = cancelledRows.length;
  const activeOrders = rows.filter((row) => !isCompleted(row) && !isCancelled(row)).length;
  const averageOrderValue = completedOrders > 0 ? grossFoodSales / completedOrders : 0;
  const cancellationRate = totalOrders > 0 ? (cancelledOrders / totalOrders) * 100 : 0;
  const completionRate = totalOrders > 0 ? (completedOrders / totalOrders) * 100 : 0;

  const topItems = Object.keys(itemQty)
    .map((name) => ({
      name,
      quantity: itemQty[name],
      sales: cents(itemSales[name] || 0),
    }))
    .sort((a, b) => b.quantity - a.quantity || b.sales - a.sales)
    .slice(0, 10);

  const salesTrend = Object.entries(salesByDay)
    .map(([date, sales]) => ({ date, sales: cents(sales) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const hourlyDemand = Object.entries(ordersByHour)
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  return json(200, {
    ok: true,
    period,
    generated_at: new Date().toISOString(),
    vendor_id: vendorId,
    summary: {
      total_orders: totalOrders,
      active_orders: activeOrders,
      completed_orders: completedOrders,
      cancelled_orders: cancelledOrders,
      gross_food_sales: cents(grossFoodSales),
      gross_payable: cents(grossPayable),
      delivery_fees: cents(deliveryFees),
      service_fees: cents(serviceFees),
      packaging_revenue: cents(packagingRevenue),
      receipt_requests: receiptRequests,
      average_order_value: cents(averageOrderValue),
      cancellation_rate: cents(cancellationRate),
      completion_rate: cents(completionRate),
    },
    top_items: topItems,
    cancellation_reasons: topEntries(cancelReasonCounts, 10).map((x) => ({
      reason: x.name,
      count: x.value,
    })),
    sales_trend: salesTrend,
    hourly_demand: hourlyDemand,
  });
}
