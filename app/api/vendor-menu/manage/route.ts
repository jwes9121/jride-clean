import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const MAX_FREE_MENU_ITEMS = 15;
const ASSET_BUCKET = "vendor-assets";
const CANONICAL_TAKEOUT_TOWNS = ["Lamut", "Kiangan", "Lagawe", "Hingyon", "Banaue"] as const;

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

function normalizeTakeoutTown(value: any): string {
  const raw = cleanString(value).toLowerCase();
  return CANONICAL_TAKEOUT_TOWNS.find((town) => town.toLowerCase() === raw) || "";
}

function toPrice(v: any) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function toBool(v: any, fallback: boolean) {
  if (typeof v === "boolean") return v;
  if (String(v).toLowerCase() === "true") return true;
  if (String(v).toLowerCase() === "false") return false;
  return fallback;
}

function pickVendorName(row: any) {
  return cleanString(row?.display_name || row?.vendor_name || row?.name || row?.email || row?.id || "Vendor");
}

function pickLogo(row: any) {
  return cleanString(row?.logo_url || row?.vendor_logo_url || row?.image_url || row?.photo_url || row?.avatar_url || "");
}

function pickItemPhoto(row: any) {
  return cleanString(row?.photo_url || row?.image_url || row?.menu_photo_url || row?.item_photo_url || "");
}

function menuId(row: any) {
  return cleanString(row?.menu_item_id || row?.id || "");
}

