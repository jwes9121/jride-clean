param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function New-Timestamp {
  return (Get-Date).ToString("yyyyMMdd_HHmmss")
}

function Ensure-Dir([string]$p) {
  if (!(Test-Path -LiteralPath $p)) {
    New-Item -ItemType Directory -Path $p | Out-Null
  }
}

function Write-Section([string]$path, [string]$title) {
  Add-Content -LiteralPath $path -Value ""
  Add-Content -LiteralPath $path -Value ("=" * 92)
  Add-Content -LiteralPath $path -Value $title
  Add-Content -LiteralPath $path -Value ("=" * 92)
}

function Scan-Patterns([string]$root, [string[]]$patterns, [string]$outPath, [string]$title) {

  Write-Section $outPath $title

  $files = Get-ChildItem -LiteralPath $root -Recurse -File -ErrorAction SilentlyContinue

  foreach ($pat in $patterns) {

    Add-Content -LiteralPath $outPath -Value ""
    Add-Content -LiteralPath $outPath -Value ("--- PATTERN: " + $pat)

    $hits = $files | Select-String -Pattern $pat -Encoding UTF8 -ErrorAction SilentlyContinue

    if (!$hits) {
      Add-Content -LiteralPath $outPath -Value "NO HITS"
      continue
    }

    foreach ($h in $hits) {
      $line = $h.Line
      if ($null -eq $line) { $line = "" }
      $line = $line.Trim()
      Add-Content -LiteralPath $outPath -Value ("{0}:{1}: {2}" -f $h.Path, $h.LineNumber, $line)
    }
  }
}

# --- Validate root ---
if (!(Test-Path -LiteralPath $ProjRoot)) {
  throw "ProjRoot not found: $ProjRoot"
}

$ts = New-Timestamp
$diagDir = Join-Path $ProjRoot "_diag_out_$ts"
Ensure-Dir $diagDir

$out = Join-Path $diagDir "SCAN_REPORT_$ts.txt"
New-Item -ItemType File -Path $out -Force | Out-Null

Add-Content -LiteralPath $out -Value "JRIDE SCAN REPORT"
Add-Content -LiteralPath $out -Value "Root: $ProjRoot"
Add-Content -LiteralPath $out -Value "Time: $ts"
Add-Content -LiteralPath $out -Value ""

# Prefer scanning app\api only
$apiRoot = Join-Path $ProjRoot "app\api"
if (Test-Path -LiteralPath $apiRoot) {
  $scanRoot = $apiRoot
} else {
  $scanRoot = $ProjRoot
}

# --- A) Verification submit entrypoints ---
Scan-Patterns -root $scanRoot -patterns @(
  'passenger_verification_requests',
  '\.from\("passenger_verification_requests"\)',
  'id_front_path',
  'selfie_with_id_path',
  'status.?=.?["'']submitted["'']',
  'status.?=.?["'']pending_admin["'']'
) -outPath $out -title "A) VERIFICATION SUBMIT / TABLE REFERENCES"

# --- B) Booking creation entrypoints ---
Scan-Patterns -root $scanRoot -patterns @(
  '\.from\("bookings"\)\.insert',
  '\.from\("bookings"\)\.upsert',
  'booking_code',
  'created_by_user_id',
  'trip_type',
  'takeout',
  'vendor_id'
) -outPath $out -title "B) BOOKING CREATE / INSERT ENTRYPOINTS"

# --- C) Restriction / verified flags ---
Scan-Patterns -root $scanRoot -patterns @(
  'night_allowed',
  'user_metadata',
  'verified',
  'Verification required',
  'Not allowed to book at night'
) -outPath $out -title "C) RESTRICTION / VERIFIED FLAGS REFERENCES"

Write-Host ""
Write-Host "=== SCAN COMPLETE ==="
Write-Host "Report:"
Write-Host $out
Write-Host ""
Write-Host "Open the report and send me the file paths that:"
Write-Host "  - INSERT into passenger_verification_requests"
Write-Host "  - INSERT into bookings"
Write-Host ""