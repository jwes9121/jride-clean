import { NextRequest, NextResponse } from "next/server";
import { createClient as createAnon } from "@supabase/supabase-js";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string) {
  return process.env[name] || "";
}

function anonClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");
  if (!url || !key) throw new Error("Missing Supabase anon env");
  return createAnon(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing Supabase service role env (SUPABASE_SERVICE_ROLE_KEY)");
  return createAdmin(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function extFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "bin";
}

export async function POST(req: NextRequest) {
  try {
    const at = req.cookies.get("jride_pax_at")?.value || "";
    if (!at) return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });

    const anon = anonClient();
    const { data, error } = await anon.auth.getUser(at);
    if (error || !data?.user) {
      const res = NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
      res.cookies.set({ name: "jride_pax_at", value: "", path: "/", maxAge: 0 });
      res.cookies.set({ name: "jride_pax_rt", value: "", path: "/", maxAge: 0 });
      return res;
    }

    const form = await req.formData();
    const kind = String(form.get("kind") || "").trim(); // id_front | selfie
    const file = form.get("file");

    if (kind !== "id_front" && kind !== "selfie") {
      return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const mime = String(file.type || "");
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ ok: false, error: "Image only" }, { status: 400 });
    }
    const bytes = Number(file.size || 0);
    if (bytes > 5 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Max 5MB" }, { status: 400 });
    }

    const passengerId = data.user.id;
    const bucket = (kind === "id_front") ? "passenger-ids" : "passenger-selfies";
    const ext = extFromMime(mime);
    const path = `${passengerId}/${Date.now()}_${kind}.${ext}`;

    const admin = adminClient();
    const ab = await file.arrayBuffer();

    const up = await admin.storage.from(bucket).upload(path, ab, {
      contentType: mime || "application/octet-stream",
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, bucket, path, bytes, mime }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}