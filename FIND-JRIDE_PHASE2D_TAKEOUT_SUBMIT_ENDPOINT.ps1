# FIND-JRIDE_PHASE2D_TAKEOUT_SUBMIT_ENDPOINT.ps1
# Purpose: Locate the POST endpoint used by the takeout "Submit order" UI
# Non-destructive: READ-ONLY (no edits). Safe to run anytime.

$ErrorActionPreference = "Stop"

function Info($m) { Write-Host "[INFO] $m" -ForegroundColor Cyan }
function Warn($m) { Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Ok($m)   { Write-Host "[OK]   $m" -ForegroundColor Green }

$root = (Get-Location).Path
Info "Repo root: $root"

# 1) Find likely takeout pages/components that call fetch()
$uiCandidates = @(
  "app\takeout\page.tsx",
  "app\takeout\checkout\page.tsx",
  "app\takeout\order\page.tsx",
  "app\takeout\components",
  "app\components"
)

Info "Scanning UI candidates for fetch('/api/...takeout...') ..."
$uiHits = @()

foreach ($p in $uiCandidates) {
  $full = Join-Path $root $p
  if (Test-Path $full) {
    if ((Get-Item $full).PSIsContainer) {
      $files = Get-ChildItem -Path $full -Recurse -File -Include *.ts,*.tsx -ErrorAction SilentlyContinue
      foreach ($f in $files) {
        $m = Select-String -Path $f.FullName -Pattern "fetch\(\s*['""]\/api\/[^'""]+['""]" -SimpleMatch -ErrorAction SilentlyContinue
        if ($m) { $uiHits += $m }
      }
    } else {
      $m = Select-String -Path $full -Pattern "fetch\(\s*['""]\/api\/[^'""]+['""]" -SimpleMatch -ErrorAction SilentlyContinue
      if ($m) { $uiHits += $m }
    }
  }
}

if (-not $uiHits -or $uiHits.Count -eq 0) {
  Warn "No UI fetch('/api/...') calls found in common takeout UI locations."
} else {
  Ok ("UI fetch() hits found: " + $uiHits.Count)
  $uiHits | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
}

# 2) Specifically look for takeout-related API calls in UI hits
Info "Filtering UI hits that mention takeout/checkout/orders ..."
$takeoutUiHits = $uiHits | Where-Object { $_.Line -match "/api/(takeout|checkout|orders|vendor-orders)" -or $_.Line -match "takeout" }

if ($takeoutUiHits -and $takeoutUiHits.Count -gt 0) {
  Ok ("Takeout-related UI hits: " + $takeoutUiHits.Count)
  $takeoutUiHits | Select-Object Path, LineNumber, Line | Format-Table -AutoSize
} else {
  Warn "No obvious takeout-related UI hits detected."
}

# 3) List takeout API routes that exist
Info "Listing existing takeout API routes under app\api\takeout\ ..."
$apiRoot = Join-Path $root "app\api\takeout"
if (Test-Path $apiRoot) {
  $routes = Get-ChildItem -Path $apiRoot -Recurse -File -Filter "route.ts" -ErrorAction SilentlyContinue
  if ($routes -and $routes.Count -gt 0) {
    Ok ("Found takeout route.ts files: " + $routes.Count)
    $routes | Select-Object FullName | Format-Table -AutoSize
  } else {
    Warn "No route.ts found under app\api\takeout"
  }
} else {
  Warn "Folder not found: app\api\takeout"
}

# 4) Check vendor-orders files existence
Info "Checking vendor-orders API/UI files..."
$need = @(
  "app\api\vendor-orders\route.ts",
  "app\vendor-orders\page.tsx"
)
foreach ($rel in $need) {
  $fp = Join-Path $root $rel
  if (Test-Path $fp) { Ok "Found: $rel" } else { Warn "Missing: $rel" }
}

Info "Done. Next: upload the 3 Phase 2D files (POST takeout route.ts + vendor-orders route.ts + vendor-orders page.tsx)."
