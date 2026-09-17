import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function lower(v: unknown): string {
  return text(v).toLowerCase();
}

function json(status: number, payload: unknown) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
  });
}

function isUuid(v: unknown): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(v));
}

function isTimestamp(v: unknown): boolean {
  const raw = text(v);
  return Boolean(raw) && Number.isFinite(Date.parse(raw));
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

  if (!url || !key) {
    throw new Error("Missing Supabase service configuration.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function getDeviceId(req: NextRequest): string {
  return text(req.headers.get("x-device-id"));
}

function phoneFromAuthEmail(email: string | null): string | null {
  if (!email) return null;
  const match = /^p_(\d+)@phone\.jride\.local$/i.exec(email);
  if (!match) return null;
  return match[1].startsWith("63") ? `+${match[1]}` : match[1];
}

type TakeoutRequestUserResult =
  | { ok: true; user: any }
  | { ok: false; status: number; error: string; message: string };

async function getTakeoutRequestUser(
  req: NextRequest,
  admin: any,
): Promise<TakeoutRequestUserResult> {
  const token = getBearerToken(req);
  const deviceId = getDeviceId(req);

  // Android/native requests send both bearer token and device id. The bearer
  // identity is authoritative and must not fall back to a browser cookie when
  // the native token or device session is invalid.
  if (token && deviceId) {
    const bearer = await admin.auth.getUser(token).catch(() => null as any);
    const user = bearer?.data?.user || null;
    if (bearer?.error || !user) {
      return {
        ok: false,
        status: 401,
        error: "TAKEOUT_DECLINE_AUTH_REQUIRED",
        message: "Sign in again before declining the delivery fare.",
      };
    }

    const deviceSession = await admin.rpc("jride_passenger_validate_device_session", {
      p_user_id: user.id,
      p_device_id: deviceId,
    });

    if (deviceSession.error) {
      return {
        ok: false,
        status: 503,
        error: "TAKEOUT_DECLINE_DEVICE_SESSION_VALIDATE_FAILED",
        message: deviceSession.error.message,
      };
    }

    if (!(deviceSession.data as any)?.ok) {
      return {
        ok: false,
        status: 401,
        error: text((deviceSession.data as any)?.error) || "ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE",
        message: "This passenger session is no longer active on this device.",
      };
    }

    return { ok: true, user };
  }

  // Browser requests keep their existing cookie-session behavior.
  try {
    const cookieClient = createRouteHandlerClient({ cookies });
    const cookieUser = await cookieClient.auth.getUser();
    if (cookieUser?.data?.user) return { ok: true, user: cookieUser.data.user };
  } catch {}

  // Legacy browser pages may still carry only the passenger bearer token.
  if (token) {
    const bearer = await admin.auth.getUser(token).catch(() => null as any);
    if (bearer?.data?.user) return { ok: true, user: bearer.data.user };
  }

  // Preserve the pre-existing browser NextAuth fallback. Native requests with a
  // bearer + device id have already returned above and can never reach it.
  const nextSession = await auth().catch(() => null as any);
  const nextUser = (nextSession as any)?.user || null;
  if (nextUser) return { ok: true, user: nextUser };

  return {
    ok: false,
    status: 401,
    error: "TAKEOUT_DECLINE_AUTH_REQUIRED",
    message: "Sign in before declining the delivery fare.",
  };
}

async function resolvePassengerId(admin: any, requestUser: any): Promise<string | null> {
  const directId = text(requestUser?.id || requestUser?.user_id);
  if (isUuid(directId)) return directId;

  const email = text(requestUser?.email).toLowerCase() || null;
  const phone = text(requestUser?.phone) || phoneFromAuthEmail(email);
  const attempts: Array<{ column: "email" | "phone"; value: string | null }> = [
    { column: "email", value: email },
    { column: "phone", value: phone },
  ];

  for (const attempt of attempts) {
    if (!attempt.value) continue;
    const profile = await admin
      .from("passenger_profiles")
      .select("user_id")
      .eq(attempt.column, attempt.value)
      .limit(1)
      .maybeSingle();
    const profileUserId = text(profile?.data?.user_id);
    if (!profile?.error && isUuid(profileUserId)) return profileUserId;
  }

  return null;
}

function outcomeResponse(result: any) {
  const outcome = lower(result?.outcome);

  if (outcome === "declined" || outcome === "already_declined") {
    return json(200, {
      ok: true,
      outcome,
      idempotent: outcome === "already_declined",
      booking_id: result?.booking_id || null,
      booking_code: result?.booking_code || null,
      released_driver_id: result?.released_driver_id || null,
      driver_penalty: false,
      reassign: false,
    });
  }

  const responses: Record<string, { status: number; error: string; message: string }> = {
    unauthorized: {
      status: 401,
      error: "TAKEOUT_DECLINE_AUTH_REQUIRED",
      message: "Sign in before declining the delivery fare.",
    },
    order_required: {
      status: 400,
      error: "ORDER_REQUIRED",
      message: "order_id or booking_code is required.",
    },
    not_found: {
      status: 404,
      error: "TAKEOUT_ORDER_NOT_FOUND",
      message: "Takeout order not found.",
    },
    forbidden: {
      status: 403,
      error: "TAKEOUT_DECLINE_FORBIDDEN",
      message: "This Takeout order does not belong to the signed-in passenger.",
    },
    already_confirmed: {
      status: 409,
      error: "TAKEOUT_ALREADY_CONFIRMED",
      message: "The delivery fare was already confirmed and can no longer be declined here.",
    },
    inactive: {
      status: 409,
      error: "TAKEOUT_ORDER_INACTIVE",
      message: "This Takeout order is already completed or cancelled.",
    },
    proposal_expired: {
      status: 409,
      error: "TAKEOUT_FEE_PROPOSAL_EXPIRED",
      message: "The delivery fare proposal has expired. Refresh the order.",
    },
    proposal_changed: {
      status: 409,
      error: "TAKEOUT_PROPOSAL_CHANGED",
      message: "The delivery quote changed or is no longer active. Refresh and review the latest order state.",
    },
  };

  const mapped = responses[outcome] || {
    status: 409,
    error: "TAKEOUT_DECLINE_REJECTED",
    message: "The delivery fare could not be declined in the current order state.",
  };

  return json(mapped.status, { ok: false, error: mapped.error, message: mapped.message });
}

export async function POST(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const authResult = await getTakeoutRequestUser(req, serviceSupabase);

    if (!authResult.ok) {
      return json(authResult.status, {
        ok: false,
        error: authResult.error,
        message: authResult.message,
      });
    }

    const passengerId = await resolvePassengerId(serviceSupabase, authResult.user);
    if (!passengerId) {
      return json(401, {
        ok: false,
        error: "TAKEOUT_DECLINE_AUTH_REQUIRED",
        message: "JRide could not verify the signed-in passenger.",
      });
    }

    const body = await req.json().catch(() => ({}));
    const action = lower(body?.action);
    if (action !== "decline" && body?.decline !== true) {
      return json(400, {
        ok: false,
        error: "DECLINE_REQUIRED",
        message: "action=decline or decline=true is required.",
      });
    }

    const orderId = text(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id);
    const bookingCode = text(body?.booking_code || body?.bookingCode || body?.code);

    if (!orderId && !bookingCode) {
      return json(400, {
        ok: false,
        error: "ORDER_REQUIRED",
        message: "order_id or booking_code is required.",
      });
    }

    if (orderId && !isUuid(orderId)) {
      return json(400, {
        ok: false,
        error: "INVALID_ORDER_ID",
        message: "order_id is invalid.",
      });
    }

    const expected = body?.expected_proposal || null;
    const expectedProposedAt = text(expected?.proposed_at);
    const expectedExpiresAt = text(expected?.expires_at);
    const expectedDriverId = text(expected?.driver_id);
    const expectedTotal = Number(expected?.total);

    if (
      !expected ||
      !isTimestamp(expectedProposedAt) ||
      !isTimestamp(expectedExpiresAt) ||
      !isUuid(expectedDriverId) ||
      !Number.isFinite(expectedTotal) ||
      expectedTotal <= 0
    ) {
      return json(400, {
        ok: false,
        error: "EXPECTED_PROPOSAL_REQUIRED",
        message: "The exact delivery quote being declined is required.",
      });
    }

    const rpc = await serviceSupabase.rpc("decline_takeout_fare_proposal_v1", {
      p_passenger_id: passengerId,
      p_expected_proposed_at: expectedProposedAt,
      p_expected_expires_at: expectedExpiresAt,
      p_expected_total: expectedTotal,
      p_expected_driver_id: expectedDriverId,
      p_booking_id: orderId || null,
      p_booking_code: bookingCode || null,
    });

    if (rpc.error) {
      return json(500, {
        ok: false,
        error: "TAKEOUT_DECLINE_RPC_FAILED",
        message: rpc.error.message,
      });
    }

    return outcomeResponse(rpc.data);
  } catch (error: any) {
    return json(500, {
      ok: false,
      error: "TAKEOUT_DECLINE_FAILED",
      message: String(error?.message || error || "Failed to decline Takeout delivery fare."),
    });
  }
}
