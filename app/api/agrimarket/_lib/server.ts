import { NextRequest, NextResponse } from "next/server";
import { createClient as createCookieSupabase } from "@/utils/supabase/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export type PassengerAuthResult =
  | { ok: true; user: any }
  | { ok: false; response: NextResponse };

export type ProducerAuthResult =
  | { ok: true; vendorId: string; producer: any }
  | { ok: false; response: NextResponse };

function envEnabled(value: string | undefined): boolean {
  const raw = String(value || "0").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function agrimarketEnabled(): boolean {
  return envEnabled(process.env.AGRIMARKET_ENABLED);
}

export function agrimarketDisabledResponse() {
  return jsonNoStore(503, {
    ok: false,
    enabled: false,
    error: "AGRIMARKET_DISABLED",
    message: "Agrimarket is prepared but not enabled yet.",
  });
}

export function jsonNoStore(status: number, payload: any) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      Pragma: "no-cache",
    },
  });
}

export function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

  if (!url || !key) {
    throw new Error("Missing Supabase service configuration.");
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function createAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    throw new Error("Missing Supabase anon configuration.");
  }

  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerToken(req: NextRequest): string | null {
  const value = req.headers.get("authorization") || "";
  if (!value.startsWith("Bearer ")) return null;
  const token = value.slice(7).trim();
  return token || null;
}

function passengerDeviceId(req: NextRequest): string | null {
  const value = String(req.headers.get("x-device-id") || "").trim();
  return value || null;
}

export async function requireAgrimarketPassenger(req: NextRequest): Promise<PassengerAuthResult> {
  const token = bearerToken(req);
  const deviceId = passengerDeviceId(req);

  if (token) {
    const anon = createAnonSupabase();
    const userRes = await anon.auth.getUser(token);
    const user = userRes.data?.user || null;

    if (!user) {
      return {
        ok: false,
        response: jsonNoStore(401, {
          ok: false,
          error: "PASSENGER_AUTH_REQUIRED",
          message: "Please sign in again.",
        }),
      };
    }

    if (deviceId) {
      const sessionRes = await anon.rpc("jride_passenger_validate_device_session", {
        p_user_id: user.id,
        p_device_id: deviceId,
      });

      if (sessionRes.error) {
        return {
          ok: false,
          response: jsonNoStore(503, {
            ok: false,
            error: "DEVICE_SESSION_VALIDATE_FAILED",
            message: "Passenger session validation is temporarily unavailable.",
          }),
        };
      }

      const session = sessionRes.data as any;
      if (!session?.ok) {
        return {
          ok: false,
          response: jsonNoStore(401, {
            ok: false,
            error: session?.error || "ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE",
            message: "Your passenger session is no longer active. Please sign in again.",
          }),
        };
      }
    }

    return { ok: true, user };
  }

  const cookieClient = createCookieSupabase();
  const userRes = await cookieClient.auth.getUser();
  const user = userRes.data?.user || null;

  if (!user) {
    return {
      ok: false,
      response: jsonNoStore(401, {
        ok: false,
        error: "PASSENGER_AUTH_REQUIRED",
        message: "Please sign in to use Agrimarket.",
      }),
    };
  }

  return { ok: true, user };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export async function requireAgrimarketProducer(req: NextRequest): Promise<ProducerAuthResult> {
  const vendorId = String(req.headers.get("x-jride-vendor-id") || "").trim();
  const accessPin = String(req.headers.get("x-jride-vendor-pin") || "").trim();

  if (!vendorId || !accessPin || !isUuid(vendorId)) {
    return {
      ok: false,
      response: jsonNoStore(401, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_AUTH_REQUIRED",
        message: "Valid producer credentials are required.",
      }),
    };
  }

  const admin = createServiceSupabase();
  const credentialRes = await admin
    .from("vendor_onboarding_credentials")
    .select("vendor_id,status")
    .eq("vendor_id", vendorId)
    .eq("access_pin", accessPin)
    .limit(1)
    .maybeSingle();

  if (credentialRes.error) {
    return {
      ok: false,
      response: jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_AUTH_FAILED",
        message: credentialRes.error.message,
      }),
    };
  }

  if (!credentialRes.data) {
    return {
      ok: false,
      response: jsonNoStore(401, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_AUTH_REQUIRED",
        message: "Valid producer credentials are required.",
      }),
    };
  }

  const producerRes = await admin
    .from("agrimarket_producers")
    .select("id,vendor_account_id,status,accepting_orders")
    .eq("vendor_account_id", vendorId)
    .limit(1)
    .maybeSingle();

  if (producerRes.error) {
    return {
      ok: false,
      response: jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_LOOKUP_FAILED",
        message: producerRes.error.message,
      }),
    };
  }

  if (!producerRes.data || String(producerRes.data.status || "").toLowerCase() !== "active") {
    return {
      ok: false,
      response: jsonNoStore(403, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_NOT_ACTIVE",
        message: "This vendor is not an active Agrimarket producer.",
      }),
    };
  }

  return { ok: true, vendorId, producer: producerRes.data };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
