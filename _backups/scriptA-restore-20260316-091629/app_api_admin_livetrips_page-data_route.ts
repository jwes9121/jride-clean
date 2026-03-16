import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { createNextOffer } from "@/lib/dispatchOfferQueue";

function asNum(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function pickDeviceId(req: NextRequest, body: any): string {
  const fromBody = String(body?.device_id ?? body?.deviceId ?? "").trim();
  if (fromBody) return fromBody;
  const ua = String(req.headers.get("user-agent") ?? "").slice(0, 160);
  const xff = String(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const seed = (ua + "|" + xff).trim();
  return seed ? "fallback:" + seed : "fallback:unknown";
}

const IFUGAO_LAT_MIN = 16.6;
const IFUGAO_LAT_MAX = 17.25;
const IFUGAO_LNG_MIN = 120.7;
const IFUGAO_LNG_MAX = 121.35;

function insideIfugao(lat: number, lng: number): boolean {
  return lat >= IFUGAO_LAT_MIN && lat <= IFUGAO_LAT_MAX && lng >= IFUGAO_LNG_MIN && lng <= IFUGAO_LNG_MAX;
}

function deriveTownFromLatLng(lat: number, lng: number): string | null {
  const BOXES: Array<{ name: string; minLat: number; maxLat: number; minLng: number; maxLng: number }> = [
    { name: "Lagawe", minLat: 17.05, maxLat: 17.16, minLng: 121.1, maxLng: 121.3 },
    { name: "Kiangan", minLat: 16.98, maxLat: 17.1, minLng: 121.05, maxLng: 121.25 },
    { name: "Lamut", minLat: 16.86, maxLat: 17.02, minLng: 121.1, maxLng: 121.28 },
    { name: "Hingyon", minLat: 17.1, maxLat: 17.22, minLng: 121.0, maxLng: 121.18 },
    { name: "Banaue", minLat: 16.92, maxLat: 17.15, minLng: 121.02, maxLng: 121.38 },
  ];
  for (const b of BOXES) {
    if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) return b.name;
  }
  return null;
}

async function enforceDeviceLock(opts: { driverId: string; deviceId: string; nowIso: string; staleSeconds: number; forceTakeover: boolean }) {
  const { driverId, deviceId, nowIso, staleSeconds, forceTakeover } = opts;
  const { data: lock, error: lockErr } = await supabaseServer.from("driver_device_locks").select("driver_id, device_id, last_seen").eq("driver_id", driverId).maybeSingle();
  if (lockErr) throw new Error("driver_device_locks lookup failed: " + lockErr.message);

  if (!lock) {
    const { error: insErr } = await supabaseServer.from("driver_device_locks").insert({ driver_id: driverId, device_id: deviceId, last_seen: nowIso });
    if (insErr) throw new Error("driver_device_locks insert failed: " + insErr.message);
    return { ok: true, claimed: true, active_device_id: deviceId };
  }

  const active = String(lock.device_id ?? "");
  const lastSeen = lock.last_seen ? new Date(lock.last_seen as any).getTime() : 0;
  const nowMs = new Date(nowIso).getTime();
  const ageSec = lastSeen ? Math.floor((nowMs - lastSeen) / 1000) : 999999;
  const same = active === deviceId;

  if (!same && !forceTakeover && ageSec < staleSeconds) {
    return { ok: false, conflict: true, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  const { error: upErr } = await supabaseServer.from("driver_device_locks").update({ device_id: deviceId, last_seen: nowIso }).eq("driver_id", driverId);
  if (upErr) throw new Error("driver_device_locks update failed: " + upErr.message);

  return { ok: true, claimed: !same, active_device_id: deviceId, last_seen_age_seconds: ageSec };
}

async function tryOfferWaitingBooking(town: string | null) {
  const { data, error } = await supabaseServer
    .from("bookings")
    .select("id, booking_code, town, created_at")
    .eq("status", "requested")
    .or("assigned_driver_id.is.null,driver_id.is.null")
    .order("created_at", { ascending: true })
    .limit(20);

  if (error) {
    return { ok: false, skipped: true, reason: "BOOKINGS_LOOKUP_FAILED", message: error.message };
  }

  const rows = Array.isArray(data) ? data : [];
  if (!rows.length) {
    return { ok: true, skipped: true, reason: "NO_WAITING_BOOKINGS" };
  }

  const sameTown = town ? rows.find((r: any) => String(r?.town || "").trim().toLowerCase() === String(town).trim().toLowerCase()) : null;
  const candidate = sameTown || rows[0];
  if (!candidate) {
    return { ok: true, skipped: true, reason: "NO_CANDIDATE" };
  }

  return await createNextOffer({
    bookingId: candidate.id ?? null,
    bookingCode: candidate.booking_code ?? null,
    timeoutSeconds: 8,
    source: "driver_heartbeat_online",
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const driverId = String(body?.driver_id ?? body?.driverId ?? "").trim();
    const lat = asNum(body?.lat);
    const lng = asNum(body?.lng);

    if (!driverId || lat == null || lng == null) {
      return NextResponse.json({ ok: false, error: "driver_id/driverId, lat, lng required" }, { status: 400 });
    }

    const allowOutside = !!(body?.allow_outside_ifugao ?? body?.allowOutsideIfugao ?? false);
    if (!allowOutside && !insideIfugao(lat, lng)) {
      return NextResponse.json({ ok: false, error: "Location outside Ifugao rejected", lat, lng }, { status: 400 });
    }

    const nowIso = new Date().toISOString();
    const deviceId = pickDeviceId(req, body);
    const forceTakeover = !!(body?.force_takeover ?? body?.forceTakeover ?? false);

    const lock = await enforceDeviceLock({ driverId, deviceId, nowIso, staleSeconds: 120, forceTakeover });
    if ((lock as any).conflict) {
      return NextResponse.json((() => { const { ok: _ok, ...rest } = lock as any; return { ok: false, error: "Device lock conflict", ...rest }; })(), { status: 409 });
    }

    const isAvail = body?.is_available === undefined ? true : !!body?.is_available;
    const status = isAvail ? "online" : "offline";
    const townRaw = body?.town ?? null;
    const town = townRaw ? String(townRaw) : deriveTownFromLatLng(lat, lng);

    const { error } = await supabaseServer.from("driver_locations").upsert({ driver_id: driverId, lat, lng, status, town }, { onConflict: "driver_id" });
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    let retryDispatch: any = null;
    if (status === "online") {
      try {
        retryDispatch = await tryOfferWaitingBooking(town);
      } catch (dispatchErr: any) {
        retryDispatch = { ok: false, skipped: true, reason: "RETRY_DISPATCH_FAILED", message: String(dispatchErr?.message || dispatchErr) };
      }
    }

    return NextResponse.json({ ok: true, lock, retry_dispatch: retryDispatch }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
