import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Json = Record<string, any>;

type ZoneRow = {
  zone_id: string;
  zone_name: string;
  color_hex?: string | null;
  capacity_limit?: number | null;
  active_drivers?: number | null;
  available_slots?: number | null;
  status?: string | null;
};

const BOOKING_COLUMN_CANDIDATES = [
  "id",
  "uuid",
  "booking_code",
  "passenger_name",
  "pickup_label",
  "dropoff_label",
  "pickup_lat",
  "pickup_lng",
  "dropoff_lat",
  "dropoff_lng",
  "status",
  "driver_id",
  "driver_name",
  "driver_phone",
  "town",
  "zone",
  "created_at",
  "updated_at",
  // pricing-ish fields kept optional; route will only select them if they exist
  "base_fare",
  "convenience_fee",
  "distance_fee",
  "takeout_fee",
  "proposed_fare",
  "verified_fare",
  "passenger_fare_response",
  // previously problematic in your stack; must never be forced if absent
  "pickup_distance_fee",
] as const;

async function getExistingColumns(supabase: ReturnType<typeof supabaseAdmin>, table: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", table);

  if (error) {
    console.error("PAGE_DATA_SCHEMA_COLUMNS_ERROR", { table, message: error.message });
    return new Set<string>();
  }

  return new Set<string>((data || []).map((r: any) => String(r.column_name || "").trim()).filter(Boolean));
}

function pickSelectColumns(existing: Set<string>, candidates: readonly string[]) {
  return candidates.filter((c) => existing.has(c));
}

function normalizeTrip(row: Json): Json {
  return {
    ...row,
    booking_code: row.booking_code ?? row.bookingCode ?? null,
    pickup_label: row.pickup_label ?? row.from_label ?? row.fromLabel ?? null,
    dropoff_label: row.dropoff_label ?? row.to_label ?? row.toLabel ?? null,
    zone: row.zone ?? row.town ?? row.zone_name ?? null,
    status: row.status ?? "pending",
  };
}

async function loadBookings(supabase: ReturnType<typeof supabaseAdmin>) {
  const cols = await getExistingColumns(supabase, "bookings");
  if (!cols.size) {
    return {
      trips: [] as Json[],
      usedColumns: [] as string[],
      warnings: ["BOOKINGS_SCHEMA_NOT_READABLE"],
    };
  }

  const selected = pickSelectColumns(cols, BOOKING_COLUMN_CANDIDATES);
  if (!selected.includes("id") || !selected.includes("status")) {
    return {
      trips: [] as Json[],
      usedColumns: selected,
      warnings: ["BOOKINGS_REQUIRED_COLUMNS_MISSING"],
    };
  }

  const query = selected.join(",");
  const { data, error } = await supabase
    .from("bookings")
    .select(query)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error("PAGE_DATA_BOOKINGS_QUERY_ERROR", { message: error.message, query });
    return {
      trips: [] as Json[],
      usedColumns: selected,
      warnings: ["BOOKINGS_QUERY_FAILED", error.message],
    };
  }

  return {
    trips: (data || []).map(normalizeTrip),
    usedColumns: selected,
    warnings: [] as string[],
  };
}

async function tryLoadZones(supabase: ReturnType<typeof supabaseAdmin>) {
  const warnings: string[] = [];

  for (const table of ["zones", "dispatch_zones", "service_zones"]) {
    const cols = await getExistingColumns(supabase, table);
    if (!cols.size) continue;

    const selectable = [
      cols.has("id") ? "id" : null,
      cols.has("zone_id") ? "zone_id" : null,
      cols.has("name") ? "name" : null,
      cols.has("zone_name") ? "zone_name" : null,
      cols.has("color_hex") ? "color_hex" : null,
      cols.has("capacity_limit") ? "capacity_limit" : null,
      cols.has("active_drivers") ? "active_drivers" : null,
      cols.has("available_slots") ? "available_slots" : null,
      cols.has("status") ? "status" : null,
    ].filter(Boolean) as string[];

    if (!selectable.length) continue;

    const { data, error } = await supabase.from(table).select(selectable.join(",")).limit(200);
    if (error) {
      warnings.push(`${table.toUpperCase()}_QUERY_FAILED:${error.message}`);
      continue;
    }

    const zones: ZoneRow[] = (data || []).map((z: any) => ({
      zone_id: String(z.zone_id ?? z.id ?? z.name ?? z.zone_name ?? ""),
      zone_name: String(z.zone_name ?? z.name ?? z.zone_id ?? z.id ?? "Unknown"),
      color_hex: z.color_hex ?? null,
      capacity_limit: z.capacity_limit ?? null,
      active_drivers: z.active_drivers ?? null,
      available_slots: z.available_slots ?? null,
      status: z.status ?? null,
    }));

    return { zones, zoneSource: table, warnings };
  }

  return { zones: [] as ZoneRow[], zoneSource: null as string | null, warnings };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const supabase = supabaseAdmin();

    const [bookingsRes, zonesRes] = await Promise.all([
      loadBookings(supabase),
      tryLoadZones(supabase),
    ]);

    const warnings = [...bookingsRes.warnings, ...zonesRes.warnings];

    const payload: Json = {
      ok: true,
      zones: zonesRes.zones,
      trips: bookingsRes.trips,
      bookings: bookingsRes.trips,
      data: bookingsRes.trips,
      warnings,
    };

    if (debug) {
      payload.debug = {
        bookingColumnsUsed: bookingsRes.usedColumns,
        zoneSource: zonesRes.zoneSource,
        tripCount: bookingsRes.trips.length,
        zoneCount: zonesRes.zones.length,
        note: "pickup_distance_fee is only queried if it exists in public.bookings",
      };
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("PAGE_DATA_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "PAGE_DATA_UNEXPECTED",
        message: err?.message ?? "Unexpected error",
        zones: [],
        trips: [],
        bookings: [],
        data: [],
      },
      { status: 500 }
    );
  }
}
