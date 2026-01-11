import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type LatLng = { lat: number | null; lng: number | null };

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

function isFiniteNum(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

// Treat 0/0 as invalid for this app
function normalizeLL(ll: LatLng): LatLng {
  const lat = isFiniteNum(ll?.lat);
  const lng = isFiniteNum(ll?.lng);
  if (lat == null || lng == null) return { lat: null, lng: null };
  if (lat === 0 || lng === 0) return { lat: null, lng: null };
  return { lat, lng };
}

function pickLatLng(obj: any): LatLng {
  if (!obj || typeof obj !== "object") return { lat: null, lng: null };

  const keys = Object.keys(obj);
  const lowerMap: Record<string, any> = {};
  for (const k of keys) lowerMap[k.toLowerCase()] = (obj as any)[k];

  const latKeys = ["lat","latitude","location_lat","pickup_lat","from_lat","start_lat","vendor_lat","store_lat","merchant_lat"];
  const lngKeys = ["lng","lon","longitude","location_lng","pickup_lng","from_lng","start_lng","vendor_lng","store_lng","merchant_lng"];

  function firstNum(cands: string[]) {
    for (const k of cands) {
      if (k in lowerMap) {
        const n = Number(lowerMap[k]);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  return normalizeLL({ lat: firstNum(latKeys), lng: firstNum(lngKeys) });
}

function pickTown(obj: any): string | null {
  if (!obj || typeof obj !== "object") return null;
  const keys = Object.keys(obj);
  const lower: Record<string, any> = {};
  for (const k of keys) lower[k.toLowerCase()] = (obj as any)[k];

  const cands = ["town","municipality","lgu","city"];
  for (const k of cands) {
    if (k in lower) {
      const v = String(lower[k] ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

function inferTownFromLabel(label: string | null): string | null {
  const s = String(label || "").toLowerCase();
  if (!s) return null;
  const towns = ["kiangan","lagawe","hingyon","lamut","banaue"];
  for (const t of towns) {
    if (s.includes(t)) return t.charAt(0).toUpperCase() + t.slice(1);
  }
  return null;
}

/* PHASE_3I_TOWNBOX_FALLBACK */
function deriveTownFromLatLng(lat: number | null, lng: number | null): string | null {
  const la = (lat == null ? NaN : Number(lat));
  const lo = (lng == null ? NaN : Number(lng));
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;

  // Rough Ifugao municipality boxes (fallback only).
  const BOXES: Array<{ name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    { name: "Lagawe",  minLat: 17.05, maxLat: 17.16, minLng: 121.10, maxLng: 121.30 },
    { name: "Kiangan", minLat: 16.98, maxLat: 17.10, minLng: 121.05, maxLng: 121.25 },
    { name: "Lamut",   minLat: 16.86, maxLat: 17.02, minLng: 121.10, maxLng: 121.28 },
    { name: "Hingyon", minLat: 17.10, maxLat: 17.22, minLng: 121.00, maxLng: 121.18 },
    { name: "Banaue",  minLat: 16.92, maxLat: 17.15, minLng: 121.02, maxLng: 121.38 },
  ];

  for (const b of BOXES) {
    if (la >= b.minLat && la <= b.maxLat && lo >= b.minLng && lo <= b.maxLng) return b.name;
  }
  return null;
}
/* PHASE_3I_TOWNBOX_FALLBACK_END */

async function tryFetchRowById(admin: any, table: string, idField: string, idValue: string) {
  try {
    const res = await admin.from(table).select("*").eq(idField, idValue).limit(1);
    if (res.error) return null;
    const row = Array.isArray(res.data) ? res.data[0] : null;
    return row || null;
  } catch {
    return null;
  }
}

async function mapboxGeocode(label: string): Promise<LatLng> {
  const q = String(label || "").trim();
  if (!q) return { lat: null, lng: null };

  const token =
    process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
    process.env.MAPBOX_ACCESS_TOKEN ||
    process.env.MAPBOX_TOKEN ||
    "";

  if (!token) return { lat: null, lng: null };

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(q) +
    ".json?limit=1&language=en&access_token=" +
    encodeURIComponent(token);

  try {
    const r = await fetch(url, { method: "GET" });
    const j: any = await r.json().catch(() => null);
    const f = j?.features?.[0];
    const center = Array.isArray(f?.center) ? f.center : null; // [lng,lat]
    const lng = center && center.length >= 2 ? Number(center[0]) : null;
    const lat = center && center.length >= 2 ? Number(center[1]) : null;
    return normalizeLL({ lat, lng });
  } catch {
    return { lat: null, lng: null };
  }
}

async function fetchVendorCoordsAndTown(admin: any, vendorId: string): Promise<{ ll: LatLng; town: string | null }> {
  // Recommended: multiple sources in order
  const candidates: Array<[string, string]> = [
    ["vendor_accounts", "id"],
    ["vendor_accounts", "vendor_id"],
    ["vendor_profiles", "id"],
    ["vendor_profiles", "vendor_id"],
    ["vendors", "id"],
    ["vendors", "vendor_id"],
  ];

  let firstTown: string | null = null;

  for (const [table, key] of candidates) {
    const row = await tryFetchRowById(admin, table, key, vendorId);
    if (!row) continue;
    const ll = pickLatLng(row);
    const town = pickTown(row);
    if (!firstTown && town) firstTown = town;
    if (ll.lat != null && ll.lng != null) return { ll, town: town || firstTown };
  }

  return { ll: { lat: null, lng: null }, town: firstTown };
}

function hasValidLL(lat: any, lng: any): boolean {
  const la = isFiniteNum(lat);
  const lo = isFiniteNum(lng);
  if (la == null || lo == null) return false;
  if (la === 0 || lo === 0) return false;
  return true;
}

// Schema-safe update: if schema cache complains about a missing column, drop that field and retry.
async function schemaSafeUpdateBooking(admin: any, id: string, initial: Record<string, any>) {
  let payload: Record<string, any> = { ...initial };

  for (let attempt = 0; attempt < 8; attempt++) {
    const res = await admin.from("bookings").update(payload).eq("id", id).select("id").single();

    if (!res.error) return res;

    const msg = String((res.error as any)?.message || "");
    const m = msg.match(/Could not find the '([^']+)' column of 'bookings' in the schema cache/i);
    if (m && m[1]) {
      const col = String(m[1]);
      delete (payload as any)[col];
      continue;
    }
    return res;
  }

  return { data: null, error: { message: "DB_ERROR: schema-safe update retries exceeded" } } as any;
}

export async function POST(req: Request) {
  const admin = getServiceRoleAdmin();
  if (!admin) {
    return json(500, {
      ok: false,
      error: "SERVER_MISCONFIG",
      message: "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
    });
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {}

  const limit = Math.max(1, Math.min(300, Number(body?.limit ?? 80) || 80));
  const dryRun = !!body?.dry_run;

  // Only touch active bookings (donâ€™t mutate completed/cancelled history)
  const ACTIVE = ["pending", "assigned", "on_the_way", "arrived", "enroute", "on_trip", "requested"];

  // Target likely-takeout rows:
  // - service_type == "takeout" OR vendor_id present
  // Also require missing coords OR 0/0 coords
  const q = admin
    .from("bookings")
    .select("*")
    .in("status", ACTIVE)
    .or("service_type.eq.takeout,vendor_id.not.is.null")
    .order("created_at", { ascending: false })
    .limit(limit);

  const res = await q;
  if (res.error) return json(500, { ok: false, error: "DB_ERROR", message: res.error.message });

  const rows: any[] = Array.isArray(res.data) ? res.data : [];
  let scanned = 0;
  let updated = 0;
  let skipped = 0;

  const details: any[] = [];

  for (const b of rows) {
    scanned++;

    const id = String(b?.id || "");
    if (!id) { skipped++; continue; }

    const vendorId = String(b?.vendor_id || "").trim();
    const toLabel = String(b?.to_label ?? b?.dropoff_label ?? b?.toLabel ?? "").trim() || null;

    const hasPickup = hasValidLL((b as any)?.pickup_lat, (b as any)?.pickup_lng);
    const hasDrop = hasValidLL((b as any)?.dropoff_lat, (b as any)?.dropoff_lng);

    // If both already good, skip
    if (hasPickup && hasDrop && String((b as any)?.town || "").trim()) {
      skipped++;
      continue;
    }

    // Compute backfills
    const patch: Record<string, any> = {};
    const can = (k: string) => Object.prototype.hasOwnProperty.call(b, k);

    // Always bump updated_at if exists
    if (can("updated_at")) patch.updated_at = new Date().toISOString();

    // Pickup from vendor meta
    let vendorTown: string | null = null;
    let vendorLL: LatLng = { lat: null, lng: null };
    if (vendorId) {
      const v = await fetchVendorCoordsAndTown(admin, vendorId);
      vendorLL = normalizeLL(v.ll);
      vendorTown = v.town || null;
    }

    if (!hasPickup && vendorLL.lat != null && vendorLL.lng != null) {
      if (can("pickup_lat")) patch.pickup_lat = vendorLL.lat;
      if (can("pickup_lng")) patch.pickup_lng = vendorLL.lng;
    }

    // Dropoff from geocode (old rows may not have device_key/address_id)
    let dropLL: LatLng = { lat: null, lng: null };
    if (!hasDrop && toLabel) {
      dropLL = await mapboxGeocode(toLabel);
      if (dropLL.lat != null && dropLL.lng != null) {
        if (can("dropoff_lat")) patch.dropoff_lat = dropLL.lat;
        if (can("dropoff_lng")) patch.dropoff_lng = dropLL.lng;
      }
    }

    // Town fill (only if missing)
    const curTown = String((b as any)?.town || "").trim() || null;
    if (!curTown && can("town")) {
      const derivedTown =
        vendorTown ||
        inferTownFromLabel(toLabel) ||
        deriveTownFromLatLng(
          (patch.pickup_lat ?? (b as any)?.pickup_lat) ?? null,
          (patch.pickup_lng ?? (b as any)?.pickup_lng) ?? null
        ) ||
        null;

      if (derivedTown) patch.town = derivedTown;
    }

    // If patch only has updated_at, skip
    const patchKeys = Object.keys(patch).filter((k) => k !== "updated_at");
    if (patchKeys.length === 0) {
      skipped++;
      continue;
    }

    if (dryRun) {
      updated++;
      details.push({ id, vendor_id: vendorId || null, would_patch: patch });
      continue;
    }

    const upd = await schemaSafeUpdateBooking(admin, id, patch);
    if (upd.error) {
      details.push({ id, vendor_id: vendorId || null, error: upd.error.message });
      continue;
    }

    updated++;
    details.push({ id, vendor_id: vendorId || null, patched: patchKeys });
  }

  return json(200, {
    ok: true,
    phase: "PHASE_3I_BACKFILL_TAKEOUT_COORDS_TOWN",
    dryRun,
    scanned,
    updated,
    skipped,
    sample: details.slice(0, 25),
    note:
      "Backfills pickup coords from vendor tables; dropoff coords via Mapbox geocode(to_label) if token present; fills town if missing. Idempotent; does not overwrite valid coords.",
  });
}