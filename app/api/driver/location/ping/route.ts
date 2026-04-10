import { NextRequest, NextResponse } from "next/server";
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

function norm(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function text(v: any): string {
  return String(v ?? "").trim();
}

function normDeviceId(s: any): string {
  return String(s ?? "").trim().toLowerCase();
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const provided = text(req.headers.get("x-jride-driver-secret"));
  const expected =
    text(process.env.DRIVER_PING_SECRET) ||
    text(process.env.NEXT_PUBLIC_DRIVER_PING_SECRET);
  if (!provided || !expected) return false;
  return provided === expected;
}

async function resolveDriverIdFromBearer(serviceSupabase: any, authUserId: string): Promise<string | null> {
  const directProfile = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("driver_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (!directProfile.error && directProfile.data?.driver_id) {
    return text(directProfile.data.driver_id) || null;
  }

  const authUser = await serviceSupabase
    .from("auth_users_view")
    .select("email")
    .eq("id", authUserId)
    .limit(1)
    .maybeSingle();

  const email = text((authUser.data as any)?.email);
  if (!email) return null;

  const byEmail = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!byEmail.error && byEmail.data?.driver_id) {
    return text(byEmail.data.driver_id) || null;
  }

  return null;
}

async function resolveDriverAuth(req: NextRequest, serviceSupabase: any): Promise<
  | { ok: true; driverId: string; authMode: "bearer" | "driver_secret" }
  | { ok: false; code: string; message: string }
> {
  const accessToken = getBearerToken(req);
  if (accessToken) {
    const anonUrl = envAny(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"]);
    const anonKey = envAny(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"]);
    if (!anonUrl || !anonKey) {
      return {
        ok: false,
        code: "SUPABASE_ANON_ENV_MISSING",
        message: "Missing Supabase anon client environment variables.",
      };
    }

    const authSupabase = createClient(anonUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userRes, error: userErr } = await authSupabase.auth.getUser(accessToken);
    const user = userRes?.user ?? null;
    if (userErr || !user?.id) {
      return {
        ok: false,
        code: "NOT_AUTHED",
        message: "Invalid bearer token.",
      };
    }

    const driverId = await resolveDriverIdFromBearer(serviceSupabase, user.id);
    if (!driverId) {
      return {
        ok: false,
        code: "DRIVER_NOT_FOUND",
        message: "No driver profile found for token user.",
      };
    }

    return { ok: true, driverId, authMode: "bearer" };
  }

  if (isDriverSecretAuthorized(req)) {
    return { ok: true, driverId: "", authMode: "driver_secret" };
  }

  return {
    ok: false,
    code: "NOT_AUTHED",
    message: "Missing bearer token or valid driver secret.",
  };
}

function pickDeviceId(req: Request, body: any): string {
  const fromBody = String(body?.device_id ?? body?.deviceId ?? "");
  if (fromBody && fromBody.trim()) return normDeviceId(fromBody);

  const ua = String(req.headers.get("user-agent") ?? "").slice(0, 160);
  const xff = String(req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const seed = (ua + "|" + xff).trim();
  return normDeviceId(seed ? "fallback:" + seed : "fallback:unknown");
}

async function enforceDeviceLockPing(opts: {
  supabase: any;
  driverId: string;
  deviceId: string;
  nowIso: string;
  staleSeconds: number;
  forceTakeover: boolean;
}) {
  const { supabase, driverId, deviceId, nowIso, staleSeconds, forceTakeover } = opts;

  const reqDevice = normDeviceId(deviceId);

  const { data: lock, error: lockErr } = await supabase
    .from("driver_device_locks")
    .select("driver_id, device_id, last_seen")
    .eq("driver_id", driverId)
    .maybeSingle();

  if (lockErr) throw new Error("driver_device_locks lookup failed: " + lockErr.message);

  if (!lock) {
    const { error: insErr } = await supabase
      .from("driver_device_locks")
      .insert({ driver_id: driverId, device_id: reqDevice, last_seen: nowIso });

    if (insErr) throw new Error("driver_device_locks insert failed: " + insErr.message);

    return { ok: true, claimed: true, active_device_id: reqDevice, last_seen_age_seconds: 0 };
  }

  const active = normDeviceId(lock.device_id ?? "");
  const lastSeen = lock.last_seen ? new Date(lock.last_seen as any).getTime() : 0;
  const nowMs = new Date(nowIso).getTime();
  const ageSec = lastSeen ? Math.floor((nowMs - lastSeen) / 1000) : 999999;
  const same = active === reqDevice;

  if (same) {
    const { error: hbErr } = await supabase
      .from("driver_device_locks")
      .update({ last_seen: nowIso })
      .eq("driver_id", driverId);

    if (hbErr) throw new Error("driver_device_locks heartbeat update failed: " + hbErr.message);

    return { ok: true, claimed: false, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  if (!same && forceTakeover) {
    const { data: loc, error: locErr } = await supabase
      .from("driver_locations")
      .select("status")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (locErr) throw new Error("driver_locations lookup failed: " + locErr.message);

    const st = norm((loc as any)?.status ?? "");
    if (!st || st !== "offline") {
      return {
        ok: false,
        online_block: true,
        active_device_id: active,
        current_status: st || "unknown",
        last_seen_age_seconds: ageSec,
      };
    }
  }

  if (!forceTakeover && ageSec < staleSeconds) {
    return { ok: false, conflict: true, active_device_id: active, last_seen_age_seconds: ageSec };
  }

  const { error: upErr } = await supabase
    .from("driver_device_locks")
    .update({ device_id: reqDevice, last_seen: nowIso })
    .eq("driver_id", driverId);

  if (upErr) throw new Error("driver_device_locks update failed: " + upErr.message);

  return { ok: true, claimed: true, active_device_id: reqDevice, last_seen_age_seconds: ageSec };
}

async function triggerRetryAutoAssign(baseUrl: string) {
  if (!baseUrl || !String(baseUrl).trim()) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "BASE_URL_MISSING",
    };
  }

  const url = String(baseUrl).replace(/\/+$/, "") + "/api/dispatch/retry-auto-assign";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch (_) {
      body = null;
    }

    return {
      attempted: true,
      ok: res.ok,
      status: res.status,
      body,
      url,
    };
  } catch (e: any) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      error: String(e?.message ?? e),
      url,
    };
  }
}

