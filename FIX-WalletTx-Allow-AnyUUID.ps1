# FIX-WalletTx-Allow-AnyUUID.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path $root $rel
if (!(Test-Path $path)) { Fail "Missing file: $rel (run from repo root)" }

$txt = Get-Content -Raw -Path $path

# Sanity: ensure we're patching the correct endpoint
if ($txt -notmatch "BAD_ID" -or $txt -notmatch "wallet/transactions") {
  # Some repos don't include the path string in code; BAD_ID is the stronger check.
  if ($txt -notmatch "BAD_ID") { Fail "This file doesn't look like the wallet transactions route (no BAD_ID found)." }
}

# 1) Replace common UUID v4 regex with generic UUID regex (accepts any version)
$genericUuid = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i'

$patterns = @(
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i',  # v4 regex (escaped-ish)
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89AB\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i',
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i',
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i',
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i'
)

# Also catch the typical literal form:
# /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
$txt2 = $txt
$txt2 = [regex]::Replace(
  $txt2,
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[[89ab89AB]\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i',
  $genericUuid
)

$txt2 = [regex]::Replace(
  $txt2,
  '/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[[89ab89AB]\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/',
  $genericUuid
)

# 2) If there's a helper named isUuidV4, rewrite it to accept any UUID (keeps call sites unchanged)
# This is a safe best-effort patch.
$txt2 = [regex]::Replace(
  $txt2,
  '(?s)function\s+isUuidV4\s*\(\s*(\w+)\s*:\s*string\s*\)\s*\{\s*return\s+[^;]*;\s*\}',
  'function isUuidV4($1: string) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test($1); }'
)

# 3) If there is a const UUID_V4_RE, replace it
$txt2 = [regex]::Replace(
  $txt2,
  '(?m)^\s*const\s+UUID(_V4)?_RE\s*=\s*/\^\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-4\[0-9a-f\]\{3\}-\[[89ab89AB]\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\$\/i\s*;\s*$',
  'const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;'
)

if ($txt2 -eq $txt) {
  Fail "No UUID v4-only validation patterns were found to patch. Paste the top ~80 lines of $rel around the BAD_ID check and I will target it precisely."
}

Set-Content -Path $path -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched $rel to accept any UUID (not just v4)" -ForegroundColor Green
Write-Host "[NEXT] Run: npm run build" -ForegroundColor Cyan
