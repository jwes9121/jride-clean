import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PeriodKey = "today" | "week" | "month" | "all";

type BookingRow = Record<string, any>;

type ItemRow = {
  booking_id?: string | null;
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  snapshot_at?: string | null;
};

function json(status: number, body: Record<string, any>) {
  return NextResponse.json(body, { status });
}

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(v: unknown): string {
  return text(v).toLowerCase().replace(/\s+/g, "_");
}

function isCompleted(row: BookingRow): boolean {
  const statuses = [
    normalizeStatus(row.vendor_status),
    normalizeStatus(row.customer_status),
    normalizeStatus(row.status),
  ];
  return statuses.includes("completed");
}

function isCancelled(row: BookingRow): boolean {
  const statuses = [
    normalizeStatus(row.vendor_status),
    normalizeStatus(row.customer_status),
    normalizeStatus(row.status),
  ];
  return statuses.includes("cancelled") || statuses.includes("canceled") || statuses.includes("vendor_timeout");
}

function isVendorTimeout(row: BookingRow): boolean {
  const reason = cancelReason(row).toLowerCase();
  const statuses = [
    normalizeStatus(row.vendor_status),
    normalizeStatus(row.customer_status),
  ];
  return statuses.includes("vendor_timeout") || reason.includes("did not respond within 5 minutes");
}

function isActive(row: BookingRow): boolean {
  return !isCompleted(row) && !isCancelled(row);
}

function manilaDateKey(iso: unknown): string {
  const d = new Date(text(iso));
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function manilaHourKey(iso: unknown): string {
  const d = new Date(text(iso));
  if (!Number.isFinite(d.getTime())) return "--:00";
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour: "2-digit",
    hour12: false,
  }).format(d);
  return hour + ":00";
}

function startOfManilaPeriod(period: PeriodKey): string | null {
  if (period === "all") return null;

  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === "year")?.value || "0");
  const m = Number(parts.find((p) => p.type === "month")?.value || "1");
  const d = Number(parts.find((p) => p.type === "day")?.value || "1");

  let startY = y;
  let startM = m;
  let startD = d;

  if (period === "month") {
    startD = 1;
  }

  if (period === "week") {
    const manilaNoonUtc = new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
    const day = manilaNoonUtc.getUTCDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    manilaNoonUtc.setUTCDate(manilaNoonUtc.getUTCDate() + mondayOffset);
    startY = manilaNoonUtc.getUTCFullYear();
    startM = manilaNoonUtc.getUTCMonth() + 1;
    startD = manilaNoonUtc.getUTCDate();
  }

  const utc = new Date(Date.UTC(startY, startM - 1, startD, 16, 0, 0));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return utc.toISOString();
}

function orderSubtotal(row: BookingRow, itemSubtotal: number): number {
  const explicit =
    row.takeout_items_subtotal ??
    row.items_subtotal ??
    row.subtotal ??
    row.total_bill ??
    row.totalBill;
  const n = num(explicit);
  return n > 0 ? n : itemSubtotal;
}

