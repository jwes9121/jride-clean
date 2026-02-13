# PATCH-JRIDE_PHASE8B_INCLUDE_ARRIVED_LIVETRIPS_FIXED.ps1
# Include 'arrived' in LiveTrips backend status filters (page-data + summary)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw "[FAIL] $m" }

function Backup-File([string]$Path){
  if(!(Test-Path $Path)){ Fail "Missing file: $Path" }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$Path.bak.$ts"
  Copy-Item -LiteralPath $Path -Destination $bak -Force
  Ok "Backup: $bak"
}

function WriteUtf8NoBom([string]$Path, [string]$Content){
  [System.IO.File]::WriteAllText($Path, $Content, (New-Object System.Text.UTF8Encoding($false)))
}

function Patch-StatusLists([string]$txt){
  $orig = $txt

  # 1) REST query strings: status=in.(assigned,on_the_way,on_trip)
  $txt = [regex]::Replace(
    $txt,
    "status\s*=\s*in\.\(\s*assigned\s*,\s*on_the_way\s*,\s*on_trip\s*\)",
    "status=in.(assigned,on_the_way,arrived,on_trip)"
  )

  # 2) REST query strings with enroute: status=in.(assigned,on_the_way,enroute,on_trip)
  $txt = [regex]::Replace(
    $txt,
    "status\s*=\s*in\.\(\s*assigned\s*,\s*on_the_way\s*,\s*enroute\s*,\s*on_trip\s*\)",
    "status=in.(assigned,on_the_way,arrived,enroute,on_trip)"
  )

  # 3) JS/TS arrays with single quotes: ['assigned','on_the_way','on_trip']
  $txt = [regex]::Replace(
    $txt,
    "\[\s*'assigned'\s*,\s*'on_the_way'\s*,\s*'on_trip'\s*\]",
    "['assigned','on_the_way','arrived','on_trip']"
  )

  # 4) JS/TS arrays with double quotes: [\"assigned\",\"on_the_way\",\"on_trip\"]
  $txt = [regex]::Replace(
    $txt,
    "\[\s*""assigned""\s*,\s*""on_the_way""\s*,\s*""on_trip""\s*\]",
    "[""assigned"",""on_the_way"",""arrived"",""on_trip""]"
  )

  # 5) Supabase .in('status', ['assigned','on_the_way','on_trip'])
  $txt = [regex]::Replace(
    $txt,
    "\.in\(\s*'status'\s*,\s*\[\s*'assigned'\s*,\s*'on_the_way'\s*,\s*'on_trip'\s*\]\s*\)",
    ".in('status', ['assigned','on_the_way','arrived','on_trip'])"
  )

  # 6) Supabase .in(""status"", [""assigned"",""on_the_way"",""on_trip""])
  $txt = [regex]::Replace(
    $txt,
    "\.in\(\s*""status""\s*,\s*\[\s*""assigned""\s*,\s*""on_the_way""\s*,\s*""on_trip""\s*\]\s*\)",
    ".in(""status"", [""assigned"",""on_the_way"",""arrived"",""on_trip""])"
  )

  # 7) Common const patterns: const ACTIVE_STATUSES = [...]
  $txt = [regex]::Replace(
    $txt,
    "(const\s+(ACTIVE_STATUSES|activeStatuses|LIVE_STATUSES|STATUSES_IN|ACTIVE_STATUS_SET)\s*=\s*)\[\s*'assigned'\s*,\s*'on_the_way'\s*,\s*'on_trip'\s*\]",
    "`$1['assigned','on_the_way','arrived','on_trip']"
  )

  $txt = [regex]::Replace(
    $txt,
    "(const\s+(ACTIVE_STATUSES|activeStatuses|LIVE_STATUSES|STATUSES_IN|ACTIVE_STATUS_SET)\s*=\s*)\[\s*""assigned""\s*,\s*""on_the_way""\s*,\s*""on_trip""\s*\]",
    "`$1[""assigned"",""on_the_way"",""arrived"",""on_trip""]"
  )

  return @{ Old = $orig; New = $txt }
}

function Patch-File([string]$Path){
  Backup-File $Path
  $txt = Get-Content -LiteralPath $Path -Raw
  $patched = (Patch-StatusLists $txt).New

  if($patched -ne $txt){
    WriteUtf8NoBom $Path $patched
    Ok "Wrote changes: $Path"
    return $true
  } else {
    Warn "No change needed: $Path"
    return $false
  }
}

# --- Main ---
$root = (Get-Location).Path
$pageData = Join-Path $root "app\api\admin\livetrips\page-data\route.ts"
$summary  = Join-Path $root "app\api\admin\livetrips\summary\route.ts"

$any = $false

if(!(Test-Path $pageData)){ Fail "Missing expected file: app\api\admin\livetrips\page-data\route.ts" }
Ok "Patching: $pageData"
if(Patch-File $pageData){ $any = $true }

if(Test-Path $summary){
  Ok "Patching: $summary"
  if(Patch-File $summary){ $any = $true }
} else {
  Warn "summary route not found (skip): app\api\admin\livetrips\summary\route.ts"
}

if(-not $any){
  Warn "No edits were applied. If Arrived still doesn't show, the filter may live inside the RPC (admin_get_live_trips_page_data)."
} else {
  Ok "Patch complete. Build + deploy, then test: Admin Actions set trip -> arrived; LiveTrips should show it under Arrived tab."
}
