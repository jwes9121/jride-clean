import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type DriverRequestIdentity = {
  ok: boolean;
  driverId?: string;
  authMode?: "bearer" | "driver_secret" | "preview_device_lock";
  error?: string;
  status?: number;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function bearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function driverSecretAuthorized(req: Request): boolean {
  const supplied = text(req.headers.get("x-jride-driver-secret"));
  const expected = text(process.env.DRIVER_PING_SECRET);
  return !!supplied && !!expected && supplied === expected;
}

function previewNativeTestRequest(req: Request): boolean {
  return (
    text(process.env.VERCEL_ENV).toLowerCase() === "preview" &&
    text(req.headers.get("x-jride-agrimarket-native-test")) === "1" &&
    !!text(req.headers.get("x-jride-driver-secret"))
  );
}

async function previewDeviceLockAuthorized(
  req: Request,
  explicitDriverId?: string | null
): Promise<string | null> {
  if (!previewNativeTestRequest(req)) return null;

  const driverId = text(explicitDriverId);
  const deviceId = text(req.headers.get("x-jride-device-id"));
  if (!driverId || !deviceId) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(driverId)) {
    return null;
  }

  // Preview-only native dry runs can legitimately last well beyond 10 minutes.
  // Keep the device binding requirement, but allow a 24-hour lock age so the
  // test session does not lose auth halfway through an assigned delivery.
  // Production requests never enter this branch.
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const admin = supabaseAdmin();
  const lock = await admin
    .from("driver_device_locks")
    .select("driver_id")
    .eq("driver_id", driverId)
    .eq("device_id", deviceId)
    .gte("last_seen", cutoff)
    .limit(1)
    .maybeSingle();

  if (lock.error || !lock.data?.driver_id) return null;
  return text(lock.data.driver_id);
}

function anonClient() {
  const url = text(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const key = text(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  );

  if (!url || !key) throw new Error("SUPABASE_ANON_ENV_MISSING");

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolveDriverIdFromAuthUser(authUserId: string): Promise<string | null> {
  const admin = supabaseAdmin();

  const directProfile = await admin
    .from("driver_profiles")
    .select("driver_id")
    .eq("driver_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (!directProfile.error && directProfile.data?.driver_id) {
    return text(directProfile.data.driver_id);
  }

  const authUser = await admin
    .from("auth_users_view")
    .select("email")
    .eq("id", authUserId)
    .limit(1)
    .maybeSingle();

  const email = text((authUser.data as any)?.email);
  if (!email) return null;

  const byEmail = await admin
    .from("driver_profiles")
    .select("driver_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!byEmail.error && byEmail.data?.driver_id) {
    return text(byEmail.data.driver_id);
  }

  return null;
}

export async function resolveDriverRequest(
  req: Request,
  explicitDriverId?: string | null
): Promise<DriverRequestIdentity> {
  const token = bearerToken(req);

  if (token) {
    const auth = anonClient();
    const { data, error } = await auth.auth.getUser(token);
    const authUserId = text(data?.user?.id);

    if (error || !authUserId) {
      return { ok: false, error: "NOT_AUTHED", status: 401 };
    }

    const driverId = await resolveDriverIdFromAuthUser(authUserId);
    if (!driverId) {
      return { ok: false, error: "DRIVER_NOT_FOUND", status: 404 };
    }

    return { ok: true, driverId, authMode: "bearer" };
  }

  if (driverSecretAuthorized(req)) {
    const driverId = text(explicitDriverId);
    if (!driverId) {
      return { ok: false, error: "MISSING_DRIVER_ID", status: 400 };
    }
    return { ok: true, driverId, authMode: "driver_secret" };
  }

  const previewDriverId = await previewDeviceLockAuthorized(req, explicitDriverId);
  if (previewDriverId) {
    return { ok: true, driverId: previewDriverId, authMode: "preview_device_lock" };
  }

  return { ok: false, error: "NOT_AUTHED", status: 401 };
}
