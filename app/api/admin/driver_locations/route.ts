import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const supabase = supabaseAdmin();


/**
 * GET /api/admin/driver_locations
 * Optional: ?town=hingyon  (case-insensitive exact match)
 *
 * Returns:
 *  { ok: true, drivers: [...latestPerDriver], driver_locations: [...latestPerDriver] }
 *
 * Notes:
 * - Uses dispatch_driver_locations_view to keep shape consistent
 * - Dedupe to latest row per driver_id in JS to avoid relying on DISTINCT ON
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    
    const town = url.searchParams.get("town");
const townParam = (url.searchParams.get("town") || "").trim();

    let q = supabase.from("dispatch_driver_locations_view")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(500);

    if (townParam) {
      // match your data after initcap(): Hingyon/Lagawe/etc
      // Use ilike for case-insensitive exact match
      q = q.ilike("town", townParam);
    }

    const { data, error } = await q;

    if (error) {
          // Normalize for Admin UI: treat "online" as "available"
          // (Does NOT change DB; only the API response used by LiveTrips.)
          try {
            // If the handler uses variables named "drivers" / "driver_locations", normalize them.
            // If not defined, this safely throws and is ignored.
            // @ts-ignore
            if (typeof drivers !== "undefined") {
              // @ts-ignore
              drivers = (drivers || []).map((r: any) => {
                const s = String((r as any)?.status || "").trim().toLowerCase();
                return s === "online" ? { ...r, status: "available" } : r;
              });
            }
            // @ts-ignore
            if (typeof driver_locations !== "undefined") {
              // @ts-ignore
              driver_locations = (driver_locations || []).map((r: any) => {
                const s = String((r as any)?.status || "").trim().toLowerCase();
                return s === "online" ? { ...r, status: "available" } : r;
              });
            }
          } catch { /* ignore */ }

      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = Array.isArray(data) ? data : [];

    // Latest per driver_id (rows are already sorted newest-first)
    const seen = new Set<string>();
    const latest: any[] = [];
    for (const r of rows) {
      const id = String((r as any)?.driver_id || "");
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      latest.push(r);
    }

    return NextResponse.json(
      {
        ok: true,
        drivers: latest,
        driver_locations: latest,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "unknown error" }, { status: 500 });
  }
}



