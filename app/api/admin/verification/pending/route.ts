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

export async function GET() {
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
  if (!service) {
    return NextResponse.json(
      { ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 }
    );
  }

  // 1) Who is calling? (Supabase cookie session)
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

  if (!requesterId) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

  // 2) Service-role client for privileged operations
  const adminSb = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Allowlists + metadata role fallback
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

  // Queue counts
  const submittedCountRes = await adminSb
    .from("passenger_verification_requests")
    .select("passenger_id", { count: "exact", head: true })
    .eq("status", "submitted");

  const pendingAdminCountRes = await adminSb
    .from("passenger_verification_requests")
    .select("passenger_id", { count: "exact", head: true })
    .eq("status", "pending_admin");

  if (submittedCountRes.error) {
    return NextResponse.json({ ok: false, error: submittedCountRes.error.message }, { status: 500 });
  }
  if (pendingAdminCountRes.error) {
    return NextResponse.json({ ok: false, error: pendingAdminCountRes.error.message }, { status: 500 });
  }

  // Rows for each queue
  const submittedRowsRes = await adminSb
    .from("passenger_verification_requests")
    .select("passenger_id, full_name, town, status, submitted_at, id_front_path, selfie_with_id_path, admin_notes")
    .eq("status", "submitted")
    .order("submitted_at", { ascending: true });

  const pendingAdminRowsRes = await adminSb
    .from("passenger_verification_requests")
    .select("passenger_id, full_name, town, status, submitted_at, reviewed_at, reviewed_by, admin_notes, id_front_path, selfie_with_id_path")
    .eq("status", "pending_admin")
    .order("submitted_at", { ascending: true });

  if (submittedRowsRes.error) {
    return NextResponse.json({ ok: false, error: submittedRowsRes.error.message }, { status: 500 });
  }
  if (pendingAdminRowsRes.error) {
    return NextResponse.json({ ok: false, error: pendingAdminRowsRes.error.message }, { status: 500 });
  }

  const ID_BUCKET = env("JRIDE_ID_BUCKET") || "passenger-ids";
  const SELFIE_BUCKET = env("JRIDE_SELFIE_BUCKET") || "passenger-selfies";
  const EXPIRES = 60 * 10;

  async function attachSignedUrls(r: any) {
    let id_front_signed_url: string | null = null;
    let selfie_signed_url: string | null = null;

    const idPath = r?.id_front_path ? String(r.id_front_path) : "";
    const sfPath = r?.selfie_with_id_path ? String(r.selfie_with_id_path) : "";

    if (idPath) {
      const s = await adminSb.storage.from(ID_BUCKET).createSignedUrl(idPath, EXPIRES);
      if (!s.error) id_front_signed_url = s.data?.signedUrl || null;
    }
    if (sfPath) {
      const s = await adminSb.storage.from(SELFIE_BUCKET).createSignedUrl(sfPath, EXPIRES);
      if (!s.error) selfie_signed_url = s.data?.signedUrl || null;
    }

    return { ...r, id_front_signed_url, selfie_signed_url };
  }

  const submittedRows = await Promise.all((submittedRowsRes.data || []).map(attachSignedUrls));
  const pendingAdminRows = await Promise.all((pendingAdminRowsRes.data || []).map(attachSignedUrls));

  return NextResponse.json({
    ok: true,
    counts: {
      submitted: submittedCountRes.count || 0,
      pending_admin: pendingAdminCountRes.count || 0,
    },
    rows: {
      submitted: submittedRows,
      pending_admin: pendingAdminRows,
    },
  });
}