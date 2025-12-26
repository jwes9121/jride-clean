import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
}

function json(status: number, obj: any) {
  return NextResponse.json(obj, { status });
}

function num(v: any): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: any): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// Optional shared secret (recommended in prod)
// If DRIVER_PING_SECRET is set, request must include header: x-jride-ping-secret: <secret>
function checkSecret(req: Request) {
  const secret = envAny(["DRIVER_PING_SECRET"]);
  if (!secret) return true; // no secret configured -> allow (dev-friendly)
  const got = req.headers.get("x-jride-ping-secret") || "";
  return got === secret;
}

export async function GET() {
  return json(200, { ok: true, route: "driver/location/ping" });
}

export async function POST(req: Request) {
  try {
    if (!checkSecret(req)) {
      return json(401, { ok: false, code: "UNAUTHORIZED", message: "Missing/invalid x-jride-ping-secret" });
    }

    const SUPABASE_URL = envAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const SERVICE_KEY = envAny(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "SUPABASE_SERVICE_ROLE"]);

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, code: "MISSING_ENV", message: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const body = await req.json().catch(() => ({} as any));

    const driver_id = str(body.driver_id ?? body.driverId ?? body.driver_uuid ?? body.driverUuid);
    const lat = num(body.lat ?? body.latitude);
    const lng = num(body.lng ?? body.longitude);
    const status = str(body.status ?? body.driver_status ?? body.driverStatus);
    const town = str(body.town ?? body.zone);

    if (!driver_id) {
      return json(400, { ok: false, code: "BAD_REQUEST", message: "driver_id is required" });
    }

    const patch: any = { updated_at: new Date().toISOString() };
    if (lat != null) patch.lat = lat;
    if (lng != null) patch.lng = lng;
    if (status) patch.status = status;
    if (town) patch.town = town;

    const vehicle_type = str(body.vehicle_type ?? body.vehicleType);
    const capacity = body.capacity != null ? Number(body.capacity) : null;
    const home_town = str(body.home_town ?? body.homeTown);
    if (vehicle_type) patch.vehicle_type = vehicle_type;
    if (Number.isFinite(capacity as any)) patch.capacity = capacity;
    if (home_town) patch.home_town = home_town;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // 1) Try UPSERT by driver_id (best when driver_id has unique constraint)
    const upsertPayload = { driver_id, ...patch };

    let upsertErr: any = null;
    try {
      const { error } = await supabase
        .from("driver_locations")
        .upsert(upsertPayload, { onConflict: "driver_id" });
      if (error) upsertErr = error;
    } catch (e: any) {
      upsertErr = e;
    }

    if (!upsertErr) {
      return json(200, { ok: true, driver_id, updated_at: patch.updated_at, mode: "upsert(driver_id)" });
    }

    // 2) Fallback: update existing row by driver_id, else insert with generated id
    const { data: existing, error: selErr } = await supabase
      .from("driver_locations")
      .select("id, driver_id")
      .eq("driver_id", driver_id)
      .limit(1);

    if (!selErr && Array.isArray(existing) && existing.length > 0 && existing[0]?.id) {
      const id = existing[0].id;
      const { error: updErr } = await supabase
        .from("driver_locations")
        .update(patch)
        .eq("id", id);

      if (updErr) {
        return json(500, {
          ok: false,
          code: "UPDATE_FAILED",
          message: updErr.message || "Update failed",
          detail: { upsert_error: (upsertErr as any)?.message || String(upsertErr) },
        });
      }

      return json(200, { ok: true, driver_id, updated_at: patch.updated_at, mode: "update(id)" });
    }

    // Insert new row (INSERT-SAFE): generate UUID for id in case DB has no default
    const id = (globalThis.crypto && "randomUUID" in globalThis.crypto)
      ? (globalThis.crypto as any).randomUUID()
      : `${Date.now()}-${Math.random()}`; // should never happen on Node 18+, but safe

    const insertPayload = { id, driver_id, ...patch };

    const { error: insErr } = await supabase
      .from("driver_locations")
      .insert(insertPayload);

    if (insErr) {
      return json(500, {
        ok: false,
        code: "INSERT_FAILED",
        message: insErr.message || "Insert failed",
        detail: {
          generated_id: id,
          upsert_error: (upsertErr as any)?.message || String(upsertErr),
          select_error: selErr?.message || null,
        },
      });
    }

    return json(200, { ok: true, driver_id, updated_at: patch.updated_at, mode: "insert(id+driver_id)" });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message || "ping failed" });
  }
}
