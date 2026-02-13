# PATCH-JRIDE_VENDOR_ORDERS_UUID_EMPTY_GUARD_V2.ps1
# Robust fix: enforce vendor_id required for BOTH GET and POST, regardless of surrounding auth/pilot logic.
# Inserts guard immediately after vendor_id is parsed.
# UTF-8 no BOM + backups.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$api = Join-Path $root "app\api\vendor-orders\route.ts"
if (!(Test-Path $api)) { Fail "Missing file: $api" }

Copy-Item -Force $api "$api.bak.$ts"
Ok "Backup: $api.bak.$ts"

$txt = [System.IO.File]::ReadAllText($api)

# Helper: insert a guard after the first "const vendor_id = ...;" inside a specific function block
function InsertGuardAfterVendorId([string]$src, [string]$fnName) {
  $fnPat = "(?s)(export\s+async\s+function\s+$fnName\s*\([^)]*\)\s*\{)(.*?)(\}\s*)$"
  $m = [regex]::Match($src, $fnPat)
  if (!$m.Success) { return @{ ok=$false; text=$src; why="Function $fnName not found" } }

  $head = $m.Groups[1].Value
  $body = $m.Groups[2].Value
  $tail = $m.Groups[3].Value

  # If guard already exists, skip
  if ($body -match 'error:\s*"vendor_id_required"' -and $body -match 'vendor_id required') {
    return @{ ok=$true; text=$src; why="Guard already present in $fnName" }
  }

  # Find vendor_id parse line inside the function body
  $vendorLinePat = "(?s)(const\s+vendor_id\s*=\s*.*?;\s*)"
  $vm = [regex]::Match($body, $vendorLinePat)
  if (!$vm.Success) {
    return @{ ok=$false; text=$src; why="Could not find 'const vendor_id = ...;' inside $fnName" }
  }

  $before = $body.Substring(0, $vm.Index + $vm.Length)
  $after  = $body.Substring($vm.Index + $vm.Length)

  $guard = @'
  // Guard: never pass empty string "" to uuid filters.
  if (!vendor_id) {
    return json(400, {
      ok: false,
      error: "vendor_id_required",
      message: "vendor_id required (missing vendor context)",
    });
  }

'@

  $newBody = $before + $guard + $after
  $newSrc = $head + $newBody + $tail
  return @{ ok=$true; text=$newSrc; why="Inserted guard in $fnName" }
}

# Insert guards in GET and POST
$r1 = InsertGuardAfterVendorId -src $txt -fnName "GET"
if (!$r1.ok) { Fail "GET patch failed: $($r1.why). Paste the first 200 lines of $api." }
$txt2 = $r1.text
Ok $r1.why

$r2 = InsertGuardAfterVendorId -src $txt2 -fnName "POST"
if (!$r2.ok) { Fail "POST patch failed: $($r2.why). Paste the POST section of $api." }
$txt3 = $r2.text
Ok $r2.why

[System.IO.File]::WriteAllText($api, $txt3, $utf8NoBom)
Ok "Patched: $api"
Ok "vendor_id empty-string UUID guard applied to GET + POST."
