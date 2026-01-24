import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function env(name: string) {
  const v = process.env[name];
  return (v && String(v).trim()) ? String(v).trim() : "";
}

export async function GET() {
  try {
    const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
    const service =
      env("SUPABASE_SERVICE_ROLE_KEY") ||
      env("SUPABASE_SERVICE_KEY");

    if (!url) {
      return NextResponse.json({ ok: false, error: "Missing SUPABASE_URL" }, { status: 500 });
    }
    if (!service) {
      // We can still return rows, but we cannot sign private storage URLs.
      // This keeps the UI functional while you add the env var.
    }

    const supabase = createClient(url, service || (env("SUPABASE_ANON_KEY") || env("NEXT_PUBLIC_SUPABASE_ANON_KEY")), {
      auth: { persistSession: false },
    });

    // Pull pending rows
    const { data, error } = await supabase
      .from("passenger_verification_requests")
      .select("passenger_id, full_name, town, status, submitted_at, admin_notes, id_front_path, selfie_with_id_path")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const rows = Array.isArray(data) ? data : [];

    // If no service key, return rows without signed urls
    if (!service) {
      return NextResponse.json({
        ok: true,
        rows: rows.map((r: any) => ({
          ...r,
          id_front_signed_url: null,
          selfie_signed_url: null,
          signed_url_note: "SUPABASE_SERVICE_ROLE_KEY missing, cannot sign private storage urls",
        })),
      });
    }

    // Buckets (private)
    const ID_BUCKET = "passenger-ids";
    const SELFIE_BUCKET = "passenger-selfies";
    const EXPIRES = 60 * 10; // 10 minutes

    // Create signed urls
    const out = [];
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

      out.push({
        ...r,
        id_front_signed_url,
        selfie_signed_url,
      });
    }

    return NextResponse.json({ ok: true, rows: out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Unexpected error" }, { status: 500 });
  }
}