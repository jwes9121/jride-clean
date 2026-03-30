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

function normalizeKeys(row: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(row || {})) {
    out[String(k)] = v;
  }
  return out;
}

const LIVETRIPS_QUARANTINED_BOOKING_CODES = new Set<string>([
  "JR-UI-20260318082937-9869",
  "JR-UI-20260318055904-5903",
  "JR-UI-20260326184941-8351",
  "JR-UI-20260326091251-2694",
]);

const LIVETRIPS_ALLOWED_TRIP_STATUSES = new Set<string>([
  "requested",
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
]);

const QUERY_STATUS_FILTER = [
  "requested",
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
];

// TEMP DEBUG PROBE
const PROBE_BOOKING_ID = "8b83b021-1991-4266-b715-50a6d92d72a7";

function normalizeTrip(row: Json): Json {
  const r = normalizeKeys(row);
  return {
    ...r,
    booking_code: r.booking_code ?? r.bookingCode ?? null,
    pickup_label: r.pickup_label ?? r.from_label ?? r.fromLabel ?? null,
    dropoff_label: r.dropoff_label ?? r.to_label ?? r.toLabel ?? null,
    zone: r.zone ?? r.town ?? r.zone_name ?? null,
    status: r.status ?? null,
  };
}

function excludeQuarantinedTrips(rows: Json[]): Json[] {
  return rows.filter((row: any) => {
    const code = String(row?.booking_code ?? row?.bookingCode ?? "").trim();
    return !LIVETRIPS_QUARANTINED_BOOKING_CODES.has(code);
  });
}

function filterDispatchEligibleTrips(rows: Json[]): Json[] {
  return rows.filter((row: any) => {
    const status = String(row?.status ?? "").trim().toLowerCase();
    return LIVETRIPS_ALLOWED_TRIP_STATUSES.has(status);
  });
}

async function loadBookings(supabase: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .neq("status", "cancelled")
    .neq("status", "completed")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error("PAGE_DATA_BOOKINGS_ERROR", error);
    return {
      trips: [] as Json[],
      rawRows: [] as Json[],
      usedColumns: [] as string[],
      warnings: ["BOOKINGS_SELECT_FAILED:" + error.message],
    };
  }

  const rows = Array.isArray(data) ? data : [];

  // Hard safety filter after fetch.
  // This prevents cancelled/completed/stale rows from leaking into LiveTrips
  // even if the upstream result snapshot is inconsistent.
  const hardFilteredRows = rows.filter((row: any) => {
    const status = String(row?.status ?? "").trim().toLowerCase();
    return LIVETRIPS_ALLOWED_TRIP_STATUSES.has(status);
  });

  const filteredRows = excludeQuarantinedTrips(hardFilteredRows);
  const normalizedTrips = filterDispatchEligibleTrips(
    filteredRows.map((row: any) => normalizeTrip(row))
  );
  const usedColumns = rows.length ? Object.keys(normalizeKeys(rows[0])) : ([] as string[]);

  return {
    trips: normalizedTrips,
    bookings: normalizedTrips,
    data: normalizedTrips,
    rawRows: rows,
    usedColumns,
    warnings: [] as string[],
  };
}

async function tryLoadZones(supabase: ReturnType<typeof supabaseAdmin>) {
  const warnings: string[] = [];

  for (const table of ["zones", "dispatch_zones", "service_zones"]) {
    const { data, error } = await supabase.from(table).select("*").limit(200);

    if (error) {
      warnings.push(table.toUpperCase() + "_QUERY_FAILED:" + error.message);
      continue;
    }

    const rows = Array.isArray(data) ? data : [];
    if (!rows.length) {
      continue;
    }

    const zones: ZoneRow[] = rows.map((z: any) => {
      const r = normalizeKeys(z);
      return {
        zone_id: String(r.zone_id ?? r.id ?? r.name ?? r.zone_name ?? ""),
        zone_name: String(r.zone_name ?? r.name ?? r.zone_id ?? r.id ?? "Unknown"),
        color_hex: r.color_hex ?? null,
        capacity_limit: r.capacity_limit ?? null,
        active_drivers: r.active_drivers ?? null,
        available_slots: r.available_slots ?? null,
        status: r.status ?? null,
      };
    });

    return { zones, zoneSource: table, warnings };
  }

  return { zones: [] as ZoneRow[], zoneSource: null as string | null, warnings };
}

async function loadProbe(supabase: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await supabase
    .from("bookings")
    .select("id, booking_code, status, driver_id, assigned_driver_id, assigned_at, updated_at")
    .eq("id", PROBE_BOOKING_ID)
    .maybeSingle();

  return {
    probeId: PROBE_BOOKING_ID,
    probeRow: data ?? null,
    probeError: error?.message ?? null,
  };
}

function getSupabaseUrlHost(): string {
  try {
    const raw = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    if (!raw) return "NOT_SET";
    return new URL(raw).hostname;
  } catch {
    return "PARSE_ERROR";
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const supabase = supabaseAdmin();

    const [bookingsRes, zonesRes, probeRes] = await Promise.all([
      loadBookings(supabase),
      tryLoadZones(supabase),
      loadProbe(supabase),
    ]);

    const warnings = [...bookingsRes.warnings, ...zonesRes.warnings];

    const canonicalTrips = Array.isArray(bookingsRes.trips) ? bookingsRes.trips : [];
    const rawRows = Array.isArray(bookingsRes.rawRows) ? bookingsRes.rawRows : [];

    const payload: Json = {
      ok: true,
      source: "page-data-route",
      env: {
        supabase_url_host: getSupabaseUrlHost(),
      },
      firstTripIds: rawRows.slice(0, 5).map((r: any) => r?.id ?? null),
      firstTripCodes: rawRows.slice(0, 5).map((r: any) => r?.booking_code ?? r?.bookingCode ?? null),
      queryStatusFilter: QUERY_STATUS_FILTER,
      zones: zonesRes.zones,
      trips: canonicalTrips,
      bookings: canonicalTrips,
      data: canonicalTrips,
      warnings,
      probe: {
        id: probeRes.probeId,
        row: probeRes.probeRow,
        error: probeRes.probeError,
      },
    };

    if (debug) {
      payload.debug = {
        bookingColumnsUsed: bookingsRes.usedColumns,
        zoneSource: zonesRes.zoneSource,
        tripCount: bookingsRes.trips.length,
        zoneCount: zonesRes.zones.length,
        rawRowCount: rawRows.length,
        note: "bookings and zones are loaded via select(*) in this build",
      };
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err: any) {
    console.error("PAGE_DATA_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        source: "page-data-route",
        error: "PAGE_DATA_UNEXPECTED",
        message: err?.message ?? "Unexpected error",
        zones: [],
        trips: [],
        bookings: [],
        data: [],
        probe: {
          id: PROBE_BOOKING_ID,
          row: null,
          error: err?.message ?? "Unexpected error",
        },
      },
      { status: 500 }
    );
  }
}