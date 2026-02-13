# PATCH-JRIDE_MIDDLEWARE_EXCLUDE_API_V2_PS5SAFE.ps1
# Robust: locate middleware.ts by filesystem search, then ensure matcher excludes /api and assets.
# PS5-safe with backup.

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

$projRoot = (Get-Location).Path

Info "== JRide Patch: Middleware exclude /api (V2 / PS5-safe) =="
Info ("Project: " + $projRoot)

# Find middleware.ts anywhere in repo (prefer root or src/)
$found = Get-ChildItem -Path $projRoot -Recurse -File -Filter "middleware.ts" -ErrorAction SilentlyContinue |
  Sort-Object FullName

if (!$found -or $found.Count -eq 0) {
  throw "middleware.ts not found anywhere under: $projRoot"
}

# Prefer repo-root middleware.ts, then src\middleware.ts, else first match
$targetObj =
  ($found | Where-Object { $_.FullName -ieq (Join-Path $projRoot "middleware.ts") } | Select-Object -First 1)
if (!$targetObj) {
  $targetObj = ($found | Where-Object { $_.FullName -ieq (Join-Path $projRoot "src\middleware.ts") } | Select-Object -First 1)
}
if (!$targetObj) { $targetObj = $found[0] }

$target = $targetObj.FullName
Info ("Target: " + $target)

$bakDir = Join-Path $projRoot "_patch_bak"
if (!(Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("middleware.ts.bak." + $stamp)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok "[OK] Backup: $bak"

$txt = Get-Content -Raw -LiteralPath $target

$desiredConfig = @"
export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)",
  ],
};
"@.Trim()

if ($txt -match 'export\s+const\s+config\s*=\s*\{') {
  $txt = [regex]::Replace(
    $txt,
    '(?s)export\s+const\s+config\s*=\s*\{.*?\};\s*',
    $desiredConfig + "`r`n",
    1
  )
  Ok "[OK] Replaced existing export const config block."
} else {
  $txt = $txt.TrimEnd() + "`r`n`r`n" + $desiredConfig + "`r`n"
  Ok "[OK] Added export const config block."
}

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Ok "[OK] Patched: $target"

Info "NEXT: Restart dev server."
