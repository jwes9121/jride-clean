# DIAG-JRIDE_PHASE8D1_FIND_LIVETRIPS_PAGEDATA_FILTER.ps1
# ASCII-only. Finds LiveTrips "page data" route and prints any status filter blocks.

$ErrorActionPreference = "Stop"

function Say($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host "[WARN] $m" -ForegroundColor Yellow }
function Fail($m){ throw "[FAIL] $m" }

if (!(Test-Path "app")) { Fail "Run from repo root (folder that contains /app)." }

Say "Searching for candidate LiveTrips page-data routes..."
$routes = Get-ChildItem -Path "app\api" -Recurse -Filter "route.ts" |
  Where-Object { $_.FullName -match 'livetrips' -and $_.FullName -match 'page-data|pagedata|page_data|live' }

if (!$routes -or $routes.Count -eq 0) {
  Warn "No obvious livetrips page-data route found by name."
  Say "Fallback: list any routes under app\api\admin\livetrips\*"
  $fallback = Get-ChildItem -Path "app\api\admin\livetrips" -Recurse -Filter "route.ts" -ErrorAction SilentlyContinue
  if (!$fallback) { Fail "No route.ts found under app\api\admin\livetrips. Paste your app/api/admin/livetrips tree." }
  $routes = $fallback
}

Say ""
Say "Found route candidates:"
$routes | ForEach-Object { Write-Host (" - " + $_.FullName) }

Say ""
Say "---- Extracting status filter hints (lines containing status + IN/eq/includes) ----"

foreach($r in $routes) {
  Say ""
  Say ("=== " + $r.FullName + " ===")
  $lines = Get-Content $r.FullName

  $any = $false
  for($i=0; $i -lt $lines.Count; $i++){
    $ln = $lines[$i]
    if ($ln -match 'status' -and ($ln -match 'on_the_way|on_trip|assigned|arrived|enroute|requested|completed|cancelled|IN\s*\(|includes\(')) {
      $any = $true
      $start = [Math]::Max(0, $i-3)
      $end = [Math]::Min($lines.Count-1, $i+6)

      for($j=$start; $j -le $end; $j++){
        Write-Host ("{0,5}: {1}" -f ($j+1), $lines[$j])
      }
      Write-Host ""
    }
  }
  if (-not $any) {
    Warn "No obvious status filter snippet found in this file."
  }
}

Say ""
Say "DONE. If you see a list like ['pending','assigned','on_the_way','on_trip',...] without 'arrived', that is the bug."
