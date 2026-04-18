import { NextResponse } from "next/server";
import { auth } from "../../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

function isEmailInList(email: string | null | undefined, listLower: string[]) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return false;
  return listLower.includes(e);
}

async function getAuthorizedAdmin() {
  const session = await auth();
  const requesterEmail = String((session?.user as any)?.email || "").trim().toLowerCase();
  const role = String((session?.user as any)?.role || "user").trim().toLowerCase();
  const hasUser = !!session?.user;

  if (!hasUser) {
    return { ok: false, status: 401, error: "Not signed in" };
  }

  const adminEmailsLower = toLowerList(parseCsv(env("JRIDE_ADMIN_EMAILS") || env("ADMIN_EMAILS")));
  const dispatcherEmailsLower = toLowerList(parseCsv(env("JRIDE_DISPATCHER_EMAILS") || env("DISPATCHER_EMAILS")));

  const isAdmin = role === "admin" || isEmailInList(requesterEmail, adminEmailsLower);
  const isDispatcher = role === "dispatcher" || isEmailInList(requesterEmail, dispatcherEmailsLower);

  if (!isAdmin && !isDispatcher) {
    return { ok: false, status: 403, error: "Forbidden (admin/dispatcher only)." };
  }

  return {
    ok: true,
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
    const authz: any = await getAuthorizedAdmin();
    if (!authz.ok) {
      return NextResponse.json({ ok: false, error: authz.error }, { status: authz.status });
    }

    const admin = supabaseAdmin();

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
      auth_debug: {
        requester_email: authz.requesterEmail,
        is_admin: authz.isAdmin,
        is_dispatcher: authz.isDispatcher,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