function normalizeMenuRow(row: any) {
  const id = menuId(row);
  return {
    id,
    menu_item_id: id,
    vendor_id: cleanString(row?.vendor_id || ""),
    name: cleanString(row?.name || row?.item_name || row?.menu_name || ""),
    description: cleanString(row?.description || ""),
    packaging_note: cleanString(row?.packaging_note || row?.packagingNote || row?.packaging || ""),
    price: toPrice(row?.price || row?.unit_price || 0),
    photo_url: pickItemPhoto(row) || null,
    sort_order: Number.isFinite(Number(row?.sort_order)) ? Number(row?.sort_order) : 0,
    is_available: toBool(row?.is_available ?? row?.available ?? row?.available_today, true),
    sold_out_today: toBool(row?.sold_out_today ?? row?.is_sold_out_today, false),
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
  const fields = "*";
  const byId = await admin.from("vendor_accounts").select(fields).eq("id", vendorId).limit(1);
  if (!byId.error && Array.isArray(byId.data) && byId.data[0]) return byId.data[0];
  const byEmail = await admin.from("vendor_accounts").select(fields).eq("email", vendorId).limit(1);
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
            town: normalizeTakeoutTown(vendor?.town || vendor?.municipality || vendor?.vendor_town),
            logo_url: pickLogo(vendor) || null,
            accepting_orders: toBool(vendor?.accepting_orders ?? vendor?.is_open ?? vendor?.open, true),
            premium_packaging_enabled: toBool(vendor?.premium_packaging_enabled ?? vendor?.premiumPackagingEnabled, false),
            premium_packaging_fee: toPrice(vendor?.premium_packaging_fee ?? vendor?.premiumPackagingFee ?? 0),
            premium_packaging_label: cleanString(vendor?.premium_packaging_label || vendor?.premiumPackagingLabel || "Premium packaging"),
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
      const town = normalizeTakeoutTown(body?.town || body?.municipality || body?.vendor_town);
      if (!town) {
        return json(400, { ok: false, error: "INVALID_TOWN", message: "Select a valid vendor town: Lamut, Kiangan, Lagawe, Hingyon, or Banaue." });
      }
      const patch: Json = {
        display_name: cleanString(body?.name || body?.display_name || body?.vendor_name),
        vendor_name: cleanString(body?.name || body?.display_name || body?.vendor_name),
        name: cleanString(body?.name || body?.display_name || body?.vendor_name),
        town,
        municipality: town,
        vendor_town: town,
        accepting_orders: toBool(body?.accepting_orders, true),
        premium_packaging_enabled: toBool(body?.premium_packaging_enabled ?? body?.premiumPackagingEnabled, false),
        premium_packaging_fee: toPrice(body?.premium_packaging_fee ?? body?.premiumPackagingFee ?? 0),
        premium_packaging_label: cleanString(body?.premium_packaging_label || body?.premiumPackagingLabel || "Premium packaging"),
        is_open: toBool(body?.accepting_orders, true),
        open: toBool(body?.accepting_orders, true),
        updated_at: new Date().toISOString(),
      };
      if (logoUpload.url) {
        patch.logo_url = logoUpload.url;
        patch.vendor_logo_url = logoUpload.url;
        patch.image_url = logoUpload.url;
      }
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
      const base: Json = {
        vendor_id: vendorId,
        name: cleanString(body?.name),
        description: cleanString(body?.description),
        packaging_note: cleanString(body?.packaging_note || body?.packagingNote),
        price: toPrice(body?.price),
        sort_order: Number.isFinite(Number(body?.sort_order)) ? Number(body?.sort_order) : existing.length + 1,
        is_available: toBool(body?.is_available, true),
        available: toBool(body?.is_available, true),
        sold_out_today: toBool(body?.sold_out_today, false),
        is_sold_out_today: toBool(body?.sold_out_today, false),
        last_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      if (photoUpload.url) {
        base.photo_url = photoUpload.url;
        base.image_url = photoUpload.url;
        base.menu_photo_url = photoUpload.url;
        base.item_photo_url = photoUpload.url;
      }
      if (!base.name) return json(400, { ok: false, error: "MISSING_NAME", message: "Menu item name is required" });
      if (base.price <= 0) return json(400, { ok: false, error: "INVALID_PRICE", message: "Menu item price must be greater than zero" });

      if (itemId) {
        const upByMenu = await updateSchemaSafe(admin, "vendor_menu_today", base, "menu_item_id", itemId);
        if (!upByMenu.error && Array.isArray(upByMenu.data) && upByMenu.data.length) {
          return json(200, { ok: true, action: "updated", warning: photoUpload.warning, item: normalizeMenuRow(upByMenu.data[0]) });
        }
        const upById = await updateSchemaSafe(admin, "vendor_menu_today", base, "id", itemId);
        if (upById.error) return json(500, { ok: false, error: "DB_ERROR", message: upById.error.message, warning: photoUpload.warning });
        return json(200, { ok: true, action: "updated", warning: photoUpload.warning, item: normalizeMenuRow(Array.isArray(upById.data) ? upById.data[0] : upById.data) });
      }

      base.menu_item_id = `mi_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const ins = await insertSchemaSafe(admin, "vendor_menu_today", base);
      if (ins.error) return json(500, { ok: false, error: "DB_ERROR", message: ins.error.message, warning: photoUpload.warning });
      return json(200, { ok: true, action: "created", warning: photoUpload.warning, item: normalizeMenuRow(ins.data) });
    }

    if (action === "toggle_item") {
      const itemId = cleanString(body?.id || body?.menu_item_id || body?.menuItemId);
      if (!itemId) return json(400, { ok: false, error: "MISSING_ITEM_ID", message: "Menu item id is required" });
      const patch: Json = {
        is_available: toBool(body?.is_available, true),
        available: toBool(body?.is_available, true),
        sold_out_today: toBool(body?.sold_out_today, false),
        is_sold_out_today: toBool(body?.sold_out_today, false),
        last_updated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const upByMenu = await updateSchemaSafe(admin, "vendor_menu_today", patch, "menu_item_id", itemId);
      if (!upByMenu.error && Array.isArray(upByMenu.data) && upByMenu.data.length) {
        return json(200, { ok: true, action: "toggled", item: normalizeMenuRow(upByMenu.data[0]) });
      }
      const upById = await updateSchemaSafe(admin, "vendor_menu_today", patch, "id", itemId);
      if (upById.error) return json(500, { ok: false, error: "DB_ERROR", message: upById.error.message });
      return json(200, { ok: true, action: "toggled", item: normalizeMenuRow(Array.isArray(upById.data) ? upById.data[0] : upById.data) });
    }

    return json(400, { ok: false, error: "INVALID_ACTION", message: "Supported actions: profile, save_item, toggle_item" });
  } catch (e: any) {
    return json(500, { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) });
  }
}
