# PATCH-JRIDE_ADMIN_DRIVER_LOCATIONS_NORMALIZE_ONLINE_TO_AVAILABLE_V2.ps1
# Robust patch:
# - Inserts a normalization block immediately before the FIRST "return NextResponse.json(" in the file.
# - Normalizes "online" -> "available" for variables named drivers and/or driver_locations if they exist.
# - Works across different JSON return shapes.
# - Patches both driver_locations and driver-locations routes if present.

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }

function Backup([string]$p){
  if(!(Test-Path $p)){ return $null }
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = "$p.bak.$ts"
  Copy-Item -LiteralPath $p -Destination $bak -Force
  return $bak
}

$root = (Get-Location).Path
$routeA = Join-Path $root "app\api\admin\driver_locations\route.ts"
$routeB = Join-Path $root "app\api\admin\driver-locations\route.ts"

$routes = @()
if(Test-Path $routeA){ $routes += $routeA }
if(Test-Path $routeB){ $routes += $routeB }

if($routes.Count -eq 0){
  Fail "No route files found: $routeA or $routeB"
}

$inject = @'
    // Normalize for Admin UI: treat "online" as "available"
    // (Does NOT change DB; only the API response used by LiveTrips.)
    try {
      // If the handler uses variables named "drivers" / "driver_locations", normalize them.
      // If not defined, this safely throws and is ignored.
      // @ts-ignore
      if (typeof drivers !== "undefined") {
        // @ts-ignore
        drivers = (drivers || []).map((r: any) => {
          const s = String((r as any)?.status || "").trim().toLowerCase();
          return s === "online" ? { ...r, status: "available" } : r;
        });
      }
      // @ts-ignore
      if (typeof driver_locations !== "undefined") {
        // @ts-ignore
        driver_locations = (driver_locations || []).map((r: any) => {
          const s = String((r as any)?.status || "").trim().toLowerCase();
          return s === "online" ? { ...r, status: "available" } : r;
        });
      }
    } catch { /* ignore */ }

'@

foreach($p in $routes){
  $bak = Backup $p
  Write-Host "[OK] Backup: $bak"

  $txt = Get-Content -LiteralPath $p -Raw

  if($txt -match "Normalize for Admin UI: treat `"online`" as `"available`""){
    Write-Host "[SKIP] Already normalized in: $p"
    continue
  }

  # Insert right before the FIRST: return NextResponse.json(
  $re = [regex]'(\r?\n)(\s*)return\s+NextResponse\.json\s*\('
  if(-not $re.IsMatch($txt)){
    Fail "Could not find 'return NextResponse.json(' in: $p"
  }

  $txt2 = $re.Replace($txt, { param($m)
      $nl = $m.Groups[1].Value
      $indent = $m.Groups[2].Value
      $block = ($inject -split "`n" | ForEach-Object { if($_ -ne "") { $indent + $_ } else { "" } }) -join "`n"
      return $nl + $block + $nl + $indent + "return NextResponse.json("
    }, 1)

  if($txt2 -eq $txt){
    Fail "No change made to: $p"
  }

  Set-Content -LiteralPath $p -Value $txt2 -Encoding UTF8
  Write-Host "[OK] Patched: $p"
}

Write-Host ""
Write-Host "== Build =="
& npm.cmd run build
Write-Host "== DONE =="
