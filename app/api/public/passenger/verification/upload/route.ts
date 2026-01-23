import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createClient as createAdmin } from "@supabase/supabase-js";

function adminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return createAdmin(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function extFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "bin";
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
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

    const passenger_id = session.user.id;
    const bucket = (kind === "id_front") ? "passenger-ids" : "passenger-selfies";
    const ext = extFromMime(mime);
    const path = `${passenger_id}/${Date.now()}_${kind}.${ext}`;

    const supabase = adminSupabase();
    const ab = await file.arrayBuffer();

    const up = await supabase.storage.from(bucket).upload(path, ab, {
      contentType: mime || "application/octet-stream",
      upsert: true
    });

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, bucket, path, mime, bytes }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}