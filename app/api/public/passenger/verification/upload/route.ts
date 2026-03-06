import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";


export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string) {
  return process.env[name] || "";
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
    const supabase = createClient();
const { data: userRes, error: userErr } = await supabase.auth.getUser();
const user = userRes?.user;

if (userErr || !user?.id) {
  return NextResponse.json({ ok:false, error:"Not signed in" },{status:401});
}

const passengerId = user.id;
    const bucket = (kind === "id_front") ? "passenger-ids" : "passenger-selfies";
    const ext = extFromMime(mime);
    const path = `${passengerId}/${Date.now()}_${kind}.${ext}`;

    const admin = supabase;
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