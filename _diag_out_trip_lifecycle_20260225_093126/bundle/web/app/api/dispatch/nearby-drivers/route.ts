import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function err(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function ok(payload: any) {
  return NextResponse.json(payload);
}
function allowed(r?: string) {
  return r === "admin" || r === "dispatcher";
}

/**
 * GET /api/dispatch/nearby-drivers?town=Lagawe&limit=20
 * Returns latest driver locations (name, town, lat/lng, updated_at) for the given town.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!allowed(role)) return err("Forbidden", 403);

  const { searchParams } = new URL(req.url);
  const town = String(searchParams.get("town") || "").trim();
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") || 20)));
  if (!town) return err("town required");

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("driver_locations_with_town")
    .select("driver_id, name, town, lat, lng, updated_at")
    .eq("town", town)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) return err(error.message, 500);
  return ok({ rows: data || [] });
}
