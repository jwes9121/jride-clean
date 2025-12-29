export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

export async function GET() {
  try {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      console.error(
        "[admin/livetrips/summary] Missing SUPABASE_URL or SUPABASE_ANON_KEY env vars"
      );
      return NextResponse.json(
        {
          error: "ENV_MISSING",
          message: "SUPABASE_URL or SUPABASE_ANON_KEY missing",
        },
        { status: 500 }
      );
    }

    const baseHeaders = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };

    const selectCols =
      "id,booking_code,status,assigned_driver_id,created_at,pickup_lat,pickup_lng";

    // Pending: pending / searching with no assigned driver
    const pendingQuery = [
      `select=${selectCols}`,
      "status=in.(pending,searching,arrived)",
      "assigned_driver_id=is.null",
      "order=created_at.asc",
    ].join("&");
    const pendingUrl = `${SUPABASE_URL}/rest/v1/bookings?${pendingQuery}`;

    // Active: includes dropoff
    const activeStatuses =
      "assigned,driver_accepted,driver_arrived,passenger_onboard,in_transit,dropoff";
    const activeQuery = [
      `select=${selectCols}`,
      `status=in.(${activeStatuses})`,
      "order=created_at.asc",
    ].join("&");
    const activeUrl = `${SUPABASE_URL}/rest/v1/bookings?${activeQuery}`;

    // Completed today
    const today = new Date();
    const ymd = today.toISOString().slice(0, 10);
    const completedQuery = [
      `select=${selectCols}`,
      "status=eq.completed",
      `created_at=gte.${ymd}T00:00:00Z`,
      "order=created_at.desc",
    ].join("&");
    const completedUrl = `${SUPABASE_URL}/rest/v1/bookings?${completedQuery}`;

    // Drivers for map
    const driverSelect = "driver_id,lat,lng,status,updated_at";
    const driverQuery = [
      `select=${driverSelect}`,
      "order=updated_at.desc",
    ].join("&");
    const driversUrl = `${SUPABASE_URL}/rest/v1/driver_locations?${driverQuery}`;

    const [pendingRes, activeRes, completedRes, driversRes] =
      await Promise.all([
        fetch(pendingUrl, { headers: baseHeaders, cache: "no-store" }),
        fetch(activeUrl, { headers: baseHeaders, cache: "no-store" }),
        fetch(completedUrl, { headers: baseHeaders, cache: "no-store" }),
        fetch(driversUrl, { headers: baseHeaders, cache: "no-store" }),
      ]);

    const [pendingRaw, activeRaw, completedRaw, driversRaw] =
      await Promise.all([
        pendingRes.text(),
        activeRes.text(),
        completedRes.text(),
        driversRes.text(),
      ]);

    const parseJsonArray = (raw: string, label: string) => {
      try {
        const json = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(json)) {
          console.error(
            `[admin/livetrips/summary] ${label} not array:`,
            json
          );
          return [];
        }
        return json;
      } catch (e) {
        console.error(
          `[admin/livetrips/summary] Failed to parse ${label}:`,
          e,
          "raw=",
          raw
        );
        return [];
      }
    };

    if (!pendingRes.ok) {
      console.error(
        "[admin/livetrips/summary] Pending error:",
        pendingRes.status,
        pendingRaw
      );
    }
    if (!activeRes.ok) {
      console.error(
        "[admin/livetrips/summary] Active error:",
        activeRes.status,
        activeRaw
      );
    }
    if (!completedRes.ok) {
      console.error(
        "[admin/livetrips/summary] Completed error:",
        completedRes.status,
        completedRaw
      );
    }
    if (!driversRes.ok) {
      console.error(
        "[admin/livetrips/summary] Drivers error:",
        driversRes.status,
        driversRaw
      );
    }

    const pending = pendingRes.ok
      ? parseJsonArray(pendingRaw, "pending")
      : [];
    const active = activeRes.ok ? parseJsonArray(activeRaw, "active") : [];
    const completed = completedRes.ok
      ? parseJsonArray(completedRaw, "completed")
      : [];
    const drivers = driversRes.ok
      ? parseJsonArray(driversRaw, "drivers")
      : [];

    return NextResponse.json(
      {
        ok: true,
        pending,
        active,
        completed,
        drivers,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[admin/livetrips/summary] SERVER ERROR:", error);
    return NextResponse.json(
      {
        error: "SERVER_ERROR",
        message: error?.message ?? "Unknown server error",
      },
      { status: 500 }
    );
  }
}


