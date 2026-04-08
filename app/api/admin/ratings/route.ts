import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

type RatingRow = {
  id: string;
  booking_id: string | null;
  booking_code: string | null;
  rating: number | null;
  feedback: string | null;
  created_at: string | null;
  driver_id: string | null;
  passenger_id: string | null;
};

function envList(nameA: string, nameB?: string): string[] {
  const raw = [process.env[nameA], nameB ? process.env[nameB] : undefined]
    .filter(Boolean)
    .join(",");
  return raw
    .split(",")
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasAllowedEmail(email: string | null | undefined): boolean {
  const probe = String(email || "").trim().toLowerCase();
  if (!probe) return false;
  const admins = envList("JRIDE_ADMIN_EMAILS", "ADMIN_EMAILS");
  const dispatchers = envList("JRIDE_DISPATCHER_EMAILS", "DISPATCHER_EMAILS");
  return admins.includes(probe) || dispatchers.includes(probe);
}

function hasAllowedUserId(userId: string | null | undefined): boolean {
  const probe = String(userId || "").trim().toLowerCase();
  if (!probe) return false;
  const admins = envList("JRIDE_ADMIN_USER_IDS");
  const dispatchers = envList("JRIDE_DISPATCHER_USER_IDS");
  return admins.includes(probe) || dispatchers.includes(probe);
}

function hasAllowedRole(role: unknown): boolean {
  const probe = String(role || "").trim().toLowerCase();
  return probe === "admin" || probe === "dispatcher";
}

function getRequiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error("Missing env: " + name);
  return v;
}

async function getSupabaseUser() {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStore = await cookies();
  const sb = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

function getService() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY;

  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY");

  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolveRequester() {
  const session = await auth().catch(() => null);
  const nextAuthEmail = String(session?.user?.email || "").trim().toLowerCase() || null;

  const supaUser = await getSupabaseUser().catch(() => null);
  const supaEmail = String(supaUser?.email || "").trim().toLowerCase() || null;
  const supaUserId = supaUser?.id ? String(supaUser.id) : null;
  const supaRole =
    (supaUser?.user_metadata as Record<string, unknown> | undefined)?.role ??
    (supaUser?.app_metadata as Record<string, unknown> | undefined)?.role ??
    null;

  const effectiveEmail = nextAuthEmail || supaEmail || null;

  const allowed =
    hasAllowedEmail(effectiveEmail) ||
    hasAllowedUserId(supaUserId) ||
    hasAllowedRole(supaRole);

  return {
    allowed,
    effectiveEmail,
    nextAuthEmail,
    supaEmail,
    supaUserId,
    supaRole,
    hasAnyIdentity: Boolean(effectiveEmail || supaUserId),
  };
}

export async function GET(req: NextRequest) {
  try {
    const requester = await resolveRequester();

    if (!requester.hasAnyIdentity) {
      return NextResponse.json(
        { ok: false, error: "Not signed in." },
        { status: 401 }
      );
    }

    if (!requester.allowed) {
      return NextResponse.json(
        { ok: false, error: "Forbidden (admin/dispatcher only)." },
        { status: 403 }
      );
    }

    const url = new URL(req.url);
    const limitRaw = Number(url.searchParams.get("limit") || "50");
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), 200)
      : 50;

    const ratingFilter = (url.searchParams.get("rating") || "").trim();

    const service = getService();

    let query = service
      .from("trip_ratings")
      .select("id, booking_id, booking_code, rating, feedback, created_at, driver_id, passenger_id")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (ratingFilter) {
      const parsed = Number(ratingFilter);
      if (Number.isFinite(parsed)) {
        query = query.eq("rating", parsed);
      }
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || "Failed to load ratings." },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? (data as RatingRow[]) : [];

    const stats = {
      total: rows.length,
      average_rating:
        rows.length > 0
          ? rows.reduce((sum, r) => sum + Number(r.rating || 0), 0) / rows.length
          : 0,
      with_feedback: rows.filter((r) => String(r.feedback || "").trim() !== "").length,
      stars_5: rows.filter((r) => Number(r.rating || 0) === 5).length,
      stars_4: rows.filter((r) => Number(r.rating || 0) === 4).length,
      stars_3: rows.filter((r) => Number(r.rating || 0) === 3).length,
      stars_2: rows.filter((r) => Number(r.rating || 0) === 2).length,
      stars_1: rows.filter((r) => Number(r.rating || 0) === 1).length,
    };

    return NextResponse.json({
      ok: true,
      stats,
      rows,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
