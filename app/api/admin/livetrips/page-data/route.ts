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

function normalizeTrip(row: Json): Json {
  return {
    ...row,
    booking_code: row.booking_code ?? row.bookingCode ?? null,
    pickup_label: row.pickup_label ?? row.from_label ?? row.fromLabel ?? null,
    dropoff_label: row.dropoff_label ?? row.to_label ?? row.toLabel ?? null,
    zone: row.zone ?? row.town ?? row.zone_name ?? null,
    status: row.status ?? "requested",
  };
}

function parseMissingBookingsColumn(message: string): string | null {
  const m = String(message || "").match(/column\s+bookings\.([a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
  return m && m[1] ? String(m[1]).trim() : null;
}

async function selectBookingsAdaptive(supabase: ReturnType<typeof supabaseAdmin>) {
  const baseColumns = [
    "id",
    "booking_code",
    "passenger_name",
    "pickup_label",
    "dropoff_label",
    "from_label",
    "to_label",
    "pickup_lat",
    "pickup_lng",
    "dropoff_lat",
    "dropoff_lng",
    "status",
    "driver_id",
    "assigned_driver_id",
    "created_at",
    "updated_at",
    "town"
  ];

  const removedColumns: string[] = [];
  const warnings: string[] = [];
  let lastErrorMessage = "";

  for (let attempt = 0; attempt < baseColumns.length; attempt++) {
    const activeColumns = baseColumns.filter((c) => removedColumns.indexOf(c) === -1);

    if (!activeColumns.length) {
      return {
        ok: false,
        data: [] as Json[],
        warnings: warnings.concat(["BOOKINGS_QUERY_FAILED", "NO_SELECTABLE_BOOKINGS_COLUMNS"]),
        activeColumns,
        removedColumns
      };
    }

    const { data, error } = await supabase
      .from("bookings")
      .select(activeColumns.join(","))
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(300);

    if (!error) {
      return {
        ok: true,
        data: (data || []) as Json[],
        warnings,
        activeColumns,
        removedColumns
      };
    }

    const msg = String(error.message || "");
    lastErrorMessage = msg;

    const missingCol = parseMissingBookingsColumn(msg);
    if (!missingCol) {
      console.error("PAGE_DATA_BOOKINGS_QUERY_ERROR", {
        message: msg,
        activeColumns
      });
      return {
        ok: false,
        data: [] as Json[],
        warnings: warnings.concat(["BOOKINGS_QUERY_FAILED", msg]),
        activeColumns,
        removedColumns
      };
    }

    if (removedColumns.indexOf(missingCol) !== -1) {
      console.error("PAGE_DATA_BOOKINGS_QUERY_REPEAT_MISSING_COLUMN", {
        message: msg,
        missingCol,
        activeColumns
      });
      return {
        ok: false,
        data: [] as Json[],
        warnings: warnings.concat(["BOOKINGS_QUERY_FAILED", msg]),
        activeColumns,
        removedColumns
      };
    }

    removedColumns.push(missingCol);
    warnings.push("BOOKINGS_COLUMN_SKIPPED:" + missingCol);

    console.warn("PAGE_DATA_BOOKINGS_COLUMN_SKIPPED", {
      missingCol
    });
  }

  return {
    ok: false,
    data: [] as Json[],
    warnings: warnings.concat(["BOOKINGS_QUERY_FAILED", lastErrorMessage || "ADAPTIVE_SELECT_EXHAUSTED"]),
    activeColumns: [] as string[],
    removedColumns
  };
}

async function loadBookings(supabase: ReturnType<typeof supabaseAdmin>) {
  const bookingRes = await selectBookingsAdaptive(supabase);

  if (!bookingRes.ok) {
    return {
      trips: [] as Json[],
      warnings: bookingRes.warnings || [],
      debugSelect: bookingRes.activeColumns || [],
      removedColumns: bookingRes.removedColumns || []
    };
  }

  const trips = bookingRes.data.map(normalizeTrip);

  const driverIds = Array.from(
    new Set(
      trips
        .map((t: any) => String(t.assigned_driver_id || t.driver_id || "").trim())
        .filter(Boolean)
    )
  );

  let driversById: Record<string, any> = {};
  if (driverIds.length) {
    const { data: drivers, error: driversError } = await supabase
      .from("drivers")
      .select("id,driver_name,driver_status,zone_id,toda_name,wallet_balance")
      .in("id", driverIds);

    if (driversError) {
      console.error("PAGE_DATA_DRIVERS_QUERY_ERROR", {
        message: driversError.message
      });
    } else {
      driversById = Object.fromEntries(
        (drivers || []).map((d: any) => [String(d.id), d])
      );
    }
  }

  const enriched = trips.map((t: any) => {
    const did = String(t.assigned_driver_id || t.driver_id || "").trim();
    const d = did ? driversById[did] : null;

    return {
      ...t,
      driver_name: d?.driver_name ?? null,
      driver_status: d?.driver_status ?? null,
      zone_id: d?.zone_id ?? null,
      toda_name: d?.toda_name ?? null,
      wallet_balance: d?.wallet_balance ?? null
    };
  });

  return {
    trips: enriched,
    warnings: bookingRes.warnings || [],
    debugSelect: bookingRes.activeColumns || [],
    removedColumns: bookingRes.removedColumns || []
  };
}

async function tryLoadZones(supabase: ReturnType<typeof supabaseAdmin>) {
  return {
    zones: [] as ZoneRow[],
    zoneSource: null as string | null,
    warnings: ["ZONES_SCHEMA_PROBE_DISABLED"]
  };
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const debug = url.searchParams.get("debug") === "1";
    const supabase = supabaseAdmin();

    const [bookingsRes, zonesRes] = await Promise.all([
      loadBookings(supabase),
      tryLoadZones(supabase)
    ]);

    const warnings = [...bookingsRes.warnings, ...zonesRes.warnings];

    const payload: Json = {
      ok: true,
      zones: zonesRes.zones,
      trips: bookingsRes.trips,
      bookings: bookingsRes.trips,
      data: bookingsRes.trips,
      warnings
    };

    if (debug) {
      payload.debug = {
        tripCount: bookingsRes.trips.length,
        zoneCount: zonesRes.zones.length,
        note: "Direct bookings query with adaptive missing-column removal; information_schema probing disabled",
        bookingsSelectColumns: bookingsRes.debugSelect || [],
        removedBookingColumns: bookingsRes.removedColumns || []
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
        data: []
      },
      { status: 500 }
    );
  }
}