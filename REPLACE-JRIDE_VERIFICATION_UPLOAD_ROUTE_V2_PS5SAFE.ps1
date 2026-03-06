#requires -Version 5.1
<#
REPLACE JRIDE WEB: verification upload route with clean Supabase-session version
PS5-safe, ASCII-only

Target:
- app\api\public\passenger\verification\upload\route.ts

What it does:
- Replaces the whole file with a clean implementation
- Uses Supabase session cookies for auth
- Uses service-role client only for storage upload
- Fixes compile error caused by broken variable order
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($msg) { throw $msg }

function EnsureDir($p) {
  if (-not (Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function ReadText($path) {
  if (-not (Test-Path -LiteralPath $path)) {
    Fail "Missing file: $path"
  }
  return [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
}

function WriteTextUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  $name = [System.IO.Path]::GetFileName($src)
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

Write-Host "== REPLACE JRIDE WEB: verification upload route (V2 / PS5-safe) ==" -ForegroundColor Cyan

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$target = Join-Path $root "app\api\public\passenger\verification\upload\route.ts"
$bakDir = Join-Path $root "_patch_bak"

if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$bak = BackupFile $target $bakDir "VERIFY_UPLOAD_ROUTE_V2"
Write-Host "[OK] Backup: $bak"

$newContent = @'
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) throw new Error("Missing Supabase service role env (SUPABASE_SERVICE_ROLE_KEY)");
  return createAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
    // Use the same Supabase session model as the rest of verification flow
    const supabase = createClient();
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    const user = userRes?.user;

    if (userErr || !user?.id) {
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

    const passengerId = user.id;
    const bucket = kind === "id_front" ? "passenger-ids" : "passenger-selfies";
    const ext = extFromMime(mime);
    const path = `${passengerId}/${Date.now()}_${kind}.${ext}`;

    // Use service-role client only for storage write
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
    return NextResponse.json(
      { ok: false, error: String(e?.message || e || "error") },
      { status: 500 }
    );
  }
}
'@

WriteTextUtf8NoBom $target $newContent
Write-Host "[OK] Replaced: $target"
Write-Host ""
Write-Host "Done."