param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Write-Info([string]$m) { Write-Host $m -ForegroundColor Cyan }

$target = Join-Path $RepoRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.SMARTAUTOASSIGN_PROPS_FIX_V1.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

$oldBlock = @'
                  assignedDriverId={assignedDriverId}
                  onAssign={async (driverId) => {
                    if (!selectedTrip?.booking_code) return;
                    await assignDriver(selectedTrip.booking_code, driverId);
                  }}
                  assigningDriverId={assigningDriverId}
                  canAssign={canAssign}
                  lockReason={lockReason}
'@

$newBlock = @'
                  onAssign={async (driverId) => {
                    if (!selectedTrip?.booking_code) return;
                    await assignDriver(selectedTrip.booking_code, driverId);
                  }}
'@

if ($content.Contains($oldBlock)) {
  $content = $content.Replace($oldBlock, $newBlock)
  Write-Ok "[OK] Removed unsupported SmartAutoAssignSuggestions props"
} else {
  $patterns = @(
    '(?ms)^[ \t]*assignedDriverId=\{assignedDriverId\}\r?\n',
    '(?ms)^[ \t]*assigningDriverId=\{assigningDriverId\}\r?\n',
    '(?ms)^[ \t]*canAssign=\{canAssign\}\r?\n',
    '(?ms)^[ \t]*lockReason=\{lockReason\}\r?\n'
  )
  $changed = $false
  foreach ($p in $patterns) {
    $next = [regex]::Replace($content, $p, '')
    if ($next -ne $content) {
      $content = $next
      $changed = $true
    }
  }
  if (-not $changed) {
    throw "Anchor not found: unsupported SmartAutoAssignSuggestions props"
  }
  Write-Ok "[OK] Removed unsupported props via regex fallback"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Ok "[OK] Wrote: $target"

Write-Host ""
Write-Info "Next command"
Write-Host "npm run build"
