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

function bool(v: any, fallback = false) {
  if (v === true || v === false) return v;
  const t = String(v ?? "").trim().toLowerCase();
  if (t === "true" || t === "1" || t === "yes") return true;
  if (t === "false" || t === "0" || t === "no") return false;
  return fallback;
}

// GET /api/passenger-addresses?device_key=... OR ?created_by_user_id=...
export async function GET(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const device_key = s(req.nextUrl.searchParams.get("device_key"));
  const created_by_user_id = s(req.nextUrl.searchParams.get("created_by_user_id"));

  if (!device_key && !created_by_user_id) {
    return json(400, { ok: false, error: "owner_required", message: "device_key or created_by_user_id required" });
  }

  let q = admin
    .from("passenger_addresses")
    .select("id,created_by_user_id,device_key,label,address_text,landmark,notes,lat,lng,is_primary,is_active,created_at,updated_at")
    .eq("is_active", true);

  if (created_by_user_id) q = q.eq("created_by_user_id", created_by_user_id);
  else q = q.eq("device_key", device_key);

  const { data, error } = await q
    .order("is_primary", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) return json(500, { ok: false, error: "DB_ERROR", message: error.message });

  const items = Array.isArray(data) ? data : [];
  const primary = items.find((a: any) => !!a?.is_primary) || null;

  return json(200, {
    ok: true,
    device_key: device_key || null,
    created_by_user_id: created_by_user_id || null,
    primary,
    addresses: items,
  });
}

// POST /api/passenger-addresses
// body: { device_key? , created_by_user_id? , address_text, label?, landmark?, notes?, lat?, lng?, is_primary? }
export async function POST(req: NextRequest) {
  const admin = getAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  const body = await req.json().catch(() => ({} as any));

  const device_key = s(body.device_key ?? body.deviceKey);
  const created_by_user_id = s(body.created_by_user_id ?? body.createdByUserId);

  if (!device_key && !created_by_user_id) {
    return json(400, { ok: false, error: "owner_required", message: "device_key or created_by_user_id required" });
  }

  const address_text = s(body.address_text ?? body.addressText);
  if (!address_text) return json(400, { ok: false, error: "address_required", message: "address_text required" });

  const label = s(body.label);
  const landmark = s(body.landmark);
  const notes = s(body.notes);

  const lat = body.lat === null || body.lat === undefined ? null : Number(body.lat);
  const lng = body.lng === null || body.lng === undefined ? null : Number(body.lng);

  const makePrimary = bool(body.is_primary ?? body.isPrimary, false);

  // If setting primary, unset existing primary first (owner-scoped)
  if (makePrimary) {
    let uq = admin.from("passenger_addresses").update({ is_primary: false });
    if (created_by_user_id) uq = uq.eq("created_by_user_id", created_by_user_id);
    else uq = uq.eq("device_key", device_key);
    uq = uq.eq("is_active", true).eq("is_primary", true);

    const { error: uerr } = await uq;
    if (uerr) return json(500, { ok: false, error: "DB_ERROR", message: uerr.message });
  }

  const insertRow: any = {
    created_by_user_id: created_by_user_id || null,
    device_key: device_key || null,
    label: label || null,
    address_text,
    landmark: landmark || null,
    notes: notes || null,
    lat: Number.isFinite(lat as any) ? lat : null,
    lng: Number.isFinite(lng as any) ? lng : null,
    is_primary: makePrimary,
    is_active: true,
  };

  // Insert new address (MVP). (We can add â€œupdate existingâ€ later.)
  const { data, error } = await admin
    .from("passenger_addresses")
    .insert(insertRow)
    .select("id,created_by_user_id,device_key,label,address_text,landmark,notes,lat,lng,is_primary,is_active,created_at,updated_at")
    .single();

  if (error) {
    // If unique primary constraint trips due to race, retry once by unsetting again then insert non-primary
    const msg = String(error.message || "");
    if (makePrimary && msg.toLowerCase().includes("duplicate")) {
      let uq2 = admin.from("passenger_addresses").update({ is_primary: false });
      if (created_by_user_id) uq2 = uq2.eq("created_by_user_id", created_by_user_id);
      else uq2 = uq2.eq("device_key", device_key);
      uq2 = uq2.eq("is_active", true);

      const { error: u2 } = await uq2;
      if (!u2) {
        insertRow.is_primary = true;
        const { data: d2, error: e2 } = await admin
          .from("passenger_addresses")
          .insert(insertRow)
          .select("id,created_by_user_id,device_key,label,address_text,landmark,notes,lat,lng,is_primary,is_active,created_at,updated_at")
          .single();
        if (e2) return json(500, { ok: false, error: "DB_ERROR", message: e2.message });
        return json(200, { ok: true, address: d2 });
      }
    }

    return json(500, { ok: false, error: "DB_ERROR", message: error.message });
  }

  return json(200, { ok: true, address: data });
}