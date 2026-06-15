import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;

const FORCE_VISIBLE_VENDOR_IDS = new Set<string>([
  "afa691c6-4a29-441f-b3bf-a8bb3a589ebe", // AGUBENGBENG
  "8af2c5a5-d325-4d49-af43-d5d1d5ab14cb", // IFUGATO CAFE
]);

const FORCE_HIDDEN_VENDOR_IDS = new Set<string>([
  "23d549f7-565f-4476-90ca-ea10d7ee07b2",
  "54762c55-829c-425a-8183-7a682f61b75c",
  "ff951ad9-6bb4-4fe1-b495-acc7f1d8218b",
  "1ad78ce7-a5a0-40fb-acec-e12cdefe94fb",
  "ae4a56e7-ff63-4cde-ba7e-5fae273272a2",
]);

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

function normalizeVendor(v: any) {
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
}

export async function GET() {
  const supabase = adminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "MISSING_SERVICE_ROLE", message: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing" },
      { status: 500 }
    );
  }

  const selectCols = "id,email,display_name,created_at,town,lat,lng,location_label,logo_url,tagline,accepting_orders";

  const base = await supabase
    .from("vendor_accounts")
    .select(selectCols)
    .order("created_at", { ascending: false });

  if (base.error) {
    return NextResponse.json({ ok: false, error: "DB_ERROR", message: base.error.message }, { status: 500 });
  }

  // Safety net: force-fetch these two pilot vendors by ID, then merge/dedupe.
  // This avoids losing them if a prior pilot cleanup filter or stale route query drops them from the base result.
  const forced = await supabase
    .from("vendor_accounts")
    .select(selectCols)
    .in("id", Array.from(FORCE_VISIBLE_VENDOR_IDS));

  if (forced.error) {
    return NextResponse.json({ ok: false, error: "DB_ERROR", message: forced.error.message }, { status: 500 });
  }

  const byId = new Map<string, any>();
  for (const row of Array.isArray(base.data) ? base.data : []) {
    const id = cleanString(row?.id);
    if (id) byId.set(id, row);
  }
  for (const row of Array.isArray(forced.data) ? forced.data : []) {
    const id = cleanString(row?.id);
    if (id) byId.set(id, row);
  }

  const rows = Array.from(byId.values());
  const vendorIds = rows.map((v: any) => cleanString(v?.id)).filter(Boolean);

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

  const vendors = rows
    .filter((v: any) => {
      const id = cleanString(v?.id);
      if (FORCE_VISIBLE_VENDOR_IDS.has(id)) return true;
      return !removedIds.has(id) && !FORCE_HIDDEN_VENDOR_IDS.has(id);
    })
    .filter((v: any) => v?.accepting_orders === true || FORCE_VISIBLE_VENDOR_IDS.has(cleanString(v?.id)))
    .map(normalizeVendor);

  return NextResponse.json({ ok: true, vendors }, { status: 200 });
}
