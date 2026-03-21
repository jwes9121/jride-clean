param(
  [Parameter(Mandatory = $true)]
  [string]$WebRoot
)

$ErrorActionPreference = 'Stop'

function Write-Ok($msg) {
  Write-Host "[OK] $msg" -ForegroundColor Green
}

function Write-WarnMsg($msg) {
  Write-Host "[WARN] $msg" -ForegroundColor Yellow
}

function Ensure-Dir([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) {
    New-Item -ItemType Directory -Path $path -Force | Out-Null
  }
}

function Backup-File([string]$filePath, [string]$tag) {
  $dir = Split-Path -Parent $filePath
  $bakDir = Join-Path $dir "_patch_bak"
  Ensure-Dir $bakDir
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bakPath = Join-Path $bakDir ((Split-Path -Leaf $filePath) + ".bak.$tag.$stamp")
  Copy-Item -LiteralPath $filePath -Destination $bakPath -Force
  Write-Ok "Backup: $bakPath"
}

$target = Join-Path $WebRoot "app\api\admin\livetrips\page-data\route.ts"
if (-not (Test-Path -LiteralPath $target)) {
  throw "Target file not found: $target"
}

Backup-File -filePath $target -tag "LIVETRIPS_PAGE_DATA_STRICT_STATUS_FILTER_V1"

$content = Get-Content -LiteralPath $target -Raw

# Normalize line endings for safer matching/editing
$content = $content -replace "`r`n", "`n"

# 1) Add canonical allowed statuses constant after quarantined booking codes set
if ($content -notmatch "const\s+LIVETRIPS_ALLOWED_TRIP_STATUSES\s*=\s*new\s+Set<string>") {
  $anchorPattern = 'const LIVETRIPS_QUARANTINED_BOOKING_CODES = new Set<string>\(\[[\s\S]*?\]\);'
  $anchorMatch = [regex]::Match($content, $anchorPattern)
  if (-not $anchorMatch.Success) {
    throw "Could not find LIVETRIPS_QUARANTINED_BOOKING_CODES block"
  }

  $insert = @'

const LIVETRIPS_ALLOWED_TRIP_STATUSES = new Set<string>([
  "requested",
  "assigned",
  "on_the_way",
]);

'@

  $content = $content.Insert($anchorMatch.Index + $anchorMatch.Length, $insert)
  Write-Ok "Inserted LIVETRIPS_ALLOWED_TRIP_STATUSES"
}
else {
  Write-WarnMsg "LIVETRIPS_ALLOWED_TRIP_STATUSES already present; skipping insert"
}

# 2) Replace normalizeTrip status fallback from "pending" to null
$statusOld = 'status: r.status ?? "pending",'
$statusNew = 'status: r.status ?? null,'
if ($content.Contains($statusOld)) {
  $content = $content.Replace($statusOld, $statusNew)
  Write-Ok 'Replaced status fallback from "pending" to null'
}
elseif ($content.Contains($statusNew)) {
  Write-WarnMsg 'Status fallback already set to null'
}
else {
  throw 'Could not find normalizeTrip status fallback line'
}

# 3) Add strict status filter helper after excludeQuarantinedTrips
if ($content -notmatch "function\s+filterDispatchEligibleTrips\s*\(") {
  $excludePattern = 'function excludeQuarantinedTrips\(rows: Json\[\]\): Json\[\] \{[\s\S]*?\n\}'
  $excludeMatch = [regex]::Match($content, $excludePattern)
  if (-not $excludeMatch.Success) {
    throw "Could not find excludeQuarantinedTrips function"
  }

  $helper = @'

function filterDispatchEligibleTrips(rows: Json[]): Json[] {
  return rows.filter((row: any) => {
    const status = String(row?.status ?? "").trim().toLowerCase();
    return LIVETRIPS_ALLOWED_TRIP_STATUSES.has(status);
  });
}
'@

  $content = $content.Insert($excludeMatch.Index + $excludeMatch.Length, $helper)
  Write-Ok "Inserted filterDispatchEligibleTrips helper"
}
else {
  Write-WarnMsg "filterDispatchEligibleTrips already present; skipping insert"
}

# 4) Replace broad bookings select with explicit status-filtered select
$oldQuery = @'
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);
'@

$newQuery = @'
  const { data, error } = await supabase
    .from("bookings")
    .select("*")
    .in("status", ["requested", "assigned", "on_the_way"])
    .order("updated_at", { ascending: false, nullsFirst: false })
    .limit(300);
'@

if ($content.Contains($oldQuery)) {
  $content = $content.Replace($oldQuery, $newQuery)
  Write-Ok "Replaced bookings query with explicit status filter"
}
elseif ($content.Contains('.in("status", ["requested", "assigned", "on_the_way"])')) {
  Write-WarnMsg "Bookings query already appears filtered by status"
}
else {
  throw "Could not find the bookings select(*) query block to replace"
}

# 5) Replace normalization pipeline to enforce strict status filtering again after normalizeTrip
$oldPipeline = @'
  const rows = Array.isArray(data) ? data : [];
  const filteredRows = excludeQuarantinedTrips(rows);
  const normalizedTrips = filteredRows.map((row: any) => normalizeTrip(row));
  const usedColumns = rows.length ? Object.keys(normalizeKeys(rows[0])) : ([] as string[]);
'@

$newPipeline = @'
  const rows = Array.isArray(data) ? data : [];
  const filteredRows = excludeQuarantinedTrips(rows);
  const normalizedTrips = filterDispatchEligibleTrips(
    filteredRows.map((row: any) => normalizeTrip(row))
  );
  const usedColumns = rows.length ? Object.keys(normalizeKeys(rows[0])) : ([] as string[]);
'@

if ($content.Contains($oldPipeline)) {
  $content = $content.Replace($oldPipeline, $newPipeline)
  Write-Ok "Replaced normalization pipeline with strict post-normalize status filter"
}
elseif ($content.Contains('const normalizedTrips = filterDispatchEligibleTrips(')) {
  Write-WarnMsg "Normalization pipeline already appears strictly filtered"
}
else {
  throw "Could not find normalization pipeline block to replace"
}

# Restore CRLF
$content = $content -replace "`n", "`r`n"

Set-Content -LiteralPath $target -Value $content -Encoding UTF8
Write-Ok "Patched: $target"

Write-Host ""
Write-Host "NEXT:" -ForegroundColor Cyan
Write-Host "1. Rebuild/redeploy the web app"
Write-Host "2. Hard refresh LiveTrips (Ctrl+Shift+R)"
Write-Host "3. Ghost cancelled/completed trips should no longer appear"