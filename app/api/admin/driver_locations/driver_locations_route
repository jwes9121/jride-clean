import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function supabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !key) {
    throw new Error("Supabase env missing: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and a key (SERVICE_ROLE or ANON)");
  }

  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  try {
    const sb = supabase();

    // Try common shapes:
    // 1) table/view: driver_locations
    // 2) fallback: drivers (if you store latest coords there)
    let rows: any[] = [];

    const a = await sb
      .from("driver_locations")
      .select("*")
      .limit(500);

    if (!a.error && Array.isArray(a.data)) {
      rows = a.data;
    } else {
      const b = await sb
        .from("drivers")
        .select("*")
        .limit(500);

      if (!b.error && Array.isArray(b.data)) {
        rows = b.data;
      } else {
        const msg = a.error?.message || b.error?.message || "Unknown Supabase error";
        return NextResponse.json(
          { ok: false, error: msg, drivers: [], driver_locations: [], data: [] },
          { status: 500, headers: { "Cache-Control": "no-store" } }
        );
      }
    }

    return NextResponse.json(
      { ok: true, drivers: rows, driver_locations: rows, data: rows },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || String(e), drivers: [], driver_locations: [], data: [] },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}