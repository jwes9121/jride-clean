param(
  [Parameter(Mandatory=$true)]
  [string]$RepoRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Path([string]$p, [string]$label) {
  if (!(Test-Path -LiteralPath $p)) { throw ("Missing " + $label + ": " + $p) }
}

$repo = (Resolve-Path -LiteralPath $RepoRoot).Path
$target = Join-Path $repo "app\api\public\passenger\book\route.ts"
Assert-Path $target "target file"

$bakDir = Join-Path $repo "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("route.ts.bak.DIAG_PASSENGER_BOOKINGS_INSERT_V1." + $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force

$lines = Get-Content -LiteralPath $target
$max = $lines.Count

function Dump-Context([int]$lineNo, [int]$radius) {
  $start = [Math]::Max(1, $lineNo - $radius)
  $end   = [Math]::Min($max, $lineNo + $radius)
  $out = @()
  $out += ("---- CONTEXT L{0}-L{1} ----" -f $start, $end)
  for ($i=$start; $i -le $end; $i++) {
    $out += ("{0,5}: {1}" -f $i, $lines[$i-1])
  }
  return $out
}

$hits = @()

# 1) Find any from("bookings") / from('bookings')
$reFrom = [regex]'from\(\s*["'']bookings["'']\s*\)'
for ($i=1; $i -le $max; $i++) {
  if ($reFrom.IsMatch($lines[$i-1])) {
    $hits += ("HIT from(bookings) at line {0}" -f $i)
    $hits += Dump-Context $i 20
    $hits += ""
  }
}

# 2) Find insert/upsert near bookings keywords
$reIU = [regex]'(\.insert\(|\.upsert\()'
$reBook = [regex]'bookings'
for ($i=1; $i -le $max; $i++) {
  $ln = $lines[$i-1]
  if ($reIU.IsMatch($ln) -and $reBook.IsMatch($ln)) {
    $hits += ("HIT insert/upsert + bookings on same line {0}" -f $i)
    $hits += Dump-Context $i 20
    $hits += ""
  }
}

# 3) Find BOOKING_INSERT_FAILED handler area (you said line ~624)
$reFail = [regex]'BOOKING_INSERT_FAILED|BOOK_FAILED|violates check constraint|bookings_driver_required_status'
for ($i=1; $i -le $max; $i++) {
  if ($reFail.IsMatch($lines[$i-1])) {
    $hits += ("HIT booking failure handler at line {0}" -f $i)
    $hits += Dump-Context $i 30
    $hits += ""
  }
}

$diagDir = Join-Path $repo "_diag_out"
New-Item -ItemType Directory -Force -Path $diagDir | Out-Null
$outPath = Join-Path $diagDir ("PASSENGER_BOOKINGS_INSERT_SNIPPET_" + $ts + ".txt")

if ($hits.Count -eq 0) {
  $hits = @(
    "NO HITS FOUND for from('bookings') in route.ts (unexpected).",
    "File: " + $target,
    "Tip: the insert might be via RPC or helper; we need to search for 'bookings' and '.from(' across the whole file."
  )
}

Set-Content -LiteralPath $outPath -Value ($hits -join "`r`n") -Encoding UTF8

Write-Host "== DIAG DONE ==" -ForegroundColor Cyan
Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green
Write-Host ("[OK] Report: " + $outPath) -ForegroundColor Green
Write-Host ""
Write-Host "NEXT: Open the report and paste the block that shows the bookings insert." -ForegroundColor Yellow