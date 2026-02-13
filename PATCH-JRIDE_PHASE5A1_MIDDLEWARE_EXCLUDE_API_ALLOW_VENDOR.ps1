# PATCH-JRIDE_PHASE5A1_MIDDLEWARE_EXCLUDE_API_ALLOW_VENDOR.ps1
# Purpose:
# - Ensure middleware NEVER runs on /api/* routes (prevents 405/oddities)
# - Explicitly allow /api/vendor/* in allowlist (extra safe)
# - Write UTF-8 NO BOM
# Locked: No backend logic changes, no wallet logic, no schema changes.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$root = (Get-Location).Path
$target = Join-Path $root "middleware.ts"

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target not found: $target`nRun this script from repo root."
}

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.$ts"
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# ---- 1) Ensure /api/vendor/ is in the allow block ----
# We will replace the allow block condition safely.
# Expect to find: p.startsWith("/api/dispatch/") || p.startsWith("/api/admin/") || p.startsWith("/api/auth/")
$needle = 'p.startsWith("/api/dispatch/") ||' + "`r`n" +
          '    p.startsWith("/api/admin/") ||' + "`r`n" +
          '    p.startsWith("/api/auth/")'

if ($txt -notlike "*$needle*") {
  # Try a looser find without CRLF dependency
  if ($txt -notmatch [regex]::Escape('p.startsWith("/api/dispatch/")') ) {
    Fail "Could not locate middleware allowlist block (dispatch/admin/auth). Paste middleware.ts if this persists."
  }
} else {
  $replacement = 'p.startsWith("/api/dispatch/") ||' + "`r`n" +
                 '    p.startsWith("/api/admin/") ||' + "`r`n" +
                 '    p.startsWith("/api/vendor/") ||' + "`r`n" +
                 '    p.startsWith("/api/auth/")'
  $txt = $txt.Replace($needle, $replacement)
}

# ---- 2) Exclude ALL /api/* from matcher (middleware won’t run on APIs) ----
# Replace the matcher line if present.
# Old: matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
# New: matcher excludes api/, static, image, favicon, and any file-ext requests
$oldMatcherA = 'matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],'
$oldMatcherB = 'matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]'

$newMatcher  = 'matcher: ["/((?!api/|_next/static|_next/image|favicon.ico|.*\..*).*)"],'

if ($txt -like "*$oldMatcherA*") {
  $txt = $txt.Replace($oldMatcherA, $newMatcher)
} elseif ($txt -like "*$oldMatcherB*") {
  $txt = $txt.Replace($oldMatcherB, $newMatcher)
} else {
  # Fallback: try to locate "matcher:" and replace the whole config block minimally
  if ($txt -notmatch "export const config\s*=\s*\{") {
    Fail "Could not locate export const config block. Paste middleware.ts if this persists."
  }
  # Replace any existing matcher array line (simple approach)
  $txt = [regex]::Replace(
    $txt,
    'matcher:\s*\[[^\]]*\]\s*,?',
    $newMatcher,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )
}

# ---- 3) Write UTF-8 NO BOM ----
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $txt, $utf8NoBom)

Ok "[OK] Patched: $target"
Info "Changes:"
Info " - allow /api/vendor/* explicitly"
Info " - exclude /api/* from middleware matcher"
Ok "[DONE]"
