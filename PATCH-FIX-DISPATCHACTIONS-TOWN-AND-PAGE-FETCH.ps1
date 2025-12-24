# PATCH-FIX-DISPATCHACTIONS-TOWN-AND-PAGE-FETCH.ps1
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = "C:\Users\jwes9\Desktop\jride-clean-fresh"

$fActions = Join-Path $root "app\actions\dispatchActions.ts"
$fPage    = Join-Path $root "app\dispatch\page.tsx"

if (!(Test-Path $fActions)) { Fail "Missing: $fActions" }
if (!(Test-Path $fPage))    { Fail "Missing: $fPage" }

$ts = Get-Date -Format "yyyyMMdd-HHmmss"

# -------------------------
# 1) Fix dispatchActions.ts
# -------------------------
$bakA = "$fActions.bak.$ts"
Copy-Item $fActions $bakA -Force
Write-Host "[OK] Backup: $bakA" -ForegroundColor Green

$txtA = Get-Content $fActions -Raw

# Fix the obvious bug: rows.town -> row.town (inside for (const row of rows))
$txtA2 = $txtA -replace '(?m)^\s*const\s+town\s*=\s*rows\.town\s*\|\|\s*["'']Other["'']\s*;\s*$', '    const town = ((row as any).town ?? (row as any).zone ?? "Other");'
# If that exact line doesn't exist, still enforce a safe town derivation if we can find "const town ="
if ($txtA2 -eq $txtA) {
  # Replace any "const town = ...town..." line inside the loop with a safe version
  $txtA2 = $txtA -replace '(?m)^\s*const\s+town\s*=\s*.*\s*;\s*$', '    const town = ((row as any).town ?? (row as any).zone ?? "Other");'
}

# Also guard against accidentally referencing rows.town elsewhere
$txtA2 = $txtA2 -replace 'rows\.town', '(row as any).town'

Set-Content -Path $fActions -Value $txtA2 -Encoding UTF8
Write-Host "[OK] Patched dispatchActions.ts town grouping." -ForegroundColor Green

# -------------------------
# 2) Fix page.tsx fetch syntax
# -------------------------
$bakP = "$fPage.bak.$ts"
Copy-Item $fPage $bakP -Force
Write-Host "[OK] Backup: $bakP" -ForegroundColor Green

$txtP = Get-Content $fPage -Raw

# Fix: fetch("..."), { ... }  -> fetch("...", { ... })
$txtP = $txtP -replace 'fetch\(\s*("(/api/dispatch/drivers|/api/dispatch/bookings)")\s*\)\s*,\s*\{', 'fetch($1, {'
$txtP = $txtP -replace "fetch\(\s*('(/api/dispatch/drivers|/api/dispatch/bookings)')\s*\)\s*,\s*\{", 'fetch($1, {'

# Remove "as any" from cache option if present (keeps TS happy in client code)
$txtP = $txtP -replace 'cache:\s*"no-store"\s*as\s*any', 'cache: "no-store"'
$txtP = $txtP -replace "cache:\s*'no-store'\s*as\s*any", "cache: 'no-store'"

# Ensure it’s not the broken pattern: fetch("..."), { cache: ... }
# (If any remain, fail loudly)
if ($txtP -match 'fetch\(\s*["'']/api/dispatch/(drivers|bookings)["'']\s*\)\s*,\s*\{') {
  Fail "page.tsx still contains broken fetch(...), { ... } pattern after patch. Paste the refreshDrivers() fetch line."
}

Set-Content -Path $fPage -Value $txtP -Encoding UTF8
Write-Host "[OK] Patched page.tsx fetch syntax." -ForegroundColor Green

# -------------------------
# 3) Build test (single pass)
# -------------------------
Write-Host ""
Write-Host "[TEST] Running npm run build..." -ForegroundColor Cyan
Push-Location $root
try {
  $p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "npm run build" -NoNewWindow -Wait -PassThru
  if ($p.ExitCode -ne 0) {
    Write-Host "[FAIL] Build failed. Rollback commands:" -ForegroundColor Red
    Write-Host ("Copy-Item `"" + $bakA + "`" `"" + $fActions + "`" -Force") -ForegroundColor Yellow
    Write-Host ("Copy-Item `"" + $bakP + "`" `"" + $fPage + "`" -Force") -ForegroundColor Yellow
    Fail "npm run build failed (see output above)."
  }
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "[DONE] Build passed. Now restart dev server:" -ForegroundColor Green
Write-Host "  Ctrl+C (stop dev)" -ForegroundColor Cyan
Write-Host "  npm run dev" -ForegroundColor Cyan
Write-Host "Open: http://localhost:3000/dispatch" -ForegroundColor Cyan
