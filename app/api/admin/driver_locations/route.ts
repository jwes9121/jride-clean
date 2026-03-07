import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type DriverRowDb = {
  id?: string | null;
  driver_id?: string | null;
  status?: string | null;
  town?: string | null;
  home_town?: string | null;
  lat?: number | null;
  lng?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
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
    hour12: false,
  });
}

function ageSecondsFromIso(input: string | null | undefined) {
  if (!input) return null;
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}

export async function GET() {
  try {
    const staleAfterSeconds = 120;
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
          message: error.message,
        },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? (data as DriverRowDb[]) : [];

    const drivers = rows.map((row) => {
      const updatedAt = row.updated_at ?? null;
      const createdAt = row.created_at ?? null;
      const ageSeconds = ageSecondsFromIso(updatedAt);
      const isStale = ageSeconds == null ? true : ageSeconds > staleAfterSeconds;
      const effectiveStatus = isStale ? "stale" : String(row.status ?? "");

      return {
        ...row,
        updated_at: updatedAt,
        updated_at_ph: toPhilippineTime(updatedAt),
        created_at: createdAt,
        created_at_ph: toPhilippineTime(createdAt),
        age_seconds: ageSeconds,
        is_stale: isStale,
        age_min: ageSeconds == null ? null : Math.floor(ageSeconds / 60),
        effective_status: effectiveStatus,
      };
    });

    return NextResponse.json(
      {
        ok: true,
        source: "app/api/admin/driver_locations/route.ts",
        stale_after_seconds: staleAfterSeconds,
        server_now_utc: new Date().toISOString(),
        server_now_ph: new Date().toLocaleString("en-PH", {
          timeZone: "Asia/Manila",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }),
        count: drivers.length,
        drivers,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("ADMIN_DRIVER_LOCATIONS_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "ADMIN_DRIVER_LOCATIONS_UNEXPECTED",
        message: err?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}