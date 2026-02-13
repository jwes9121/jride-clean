$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ throw $m }

$root = (Get-Location).Path

$takeoutPage = Join-Path $root "app\takeout\page.tsx"
if (!(Test-Path $takeoutPage)) { Fail "Missing: $takeoutPage (run from repo root)" }

Ok ("[OK] Repo root: " + $root)
Ok "[OK] Scanning app\takeout\page.tsx for API usage..."

$lines = Get-Content -LiteralPath $takeoutPage

# Show any lines that include /api/
$apiLines = $lines | Select-String -SimpleMatch "/api/"
if ($apiLines) {
  Ok "[OK] Lines in app\takeout\page.tsx containing '/api/':"
  $apiLines | ForEach-Object {
    Write-Host ("  L" + $_.LineNumber + ": " + $_.Line.Trim())
  }
} else {
  Warn "[WARN] No '/api/' literal found in app\takeout\page.tsx."
}

Ok ""
Ok "[OK] Lines in app\takeout\page.tsx containing 'vendor-orders' (if any):"
$voLines = $lines | Select-String -SimpleMatch "vendor-orders"
if ($voLines) {
  $voLines | ForEach-Object {
    Write-Host ("  L" + $_.LineNumber + ": " + $_.Line.Trim())
  }
} else {
  Warn "  (none)"
}

Ok ""
Ok "[OK] Repo-wide search for '/api/vendor-orders'..."
$hits = Select-String -Path (Join-Path $root "app\**\*.ts*") -SimpleMatch "/api/vendor-orders" -ErrorAction SilentlyContinue
if ($hits) {
  $hits | Select-Object -First 50 | ForEach-Object {
    $rel = $_.Path.Replace($root + "\", "")
    Write-Host ("  " + $rel + ":" + $_.LineNumber + ": " + $_.Line.Trim())
  }
  if ($hits.Count -gt 50) { Warn "  ... more omitted" }
} else {
  Warn "[WARN] No '/api/vendor-orders' reference found under app/**.ts*."
}

Ok ""
Ok "[OK] Existing API route folders under app\api\takeout:"
$takeoutApi = Join-Path $root "app\api\takeout"
if (Test-Path $takeoutApi) {
  Get-ChildItem -LiteralPath $takeoutApi -Directory | Sort-Object Name | ForEach-Object {
    Write-Host ("  - " + $_.Name)
  }
} else {
  Warn "[WARN] app\api\takeout does not exist in this repo."
}

Ok ""
Ok "[OK] Vendor-orders route existence:"
$vendorOrdersRoute = Join-Path $root "app\api\vendor-orders\route.ts"
if (Test-Path $vendorOrdersRoute) {
  Ok "  - FOUND: app\api\vendor-orders\route.ts"
} else {
  Warn "  - NOT FOUND: app\api\vendor-orders\route.ts"
}

Ok ""
Ok "[DONE] Diagnostic finished."
