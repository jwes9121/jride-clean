import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { dryRunPostingEngine } from "@/lib/finance/postingEngine";

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

export async function GET(req: NextRequest) {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const anon = env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_KEY");
    const service = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE") || env("SUPABASE_SERVICE_KEY");

    if (!url || !anon || !service) {
      return NextResponse.json(
        { ok: false, error: "SERVER_MISCONFIG" },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
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
      return NextResponse.json(
        { ok: false, error: "NOT_SIGNED_IN" },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const adminSb = createClient(url, service, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const okAdmin = await isRequesterAdmin(adminSb, requesterId, requesterEmail);

    if (!okAdmin) {
      return NextResponse.json(
        { ok: false, error: "FORBIDDEN" },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const financeEventId = String(req.nextUrl.searchParams.get("finance_event_id") || "").trim();

    if (!financeEventId) {
      return NextResponse.json(
        { ok: false, error: "finance_event_id required" },
        {
          status: 400,
          headers: {
            "Cache-Control": "no-store",
          },
        }
      );
    }

    const result = await dryRunPostingEngine({
      adminSb,
      financeEventId,
    });

    const blockingWarnings =
      (result as any).warnings?.filter((w: any) => w.severity === "blocking") || [];

    return NextResponse.json(
      {
        ...result,
        ready_to_approve:
          result.ok === true &&
          blockingWarnings.length === 0 &&
          (result as any).totals?.debit === (result as any).totals?.credit,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(e?.message || e || "error"),
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
