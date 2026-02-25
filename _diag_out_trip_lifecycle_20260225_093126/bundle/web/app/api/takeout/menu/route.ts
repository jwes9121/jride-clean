import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function s(v: any) {
  return String(v ?? "").trim();
}

// GET /api/takeout/menu?vendor_id=UUID
export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const vendor_id = s(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId"));
  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });  // Read from the view (canonical for "today" availability).
  // If the view returns 0 rows (due to strict view logic), fall back to vendor_menu_items (MVP safety).
  const q1 = await admin
    .from("vendor_menu_today")
    .select("*")
    .eq("vendor_id", vendor_id);

  if (q1.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: q1.error.message });
  }

  let rows: any[] = Array.isArray(q1.data) ? (q1.data as any[]) : [];

  // Fallback: base items table (active only)
  if (!rows.length) {
    const q2 = await admin
      .from("vendor_menu_items")
      .select("*")
      .eq("vendor_id", vendor_id)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (q2.error) {
      return json(500, { ok: false, error: "DB_ERROR", message: q2.error.message });
    }
    rows = Array.isArray(q2.data) ? (q2.data as any[]) : [];
  }

  const items = rows
    .map((r: any) => ({
      // normalize best-effort
      id: r.menu_item_id ?? r.id ?? null,
      vendor_id: r.vendor_id ?? vendor_id,
      name: r.name ?? r.item_name ?? null,
      description: r.description ?? null,
      price: r.price ?? r.unit_price ?? null,
      sort_order: r.sort_order ?? 0,

      // availability flags (best-effort)
      is_available:
        (typeof r.is_available === "boolean" ? r.is_available : null) ??
        (typeof r.is_available_today === "boolean" ? r.is_available_today : null) ??
        (typeof r.available_today === "boolean" ? r.available_today : null) ??
        (typeof r.available === "boolean" ? r.available : null) ??
        true, // base-table fallback defaults to available

      sold_out_today:
        (typeof r.sold_out_today === "boolean" ? r.sold_out_today : null) ??
        (typeof r.is_sold_out_today === "boolean" ? r.is_sold_out_today : null) ??
        false, // base-table fallback defaults to not sold out

      last_updated_at: r.last_updated_at ?? r.updated_at ?? r.created_at ?? null,
    }))
    .filter((x: any) => x.id && x.name);

  return json(200, { ok: true, vendor_id, items });
}