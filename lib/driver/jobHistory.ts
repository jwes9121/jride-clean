import type { SupabaseClient } from "@supabase/supabase-js";

type Source = "bookings" | "agrimarket";
type Cursor = { at: string; id: string; source: Source };
type Row = Record<string, any>;
const SIZE = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/;
const BOOKING_COLUMNS = "id,booking_code,status,service_type,trip_type,from_label,to_label,passenger_name,proposed_fare,verified_fare,pickup_distance_fee,created_at,updated_at,completed_at";
const AGRI_COLUMNS = "id,order_code,status,delivery_label,created_at,updated_at,completed_at,customer_cash_collected_at,customer_cash_collected_amount,producer_paid_at,producer_paid_amount,final_cash_collected_at,final_cash_collected_amount,driver_delivery_payout,wallet_settlement_status,wallet_settlement_amount";

function text(value: unknown): string { return String(value ?? "").trim(); }
function money(value: unknown): number | null {
  if (value == null || text(value) === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
function stamp(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) throw new Error("INVALID_HISTORY_TIMESTAMP");
  // Preserve Postgres microseconds: milliseconds alone can misorder adjacent jobs.
  return value.slice(0, 19) + "." + (value.match(/\.(\d+)/)?.[1] || "").padEnd(6, "0") + "Z";
}
export function decodeHistoryCursor(value: string | null): Cursor | null {
  if (value === null) return null;
  try {
    if (!value || value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (typeof c.at !== "string" || typeof c.id !== "string" || !UUID.test(c.id) ||
        !["bookings", "agrimarket"].includes(c.source)) throw new Error();
    return { at: stamp(c.at), id: c.id, source: c.source };
  } catch { throw new Error("INVALID_HISTORY_CURSOR"); }
}
function position(row: Row, source: Source): Cursor {
  const id = text(row.id);
  if (!UUID.test(id)) throw new Error("INVALID_HISTORY_ID");
  return { at: stamp(text(row.created_at)), id, source };
}
function compare(a: Cursor, b: Cursor): number {
  const ka = a.at + a.id + a.source;
  const kb = b.at + b.id + b.source;
  return ka === kb ? 0 : ka > kb ? -1 : 1;
}
export function historyFilter(cursor: Cursor | null, source: Source): string | null {
  if (!cursor) return null;
  // Source is the last descending tie-breaker, even if two tables share a UUID.
  const op = source < cursor.source ? "lte" : "lt";
  return `created_at.lt.${cursor.at},and(created_at.eq.${cursor.at},id.${op}.${cursor.id})`;
}
export function mapJob(row: Row, source: Source) {
  const status = text(row.status).toLowerCase();
  const completed = status === "completed";
  const service = text(row.service_type || row.trip_type).toLowerCase();
  const common = {
    key: source + ":" + text(row.id),
    booking_code: text(source === "agrimarket" ? row.order_code : row.booking_code),
    service_type: source === "agrimarket" ? "agrimarket" : ["motorcycle", "tricycle", "ride"].includes(service) ? "ride" : ["takeout", "errand"].includes(service) ? service : "other",
    status, created_at: text(row.created_at), completed_at: text(row.completed_at) || null,
    pickup_label: source === "agrimarket" ? null : text(row.from_label) || null,
    dropoff_label: text(source === "agrimarket" ? row.delivery_label : row.to_label) || null,
    passenger_name: source === "agrimarket" ? null : text(row.passenger_name) || null,
  };
  if (source === "bookings") {
    const fare = money(row.verified_fare) ?? money(row.proposed_fare);
    const pickup = money(row.pickup_distance_fee) ?? 0;
    return { ...common, fare: fare === null ? null : Math.round((fare + pickup) * 100) / 100 };
  }
  const advance = row.customer_cash_collected_at ? money(row.customer_cash_collected_amount) : 0;
  const final = row.final_cash_collected_at ? money(row.final_cash_collected_amount) : 0;
  const hasCollection = Boolean(row.customer_cash_collected_at || row.final_cash_collected_at);
  return {
    ...common,
    driver_earnings: completed ? money(row.driver_delivery_payout) : null,
    cash_collected: hasCollection && advance !== null && final !== null ? Math.round((advance + final) * 100) / 100 : null,
    farmer_paid: row.producer_paid_at ? money(row.producer_paid_amount) : null,
    wallet_deduction: row.wallet_settlement_status === "settled" ? money(row.wallet_settlement_amount) : null,
    settlement_status: text(row.wallet_settlement_status) || "pending",
  };
}
export function mergeHistory(bookings: Row[], agrimarket: Row[], linkedBookingIds: Set<string>) {
  const all = [
    ...bookings.map(row => ({ row, source: "bookings" as const, cursor: position(row, "bookings") })),
    ...agrimarket.map(row => ({ row, source: "agrimarket" as const, cursor: position(row, "agrimarket") })),
  ].sort((a, b) => compare(a.cursor, b.cursor));
  // Consume raw positions before removing linked delivery-booking duplicates.
  // This keeps every page bounded and its cursor moving, including empty pages.
  const page = all.slice(0, SIZE);
  const more = all.length > SIZE;
  return {
    version: 2,
    items: page.filter(x => x.source !== "bookings" || !linkedBookingIds.has(text(x.row.id)))
      .map(x => mapJob(x.row, x.source)),
    next_cursor: more && page.length ? Buffer.from(JSON.stringify(page[page.length - 1].cursor)).toString("base64url") : null,
    has_more: more,
    order: "created_at_desc",
  };
}
export async function readJobHistory(db: SupabaseClient, driverId: string, cursor: Cursor | null) {
  if (!UUID.test(driverId)) throw new Error("INVALID_DRIVER_ID");
  const read = async (source: Source) => {
    const table: string = source === "bookings" ? "bookings" : "agrimarket_orders";
    const columns: string = source === "bookings" ? BOOKING_COLUMNS : AGRI_COLUMNS;
    let q = db.from(table).select(columns);
    // One or-expression avoids repeated PostgREST 'or' parameters overwriting
    // ownership or pagination filters. Cursor values are strictly validated.
    const filter = historyFilter(cursor, source);
    if (source === "bookings") {
      const owner = `driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`;
      q = filter ? q.or(`and(or(${owner}),or(${filter}))`) : q.or(owner);
    } else {
      q = q.eq("assigned_driver_id", driverId);
      if (filter) q = q.or(filter);
    }
    const result = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(SIZE + 1);
    if (result.error) throw new Error("HISTORY_READ_FAILED");
    return (result.data || []) as unknown as Row[];
  };
  const [bookings, agri] = await Promise.all([read("bookings"), read("agrimarket")]);
  const linked = new Set<string>();
  if (bookings.length) {
    const result = await db.from("agrimarket_orders").select("delivery_booking_id")
      .eq("assigned_driver_id", driverId).in("delivery_booking_id", bookings.map(row => row.id));
    if (result.error) throw new Error("HISTORY_READ_FAILED");
    for (const row of result.data || []) linked.add(text(row.delivery_booking_id));
  }
  return mergeHistory(bookings, agri, linked);
}
