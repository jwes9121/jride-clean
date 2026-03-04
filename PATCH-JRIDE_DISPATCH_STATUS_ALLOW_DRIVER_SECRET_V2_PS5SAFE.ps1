param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Assert-FileExists([string]$p) {
  if (-not (Test-Path -LiteralPath $p)) { throw "File not found: $p" }
}

function Backup-File([string]$path, [string]$tag) {
  $bakDir = Join-Path $ProjRoot "_patch_bak"
  New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = (Split-Path $path -Leaf) + ".bak.$tag.$ts"
  $dest = Join-Path $bakDir $name
  Copy-Item -Force -LiteralPath $path -Destination $dest
  Write-Host "[OK] Backup: $dest"
}

function Replace-Once([string]$content, [string]$pattern, [string]$replacement, [string]$errMsg) {
  $m = [regex]::Match($content, $pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if (-not $m.Success) { throw $errMsg }
  return [regex]::Replace($content, $pattern, $replacement, 1, [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

Write-Host "== PATCH JRIDE: dispatch/status accepts driver secret (V2 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
Assert-FileExists $target
Backup-File $target "DISPATCH_STATUS_DRIVER_SECRET_V2"

$src = Get-Content -LiteralPath $target -Raw

# 1) Ensure we have NextResponse import (common in route handlers)
if ($src -notmatch 'from\s+"next/server"') {
  throw "route.ts does not appear to be a Next.js Route Handler (missing next/server import). Aborting."
}

# 2) Inject helper functions once (idempotent)
if ($src -notmatch "JRIDE_DRIVER_SECRET_GATE_V2") {

  # Insert helpers right after imports block (best-effort).
  $inject = @'
/* JRIDE_DRIVER_SECRET_GATE_V2
   Allow driver apps (Android) to call dispatch/status using a shared secret header.
   Accepted headers:
     - x-driver-ping-secret
     - x-driver-api-secret
   Accepted env vars:
     - DRIVER_PING_SECRET
     - DRIVER_API_SECRET
*/
function getHeader(req: Request, name: string): string {
  try { return String(req.headers.get(name) || "").trim(); } catch { return ""; }
}

function isValidDriverSecret(req: Request): boolean {
  const want = String(process.env.DRIVER_PING_SECRET || process.env.DRIVER_API_SECRET || "").trim();
  if (!want) return false;
  const got =
    getHeader(req, "x-driver-ping-secret") ||
    getHeader(req, "x-driver-api-secret") ||
    getHeader(req, "x-jride-driver-secret");
  return !!got && got === want;
}
/* JRIDE_DRIVER_SECRET_GATE_V2_END */
'@

  # Try to place it after the last import line.
  $src = Replace-Once `
    $src `
    '(\nimport[\s\S]*?\n)(\nexport\s+async\s+function|\nexport\s+function|\nconst\s+|\/\*|\n)' `
    ('$1' + "`n" + $inject + "`n" + '$2') `
    "Could not locate a safe insertion point after imports to inject driver secret helper."
  Write-Host "[OK] Inserted driver-secret helper block."
} else {
  Write-Host "[OK] Driver-secret helper block already present."
}

# 3) Modify POST handler auth gate:
# We do NOT assume exact code, so we add a driver-secret bypass near the start of POST()
if ($src -notmatch "JRIDE_DRIVER_SECRET_BYPASS_V2") {

  # Find export async function POST(...) {  ... and inject right after the opening brace.
  $src = Replace-Once `
    $src `
    '(export\s+async\s+function\s+POST\s*\([^)]*\)\s*\{\s*)' `
    ('$1' + @'
  // JRIDE_DRIVER_SECRET_BYPASS_V2
  // If driver secret matches, treat request as authorized even without NextAuth cookies.
  const _driverSecretOk = isValidDriverSecret(req);
'@) `
    "Could not locate export async function POST(...) to inject bypass."
  Write-Host "[OK] Injected POST() driver-secret bypass flag."
} else {
  Write-Host "[OK] POST() bypass flag already present."
}

# 4) If route returns UNAUTHORIZED based on session/auth, relax it when _driverSecretOk is true.
# We patch the common pattern: if (!session || ...) return NextResponse.json({ ok:false,...unauthorized...})
# If different, we still try a safer generic patch: any "Not authenticated" / "UNAUTHORIZED" early-return guard.
if ($src -notmatch "_driverSecretOk\s*\)\s*return") {

  # Patch common "Not authenticated" return blocks first
  $src2 = $src

  # Replace: if (<authfail>) return ...  => if (<authfail> && !_driverSecretOk) return ...
  $src2 = [regex]::Replace(
    $src2,
    'if\s*\(\s*([^\)]*(?:unauth|unauthorized|not\s+authenticated)[^\)]*)\s*\)\s*\{?',
    'if ($1 && !_driverSecretOk) {',
    1,
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  # Also patch the very common: if (!session || !session.user...) return ...
  $src2 = [regex]::Replace(
    $src2,
    'if\s*\(\s*!\s*session\b([\s\S]{0,200}?)\)\s*\{?',
    'if (!session$1 && !_driverSecretOk) {',
    1,
    [System.Text.RegularExpressions.RegexOptions]::Singleline
  )

  # If nothing changed, we can’t safely force it.
  if ($src2 -eq $src) {
    throw @"
Could not safely patch the auth guard in dispatch/status.
This means your POST handler's unauthorized logic is in a different shape than expected.
Paste the first ~80 lines of app/api/dispatch/status/route.ts (including POST signature) and I'll patch it precisely.
"@
  }

  $src = $src2
  Write-Host "[OK] Patched auth guard to allow when _driverSecretOk is true."
}

# 5) Ensure any injected "if (...) {" got closed properly by not breaking syntax:
# We do a minimal sanity check: balanced braces count rough check (not perfect, but catches obvious breaks).
$open = ([regex]::Matches($src, '\{')).Count
$close = ([regex]::Matches($src, '\}')).Count
if ($open -ne $close) {
  throw "Brace mismatch after patch (open=$open close=$close). Aborting write to avoid breaking build."
}

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Write-Host "[OK] Wrote: $target"

Write-Host ""
Write-Host "Next:"
Write-Host "  1) npm run build"
Write-Host "  2) deploy"