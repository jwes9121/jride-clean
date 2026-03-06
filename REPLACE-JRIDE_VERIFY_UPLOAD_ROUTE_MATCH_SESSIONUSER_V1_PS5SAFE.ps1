#requires -Version 5.1
<#
REPLACE JRIDE WEB: verification upload route to match working session-user auth pattern
PS5-safe, ASCII-only

Target:
- app\api\public\passenger\verification\upload\route.ts

What it does:
- Replaces the whole route
- Uses createServerClient + cookies() exactly like the working session-user route
- Keeps service-role storage upload
- Removes unused auth import
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

function WriteTextUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile($src, $bakDir, $tag) {
  EnsureDir $bakDir
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Missing file: $src"
  }
  $name = [System.IO.Path]::GetFileName($src)
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $dst = Join-Path $bakDir ($name + ".bak." + $tag + "." + $stamp)
  Copy-Item -LiteralPath $src -Destination $dst -Force
  return $dst
}

Write-Host "== REPLACE JRIDE WEB: verify upload route to match session-user auth (V1 / PS5-safe) ==" -ForegroundColor Cyan

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
Write-Host "Root: $root"

$target = Join-Path $root "app\api\public\passenger\verification\upload\route.ts"
$bakDir = Join-Path $root "_patch_bak"

if (-not (Test-Path -LiteralPath $target)) {
  Fail "Target file not found: $target"
}

$bak = BackupFile $target $bakDir "VERIFY_UPLOAD_MATCH_SESSIONUSER_V1"
Write-Host "[OK] Backup: $bak"

$newContent = @'
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

function env(name: string) {
  return process.env[name] || "";
}

function adminClient() {
  const url = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_ROLE");
  if (!url || !key) {
    throw new Error("Missing Supabase service role env (SUPABASE_SERVICE_ROLE_KEY)");
  }
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

function cookieNames(cookieHeader: string | null) {
  if (!cookieHeader) return [];
  return cookieHeader
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split("=")[0])
    .slice(0, 50);
}

export async function POST(req: NextRequest) {
  try {
    const url = env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL");
    const anon = env("NEXT_PUBLIC_SUPABASE_ANON_KEY") || env("SUPABASE_ANON_KEY");

    if (!url || !anon) {
      return NextResponse.json(
        { ok: false, error: "Missing Supabase anon env" },
        { status: 500 }
      );
    }

    const cookieStore = cookies();

    const supabase = createServerClient(url, anon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: any) {
          cookieStore.set({ name, value, ...options });
        },
        remove(name: string, options: any) {
          cookieStore.set({ name, value: "", ...options, maxAge: 0 });
        },
      },
    });

    const { data, error } = await supabase.auth.getUser();
    const user = data?.user;

    if (error || !user?.id) {
      const hdr = cookieStore.toString ? cookieStore.toString() : null;
      return NextResponse.json(
        {
          ok: false,
          error: "Not signed in",
          debug: {
            cookieNames: cookieNames(hdr),
            hasSbCookies: cookieNames(hdr).some(
              (n) => n.startsWith("sb-") && n.includes("-auth-token")
            ),
          },
        },
        { status: 401 }
      );
    }

    const form = await req.formData();
    const kind = String(form.get("kind") || "").trim();
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