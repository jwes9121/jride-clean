# CLEAN-JRIDE_REMOVE_RECOVERY_ARTIFACTS_AND_GITIGNORE.ps1
# Removes recovery artifact files from git + adds .gitignore rules so they never get committed again.
# HARD RULE: DO_NOT_TOUCH_DISPATCH_STATUS
# ASCII-only

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path

$pathsToRemove = @(
  "New Text Document.txt"
)

# Also remove any tracked recover artifacts under app/admin/livetrips
$livetripsDir = Join-Path $root "app\admin\livetrips"
$artifactPatterns = @(
  "LiveTripsClient.tsx.pre_recover.*",
  "LiveTripsClient.tsx.recovered_green.*"
)

Write-Host "[INFO] Removing tracked recovery artifacts (if present)..."

foreach($p in $pathsToRemove){
  $full = Join-Path $root $p
  if(Test-Path $full){
    Write-Host "[DEL] $p"
    git rm -f -- $p | Out-Host
  }
}

foreach($pat in $artifactPatterns){
  $matches = Get-ChildItem -LiteralPath $livetripsDir -Filter $pat -File -ErrorAction SilentlyContinue
  foreach($m in $matches){
    $rel = "app/admin/livetrips/$($m.Name)"
    Write-Host "[DEL] $rel"
    git rm -f -- $rel | Out-Host
  }
}

# Ensure .gitignore exists
$gitignore = Join-Path $root ".gitignore"
if(!(Test-Path $gitignore)){
  Set-Content -LiteralPath $gitignore -Value "" -Encoding UTF8
}

$gi = Get-Content -LiteralPath $gitignore -Raw -Encoding UTF8

$rules = @(
  "",
  "# JRIDE: local recovery artifacts (do not commit)",
  "app/admin/livetrips/LiveTripsClient.tsx.pre_recover.*",
  "app/admin/livetrips/LiveTripsClient.tsx.recovered_green.*",
  "New Text Document.txt"
)

$needAppend = $false
foreach($r in $rules){
  if($r -eq ""){ continue }
  if($gi -notmatch [regex]::Escape($r)){ $needAppend = $true }
}

if($needAppend){
  Add-Content -LiteralPath $gitignore -Value ($rules -join "`r`n") -Encoding UTF8
  Write-Host "[OK] Updated .gitignore with recovery artifact rules."
} else {
  Write-Host "[OK] .gitignore already contains the needed rules."
}

Write-Host ""
Write-Host "NEXT:"
Write-Host "  1) npm.cmd run build"
Write-Host "  2) git status (should be clean except .gitignore changes/removals)"
