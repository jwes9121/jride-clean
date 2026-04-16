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

async function getAuthorizedAdminClient() {
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

  if (!url) return { ok: false, status: 500, error: "Missing SUPABASE_URL" };
  if (!anon) return { ok: false, status: 500, error: "Missing SUPABASE_ANON_KEY" };
  if (!service) return { ok: false, status: 500, error: "Missing SUPABASE_SERVICE_ROLE_KEY" };

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
    return { ok: false, status: 401, error: "Not signed in" };
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
    return { ok: false, status: 403, error: "Forbidden (admin/dispatcher only)." };
  }

  return {
    ok: true,
    adminSb,
    requesterId,
    requesterEmail,
    isAdmin,
    isDispatcher,
  };
}

export async function POST(req: Request) {
  try {
    const auth: any = await getAuthorizedAdminClient();
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const body = await req.json().catch(() => ({}));
    const passenger_id = body?.passenger_id ? String(body.passenger_id) : "";
    const admin_notes = body?.admin_notes ? String(body.admin_notes) : null;

    if (!passenger_id) {
      return NextResponse.json({ ok: false, error: "Missing passenger_id" }, { status: 400 });
    }

    const admin = auth.adminSb;
    const upd = await admin
      .from("passenger_verification_requests")
      .update({
        status: "pending_admin",
        reviewed_at: new Date().toISOString(),
        reviewed_by: auth.requesterId,
        admin_notes,
      })
      .eq("passenger_id", passenger_id)
      .eq("status", "submitted")
      .select("*")
      .single();

    if (upd.error) {
      return NextResponse.json({ ok: false, error: upd.error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, row: upd.data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
