import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  return (v && String(v).trim()) ? String(v).trim() : "";
}

function parseCsv(v: string) {
  return String(v || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
}

function toLowerList(xs: string[]) {
  return xs.map(s => s.trim().toLowerCase()).filter(Boolean);
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

async function getRoleFromMetadata(supabase: any, userId: string) {
  try {
    const u = await supabase.auth.admin.getUserById(userId);
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
  const session = await auth();
  const requesterId = session?.user?.id ? String(session.user.id) : "";
  const requesterEmail = session?.user?.email ? String(session.user.email) : "";

  if (!requesterId) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const service =
    env("SUPABASE_SERVICE_ROLE_KEY") ||
    env("SUPABASE_SERVICE_KEY") ||
    env("SUPABASE_SERVICE_ROLE") ||
    "";

  if (!url) return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL" }, { status: 500 });
  if (!service) {
    return NextResponse.json({ ok: false, error: "Missing SUPABASE_SERVICE_ROLE_KEY (required for private signed URLs)" }, { status: 500 });
  }

  const supabase = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Allowlists: IDs first (strongest), then email, then metadata fallback
  const adminIds = parseCsv(env("ADMIN_USER_IDS") || env("JRIDE_ADMIN_USER_IDS"));
  const dispatcherIds = parseCsv(env("DISPATCHER_USER_IDS") || env("JRIDE_DISPATCHER_USER_IDS"));

  const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));
  const dispatcherEmailsLower = toLowerList(parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS")));

  let isAdmin = isInList(requesterId, adminIds) || isEmailInList(requesterEmail, adminEmailsLower);
  let isDispatcher = isInList(requesterId, dispatcherIds) || isEmailInList(requesterEmail, dispatcherEmailsLower);

  if (!isAdmin && !isDispatcher) {
    const md = await getRoleFromMetadata(supabase, requesterId);
    isAdmin = md.isAdmin;
    isDispatcher = md.isDispatcher;
  }

  if (!isAdmin && !isDispatcher) {
    return NextResponse.json(
      { ok: false, error: "Forbidden (requires admin/dispatcher)." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("passenger_verification_requests")
    .select("passenger_id, full_name, town, status, submitted_at, admin_notes, id_front_path, selfie_with_id_path")
    .eq("status", "pending")
    .order("submitted_at", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = Array.isArray(data) ? data : [];

  const ID_BUCKET = "passenger-ids";
  const SELFIE_BUCKET = "passenger-selfies";
  const EXPIRES = 60 * 10;

  const out: any[] = [];
  for (const r of rows) {
    let id_front_signed_url: string | null = null;
    let selfie_signed_url: string | null = null;

    const idPath = r?.id_front_path ? String(r.id_front_path) : "";
    const sfPath = r?.selfie_with_id_path ? String(r.selfie_with_id_path) : "";

    if (idPath) {
      const s = await supabase.storage.from(ID_BUCKET).createSignedUrl(idPath, EXPIRES);
      if (!s.error) id_front_signed_url = s.data?.signedUrl || null;
    }
    if (sfPath) {
      const s = await supabase.storage.from(SELFIE_BUCKET).createSignedUrl(sfPath, EXPIRES);
      if (!s.error) selfie_signed_url = s.data?.signedUrl || null;
    }

    out.push({ ...r, id_front_signed_url, selfie_signed_url });
  }

  return NextResponse.json({ ok: true, rows: out });
}
