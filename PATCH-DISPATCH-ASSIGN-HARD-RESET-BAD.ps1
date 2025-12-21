# PATCH-DISPATCH-ASSIGN-HARD-RESET-BAD.ps1
# HARD RESET of bad() helper in app/api/dispatch/assign/route.ts
# Removes all broken fragments and reinserts a clean implementation

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\api\dispatch\assign\route.ts"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$t = Get-Content -LiteralPath $f -Raw -Encoding UTF8

# 1) REMOVE any bad() helper and any trailing garbage after it
# This removes from "function bad(" up to the first standalone "}"
$rxRemoveBad = '(?s)function\s+bad\s*\(.*?\)\s*\{.*?\}\s*,?\s*(\{.*?\}\s*\)\s*;)?'
$t2 = [regex]::Replace($t, $rxRemoveBad, '', 1)

# 2) INSERT clean bad() helper after imports
$insert = @'
function bad(message: string, extra: any = {}, status = 400) {
  const code = extra?.code ?? "UNKNOWN";
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

'@

# Insert after last import
$rxImports = '(?s)^(?:import .*?;\s*)+'
if ($t2 -match $rxImports) {
  $t2 = [regex]::Replace($t2, $rxImports, '$0' + $insert, 1)
} else {
  # fallback: prepend
  $t2 = $insert + $t2
}

Set-Content -LiteralPath $f -Value $t2 -Encoding UTF8
Write-Host "HARD RESET bad() helper in $f" -ForegroundColor Green
