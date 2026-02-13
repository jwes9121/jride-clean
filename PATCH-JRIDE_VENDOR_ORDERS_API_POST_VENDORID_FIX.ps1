# PATCH-JRIDE_VENDOR_ORDERS_API_POST_VENDORID_FIX.ps1
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }
function Fail($m){ throw $m }

$target = "app\api\vendor-orders\route.ts"
if(!(Test-Path $target)){ Fail "Missing file: $target" }

$bak = "$target.bak." + (Stamp)
Copy-Item $target $bak -Force
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

$txt = Get-Content $target -Raw

# Fix POST block: vendor_id should NOT reference vendorIdFromQuery.
# Replace any occurrence of: const vendor_id = vendorIdFromQuery || ...session...
$txt2 = [regex]::Replace(
  $txt,
  '(?m)^\s*const\s+vendor_id\s*=\s*vendorIdFromQuery\s*\|\|\s*\(session\s+as\s+any\)\?\.\s*user\?\.\s*vendor_id\s*\|\|\s*\(session\s+as\s+any\)\?\.\s*user\?\.\s*vendorId\s*\|\|\s*null\s*;\s*$',
  '    const vendor_id = String((body as any)?.vendor_id ?? (body as any)?.vendorId ?? "").trim() || (session as any)?.user?.vendor_id || (session as any)?.user?.vendorId || null;',
  1
)

if($txt2 -eq $txt){
  # Fallback: replace a slightly different spacing variant
  $txt2 = [regex]::Replace(
    $txt,
    '(?m)^\s*const\s+vendor_id\s*=\s*vendorIdFromQuery\s*\|\|\s*\(session\s+as\s+any\)\?\.\s*user\?\.\s*vendor_id\s*\|\|\s*\(session\s+as\s+any\)\?\.\s*user\?\.\s*vendorId\s*\|\|\s*null\s*;\s*$',
    '    const vendor_id = String((body as any)?.vendor_id ?? (body as any)?.vendorId ?? "").trim() || (session as any)?.user?.vendor_id || (session as any)?.user?.vendorId || null;',
    1
  )
}

if($txt2 -eq $txt){
  Fail "Could not locate the POST vendor_id line referencing vendorIdFromQuery. Paste lines 220-260 of app/api/vendor-orders/route.ts."
}

$txt = $txt2
Write-Host "[OK] Fixed POST vendor_id resolution (body first, no vendorIdFromQuery)" -ForegroundColor Green

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllBytes((Resolve-Path $target), $utf8NoBom.GetBytes($txt))

Write-Host ("[OK] Patched: " + $target) -ForegroundColor Green
