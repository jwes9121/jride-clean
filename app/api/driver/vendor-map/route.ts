import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function cleanString(v: any): string {
  return String(v ?? "").trim();
}

function normalizeTakeoutTown(value: any): string {
  const raw = cleanString(value).toLowerCase();
  return CANONICAL_TAKEOUT_TOWNS.find((town) => town.toLowerCase() === raw) || "";
}

function num(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function validPhilippinesCoord(lat: number | null, lng: number | null): boolean {
  if (lat === null || lng === null) return false;
  return lat >= 4 && lat <= 22 && lng >= 116 && lng <= 127;
}

function pickLat(row: any): number | null {
  return num(row?.vendor_lat) ?? num(row?.lat);
}

function pickLng(row: any): number | null {
  return num(row?.vendor_lng) ?? num(row?.lng);
}

function pickLabel(row: any): string {
  return cleanString(row?.vendor_location_label || row?.location_label || "");
}

function pickName(row: any): string {
  return cleanString(row?.display_name || row?.email || row?.id || "Vendor");
}

export async function GET() {
  const supabase = adminClient();

  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        error: "MISSING_SERVICE_ROLE",
        message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing",
      },
      { status: 500 }
    );
  }

  const selectCols = [
    "id",
    "email",
    "display_name",
    "town",
    "lat",
    "lng",
    "location_label",
    "vendor_lat",
    "vendor_lng",
    "vendor_location_label",
    "accepting_orders",
    "logo_url",
    "updated_at",
    "created_at",
  ].join(",");

  const res = await supabase
    .from("vendor_accounts")
    .select(selectCols)
    .order("town", { ascending: true })
    .order("display_name", { ascending: true });

  if (res.error) {
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: res.error.message },
      { status: 500 }
    );
  }

  const rawRows = Array.isArray(res.data) ? res.data : [];

  const vendors = rawRows
    .map((row: any) => {
      const lat = pickLat(row);
      const lng = pickLng(row);
      const town = normalizeTakeoutTown(row?.town);

      return {
        id: cleanString(row?.id),
        name: pickName(row),
        display_name: pickName(row),
        town,
        lat,
        lng,
        location_label: pickLabel(row),
        accepting_orders: row?.accepting_orders === true,
        logo_url: cleanString(row?.logo_url) || null,
        updated_at: row?.updated_at || row?.created_at || null,
      };
    })
    .filter((v: any) => {
      if (!v.id) return false;
      if (!v.town) return false;
      if (!validPhilippinesCoord(v.lat, v.lng)) return false;
      return true;
    });

  const towns = CANONICAL_TAKEOUT_TOWNS.map((town) => ({
    town,
    vendor_count: vendors.filter((v: any) => v.town === town).length,
  }));

  return NextResponse.json(
    {
      ok: true,
      source: "vendor_accounts",
      generated_at: new Date().toISOString(),
      refresh_after_seconds: 900,
      towns,
      vendors,
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}