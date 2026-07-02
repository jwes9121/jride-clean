import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { postFinanceEvent } from "@/lib/finance/postingEngine";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string) {
  const v = process.env[name];
  return v && String(v).trim() ? String(v).trim() : "";
}

function parseCsv(v: string) {
  return String(v || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function toLowerList(xs: string[]) {
  return xs.map((s) => s.trim().toLowerCase()).filter(Boolean);
}

function isInList(val: string | null | undefined, list: string[]) {
  const v = String(val || "").trim();
  return !!v && list.includes(v);
}

function isEmailInList(email: string | null | undefined, listLower: string[]) {
  const e = String(email || "").trim().toLowerCase();
  return !!e && listLower.includes(e);
}

async function isRequesterAdmin(adminSb: any, userId: string, email: string) {
  const adminIds = parseCsv(env("ADMIN_USER_IDS") || env("JRIDE_ADMIN_USER_IDS"));
  const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));

  if (isInList(userId, adminIds)) return true;
  if (isEmailInList(email, adminEmailsLower)) return true;

  try {
    const u = await adminSb.auth.admin.getUserById(userId);
    const md: any = u?.data?.user?.user_metadata || {};
    const role = String(md?.role || "").toLowerCase();
    if (md?.is_admin === true) return true;
    if (role === "admin") return true;
  } catch {}

  return false;
}

function noStore(body: any, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const anon = env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_KEY");
    const service = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE") || env("SUPABASE_SERVICE_KEY");

    if (!url || !anon || !service) {
      return noStore({ ok: false, error: "SERVER_MISCONFIG" }, 500);
    }

    const cookieStore = cookies();
    const userSb = createServerClient(url, anon, {
      cookies: {
        get(name) {
          return cookieStore.get(name)?.value;
        },
      },
    });

    const { data } = await userSb.auth.getUser();
    const requesterId = data?.user?.id || "";
    const requesterEmail = data?.user?.email || "";

    if (!requesterId) {
      return noStore({ ok: false, error: "NOT_SIGNED_IN" }, 401);
    }

    const adminSb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const okAdmin = await isRequesterAdmin(adminSb, requesterId, requesterEmail);
    if (!okAdmin) {
      return noStore({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const financeEventId = String(body?.finance_event_id || body?.financeEventId || "").trim();

    if (!financeEventId) {
      return noStore({ ok: false, error: "finance_event_id required" }, 400);
    }

    const postedBy = requesterEmail || requesterId;

    const result = await postFinanceEvent({
      adminSb,
      financeEventId,
      postedBy,
    });

    if (!result.ok) {
      const status = result.error === "event_already_posted" ? 409 : 400;
      return noStore(result, status);
    }

    return noStore(result, 200);
  } catch (e: any) {
    return noStore({ ok: false, error: String(e?.message || e || "error") }, 500);
  }
}