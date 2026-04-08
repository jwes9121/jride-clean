import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function parseCsv(v: string) {
  return String(v || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toLowerList(xs: string[]) {
  return xs.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isInList(val: string | null | undefined, list: string[]) {
  const v = String(val || "").trim();
  if (!v) return false;
  return list.includes(v);
}

function isEmailInList(email: string | null | undefined, listLower: string[]) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return listLower.includes(e);
}

function toIsoDate(v: string | null) {
  const s = String(v || "").trim();
  if (!s) return "";
  return s;
}

function toNumber(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function buildQuery(params: URLSearchParams) {
  const qs = new URLSearchParams();
  qs.set("select", "id,booking_id,booking_code,driver_id,passenger_id,rating,feedback,created_at");
  qs.set("order", "created_at.desc");

  const limitRaw = parseInt(params.get("limit") || "100", 10);
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 100, 500));
  qs.set("limit", String(limit));

  const rating = String(params.get("rating") || "").trim();
  if (rating) qs.set("rating", "eq." + rating);

  const from = toIsoDate(params.get("from"));
  if (from) qs.set("created_at", "gte." + from);

  const to = toIsoDate(params.get("to"));
  if (to) qs.append("created_at", "lte." + to);

  return qs;
}

async function getRoleFromMetadata(adminSb: any, userId: string) {
  try {
    const u = await adminSb.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    const isAdmin = md?.is_admin === true || role === "admin";
    const isDispatcher = role === "dispatcher";
    return { isAdmin, isDispatcher };
  } catch {
    return { isAdmin: false, isDispatcher: false };
  }
}

export async function GET(req: Request) {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const anon =
      env("SUPABASE_ANON_KEY") ||
      env("NEXT_PUBLIC_SUPABASE_ANON_KEY") ||
      env("NEXT_PUBLIC_SUPABASE_KEY") ||
      "";
    const service =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("SUPABASE_SERVICE_ROLE") ||
      env("SUPABASE_SERVICE_KEY") ||
      "";

    if (!url) return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL" }, { status: 500 });
    if (!anon) return NextResponse.json({ ok: false, error: "Missing SUPABASE_ANON_KEY" }, { status: 500 });
    if (!service) return NextResponse.json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" }, { status: 500 });

    const cookieStore = cookies();
    const userSb = createServerClient(url, anon, {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
      },
    });

    const { data: userData } = await userSb.auth.getUser();
    const user = userData?.user;
    const requesterId = user?.id ? String(user.id) : "";
    const requesterEmail = user?.email ? String(user.email) : "";

    if (!requesterId) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
    }

    const adminSb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const adminIds = parseCsv(env("JRIDE_ADMIN_USER_IDS") || env("ADMIN_USER_IDS"));
    const dispatcherIds = parseCsv(env("JRIDE_DISPATCHER_USER_IDS") || env("DISPATCHER_USER_IDS"));
    const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));
    const dispatcherEmailsLower = toLowerList(parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS")));

    let isAdmin = isInList(requesterId, adminIds) || isEmailInList(requesterEmail, adminEmailsLower);
    let isDispatcher = isInList(requesterId, dispatcherIds) || isEmailInList(requesterEmail, dispatcherEmailsLower);

    if (!isAdmin && !isDispatcher) {
      const md = await getRoleFromMetadata(adminSb, requesterId);
      isAdmin = md.isAdmin;
      isDispatcher = md.isDispatcher;
    }

    if (!isAdmin && !isDispatcher) {
      return NextResponse.json({ ok: false, error: "Forbidden (admin/dispatcher only)." }, { status: 403 });
    }

    const reqUrl = new URL(req.url);
    const restUrl = url + "/rest/v1/trip_ratings?" + buildQuery(reqUrl.searchParams).toString();

    const res = await fetch(restUrl, {
      headers: {
        apikey: service,
        Authorization: "Bearer " + service,
      },
      cache: "no-store",
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: "RATINGS_READ_FAILED", details: text }, { status: res.status });
    }

    let rows: any[] = [];
    try {
      rows = JSON.parse(text || "[]");
    } catch {
      rows = [];
    }

    const stats = {
      total: rows.length,
      average_rating: 0,
      by_star: {
        star_5: 0,
        star_4: 0,
        star_3: 0,
        star_2: 0,
        star_1: 0,
      },
      with_feedback: 0,
    };

    let sum = 0;
    for (const row of rows) {
      const rating = toNumber(row?.rating, 0);
      const feedback = String(row?.feedback || "").trim();
      if (rating >= 1 && rating <= 5) {
        sum += rating;
        if (rating === 5) stats.by_star.star_5++;
        if (rating === 4) stats.by_star.star_4++;
        if (rating === 3) stats.by_star.star_3++;
        if (rating === 2) stats.by_star.star_2++;
        if (rating === 1) stats.by_star.star_1++;
      }
      if (feedback) stats.with_feedback++;
    }

    if (stats.total > 0) {
      stats.average_rating = Number((sum / stats.total).toFixed(2));
    }

    return NextResponse.json(
      {
        ok: true,
        rows,
        stats,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}
