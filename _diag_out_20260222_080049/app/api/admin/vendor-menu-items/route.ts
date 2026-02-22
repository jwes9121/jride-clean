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

  return createAdminClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function s(v: any) {
  return String(v ?? "").trim();
}

function n(v: any): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
}

// POST /api/admin/vendor-menu-items
// Body: { vendor_id, name, price, description?, sort_order? }
export async function POST(req: NextRequest) {
  try {
    const admin = getAdmin();
    if (!admin) {
      return json(500, {
        ok: false,
        error: "SERVER_MISCONFIG",
        message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    const body = await req.json().catch(() => ({} as any));

    const vendor_id = s(body.vendor_id ?? body.vendorId);
    const name = s(body.name);
    const description = (body.description === null || body.description === undefined) ? null : s(body.description);
    const price = n(body.price);
    const sort_order = Number.isFinite(Number(body.sort_order)) ? Number(body.sort_order) : 0;

    if (!vendor_id) return json(400, { ok: false, error: "vendor_id_required", message: "vendor_id required" });
    if (!name) return json(400, { ok: false, error: "name_required", message: "name required" });
    if (!Number.isFinite(price)) return json(400, { ok: false, error: "price_invalid", message: "price must be numeric" });

    const insertRow: any = {
      vendor_id,
      name,
      description,
      price,
      sort_order,
      is_active: true,
    };

    const { data, error } = await admin
      .from("vendor_menu_items")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

    return json(200, { ok: true, item: data });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e || "Unknown") });
  }
}