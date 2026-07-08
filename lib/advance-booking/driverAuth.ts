// lib/advance-booking/driverAuth.ts
//
// Driver authentication helper for Advance Booking API routes.
//
// Extracted from the proven pattern in app/api/driver/active-trip/route.ts.
// Every driver-facing Advance Booking endpoint starts with:
//
//   const auth = await resolveAuthenticatedDriver(req);
//   if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
//   const { driverId } = auth;
//
// Two supported auth modes (matches active-trip exactly):
//   1. Bearer token  -> Authorization: Bearer <supabase_access_token>
//   2. Driver secret -> x-jride-driver-secret: <DRIVER_PING_SECRET>
//                      + ?driver_id=<uuid> query param

import { NextRequest } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// -----------------------------------------------------------------
// Types
// -----------------------------------------------------------------

export interface DriverContext {
  ok: true;
  driverId: string;
  authMode: "bearer" | "driver_secret";
}

export interface DriverAuthFailure {
  ok: false;
  status: number;
  error: string;
  message: string;
}

export type DriverAuthResult = DriverContext | DriverAuthFailure;

// -----------------------------------------------------------------
// Supabase client factories
// Matches active-trip/route.ts exactly
// -----------------------------------------------------------------

function createAnonSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";
  if (!url || !anonKey)
    throw new Error(
      "Missing Supabase anon client environment variables."
    );
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function createServiceSupabase() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole)
    throw new Error(
      "Missing Supabase service role environment variables."
    );
  return createSupabaseClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// -----------------------------------------------------------------
// Helpers
// Copied verbatim from active-trip/route.ts
// -----------------------------------------------------------------

function s(v: unknown): string | null {
  const x = String(v ?? "").trim();
  return x.length > 0 ? x : null;
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const provided = s(req.headers.get("x-jride-driver-secret"));
  const expected =
    s(process.env.DRIVER_PING_SECRET) ??
    s(process.env.NEXT_PUBLIC_DRIVER_PING_SECRET);
  return !!provided && !!expected && provided === expected;
}

// Copied verbatim from active-trip/route.ts
// Tries driver_profiles.driver_id first (direct match),
// then falls back to email lookup via auth_users_view.
async function resolveDriverIdFromBearer(
  serviceSupabase: ReturnType<typeof createServiceSupabase>,
  authUserId: string
): Promise<string | null> {
  const directProfile = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("driver_id", authUserId)
    .limit(1)
    .maybeSingle();

  if (!directProfile.error && directProfile.data?.driver_id) {
    return s(directProfile.data.driver_id);
  }

  const authUser = await serviceSupabase
    .from("auth_users_view")
    .select("email")
    .eq("id", authUserId)
    .limit(1)
    .maybeSingle();

  const email = s((authUser.data as any)?.email);
  if (!email) return null;

  const byEmail = await serviceSupabase
    .from("driver_profiles")
    .select("driver_id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (!byEmail.error && byEmail.data?.driver_id) {
    return s(byEmail.data.driver_id);
  }

  return null;
}

// -----------------------------------------------------------------
// Main export
// -----------------------------------------------------------------

export async function resolveAuthenticatedDriver(
  req: NextRequest
): Promise<DriverAuthResult> {
  try {
    const serviceSupabase = createServiceSupabase();
    const accessToken = getBearerToken(req);

    let driverId: string | null = null;
    let authMode: "bearer" | "driver_secret" | null = null;

    if (accessToken) {
      // Bearer token path: validate with Supabase auth, then resolve driver_id
      const authSupabase = createAnonSupabase();
      const { data: userRes, error: userErr } =
        await authSupabase.auth.getUser(accessToken);
      const user = userRes?.user ?? null;

      if (userErr || !user?.id) {
        return {
          ok: false,
          status: 401,
          error: "NOT_AUTHED",
          message: "Invalid bearer token.",
        };
      }

      driverId = await resolveDriverIdFromBearer(serviceSupabase, user.id);
      authMode = "bearer";
    } else if (isDriverSecretAuthorized(req)) {
      // Driver secret path: driver_id comes from query param
      driverId = s(req.nextUrl.searchParams.get("driver_id"));
      authMode = "driver_secret";
    } else {
      return {
        ok: false,
        status: 401,
        error: "NOT_AUTHED",
        message: "Missing bearer token or valid driver secret.",
      };
    }

    if (!driverId) {
      return {
        ok: false,
        status: 404,
        error: "DRIVER_NOT_FOUND",
        message:
          authMode === "driver_secret"
            ? "Missing driver_id query parameter."
            : "No driver profile found for token user.",
      };
    }

    return { ok: true, driverId, authMode };
  } catch (err: any) {
    return {
      ok: false,
      status: 500,
      error: "AUTH_ERROR",
      message: err?.message ?? "Authentication failed.",
    };
  }
}

// -----------------------------------------------------------------
// Cache-control helper for driver routes
// Copied from active-trip/route.ts
// -----------------------------------------------------------------

export function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}
