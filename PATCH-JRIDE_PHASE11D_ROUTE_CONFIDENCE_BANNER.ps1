# PATCH-JRIDE_PHASE11D_ROUTE_CONFIDENCE_BANNER.ps1
# PowerShell 5.x, ASCII-only
# Patches ONLY: app/ride/page.tsx

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$RepoRoot = Get-Location
$FileRel  = "app\ride\page.tsx"
$FilePath = Join-Path $RepoRoot $FileRel
if (!(Test-Path $FilePath)) { Fail "File not found: $FilePath (Run from repo root.)" }

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FilePath.bak.$ts"
Copy-Item -LiteralPath $FilePath -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $FilePath -Raw

# Anchor: the exact header div on the map picker
$anchor = '<div className="px-3 py-2 text-xs opacity-70 border-b border-black/10 bg-white">'
if ($txt.IndexOf($anchor) -lt 0) { Fail "Anchor not found: map picker header div" }

# Replace the entire header block (the first occurrence only)
$re = '(?s)<div className="px-3 py-2 text-xs opacity-70 border-b border-black/10 bg-white">.*?</div>'
if (-not [regex]::IsMatch($txt, $re)) { Fail "Could not locate map picker header block for replacement." }

$new = @"
<div className="px-3 py-2 text-xs opacity-70 border-b border-black/10 bg-white">
                  <div>
                    Tap the map to set {pickMode}. Markers: green pickup, red dropoff.
                  </div>

                  {hasBothPoints() ? (
                    <div className="mt-2 flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center rounded-full bg-black/5 px-2 py-0.5 text-[11px]">
                          {routeInfo ? "Route ready" : "Route loading"}
                        </span>
                        <span className="text-[11px]">
                          {routeInfo
                            ? (Math.round(routeInfo.distance_m / 10) / 100) + " km, " + Math.round(routeInfo.duration_s / 60) + " min"
                            : "Fetching route..."}
                          {routeErr ? (" | " + routeErr) : ""}
                        </span>
                      </div>

                      <div className="text-[11px]">
                        Pickup near: <b>{String(fromLabel || "").trim() || "(unset)"}</b>
                      </div>
                      <div className="text-[11px]">
                        Dropoff near: <b>{String(toLabel || "").trim() || "(unset)"}</b>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 text-[11px]">
                      Route preview: set both pickup and dropoff.
                    </div>
                  )}
                </div>
"@

# Replace only first match (keeps any other similar divs untouched)
$txt2 = [regex]::Replace($txt, $re, $new, 1)
if ($txt2 -eq $txt) { Fail "No change produced (unexpected). Aborting." }

Set-Content -LiteralPath $FilePath -Value $txt2 -Encoding UTF8
Write-Host "[DONE] Patched: $FileRel"
