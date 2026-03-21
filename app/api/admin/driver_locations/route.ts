import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DriverLocationRowDb = {
  id?: string | null;
  driver_id?: string | null;
  status?: string | null;
  town?: string | null;
  home_town?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  vehicle_type?: string | null;
  capacity?: number | null;
  [key: string]: any;
};

type DriverIdentityRowDb = {
  id?: string | null;
  driver_name?: string | null;
  driver_status?: string | null;
  zone_id?: string | null;
  toda_name?: string | null;
  [key: string]: any;
};

type DriverProfileRowDb = {
  driver_id?: string | null;
  phone?: string | null;
  full_name?: string | null;
  [key: string]: any;
};

function toPhilippineTime(input: string | null | undefined) {
  if (!input) return null;
  const d = new Date(input);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function ageSecondsFromIso(input: string | null | undefined) {
  if (!input) return null;

  const parsed = Date.parse(input); // strict ISO parsing

  if (!Number.isFinite(parsed)) return null;

  const now = Date.now();

  const ms = now - parsed;

  return Math.max(0, Math.floor(ms / 1000));
}

function ts(input: string | null | undefined) {
  if (!input) return 0;
  const t = new Date(input).getTime();
  return Number.isFinite(t) ? t : 0;
}

export async function GET() {
  try {
    const staleAfterSeconds = 120;
    const assignCutoffMinutes = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
    const assignCutoffSeconds = assignCutoffMinutes * 60;
    const onlineLike = new Set(["online", "available", "idle", "waiting"]);

    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("driver_locations")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) {
      console.error("ADMIN_DRIVER_LOCATIONS_ERROR", error);
      return NextResponse.json(
        {
          ok: false,
          error: "ADMIN_DRIVER_LOCATIONS_ERROR",
          message: error.message
        },
        { status: 500 }
      );
    }

    const rawRows = Array.isArray(data) ? (data as DriverLocationRowDb[]) : [];

    // Deduplicate by driver_id: keep only the latest updated_at row per driver
    const latestByDriverId: Record<string, DriverLocationRowDb> = {};
    for (const row of rawRows) {
      const driverId = String(row.driver_id || "").trim();
      if (!driverId) continue;

      const prev = latestByDriverId[driverId];
      if (!prev) {
        latestByDriverId[driverId] = row;
        continue;
      }

      const prevTs = ts(prev.updated_at || prev.created_at || null);
      const nextTs = ts(row.updated_at || row.created_at || null);

      if (nextTs > prevTs) {
        latestByDriverId[driverId] = row;
      }
    }

    const rows = Object.values(latestByDriverId).sort((a, b) => {
      const at = ts(a.updated_at || a.created_at || null);
      const bt = ts(b.updated_at || b.created_at || null);
      return bt - at;
    });

    const driverIds = rows
      .map((row) => String(row.driver_id || "").trim())
      .filter(Boolean);

    let identityById: Record<string, DriverIdentityRowDb> = {};
    let profileByDriverId: Record<string, DriverProfileRowDb> = {};

    if (driverIds.length > 0) {
      const { data: driversData, error: driversError } = await supabase
        .from("drivers")
        .select("id,driver_name,driver_status,zone_id,toda_name")
        .in("id", driverIds);

      if (driversError) {
        console.error("ADMIN_DRIVER_LOCATIONS_DRIVERS_JOIN_ERROR", driversError);
      } else {
        const identities = Array.isArray(driversData) ? (driversData as DriverIdentityRowDb[]) : [];
        identityById = Object.fromEntries(
          identities.map((d) => [String(d.id || ""), d])
        );
      }

      const { data: profilesData, error: profilesError } = await supabase
        .from("driver_profiles")
        .select("driver_id,phone,full_name")
        .in("driver_id", driverIds);

      if (profilesError) {
        console.error("ADMIN_DRIVER_LOCATIONS_DRIVER_PROFILES_JOIN_ERROR", profilesError);
      } else {
        const profiles = Array.isArray(profilesData) ? (profilesData as DriverProfileRowDb[]) : [];
        profileByDriverId = Object.fromEntries(
          profiles.map((p) => [String(p.driver_id || ""), p])
        );
      }
    }

    const drivers = rows.map((row) => {
      const updatedAt = row.updated_at ?? null;
      const createdAt = row.created_at ?? null;
      const ageSeconds = ageSecondsFromIso(updatedAt);
      const isStale = ageSeconds == null ? true : ageSeconds > staleAfterSeconds;
      const rawStatus = String(row.status ?? "").trim().toLowerCase();
      const effectiveStatus = isStale ? "offline" : rawStatus;
      const assignFresh = ageSeconds == null ? false : ageSeconds <= assignCutoffSeconds;
      const assignOnlineEligible = onlineLike.has(rawStatus);
      const assignEligible = assignFresh && assignOnlineEligible;

      const driverId = String(row.driver_id || "").trim();
      const identity = driverId ? identityById[driverId] : null;
      const profile = driverId ? profileByDriverId[driverId] : null;

      return {
        ...row,
        name: identity?.driver_name ?? profile?.full_name ?? null,
        phone: profile?.phone ?? null,
        zone_id: identity?.zone_id ?? null,
        toda_name: identity?.toda_name ?? null,
        driver_status_master: identity?.driver_status ?? null,
        updated_at: updatedAt,
        updated_at_ph: toPhilippineTime(updatedAt),
        created_at: createdAt,
        created_at_ph: toPhilippineTime(createdAt),
        age_seconds: ageSeconds,
        is_stale: isStale,
        age_min: ageSeconds == null ? null : Math.floor(ageSeconds / 60),
        effective_status: effectiveStatus,
        assign_cutoff_minutes: assignCutoffMinutes,
        assign_fresh: assignFresh,
        assign_online_eligible: assignOnlineEligible,
        assign_eligible: assignEligible};
    });

    return NextResponse.json(
      {
        ok: true,
        source: "app/api/admin/driver_locations/route.ts",
        stale_after_seconds: staleAfterSeconds,
        assign_cutoff_minutes: assignCutoffMinutes,
        server_now_utc: new Date().toISOString(),
        server_now_ph: new Date().toLocaleString("en-PH", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false
        }),
        count: drivers.length,
        drivers
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("ADMIN_DRIVER_LOCATIONS_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "ADMIN_DRIVER_LOCATIONS_UNEXPECTED",
        message: err?.message ?? "Unexpected error"
      },
      { status: 500 }
    );
  }
}
