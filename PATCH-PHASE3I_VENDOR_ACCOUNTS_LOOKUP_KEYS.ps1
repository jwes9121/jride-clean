# PATCH-PHASE3I_VENDOR_ACCOUNTS_LOOKUP_KEYS.ps1
# Fix vendor lookup for coords: vendor_accounts has NO vendor_id column.
# Try id/email/display_name/location_label.
# ASCII-safe; creates .bak backup.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$root = (Get-Location).Path
$target = Join-Path $root "app\api\vendor-orders\route.ts"
if (!(Test-Path $target)) { Fail "Missing: $target" }

$src = Get-Content -Raw -Encoding UTF8 $target

# Find the candidates block inside fetchVendorCoordsAndTown
$pattern = '(?s)async\s+function\s+fetchVendorCoordsAndTown\s*\([^)]*\)\s*:\s*Promise<\{[^}]*\}>\s*\{.*?const\s+candidates\s*:\s*Array<\[\s*string\s*,\s*string\s*\]>\s*=\s*\[[^\]]*\];'
$m = [regex]::Match($src, $pattern)
if (!$m.Success) {
  Fail "Could not locate fetchVendorCoordsAndTown() candidates array in $target. Paste that function block if this persists."
}

$old = $m.Value

# Replace ONLY the candidates array content
$oldCandidatesPattern = '(?s)const\s+candidates\s*:\s*Array<\[\s*string\s*,\s*string\s*\]>\s*=\s*\[[^\]]*\];'
$newCandidates = @'
const candidates: Array<[string, string]> = [
    ["vendor_accounts", "id"],
    ["vendor_accounts", "email"],
    ["vendor_accounts", "display_name"],
    ["vendor_accounts", "location_label"],
  ];
'@

$patched = [regex]::Replace($old, $oldCandidatesPattern, $newCandidates, 1)

$src2 = $src.Replace($old, $patched)

$bak = "$target.bak.$ts"
Copy-Item -Force $target $bak
Ok "Backup: $bak"

Set-Content -Encoding UTF8 -NoNewline -Path $target -Value $src2
Ok "Patched: $target"
Ok "Vendor lookup keys updated (id/email/display_name/location_label)."
