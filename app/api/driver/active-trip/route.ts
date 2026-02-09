import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  return { url, key };
}

function parseDateMs(v: any): number | null {
  try {
    const t = Date.parse(String(v || ""));
    return Number.isFinite(t) ? t : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const driverId = String(u.searchParams.get("driver_id") || "").trim();

    if (!driverId || !isUuidLike(driverId)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_DRIVER_ID", message: "driver_id is required (uuid)." },
        { status: 400 }
      );
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_SUPABASE_ENV",
          message:
            "Missing SUPABASE env. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL + SUPABASE_ANON_KEY).",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(env.url, env.key);

    // Include assigned so the driver can see fresh dispatches.
    const activeStatuses = ["assigned", "accepted", "on_the_way", "arrived", "on_trip"];

    // NOTE: select("*") avoids build/runtime failures if certain columns don't exist.
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .or(`assigned_driver_id.eq.${driverId},driver_id.eq.${driverId}`)
      .in("status", activeStatuses)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", message: error.message }, { status: 500 });
    }

    // Hard cast to avoid TS union noise (fixes: Property 'status' does not exist...)
    const rows: any[] = Array.isArray(data) ? (data as any[]) : [];

    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        driver_id: driverId,
        trip: null,
        note: "NO_ACTIVE_TRIP",
        active_statuses: activeStatuses,
      });
    }

    // Prevent "old assigned" trips haunting the driver forever:
    // Only treat assigned as active if it's recent.
    const now = Date.now();
    const ASSIGNED_MAX_AGE_MINUTES = 90;
    const assignedMaxAgeMs = ASSIGNED_MAX_AGE_MINUTES * 60 * 1000;

    let picked: any = null;

    // 1) Prefer non-assigned active states first
    for (const r of rows) {
      const st = String((r as any)?.status ?? "");
      if (st && st !== "assigned") {
        picked = r;
        break;
      }
    }

    // 2) Else allow recent assigned
    if (!picked) {
      for (const r of rows) {
        const st = String((r as any)?.status ?? "");
        if (st !== "assigned") continue;

        const t = parseDateMs((r as any)?.updated_at) ?? parseDateMs((r as any)?.created_at);
        if (t && (now - t) <= assignedMaxAgeMs) {
          picked = r;
          break;
        }
      }
    }

    const trip = picked || null;

    return NextResponse.json({
      ok: true,
      driver_id: driverId,
      trip,
      note: trip ? "ACTIVE_TRIP_FOUND" : "NO_ACTIVE_TRIP",
      active_statuses: activeStatuses,
      assigned_max_age_minutes: ASSIGNED_MAX_AGE_MINUTES,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}