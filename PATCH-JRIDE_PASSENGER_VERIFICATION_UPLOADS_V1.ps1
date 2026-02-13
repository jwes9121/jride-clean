# PATCH-JRIDE_PASSENGER_VERIFICATION_UPLOADS_V1.ps1
# Adds passenger verification upload API + admin signed URL API.
# ASCII only.

$ErrorActionPreference = "Stop"

function NowStamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function WriteU($p,$t){ [IO.File]::WriteAllText($p,$t,[Text.UTF8Encoding]::new($false)) }

$root = Get-Location
$stamp = NowStamp

$uploadApi = Join-Path $root "app\api\public\passenger\verification\upload\route.ts"
$fileUrlApi = Join-Path $root "app\api\admin\verification\file-url\route.ts"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $uploadApi) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $fileUrlApi) | Out-Null

if(Test-Path $uploadApi){ Copy-Item $uploadApi "$uploadApi.bak.$stamp" -Force }
if(Test-Path $fileUrlApi){ Copy-Item $fileUrlApi "$fileUrlApi.bak.$stamp" -Force }

# ---------------------------
# Passenger upload API
# ---------------------------
$uploadTxt = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// IMPORTANT:
// This route assumes you already have a way to determine the passenger user id from cookies/session.
// Replace getPassengerUserId() with your existing logic (same as your other /api/public/passenger/* routes).

function adminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// TODO: wire this to your real passenger session
async function getPassengerUserId(_req: Request): Promise<string | null> {
  // If you already have /api/public/auth/session, reuse that logic here.
  // For now, return null so it fails safely until you connect it.
  return null;
}

function extFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  return "bin";
}

export async function POST(req: Request) {
  try {
    const passengerId = await getPassengerUserId(req);
    if (!passengerId) {
      return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
    }

    const form = await req.formData();
    const kind = String(form.get("kind") || "").trim();
    const file = form.get("file");

    if (kind !== "id_front" && kind !== "selfie_with_id") {
      return NextResponse.json({ ok: false, error: "Invalid kind" }, { status: 400 });
    }
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing file" }, { status: 400 });
    }

    const mime = String(file.type || "");
    if (!(mime.startsWith("image/"))) {
      return NextResponse.json({ ok: false, error: "File must be an image" }, { status: 400 });
    }

    // size guard for pilot: 2MB
    const bytes = Number(file.size || 0);
    if (bytes > 2 * 1024 * 1024) {
      return NextResponse.json({ ok: false, error: "Max 2MB image size" }, { status: 400 });
    }

    const ext = extFromMime(mime);
    const bucket = kind === "id_front" ? "passenger-ids" : "passenger-selfies";
    const objectPath = `${passengerId}/${Date.now()}_${kind}.${ext}`;

    const supabase = adminSupabase();
    const ab = await file.arrayBuffer();
    const up = await supabase.storage.from(bucket).upload(objectPath, ab, {
      contentType: mime || "application/octet-stream",
      upsert: true,
    });

    if (up.error) {
      return NextResponse.json({ ok: false, error: up.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, bucket, path: objectPath, mime, bytes }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}
'@

WriteU $uploadApi $uploadTxt

# ---------------------------
# Admin signed URL API
# ---------------------------
$fileUrlTxt = @'
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_SERVICE_KEY || "";
  if (!url) throw new Error("Missing env: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
  if (!key) throw new Error("Missing env: SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const bucket = String(u.searchParams.get("bucket") || "").trim();
    const path = String(u.searchParams.get("path") || "").trim();

    if (!bucket || !path) {
      return NextResponse.json({ ok: false, error: "bucket and path required" }, { status: 400 });
    }

    const supabase = adminSupabase();
    const s = await supabase.storage.from(bucket).createSignedUrl(path, 60);

    if (s.error) {
      return NextResponse.json({ ok: false, error: s.error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true, url: s.data?.signedUrl || null }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || "error") }, { status: 500 });
  }
}
'@

WriteU $fileUrlApi $fileUrlTxt

Write-Host "[OK] Wrote: $uploadApi"
Write-Host "[OK] Wrote: $fileUrlApi"
Write-Host "[DONE] Add passenger session logic inside getPassengerUserId() before using upload in UI."
