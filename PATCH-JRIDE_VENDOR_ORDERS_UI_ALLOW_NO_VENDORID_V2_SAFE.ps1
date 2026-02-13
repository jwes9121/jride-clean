# PATCH-JRIDE_VENDOR_ORDERS_UI_ALLOW_NO_VENDORID_V2_SAFE.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\vendor-orders\page.tsx"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$bak = "$target.bak.$(Stamp)"
Copy-Item $target $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $target -Raw

# 1) Soften any vendor_id_required throw (do not block before API call)
if($txt -match "vendor_id_required"){
  # Replace the specific throw line(s) but keep braces intact
  $txt2 = ($txt -split "`r?`n") | ForEach-Object {
    if($_ -match "throw new Error" -and $_ -match "vendor_id_required"){
      "        // vendor_id_required: allow API to resolve vendor from session (no URL param required)"
    } else {
      $_
    }
  }
  $txt = ($txt2 -join "`r`n")
  Write-Host "[OK] Neutralized vendor_id_required throw line(s)" -ForegroundColor Green
} else {
  Write-Host "[WARN] No vendor_id_required found (skipped throw neutralize)" -ForegroundColor Yellow
}

# 2) Update fetch URL variants safely (no regex)
# Variant A: uses vendorIdFromQuery
$oldA = '"/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorIdFromQuery)'
$new  = '(vendorId ? "/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorId) : "/api/vendor-orders")'
if($txt.Contains($oldA)){
  $txt = $txt.Replace($oldA, $new)
  Write-Host "[OK] Updated fetch URL (vendorIdFromQuery -> conditional vendorId)" -ForegroundColor Green
}

# Variant B: uses vendorId
$oldB = '"/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorId)'
if($txt.Contains($oldB)){
  $txt = $txt.Replace($oldB, $new)
  Write-Host "[OK] Updated fetch URL (vendorId -> conditional vendorId)" -ForegroundColor Green
}

# If neither variant found, fail safely so we don't silently do nothing
if((-not $txt.Contains($new))){
  Fail "Could not locate and replace the fetch URL for /api/vendor-orders. Paste the fetch(...) line that calls /api/vendor-orders from app/vendor-orders/page.tsx."
}

# Write UTF-8 NO BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))
Write-Host "[OK] Wrote UTF-8 no BOM + patched vendor-orders UI" -ForegroundColor Green
