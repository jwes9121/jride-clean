import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export function passengerJson(status: number, body: any) {
  return NextResponse.json(body, { status, headers: {
    "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache",
    Vary: "Authorization, Cookie",
  } });
}

export async function requirePassenger(req: Request): Promise<
  { ok: true; user: any } | { ok: false; response: NextResponse }
> {
  const denied = () => ({ ok: false as const, response: passengerJson(401, {
    ok: false, error: "PASSENGER_AUTH_REQUIRED", message: "Please sign in again.",
  }) });
  try {
    const authorization = req.headers.get("authorization");
    let user: any;
    if (authorization !== null) {
      const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
      if (!match) return denied();
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
      if (!url || !key) throw new Error("Authentication unavailable");
      const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const result = await client.auth.getUser(match[1]);
      if (result.error || !result.data?.user?.id) return denied();
      user = result.data.user;
      const deviceId = String(req.headers.get("x-device-id") || "").trim();
      if (deviceId) {
        const session = await supabaseAdmin({ noStore: true }).rpc("jride_passenger_validate_device_session", {
          p_user_id: user.id, p_device_id: deviceId,
        });
        if (session.error) throw new Error("Session validation unavailable");
        if (!session.data?.ok) return denied();
      }
    } else {
      const result = await createCookieClient().auth.getUser();
      if (result.error || !result.data?.user?.id) return denied();
      user = result.data.user;
    }
    return { ok: true, user };
  } catch {
    return { ok: false, response: passengerJson(503, {
      ok: false, error: "PASSENGER_AUTH_UNAVAILABLE",
      message: "Sign-in verification is temporarily unavailable. Please try again.",
    }) };
  }
}
