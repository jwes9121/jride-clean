import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

const STALE_AFTER_SECONDS = 120; // 2 minutes
export async function GET() {
  const supabase = createClient();

  // Source of truth for driver last-known locations used by dispatch/admin.
  // This view already resolves the underlying source (driver_locations / latest) and is what you validated in DB.
  const { data, error } = await supabase
    .from("dispatch_driver_locations_view")
    .select("driver_id, lat, lng, status, town, home_town, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[driver_locations] error", error);
    return NextResponse.json(
      { ok: false, error: error.message, drivers: [] },
      { status: 500 }
    );
  }

    const normalized = (Array.isArray(data) ? data : []).map((r: any) => {
    const town = (r?.town ?? r?.home_town ?? null);

    // Staleness: view shows last 10 minutes; mark stale after 2 minutes.
    const updatedAt = r?.updated_at ? new Date(String(r.updated_at)) : null;
    const ageSeconds =
      updatedAt && !isNaN(updatedAt.getTime())
        ? Math.max(0, Math.floor((Date.now() - updatedAt.getTime()) / 1000))
        : null;

    const isStale = typeof ageSeconds === "number" ? ageSeconds > STALE_AFTER_SECONDS : true;

    // keep original fields, but ensure town is populated when possible
    return { ...r, town, age_seconds: ageSeconds, is_stale: isStale };
  });

  return NextResponse.json(
    { ok: true, stale_after_seconds: STALE_AFTER_SECONDS, drivers: normalized },
    { status: 200 }
  );}


