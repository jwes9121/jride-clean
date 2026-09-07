import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createHash } from "crypto";

export type DriverRequestIdentity = {
  ok: boolean;
  driverId?: string;
  authMode?: "bearer" | "driver_secret" | "device";
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
  explicitDriverId?: string | null,
  options: { requireBearer?: boolean } = {}
): Promise<DriverRequestIdentity> {
  const token = bearerToken(req);

  if (token?.startsWith("agdev.")) {
    // Device credentials are scoped to AgriMarket's requireBearer routes.
    if (!options.requireBearer || !new URL(req.url).pathname.startsWith("/api/driver/agrimarket/")) return { ok: false, error: "NOT_AUTHED", status: 401 };
    const parts = token.match(/^agdev\.([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([0-9a-f]{64})$/);
    const deviceId = text(req.headers.get("x-jride-device-id"));
    if (!parts || !/^[0-9a-f]{16}$/.test(deviceId)) return { ok: false, error: "NOT_AUTHED", status: 401 };
    const hash = createHash("sha256").update(parts[2], "utf8").digest("hex");
    // Approval and revocation must be read from the database on every request.
    // A dynamic route alone did not prevent this SDK lookup being cached.
    const result = await supabaseAdmin({ noStore: true }).from("agrimarket_driver_devices")
      .select("driver_id,device_id,status,created_at").eq("id", parts[1]).eq("token_sha256", hash).eq("device_id", deviceId).maybeSingle();
    if (result.error) return { ok: false, error: "DRIVER_AUTH_UNAVAILABLE", status: 503 };
    const row = result.data;
    if (!row || row.device_id !== deviceId) return { ok: false, error: "NOT_AUTHED", status: 401 };
    if (text(explicitDriverId) && text(explicitDriverId) !== row.driver_id) return { ok: false, error: "DRIVER_IDENTITY_MISMATCH", status: 403 };
    if (row.status === "pending") return { ok: false, error: Date.parse(row.created_at) < Date.now() - 86400000 ? "DRIVER_DEVICE_EXPIRED" : "DRIVER_DEVICE_PENDING", status: 403 };
    if (row.status !== "approved") return { ok: false, error: "DRIVER_DEVICE_REVOKED", status: 403 };
    return { ok: true, driverId: row.driver_id, authMode: "device" };
  }

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

    if (options.requireBearer && text(explicitDriverId) && text(explicitDriverId) !== driverId) {
      return { ok: false, error: "DRIVER_IDENTITY_MISMATCH", status: 403 };
    }
    return { ok: true, driverId, authMode: "bearer" };
  }

  if (!options.requireBearer && driverSecretAuthorized(req)) {
    const driverId = text(explicitDriverId);
    if (!driverId) {
      return { ok: false, error: "MISSING_DRIVER_ID", status: 400 };
    }
    return { ok: true, driverId, authMode: "driver_secret" };
  }

  return { ok: false, error: "NOT_AUTHED", status: 401 };
}
