import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

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

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

export async function GET(req: NextRequest) {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const anon = env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_KEY");
    const service = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE") || env("SUPABASE_SERVICE_KEY");

    if (!url) return json(500, { ok: false, error: "Missing SUPABASE_URL" });
    if (!anon) return json(500, { ok: false, error: "Missing SUPABASE_ANON_KEY" });
    if (!service) return json(500, { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" });

    const financeEventId = String(req.nextUrl.searchParams.get("finance_event_id") || "").trim();
    if (!financeEventId) {
      return json(400, { ok: false, error: "finance_event_id required" });
    }

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

    if (!requesterId) return json(401, { ok: false, error: "Not signed in" });

    const adminSb = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const okAdmin = await isRequesterAdmin(adminSb, requesterId, requesterEmail);
    if (!okAdmin) return json(403, { ok: false, error: "Forbidden (admin only)." });

    const runsRes = await adminSb
      .from("finance_posting_runs")
      .select(`
        id,
        company_id,
        finance_event_id,
        posting_rule_id,
        posting_rule_version_no,
        journal_entry_id,
        status,
        failure_code,
        failure_message,
        retry_count,
        last_retried_at,
        started_at,
        finished_at,
        created_at,
        created_by
      `)
      .eq("finance_event_id", financeEventId)
      .order("created_at", { ascending: true });

    if (runsRes.error) {
      return json(500, {
        ok: false,
        error: "FINANCE_POSTING_HISTORY_READ_FAILED",
        message: runsRes.error.message,
      });
    }

    const runs = Array.isArray(runsRes.data) ? runsRes.data : [];

    return json(200, {
      ok: true,
      finance_event_id: financeEventId,
      runs: runs.map((r: any, idx: number) => ({
        attempt: idx + 1,
        id: r.id,
        status: r.status,
        posting_rule_id: r.posting_rule_id,
        rule_version: r.posting_rule_version_no,
        failure_code: r.failure_code,
        failure_message: r.failure_message,
        retry_count: r.retry_count,
        last_retried_at: r.last_retried_at,
        started_at: r.started_at,
        finished_at: r.finished_at,
        journal_entry_id: r.journal_entry_id,
        created_at: r.created_at,
        created_by: r.created_by,
      })),
      meta: {
        requester: requesterEmail || requesterId,
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e || "error") });
  }
}
