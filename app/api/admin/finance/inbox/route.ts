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

    const limit = Math.max(1, Math.min(50, Number(req.nextUrl.searchParams.get("limit") || 50)));

    const eventsRes = await adminSb
      .from("finance_events")
      .select(`
        id,
        company_id,
        business_unit_id,
        location_id,
        source_type,
        source_id,
        event_type,
        status,
        town,
        payload,
        journal_entry_id,
        processed_at,
        created_at,
        core_business_units:business_unit_id(code,name),
        core_locations:location_id(code,name)
      `)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (eventsRes.error) {
      return json(500, {
        ok: false,
        error: "FINANCE_INBOX_READ_FAILED",
        message: eventsRes.error.message,
      });
    }

    const rows = Array.isArray(eventsRes.data) ? eventsRes.data : [];

    const summary = {
      pending: rows.filter((r: any) => r.status === "pending").length,
      needs_review: rows.filter((r: any) => r.status === "failed").length,
      approved_today: 0,
      rejected: 0,
      failed: rows.filter((r: any) => r.status === "failed").length,
      posted: rows.filter((r: any) => !!r.journal_entry_id).length,
    };

    return json(200, {
      ok: true,
      summary,
      rows: rows.map((r: any) => ({
        id: r.id,
        status: r.status,
        business_event: r.event_type,
        finance_event: r.event_type,
        source_module: r.source_type,
        source_id: r.source_id,
        business_unit: r.core_business_units?.name || null,
        location: r.core_locations?.name || r.town || null,
        amount: r.payload?.amount ?? r.payload?.commission_amount ?? r.payload?.total_amount ?? null,
        posting_rule: null,
        rule_version: null,
        warnings: [],
        created_at: r.created_at,
        processed_at: r.processed_at,
        journal_entry_id: r.journal_entry_id,
      })),
      meta: {
        limit,
        requester: requesterEmail || requesterId,
      },
    });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e || "error") });
  }
}
