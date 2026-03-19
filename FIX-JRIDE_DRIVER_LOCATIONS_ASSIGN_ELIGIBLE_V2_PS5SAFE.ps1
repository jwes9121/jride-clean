param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param($Path, $Tag)
  $dir = Split-Path -Parent $Path
  $name = Split-Path -Leaf $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir "$name.bak.$Tag.$stamp"
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

$target = Join-Path $WebRoot "app\api\admin\driver_locations\route.ts"

if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

Backup-File $target "ASSIGN_ELIGIBLE_OVERRIDE_V2"

$content = Get-Content $target -Raw
$original = $content

# Replace assign_eligible inside returned object (safe override)
$content = [regex]::Replace(
  $content,
  'assign_eligible\s*:\s*[^,}]+',
  'assign_eligible: (!is_stale && onlineLike.includes(rawStatus))',
  'IgnoreCase'
)

if ($content -eq $original) {
  throw "assign_eligible return field not found"
}

[System.IO.File]::WriteAllText($target, $content, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "[OK] assign_eligible now overridden at return level"
Write-Host "[OK] Done."