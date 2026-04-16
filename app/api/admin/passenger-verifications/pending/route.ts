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

async function signedUrl(storage: any, bucket: string, path: string | null | undefined) {
  if (!path) return null;
  const r = await storage.from(bucket).createSignedUrl(path, 3600);
  if (r.error || !r.data?.signedUrl) return null;
  return r.data.signedUrl;
}

export async function GET() {
  try {
    const auth: any = await getAuthorizedAdminClient();
    if (!auth.ok) {
      return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
    }

    const admin = auth.adminSb;

    const sub = await admin
      .from("passenger_verification_requests")
      .select("passenger_id,full_name,town,status,submitted_at,reviewed_at,reviewed_by,admin_notes,id_front_path,selfie_with_id_path")
      .eq("status", "submitted")
      .order("submitted_at", { ascending: false });

    const pad = await admin
      .from("passenger_verification_requests")
      .select("passenger_id,full_name,town,status,submitted_at,reviewed_at,reviewed_by,admin_notes,id_front_path,selfie_with_id_path")
      .eq("status", "pending_admin")
      .order("submitted_at", { ascending: false });

    if (sub.error) {
      return NextResponse.json({ ok: false, error: sub.error.message }, { status: 500 });
    }
    if (pad.error) {
      return NextResponse.json({ ok: false, error: pad.error.message }, { status: 500 });
    }

    const storage = admin.storage;

    async function enrich(rows: any[]) {
      const out = [];
      for (const r of rows || []) {
        const idUrl = await signedUrl(storage, "passenger-ids", r.id_front_path);
        const selfieUrl = await signedUrl(storage, "passenger-selfies", r.selfie_with_id_path);
        out.push({
          ...r,
          id_front_signed_url: idUrl,
          selfie_signed_url: selfieUrl,
          signed_url_note: "Signed URLs expire after 1 hour.",
        });
      }
      return out;
    }

    const submitted = await enrich(Array.isArray(sub.data) ? sub.data : []);
    const pending_admin = await enrich(Array.isArray(pad.data) ? pad.data : []);

    return NextResponse.json({
      ok: true,
      counts: {
        submitted: submitted.length,
        pending_admin: pending_admin.length,
      },
      rows: {
        submitted,
        pending_admin,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
