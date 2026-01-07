import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getServiceRoleAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) return null;

  return createAdminClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function toNum(v: any): number | null {
  const n = Number(v);
  return isFinite(n) ? n : null;
}

// GET /api/admin/vendor-menu-items?vendor_id=UUID
export async function GET(req: NextRequest) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const vendor_id = String(req.nextUrl.searchParams.get("vendor_id") || "").trim();
  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });

  const { data, error } = await admin
    .from("vendor_menu_items")
    .select("id,vendor_id,name,description,price,sort_order,is_active,created_at,updated_at")
    .eq("vendor_id", vendor_id)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, vendor_id, items: Array.isArray(data) ? data : [] });
}

// POST /api/admin/vendor-menu-items
// body: { vendor_id, name, price, description?, sort_order? }
export async function POST(req: NextRequest) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));

  const vendor_id = String(body.vendor_id || body.vendorId || "").trim();
  const name = String(body.name || "").trim();
  const description = (body.description === null || body.description === undefined) ? null : String(body.description).trim();
  const price = toNum(body.price);
  const sort_order = body.sort_order === undefined || body.sort_order === null ? 0 : Number(body.sort_order);

  if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
  if (!name) return json(400, { ok: false, error: "name_required", message: "name required" });
  if (price === null) return json(400, { ok: false, error: "bad_price", message: "price must be a number" });
  if (!isFinite(sort_order)) return json(400, { ok: false, error: "bad_sort_order", message: "sort_order must be a number" });

  const insertRow: any = {
    vendor_id,
    name,
    description: description || null,
    price,
    sort_order: sort_order,
    is_active: true,
  };

  const { data, error } = await admin
    .from("vendor_menu_items")
    .insert(insertRow)
    .select("id,vendor_id,name,description,price,sort_order,is_active,created_at,updated_at")
    .single();

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  return json(200, { ok: true, item: data });
}