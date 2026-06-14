import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cleanString(v: any) {
  return String(v ?? "").trim();
}

function normalizeTakeoutTown(value: any): string {
  const raw = cleanString(value).toLowerCase();
  return CANONICAL_TAKEOUT_TOWNS.find((town) => town.toLowerCase() === raw) || "";
}

function isRemovedFromPilot(status: any): boolean {
  return cleanString(status).toLowerCase() === "removed_from_pilot";
}

// JRIDE_ADMIN_VENDORS_HIDE_REMOVED_FROM_PILOT_V1
export async function GET() {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "MISSING_SERVICE_ROLE", message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("vendor_accounts")
    .select("id,email,display_name,created_at,town,lat,lng,location_label,logo_url,tagline,accepting_orders")
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: "DB_ERROR", message: error.message }, { status: 500 });
  }

  const vendorIds = (Array.isArray(data) ? data : [])
    .map((v: any) => cleanString(v?.id))
    .filter(Boolean);

  let removedIds = new Set<string>();

  if (vendorIds.length > 0) {
    const registry = await supabase
      .from("vendor_onboarding_credentials")
      .select("vendor_id,status")
      .in("vendor_id", vendorIds);

    if (registry.error) {
      return NextResponse.json({ ok: false, error: "DB_ERROR", message: registry.error.message }, { status: 500 });
    }

    removedIds = new Set(
      (Array.isArray(registry.data) ? registry.data : [])
        .filter((row: any) => isRemovedFromPilot(row?.status))
        .map((row: any) => cleanString(row?.vendor_id))
        .filter(Boolean)
    );
  }

  const vendors = (Array.isArray(data) ? data : [])
  .filter((v: any) => !removedIds.has(cleanString(v?.id)))
  .filter((v: any) => v?.accepting_orders === true)
    .map((v: any) => {
      const logoUrl = cleanString(v?.logo_url);
      return {
        ...v,
        name: cleanString(v?.display_name || v?.email || v?.id || "Vendor"),
        display_name: cleanString(v?.display_name || v?.email || v?.id || "Vendor"),
        town: normalizeTakeoutTown(v?.town),
        tagline: cleanString(v?.tagline || ""),
        accepting_orders: v?.accepting_orders === true,
        logo_url: logoUrl || null,
        vendor_logo_url: logoUrl || null,
        profile_logo_url: logoUrl || null,
        business_logo_url: logoUrl || null,
      };
    });

  return NextResponse.json({ ok: true, vendors }, { status: 200 });
}
