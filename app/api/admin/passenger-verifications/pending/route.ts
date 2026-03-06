import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function signedUrl(storage: any, bucket: string, path: string | null | undefined) {
  if (!path) return null;
  const r = await storage.from(bucket).createSignedUrl(path, 3600);
  if (r.error || !r.data?.signedUrl) return null;
  return r.data.signedUrl;
}

export async function GET() {
  try {
    const supabase = createClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const admin = adminClient();

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