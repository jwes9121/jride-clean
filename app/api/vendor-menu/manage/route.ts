import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const MAX_FREE_MENU_ITEMS = 15;
const ASSET_BUCKET = "vendor-assets";

type Json = Record<string, any>;

function json(status: number, payload: Json) {
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

function cleanString(v: any) {
  return String(v ?? "").trim();
}

function toPrice(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function toBool(v: any, fallback: boolean) {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return fallback;
}

function pickVendorName(row: any) {
  return cleanString(row?.display_name || row?.email || row?.id || "Vendor");
}

function pickLogo(row: any) {
  return cleanString(row?.logo_url || "");
}

function pickItemPhoto(row: any) {
  return cleanString(row?.photo_url || "");
}

function menuId(row: any) {
  return cleanString(row?.menu_item_id || row?.id || "");
}

function normalizeMenuRow(row: any) {
  const id = menuId(row);
  const active = toBool(row?.is_active ?? row?.is_available_today ?? row?.is_available, true);
  const soldOut = toBool(row?.sold_out_today ?? row?.is_sold_out_today, false);
  return {
    id,
    menu_item_id: id,
    vendor_id: cleanString(row?.vendor_id || ""),
    name: cleanString(row?.name || ""),
    description: cleanString(row?.description || ""),
    packaging_note: cleanString(row?.packaging_note || ""),
    price: toPrice(row?.price || 0),
    photo_url: pickItemPhoto(row) || null,
    sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row?.sort_order) : 0,
    is_active: active,
    is_available: active,
    sold_out_today: soldOut,
    is_sold_out_today: soldOut,
    last_updated_at: row?.last_updated_at || row?.updated_at || null,
  };
}

function sanitizeDataUrl(dataUrl: any) {
  const s = cleanString(dataUrl);
  if (!s) return null;
  const m = s.match(/^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase() === "image/jpg" ? "image/jpeg" : m[1].toLowerCase();
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return { mime, ext, b64: m[3] };
}

async function uploadImage(admin: any, vendorId: string, kind: "logo" | "menu", dataUrl: any) {
  const parsed = sanitizeDataUrl(dataUrl);
  if (!parsed) return { url: null as string | null, warning: null as string | null };

  const bytes = Buffer.from(parsed.b64, "base64");
  if (bytes.length > 3 * 1024 * 1024) {
    return { url: null, warning: "IMAGE_TOO_LARGE_MAX_3MB" };
  }

  try {
    await admin.storage.createBucket(ASSET_BUCKET, { public: true });
  } catch {
    // Bucket may already exist. Continue.
  }

  const safeVendor = vendorId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const path = `${safeVendor}/${kind}-${Date.now()}-${Math.random().toString(16).slice(2)}.${parsed.ext}`;
  const up = await admin.storage.from(ASSET_BUCKET).upload(path, bytes, {
    contentType: parsed.mime,
    upsert: false,
  });

  if (up.error) return { url: null, warning: up.error.message || "IMAGE_UPLOAD_FAILED" };
  const pub = admin.storage.from(ASSET_BUCKET).getPublicUrl(path);
  return { url: pub?.data?.publicUrl || null, warning: null };
}

async function updateSchemaSafe(admin: any, table: string, patchInitial: Json, eqField: string, eqValue: string, selectCols = "*") {
  let patch = { ...patchInitial };
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await admin.from(table).update(patch).eq(eqField, eqValue).select(selectCols).limit(1);
    if (!res.error) return res;
    const msg = String(res.error?.message || "");
    const m = msg.match(/Could not find the '([^']+)' column/i);
    if (m?.[1] && Object.prototype.hasOwnProperty.call(patch, m[1])) {
      delete patch[m[1]];
      continue;
    }
    return res;
  }
  return { data: null, error: { message: "schema-safe update retries exceeded" } } as any;
}

async function insertSchemaSafe(admin: any, table: string, payloadInitial: Json, selectCols = "*") {
  let payload = { ...payloadInitial };
  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await admin.from(table).insert(payload).select(selectCols).single();
    if (!res.error) return res;
    const msg = String(res.error?.message || "");
    const m = msg.match(/Could not find the '([^']+)' column/i);
    if (m?.[1] && Object.prototype.hasOwnProperty.call(payload, m[1])) {
      delete payload[m[1]];
      continue;
    }
    return res;
  }
  return { data: null, error: { message: "schema-safe insert retries exceeded" } } as any;
}

async function getVendor(admin: any, vendorId: string) {
  const byId = await admin.from("vendor_accounts").select("*").eq("id", vendorId).limit(1);
  if (!byId.error && Array.isArray(byId.data) && byId.data[0]) return byId.data[0];
  const byEmail = await admin.from("vendor_accounts").select("*").eq("email", vendorId).limit(1);
  if (!byEmail.error && Array.isArray(byEmail.data) && byEmail.data[0]) return byEmail.data[0];
  return null;
}

async function getMenu(admin: any, vendorId: string) {
  const q = await admin
    .from("vendor_menu_today")
    .select("*")
    .eq("vendor_id", vendorId)
    .order("sort_order", { ascending: true });

  if (q.error) throw new Error(q.error.message);
  return (Array.isArray(q.data) ? q.data : []).map(normalizeMenuRow);
}

