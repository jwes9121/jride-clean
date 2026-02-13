# PATCH-JRIDE_PHASE6I_ENV_ECHO.ps1
# Adds env echo to can-book + passenger book responses so we can confirm which Supabase project prod is using.
# ASCII ONLY.

$ErrorActionPreference = "Stop"

function Timestamp() { Get-Date -Format "yyyyMMdd_HHmmss" }
function BackupFile($p) {
  if (Test-Path $p) {
    $bak = "$p.bak.$(Timestamp)"
    Copy-Item $p $bak -Force
    Write-Host "[OK] Backup: $bak"
  }
}
function WriteUtf8NoBom($path, $content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

$canBook = "app\api\public\passenger\can-book\route.ts"
$book    = "app\api\public\passenger\book\route.ts"

if (!(Test-Path $canBook)) { throw "Missing: $canBook" }
if (!(Test-Path $book))    { throw "Missing: $book" }

BackupFile $canBook
BackupFile $book

# --- Patch can-book: add env block just before return JSON (safe string insert) ---
$txt = Get-Content $canBook -Raw

if ($txt -notmatch "JRIDE_ENV_ECHO") {
  # Insert helper near top after imports
  $inject = @'
/* JRIDE_ENV_ECHO */
function jrideEnvEcho() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let host = "";
  try { host = u ? new URL(u).host : ""; } catch { host = ""; }
  return {
    supabase_host: host || null,
    vercel_env: process.env.VERCEL_ENV || null,
    nextauth_url: process.env.NEXTAUTH_URL || null
  };
}
/* JRIDE_ENV_ECHO_END */

'@

  # best-effort: after last import
  if ($txt -match "(?m)^(import[^\r\n]*\r?\n)+") {
    $txt = [regex]::Replace($txt, "(?m)^(import[^\r\n]*\r?\n)+", "`$0`n$inject")
  } else {
    $txt = $inject + $txt
  }

  # Add env into JSON response object: look for NextResponse.json({ ... })
  $txt = [regex]::Replace(
    $txt,
    "NextResponse\.json\(\s*\{",
    "NextResponse.json({`n  env: jrideEnvEcho(),"
  )
}

WriteUtf8NoBom $canBook $txt
Write-Host "[OK] Patched: $canBook"

# --- Patch book route: add env in final JSON response(s) ---
$txt2 = Get-Content $book -Raw

if ($txt2 -notmatch "JRIDE_ENV_ECHO") {
  $inject2 = @'
/* JRIDE_ENV_ECHO */
function jrideEnvEcho() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  let host = "";
  try { host = u ? new URL(u).host : ""; } catch { host = ""; }
  return {
    supabase_host: host || null,
    vercel_env: process.env.VERCEL_ENV || null,
    nextauth_url: process.env.NEXTAUTH_URL || null
  };
}
/* JRIDE_ENV_ECHO_END */

'@

  if ($txt2 -match "(?m)^(import[^\r\n]*\r?\n)+") {
    $txt2 = [regex]::Replace($txt2, "(?m)^(import[^\r\n]*\r?\n)+", "`$0`n$inject2")
  } else {
    $txt2 = $inject2 + $txt2
  }

  # Add env to any response like NextResponse.json({ ok: true, ... })
  $txt2 = [regex]::Replace(
    $txt2,
    "NextResponse\.json\(\s*\{\s*ok:\s*true\s*,",
    "NextResponse.json({ ok: true, env: jrideEnvEcho(),"
  )

  # If it returns ok:true without the exact pattern, also try generic insert
  if ($txt2 -notmatch "env:\s*jrideEnvEcho") {
    $txt2 = [regex]::Replace(
      $txt2,
      "NextResponse\.json\(\s*\{",
      "NextResponse.json({ env: jrideEnvEcho(),"
    )
  }
}

WriteUtf8NoBom $book $txt2
Write-Host "[OK] Patched: $book"

Write-Host "[NEXT] Build: npm.cmd run build"
