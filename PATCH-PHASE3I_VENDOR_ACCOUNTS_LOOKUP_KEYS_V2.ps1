# PATCH-PHASE3I_VENDOR_ACCOUNTS_LOOKUP_KEYS_V2.ps1
# Replace vendor_accounts lookup candidates block to match real schema.
# ASCII-safe; creates .bak backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$target = Join-Path (Get-Location).Path "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing: $target" }

$src = Get-Content -Raw -Encoding UTF8 $target

$old = @'
  const candidates: Array<[string, string]> = [
    ["vendor_accounts", "id"],
    ["vendor_accounts", "vendor_id"],
  ];
'@

if ($src -notmatch [regex]::Escape($old)) {
  Fail "Could not find the exact candidates block to replace. Paste the full fetchVendorCoordsAndTown() function block from vendor-orders/route.ts."
}

$new = @'
  const candidates: Array<[string, string]> = [
    ["vendor_accounts", "id"],
    ["vendor_accounts", "email"],
    ["vendor_accounts", "display_name"],
    ["vendor_accounts", "location_label"],
  ];
'@

$src2 = $src.Replace($old, $new)

$bak = "$target.bak.$ts"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

Set-Content -Encoding UTF8 -NoNewline -Path $target -Value $src2
Ok "Patched: $target"
Ok "Updated vendor_accounts lookup keys (id/email/display_name/location_label)."
