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

async function loadBookings(supabase: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await supabase
    .from("bookings")
    .select([
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
    ].join(","))
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (error) {
    console.error("PAGE_DATA_BOOKINGS_QUERY_ERROR", { message: error.message });
    return {
      trips: [] as Json[],
      warnings: ["BOOKINGS_QUERY_FAILED", error.message],
    };
  }

  const trips = (data || []).map(normalizeTrip);

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
      console.error("PAGE_DATA_DRIVERS_QUERY_ERROR", { message: driversError.message });
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
      wallet_balance: d?.wallet_balance ?? null,
    };
  });

  return {
    trips: enriched,
    warnings: [] as string[],
  };
}

async function tryLoadZones(supabase: ReturnType<typeof supabaseAdmin>) {
  return {
    zones: [] as ZoneRow[],
    zoneSource: null as string | null,
    warnings: ["ZONES_SCHEMA_PROBE_DISABLED"],
  };
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
        tripCount: bookingsRes.trips.length,
        zoneCount: zonesRes.zones.length,
        note: "Direct bookings query with drivers join; information_schema probing disabled",
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