export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG", message: "Missing Supabase service configuration" });
  }

  const vendorId = cleanString(req.nextUrl.searchParams.get("vendor_id") || req.nextUrl.searchParams.get("vendorId"));
  if (!vendorId) return json(400, { ok: false, error: "MISSING_VENDOR_ID", message: "vendor_id is required" });

  try {
    const vendor = await getVendor(admin, vendorId);
    const menu = await getMenu(admin, vendorId);
    return json(200, {
      ok: true,
      max_items: MAX_FREE_MENU_ITEMS,
      vendor: vendor
        ? {
            id: cleanString(vendor?.id || vendorId),
            vendor_id: vendorId,
            name: pickVendorName(vendor),
            town: cleanString(vendor?.town || ""),
            logo_url: pickLogo(vendor) || null,
            accepting_orders: true,
            premium_packaging_enabled: false,
            premium_packaging_fee: 0,
            premium_packaging_label: "Premium packaging",
          }
        : { id: vendorId, vendor_id: vendorId, name: vendorId, town: "", logo_url: null, accepting_orders: true, premium_packaging_enabled: false, premium_packaging_fee: 0, premium_packaging_label: "Premium packaging" },
      items: menu,
      used: menu.length,
    });
  } catch (e: any) {
    return json(500, { ok: false, error: "DB_ERROR", message: String(e?.message || e) });
  }
}

export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG", message: "Missing Supabase service configuration" });
  }

  const body = await req.json().catch(() => ({} as any));
  const action = cleanString(body?.action).toLowerCase();
  const vendorId = cleanString(body?.vendor_id || body?.vendorId);
  if (!vendorId) return json(400, { ok: false, error: "MISSING_VENDOR_ID", message: "vendor_id is required" });

  try {
    if (action === "profile") {
      const logoUpload = await uploadImage(admin, vendorId, "logo", body?.logo_data_url || body?.logoDataUrl);
      const patch: Json = {
        display_name: cleanString(body?.name || body?.display_name),
        town: cleanString(body?.town),
      };
      if (logoUpload.url) patch.logo_url = logoUpload.url;
      for (const k of Object.keys(patch)) {
        if (patch[k] === "") delete patch[k];
      }
      const up = await updateSchemaSafe(admin, "vendor_accounts", patch, "id", vendorId);
      if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message, warning: logoUpload.warning });
      return json(200, { ok: true, action: "profile", warning: logoUpload.warning, vendor: Array.isArray(up.data) ? up.data[0] : up.data });
    }

    if (action === "save_item") {
      const existing = await getMenu(admin, vendorId);
      const itemId = cleanString(body?.id || body?.menu_item_id || body?.menuItemId);
      if (!itemId && existing.length >= MAX_FREE_MENU_ITEMS) {
        return json(409, {
          ok: false,
          error: "MENU_LIMIT_REACHED",
          message: `Free tier limit reached: ${MAX_FREE_MENU_ITEMS} menu items maximum.`,
          max_items: MAX_FREE_MENU_ITEMS,
        });
      }

      const photoUpload = await uploadImage(admin, vendorId, "menu", body?.photo_data_url || body?.photoDataUrl);
      const active = toBool(body?.is_available, true) && !toBool(body?.sold_out_today, false);
      const base: Json = {
        vendor_id: vendorId,
        name: cleanString(body?.name),
        description: cleanString(body?.description),
        packaging_note: cleanString(body?.packaging_note || body?.packagingNote),
        price: toPrice(body?.price),
        sort_order: Number.isFinite(Number(body?.sort_order)) ? Number(body?.sort_order) : existing.length + 1,
        is_active: active,
        sold_out_today: toBool(body?.sold_out_today, false),
        updated_at: new Date().toISOString(),
      };
      if (photoUpload.url) base.photo_url = photoUpload.url;
      if (!base.name) return json(400, { ok: false, error: "MISSING_NAME", message: "Menu item name is required" });
      if (base.price <= 0) return json(400, { ok: false, error: "INVALID_PRICE", message: "Menu item price must be greater than zero" });

      if (itemId) {
        const up = await updateSchemaSafe(admin, "vendor_menu_items", base, "id", itemId);
        if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message, warning: photoUpload.warning });
        return json(200, { ok: true, action: "updated", warning: photoUpload.warning, item: normalizeMenuRow(Array.isArray(up.data) ? up.data[0] : up.data) });
      }

      const ins = await insertSchemaSafe(admin, "vendor_menu_items", base);
      if (ins.error) return json(500, { ok: false, error: "DB_ERROR", message: ins.error.message, warning: photoUpload.warning });
      return json(200, { ok: true, action: "created", warning: photoUpload.warning, item: normalizeMenuRow(ins.data) });
    }

    if (action === "toggle_item") {
      const itemId = cleanString(body?.id || body?.menu_item_id || body?.menuItemId);
      if (!itemId) return json(400, { ok: false, error: "MISSING_ITEM_ID", message: "Menu item id is required" });
      const soldOut = toBool(body?.sold_out_today, false);
      const available = toBool(body?.is_available, true);
      const patch: Json = {
        is_active: available && !soldOut,
        sold_out_today: soldOut,
        updated_at: new Date().toISOString(),
      };
      const up = await updateSchemaSafe(admin, "vendor_menu_items", patch, "id", itemId);
      if (up.error) return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
      return json(200, { ok: true, action: "toggled", item: normalizeMenuRow(Array.isArray(up.data) ? up.data[0] : up.data) });
    }

    return json(400, { ok: false, error: "INVALID_ACTION", message: "Supported actions: profile, save_item, toggle_item" });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
