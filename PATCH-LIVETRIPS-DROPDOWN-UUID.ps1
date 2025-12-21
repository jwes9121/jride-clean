# PATCH-LIVETRIPS-DROPDOWN-UUID.ps1
# Makes driver dropdown show FULL UUID + name (no layout changes)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$root = (Get-Location).Path
$f = Join-Path $root "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path $f)) { Fail "Missing: $f" }

$txt = Get-Content -Raw -Encoding UTF8 $f
$orig = $txt

# Insert a helper formatter near other helpers (after normalizeTripStatus if present, else after type TripRow)
if ($txt -notmatch 'function\s+formatDriverOptionLabel\s*\(') {
  if ($txt -match '(?s)(function\s+normalizeTripStatus[^{]*\{[\s\S]*?\}\s*)') {
    $txt = [regex]::Replace($txt, '(?s)(function\s+normalizeTripStatus[^{]*\{[\s\S]*?\}\s*)',
@'
$1

function formatDriverOptionLabel(d: any, idx: number) {
  const id = String(d?.driver_id || d?.id || d?.uuid || "");
  const full = id || "";
  const short = full ? full.slice(0, 8) : String(idx + 1);
  const displayName = d?.name ? String(d.name) : `Driver ${short}`;
  const town = d?.town ? String(d.town) : "";
  const status = d?.status ? String(d.status) : "";
  return `${displayName} — ${full || short}${town ? ` — ${town}` : ""}${status ? ` — ${status}` : ""}`.trim();
}

'@, 1)
  } elseif ($txt -match '(?s)(type\s+TripRow\s*=\s*\{[\s\S]*?\}\s*;\s*)') {
    $txt = [regex]::Replace($txt, '(?s)(type\s+TripRow\s*=\s*\{[\s\S]*?\}\s*;\s*)',
@'
$1

function formatDriverOptionLabel(d: any, idx: number) {
  const id = String(d?.driver_id || d?.id || d?.uuid || "");
  const full = id || "";
  const short = full ? full.slice(0, 8) : String(idx + 1);
  const displayName = d?.name ? String(d.name) : `Driver ${short}`;
  const town = d?.town ? String(d.town) : "";
  const status = d?.status ? String(d.status) : "";
  return `${displayName} — ${full || short}${town ? ` — ${town}` : ""}${status ? ` — ${status}` : ""}`.trim();
}

'@, 1)
  } else {
    Fail "Could not find anchor to insert formatDriverOptionLabel()"
  }
}

# Replace any label = `...` inside drivers.map option builder with our helper (non-destructive)
# This targets patterns like: const label = `...`; then <option> {label} </option>
if ($txt -match '(?s)drivers\.map\(\(.*?\)\s*=>\s*\{[\s\S]*?<option[\s\S]*?\{label\}[\s\S]*?<\/option>') {
  # Replace the label assignment line(s) with: const label = formatDriverOptionLabel(d, idx);
  $txt = [regex]::Replace(
    $txt,
    '(?s)(drivers\.map\(\(\s*(?<var>\w+)\s*,\s*(?<idx>\w+)\s*\)\s*=>\s*\{[\s\S]*?)(const\s+label\s*=\s*`[\s\S]*?`\.trim\(\);\s*)',
    '${1}const label = formatDriverOptionLabel(${var}, ${idx});' + "`r`n",
    1
  )
} else {
  Write-Host "NOTE: Could not detect a drivers.map(...) <option>{label}</option> block. No label replacement applied." -ForegroundColor Yellow
}

if ($txt -eq $orig) {
  Write-Host "NOTE: No changes applied (patterns may differ)." -ForegroundColor Yellow
} else {
  Set-Content -Path $f -Value $txt -Encoding UTF8
  Write-Host "OK: Driver dropdown now shows FULL UUID + name." -ForegroundColor Green
}

Set-StrictMode -Off
