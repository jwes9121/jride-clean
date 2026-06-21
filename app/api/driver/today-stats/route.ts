import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type AnyRow = Record<string, any>;
type ServiceKey = "rides" | "takeout";

function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function text(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function completedAt(row: AnyRow): Date | null {
  const raw = row.completed_at || row.completedAt || row.dropoff_at || row.updated_at || row.created_at;
  if (!raw) return null;
  const d = new Date(String(raw));
  return Number.isFinite(d.getTime()) ? d : null;
}

function manilaDateKey(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const y = parts.find((p) => p.type === "year")?.value || "0000";
  const m = parts.find((p) => p.type === "month")?.value || "00";
  const day = parts.find((p) => p.type === "day")?.value || "00";
  return `${y}-${m}-${day}`;
}

function serviceType(row: AnyRow): ServiceKey {
  const explicit = text(row.service_type || row.serviceType || row.trip_type || row.tripType).toLowerCase();
  if (explicit.includes("takeout") || explicit.includes("food") || explicit.includes("delivery")) return "takeout";

  if (
    row.takeout_total_payable != null ||
    row.takeout_service_fee != null ||
    row.takeout_delivery_fee != null ||
    row.vendor_status != null ||
    row.vendor_id != null
  ) {
    return "takeout";
  }

  return "rides";
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const driverId = (searchParams.get("driver_id") || "").trim();

    if (!driverId) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "driver_id is required" }, { status: 400 })
      );
    }

    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("status", "completed")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) {
      return withNoStore(
        NextResponse.json({ ok: false, error: "Failed to fetch today stats", detail: error.message }, { status: 500 })
      );
    }

    const todayKey = manilaDateKey(new Date());
    let rideCompleted = 0;
    let takeoutCompleted = 0;

    for (const row of data || []) {
      const at = completedAt(row);
      if (!at) continue;
      if (manilaDateKey(at) !== todayKey) continue;

      if (serviceType(row) === "takeout") takeoutCompleted += 1;
      else rideCompleted += 1;
    }

    return withNoStore(
      NextResponse.json({
        ok: true,
        driver_id: driverId,
        timezone: "Asia/Manila",
        date: todayKey,
        ride_completed: rideCompleted,
        takeout_completed: takeoutCompleted,
        total_completed: rideCompleted + takeoutCompleted,
        source: "bookings_completed_driver_today_v1",
      })
    );
  } catch (e: any) {
    return withNoStore(
      NextResponse.json({ ok: false, error: e?.message ?? "Unexpected error" }, { status: 500 })
    );
  }
}
