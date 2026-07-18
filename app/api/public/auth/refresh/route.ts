import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

function json(
  body: Record<string, unknown>,
  status: number
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function cleanRequiredString(raw: unknown): string {
  return String(raw ?? "").trim();
}

function createAnonSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY"
    );
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));

    const refreshToken = cleanRequiredString(body.refresh_token);
    const deviceId = cleanRequiredString(body.device_id);

    if (!refreshToken) {
      return json(
        {
          ok: false,
          error: "REFRESH_TOKEN_REQUIRED",
        },
        400
      );
    }

    if (!deviceId) {
      return json(
        {
          ok: false,
          error: "DEVICE_ID_REQUIRED",
        },
        400
      );
    }

    const supabase = createAnonSupabase();

    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });

    if (error || !data.session || !data.user) {
      return json(
        {
          ok: false,
          error: "REFRESH_FAILED",
        },
        401
      );
    }

    const validateRes = await supabase.rpc(
      "jride_passenger_validate_device_session",
      {
        p_user_id: data.user.id,
        p_device_id: deviceId,
      }
    );

    if (validateRes.error) {
      return json(
        {
          ok: false,
          error: "DEVICE_SESSION_VALIDATE_FAILED",
        },
        401
      );
    }

    const deviceSession = validateRes.data as {
      ok?: boolean;
      error?: string;
      auth_version?: number;
    } | null;

    if (!deviceSession?.ok) {
      return json(
        {
          ok: false,
          error:
            deviceSession?.error || "ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE",
        },
        401
      );
    }

    const session = data.session;

    return json(
      {
        ok: true,
        user_id: data.user.id,
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in:
          typeof session.expires_in === "number"
            ? session.expires_in
            : null,
        expires_at:
          typeof session.expires_at === "number"
            ? session.expires_at
            : null,
        token_type: session.token_type || "bearer",
        device_session: {
          auth_version:
            typeof deviceSession.auth_version === "number"
              ? deviceSession.auth_version
              : null,
        },
      },
      200
    );
  } catch {
    return json(
      {
        ok: false,
        error: "REFRESH_ROUTE_FAILED",
      },
      500
    );
  }
}
