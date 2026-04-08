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

type RequesterDebug = {
  nextAuthEmail: string | null;
  supaEmail: string | null;
  supaUserId: string | null;
  supaRole: string | null;
  effectiveEmail: string | null;
  adminEmails: string[];
  dispatcherEmails: string[];
  adminUserIds: string[];
  dispatcherUserIds: string[];
  matchedByEmail: boolean;
  matchedByUserId: boolean;
  matchedByRole: boolean;
};

function envList(primaryName: string, secondaryName?: string): string[] {
  const joined = [process.env[primaryName], secondaryName ? process.env[secondaryName] : undefined]
    .filter(Boolean)
    .join(",");
  return joined
    .split(",")
    .map((v) => String(v || "").trim().toLowerCase())
    .filter(Boolean);
}

function normalizeEmail(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase();
  return v ? v : null;
}

function normalizeId(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase();
  return v ? v : null;
}

function normalizeRole(value: unknown): string | null {
  const v = String(value || "").trim().toLowerCase();
  return v ? v : null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error("Missing env: " + name);
  }
  return value;
}

async function getSupabaseUser() {
  const url = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const cookieStore = await cookies();
  const supabase = createServerClient(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set() {},
      remove() {},
    },
  });

  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

  if (!url) {
    throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  }
  if (!key) {
    throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY");
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function resolveRequester() {
  const session = await auth().catch(() => null);
  const nextAuthEmail = normalizeEmail(session?.user?.email);

  const supaUser = await getSupabaseUser().catch(() => null);
  const supaEmail = normalizeEmail(supaUser?.email);
  const supaUserId = normalizeId(supaUser?.id);
  const supaRole = normalizeRole(
    (supaUser?.user_metadata as Record<string, unknown> | undefined)?.role ??
    (supaUser?.app_metadata as Record<string, unknown> | undefined)?.role
  );

  const effectiveEmail = nextAuthEmail || supaEmail;

  const adminEmails = envList("JRIDE_ADMIN_EMAILS", "ADMIN_EMAILS");
  const dispatcherEmails = envList("JRIDE_DISPATCHER_EMAILS", "DISPATCHER_EMAILS");
  const adminUserIds = envList("JRIDE_ADMIN_USER_IDS");
  const dispatcherUserIds = envList("JRIDE_DISPATCHER_USER_IDS");

  const matchedByEmail = !!effectiveEmail && (adminEmails.includes(effectiveEmail) || dispatcherEmails.includes(effectiveEmail));
  const matchedByUserId = !!supaUserId && (adminUserIds.includes(supaUserId) || dispatcherUserIds.includes(supaUserId));
  const matchedByRole = supaRole === "admin" || supaRole === "dispatcher";

  const debug: RequesterDebug = {
    nextAuthEmail,
    supaEmail,
    supaUserId,
    supaRole,
    effectiveEmail,
    adminEmails,
    dispatcherEmails,
    adminUserIds,
    dispatcherUserIds,
    matchedByEmail,
    matchedByUserId,
    matchedByRole,
  };

  return {
    hasAnyIdentity: Boolean(effectiveEmail || supaUserId),
    allowed: matchedByEmail || matchedByUserId || matchedByRole,
    debug,
  };
}

export async function GET(req: NextRequest) {
  try {
    const requester = await resolveRequester();
    const url = new URL(req.url);
    const debugMode = url.searchParams.get("debug") === "1";

    if (!requester.hasAnyIdentity) {
      return NextResponse.json(
        {
          ok: false,
          error: "Not signed in.",
          debug: debugMode ? requester.debug : undefined,
        },
        { status: 401 }
      );
    }

    if (!requester.allowed) {
      return NextResponse.json(
        {
          ok: false,
          error: "Forbidden (admin/dispatcher only).",
          debug: debugMode ? requester.debug : undefined,
        },
        { status: 403 }
      );
    }

    const limitRaw = Number(url.searchParams.get("limit") || "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
    const ratingFilterRaw = String(url.searchParams.get("rating") || "").trim();

    const service = getServiceClient();

    let query = service
      .from("trip_ratings")
      .select("id, booking_id, booking_code, rating, feedback, created_at, driver_id, passenger_id")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (ratingFilterRaw) {
      const ratingFilter = Number(ratingFilterRaw);
      if (Number.isFinite(ratingFilter)) {
        query = query.eq("rating", ratingFilter);
      }
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          error: error.message || "Failed to load ratings.",
          debug: debugMode ? requester.debug : undefined,
        },
        { status: 500 }
      );
    }

    const rows = Array.isArray(data) ? (data as RatingRow[]) : [];
    const total = rows.length;
    const average = total > 0
      ? rows.reduce((sum, row) => sum + Number(row.rating || 0), 0) / total
      : 0;
    const withFeedback = rows.filter((row) => String(row.feedback || "").trim() !== "").length;
    const stars5 = rows.filter((row) => Number(row.rating || 0) === 5).length;
    const stars4 = rows.filter((row) => Number(row.rating || 0) === 4).length;
    const stars3 = rows.filter((row) => Number(row.rating || 0) === 3).length;
    const stars2 = rows.filter((row) => Number(row.rating || 0) === 2).length;
    const stars1 = rows.filter((row) => Number(row.rating || 0) === 1).length;

    return NextResponse.json({
      ok: true,
      stats: {
        total_ratings: total,
        average_rating: average,
        with_feedback: withFeedback,
        stars_5: stars5,
        stars_4: stars4,
        stars_3: stars3,
        stars_2: stars2,
        stars_1: stars1,
        five_star_share: total > 0 ? stars5 / total : null,
      },
      rows,
      debug: debugMode ? requester.debug : undefined,
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