function cancelReason(row: BookingRow): string {
  return text(row.vendor_cancel_reason || row.cancel_reason || "Unspecified");
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const vendorId = text(url.searchParams.get("vendor_id"));
  const rawPeriod = text(url.searchParams.get("period")).toLowerCase();
  const period: PeriodKey = rawPeriod === "week" || rawPeriod === "month" || rawPeriod === "all" ? rawPeriod : "today";

  if (!vendorId) {
    return json(400, { ok: false, error: "VENDOR_ID_REQUIRED", message: "vendor_id is required." });
  }

  const supabaseUrl = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRole = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");

  if (!supabaseUrl || !serviceRole) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG", message: "Missing Supabase service configuration." });
  }

  const admin = createClient(supabaseUrl, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let query = admin
    .from("bookings")
    .select("*")
    .eq("vendor_id", vendorId)
    .eq("service_type", "takeout")
    .order("created_at", { ascending: false });

  const startIso = startOfManilaPeriod(period);
  if (startIso) query = query.gte("created_at", startIso);

  const bookingsRes = await query;

  if (bookingsRes.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: bookingsRes.error.message });
  }

  const rows = (Array.isArray(bookingsRes.data) ? bookingsRes.data : []) as BookingRow[];
  const bookingIds = rows.map((r) => text(r.id)).filter(Boolean);

  const itemRows: ItemRow[] = [];
  const itemSubtotalByBooking: Record<string, number> = {};

  if (bookingIds.length) {
    const itemsRes = await admin
      .from("takeout_order_items")
      .select("booking_id,name,price,quantity,snapshot_at")
      .in("booking_id", bookingIds);

    if (itemsRes.error) {
      return json(500, { ok: false, error: "ITEMS_DB_ERROR", message: itemsRes.error.message });
    }

    for (const item of (Array.isArray(itemsRes.data) ? itemsRes.data : []) as ItemRow[]) {
      const bid = text(item.booking_id);
      if (!bid) continue;
      const quantity = Math.max(1, Math.floor(num(item.quantity) || 1));
      const sales = num(item.price) * quantity;
      itemRows.push(item);
      itemSubtotalByBooking[bid] = (itemSubtotalByBooking[bid] || 0) + sales;
    }
  }

  const completed = rows.filter(isCompleted);
  const cancelled = rows.filter(isCancelled);
  const vendorTimeout = rows.filter(isVendorTimeout);
  const manualVendorRejections = cancelled.filter((row) => !isVendorTimeout(row));
  const active = rows.filter(isActive);

  let grossFoodSales = 0;
  let grossPayable = 0;
  let deliveryFees = 0;
  let serviceFees = 0;
  let packagingRevenue = 0;
  let receiptRequests = 0;

  const completedIds = new Set(completed.map((r) => text(r.id)).filter(Boolean));

  for (const row of completed) {
    const bid = text(row.id);
    grossFoodSales += orderSubtotal(row, itemSubtotalByBooking[bid] || 0);
    grossPayable += num(row.takeout_total_payable);
    deliveryFees += num(row.takeout_delivery_fee);
    serviceFees += num(row.takeout_service_fee);
    packagingRevenue += num(row.premium_packaging_fee);
    if (row.receipt_requested === true || text(row.receipt_requested).toLowerCase() === "true") receiptRequests += 1;
  }

  const itemMap: Record<string, { name: string; quantity: number; sales: number }> = {};
  for (const item of itemRows) {
    const bid = text(item.booking_id);
    if (!completedIds.has(bid)) continue;

    const name = text(item.name) || "Unnamed item";
    const quantity = Math.max(1, Math.floor(num(item.quantity) || 1));
    const sales = num(item.price) * quantity;

    if (!itemMap[name]) itemMap[name] = { name, quantity: 0, sales: 0 };
    itemMap[name].quantity += quantity;
    itemMap[name].sales += sales;
  }

  const cancellationMap: Record<string, number> = {};
  for (const row of cancelled) {
    const reason = cancelReason(row);
    cancellationMap[reason] = (cancellationMap[reason] || 0) + 1;
  }

  const salesTrendMap: Record<string, number> = {};
  for (const row of completed) {
    const key = manilaDateKey(row.created_at);
    if (!key) continue;
    const bid = text(row.id);
    salesTrendMap[key] = (salesTrendMap[key] || 0) + orderSubtotal(row, itemSubtotalByBooking[bid] || 0);
  }

  const hourlyMap: Record<string, number> = {};
  for (const row of rows) {
    const key = manilaHourKey(row.created_at);
    hourlyMap[key] = (hourlyMap[key] || 0) + 1;
  }

  const totalOrders = rows.length;
  const completedOrders = completed.length;
  const cancelledOrders = cancelled.length;

  return json(200, {
    ok: true,
    vendor_id: vendorId,
    period,
    generated_at: new Date().toISOString(),
    summary: {
      total_orders: totalOrders,
      active_orders: active.length,
      completed_orders: completedOrders,
      cancelled_orders: cancelledOrders,
      vendor_timeout_count: vendorTimeout.length,
      manual_vendor_rejections: manualVendorRejections.length,
      gross_food_sales: grossFoodSales,
      gross_payable: grossPayable,
      delivery_fees: deliveryFees,
      service_fees: serviceFees,
      packaging_revenue: packagingRevenue,
      receipt_requests: receiptRequests,
      average_order_value: completedOrders ? grossFoodSales / completedOrders : 0,
      cancellation_rate: totalOrders ? (cancelledOrders / totalOrders) * 100 : 0,
      vendor_timeout_rate: totalOrders ? (vendorTimeout.length / totalOrders) * 100 : 0,
      acceptance_rate: totalOrders ? ((completedOrders + active.length) / totalOrders) * 100 : 0,
      completion_rate: totalOrders ? (completedOrders / totalOrders) * 100 : 0,
    },
    top_items: Object.values(itemMap).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    cancellation_reasons: Object.entries(cancellationMap)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    sales_trend: Object.entries(salesTrendMap)
      .map(([date, sales]) => ({ date, sales }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    hourly_demand: Object.entries(hourlyMap)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
  });
}
