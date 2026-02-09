# SCAN-JRIDE_BACKEND_ACCEPT_ON_THE_WAY_LOCATE_V1_1.ps1
# Finds which backend route updates bookings status to "accepted"/"on_the_way"/etc.
# PS5-safe

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Die($m){ Write-Host $m -ForegroundColor Red; exit 1 }

$RepoRoot = (Get-Location).Path
$ApiRoot = Join-Path $RepoRoot "app\api"

if (-not (Test-Path -LiteralPath $ApiRoot)) {
  Die "[FAIL] app\api not found. Run this from your Next.js repo root."
}

$files = Get-ChildItem -LiteralPath $ApiRoot -Recurse -File -Filter "route.ts"
if (-not $files -or $files.Count -eq 0) {
  Die "[FAIL] No route.ts files found under app\api"
}

$needles = @(
  'status:\s*"on_the_way"',
  'status:\s*"accepted"',
  'status\s*=\s*"on_the_way"',
  'status\s*=\s*"accepted"',
  '"on_the_way"',
  '"accepted"',
  '"arrived"',
  '"on_trip"'
)

$hits = @()

foreach ($f in $files) {
  $path = $f.FullName
  $txt = ""
  try { $txt = Get-Content -LiteralPath $path -Raw -Encoding UTF8 } catch { continue }

  $touchesBookings =
    ($txt -match '\.from\("bookings"\)') -or
    ($txt -match '\.from\(\s*["'']bookings["'']\s*\)') -or
    ($txt -match 'from\s*:\s*["'']bookings["'']')

  if (-not $touchesBookings) { continue }

  $score = 0
  foreach ($n in $needles) {
    if ($txt -match $n) { $score += 1 }
  }

  if ($score -gt 0) {
    $hits += [pscustomobject]@{
      Score = $score
      File  = $path
    }
  }
}

if (-not $hits -or $hits.Count -eq 0) {
  Warn "[WARN] No candidates found that touch bookings + mention accepted/on_the_way."
  Warn "If your status update uses RPC/functions, we’ll scan SQL routines next."
  exit 0
}

# PS5-safe sorting: sort by Score desc, then File asc
$hits = $hits | Sort-Object -Property @{Expression="Score"; Descending=$true}, @{Expression="File"; Descending=$false}

Ok ("[OK] Found {0} candidate route.ts files" -f $hits.Count)
Info ""
Info "== TOP CANDIDATES (highest score first) =="
$hits | Select-Object -First 15 | ForEach-Object {
  Info ("Score {0}  {1}" -f $_.Score, $_.File)
}

Info ""
Info "== SNIPPETS (first 3 candidates) =="
$top = $hits | Select-Object -First 3
foreach ($h in $top) {
  Info ""
  Info ("--- " + $h.File + " ---")
  $lines = Get-Content -LiteralPath $h.File -Encoding UTF8
  for ($i=0; $i -lt $lines.Count; $i++) {
    $ln = $lines[$i]
    if ($ln -match '"on_the_way"' -or $ln -match '"accepted"' -or $ln -match 'status') {
      $start = [Math]::Max(0, $i-3)
      $end   = [Math]::Min($lines.Count-1, $i+3)
      for ($j=$start; $j -le $end; $j++) {
        $prefix = if ($j -eq $i) { ">>" } else { "  " }
        Write-Host ("{0}{1,5}: {2}" -f $prefix, ($j+1), $lines[$j])
      }
      break
    }
  }
}

Ok ""
Ok "== DONE =="
