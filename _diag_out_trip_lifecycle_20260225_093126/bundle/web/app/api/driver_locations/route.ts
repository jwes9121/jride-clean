import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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
    // keep original fields, but ensure town is populated when possible
    return { ...r, town };
  });

  return NextResponse.json(
    { ok: true, drivers: normalized },
    { status: 200 }
  );}

