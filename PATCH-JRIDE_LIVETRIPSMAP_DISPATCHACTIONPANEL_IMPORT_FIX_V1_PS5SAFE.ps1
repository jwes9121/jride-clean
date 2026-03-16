param(
  [Parameter(Mandatory = $true)]
  [string]$RepoRoot
)

$ErrorActionPreference = "Stop"

function Write-Ok([string]$m) { Write-Host $m -ForegroundColor Green }
function Write-Info([string]$m) { Write-Host $m -ForegroundColor Cyan }

$target = Join-Path $RepoRoot "app\admin\livetrips\components\LiveTripsMap.tsx"
if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$target.bak.DISPATCH_ACTION_PANEL_IMPORT_FIX_V1.$stamp"
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Ok "[OK] Backup: $bak"

$content = Get-Content -LiteralPath $target -Raw -Encoding UTF8

$old = 'import { DispatchActionPanel } from "./DispatchActionPanel";'
$new = 'import DispatchActionPanel from "./DispatchActionPanel";'

if ($content.Contains($old)) {
  $content = $content.Replace($old, $new)
  Write-Ok "[OK] Replaced named import with default import"
} else {
  $pattern = 'import\s*\{\s*DispatchActionPanel\s*\}\s*from\s*"./DispatchActionPanel";'
  $next = [regex]::Replace($content, $pattern, $new)
  if ($next -eq $content) {
    throw "Anchor not found: DispatchActionPanel named import"
  }
  $content = $next
  Write-Ok "[OK] Replaced regex-matched named import with default import"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
Write-Ok "[OK] Wrote: $target"

Write-Host ""
Write-Info "Next command"
Write-Host "npm run build"
