import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type DriverRequestIdentity = {
  ok: boolean;
  driverId?: string;
  authMode?: "bearer" | "driver_secret";
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

  return { ok: false, error: "NOT_AUTHED", status: 401 };
}
