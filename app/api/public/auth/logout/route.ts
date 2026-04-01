import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function clearAllCookies(req: NextRequest, res: NextResponse) {
  const all = req.cookies.getAll();
  for (const c of all) {
    try {
      res.cookies.set({
        name: c.name,
        value: "",
        path: "/",
        expires: new Date(0),
      });
    } catch {}
  }
  for (const c of all) {
    try {
      res.cookies.set({
        name: c.name,
        value: "",
        path: "/api",
        expires: new Date(0),
      });
    } catch {}
  }
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function getDeviceId(req: NextRequest): string {
  return String(
    req.headers.get("x-device-id") ||
    req.nextUrl.searchParams.get("device_id") ||
    ""
  ).trim();
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
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function handle(req: NextRequest) {
  const res = NextResponse.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
  );
  clearAllCookies(req, res);

  try {
    const token = getBearerToken(req);
    const deviceId = getDeviceId(req);
    if (!token || !deviceId) return res;

    const anonSupabase = createAnonSupabase();
    const userRes = await anonSupabase.auth.getUser(token);
    const user = userRes.data?.user ?? null;
    if (!user?.id) return res;

    await anonSupabase.rpc("jride_passenger_sign_out_device", {
      p_user_id: user.id,
      p_device_id: deviceId,
    });
  } catch {}

  return res;
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}