export async function POST(req: NextRequest) {
  const traceStartedAt = new Date().toISOString();
  console.log("[DISPATCH_TRACE] ping:start", { at: traceStartedAt });

  try {
    const body = await req.json().catch(() => ({}));

    const bodyDriverId = text(body?.driver_id ?? body?.driverId);
    if (!bodyDriverId) return json(400, { ok: false, code: "MISSING_DRIVER_ID" });

    const incomingLat = Number(body?.lat);
    const incomingLng = Number(body?.lng);
    const hasIncomingCoords = Number.isFinite(incomingLat) && Number.isFinite(incomingLng);

    const status = norm(body?.status ?? "online") || "online";
    const town = text(body?.town);
    const forceTakeover = !!(body?.force_takeover ?? body?.forceTakeover ?? false);

    const supabaseUrl = envAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
    const supabaseServiceRole = envAny(["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE"]);

    if (!supabaseUrl || !supabaseServiceRole) {
      return json(500, { ok: false, code: "SUPABASE_ENV_MISSING" });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authRes = await resolveDriverAuth(req, supabase);
    if (!authRes.ok) {
      return json(401, {
        ok: false,
        code: authRes.code,
        message: authRes.message,
      });
    }

    const driverId = authRes.authMode === "bearer" ? authRes.driverId : bodyDriverId;

    if (!driverId) {
      return json(400, {
        ok: false,
        code: "MISSING_DRIVER_ID",
        message: "driver_id is required for driver_secret mode.",
      });
    }

    if (authRes.authMode === "bearer" && driverId !== bodyDriverId) {
      return json(403, {
        ok: false,
        code: "DRIVER_ID_MISMATCH",
        message: "Authenticated driver does not match payload driver_id.",
        auth_driver_id: driverId,
        body_driver_id: bodyDriverId,
      });
    }

    const nowIso = new Date().toISOString();
    const deviceId = pickDeviceId(req, body);

    const lock = await enforceDeviceLockPing({
      supabase,
      driverId,
      deviceId,
      nowIso,
      staleSeconds: 120,
      forceTakeover,
    });

    if ((lock as any).online_block) {
      return json(409, {
        ok: false,
        code: "DEVICE_TAKEOVER_REQUIRES_OFFLINE",
        active_device_id: (lock as any).active_device_id,
        current_status: (lock as any).current_status,
        last_seen_age_seconds: (lock as any).last_seen_age_seconds,
      });
    }

    if ((lock as any).conflict) {
      return json(409, {
        ok: false,
        code: "DEVICE_LOCKED",
        active_device_id: (lock as any).active_device_id,
        last_seen_age_seconds: (lock as any).last_seen_age_seconds,
      });
    }

    const { data: prevLoc, error: prevLocErr } = await supabase
      .from("driver_locations")
      .select("id, status, lat, lng")
      .eq("driver_id", driverId)
      .maybeSingle();

    if (prevLocErr) {
      return json(500, {
        ok: false,
        code: "PREV_DRIVER_LOCATION_LOOKUP_FAILED",
        message: prevLocErr.message,
      });
    }

    const previousStatus = norm((prevLoc as any)?.status ?? "");

    let finalLat: number | null = null;
    let finalLng: number | null = null;
    let coordsSource = "incoming";

    if (hasIncomingCoords) {
      finalLat = incomingLat;
      finalLng = incomingLng;
    } else {
      const prevLat = Number((prevLoc as any)?.lat);
      const prevLng = Number((prevLoc as any)?.lng);
      const hasPrevCoords = Number.isFinite(prevLat) && Number.isFinite(prevLng);

      if (hasPrevCoords) {
        finalLat = prevLat;
        finalLng = prevLng;
        coordsSource = "previous_row";
      }
    }

    if (!Number.isFinite(finalLat as any) || !Number.isFinite(finalLng as any)) {
      return json(400, {
        ok: false,
        code: "MISSING_COORDS_AND_NO_PREVIOUS_LOCATION",
        driver_id: driverId,
        previous_status: previousStatus || null,
      });
    }

    const upsertPayload: any = {
      driver_id: driverId,
      lat: finalLat,
      lng: finalLng,
      status,
      town: town || null,
      updated_at: nowIso,
    };

    if ((prevLoc as any)?.id) {
      upsertPayload.id = (prevLoc as any).id;
    }

    const { error: upErr } = await supabase
      .from("driver_locations")
      .upsert(upsertPayload, { onConflict: "driver_id", ignoreDuplicates: false });

    if (upErr) {
      return json(500, {
        ok: false,
        code: "INSERT_FAILED",
        message: upErr.message,
        detail: {
          driver_id: driverId,
          has_incoming_coords: hasIncomingCoords,
          used_previous_coords: !hasIncomingCoords,
          sent_id: !!upsertPayload.id,
        },
      });
    }

    console.log("[DISPATCH_TRACE] ping:upsert_result", {
      driver_id: driverId,
      auth_mode: authRes.authMode,
      previous_status: previousStatus || null,
      current_status: status,
      coords_source: coordsSource,
    });

    const becameOnline = previousStatus !== "online" && status === "online";

    let retryResult: any = {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "NOT_ONLINE_EDGE",
    };

    if (becameOnline) {
      const baseUrl = envAny([
        "INTERNAL_BASE_URL",
        "NEXT_PUBLIC_BASE_URL",
        "NEXTAUTH_URL",
      ]);
      retryResult = await triggerRetryAutoAssign(baseUrl);
    }

    console.log("[DISPATCH_TRACE] ping:retry_result", {
      driver_id: driverId,
      auth_mode: authRes.authMode,
      became_online: becameOnline,
      retry_triggered: !!(retryResult?.attempted),
      retry_ok: !!(retryResult?.ok),
      retry_status: retryResult?.status ?? null,
    });

    return json(200, {
      ok: true,
      driver_id: driverId,
      auth_mode: authRes.authMode,
      status,
      previous_status: previousStatus || null,
      became_online: becameOnline,
      retry_triggered: !!(retryResult?.attempted),
      retry_ok: !!(retryResult?.ok),
      retry_result: retryResult,
      town: town || null,
      claimed: !!(lock as any).claimed,
      active_device_id: (lock as any).active_device_id,
      coords_source: coordsSource,
      lat: finalLat,
      lng: finalLng,
    });
  } catch (e: any) {
    return json(500, { ok: false, code: "SERVER_ERROR", message: e?.message ?? String(e) });
  }
}
