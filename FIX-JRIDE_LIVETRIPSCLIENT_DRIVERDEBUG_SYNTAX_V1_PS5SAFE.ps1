param(
  [Parameter(Mandatory=$true)]
  [string]$WebRoot
)

$ErrorActionPreference = "Stop"

function Backup-File {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Tag
  )
  $dir = Split-Path -Parent $Path
  $name = Split-Path -Leaf $Path
  $bakDir = Join-Path $dir "_patch_bak"
  if (-not (Test-Path $bakDir)) {
    New-Item -ItemType Directory -Path $bakDir | Out-Null
  }
  $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
  $bak = Join-Path $bakDir ($name + ".bak." + $Tag + "." + $stamp)
  Copy-Item $Path $bak -Force
  Write-Host "[OK] Backup: $bak"
}

function Write-Utf8NoBom {
  param(
    [Parameter(Mandatory=$true)][string]$Path,
    [Parameter(Mandatory=$true)][string]$Content
  )
  $enc = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $enc)
}

$target = Join-Path $WebRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (-not (Test-Path $target)) {
  throw "Target file not found: $target"
}

Backup-File -Path $target -Tag "FIX_DRIVERDEBUG_SYNTAX_V1"

$content = [System.IO.File]::ReadAllText($target)

$original = $content

# Exact broken shape from build screenshot
$content = [regex]::Replace(
  $content,
  'setDriversDebug\s*\(\s*loaded\s+from\s*\(\s*\)\s*\)\s*;',
  'setDriversDebug("loaded from " + url + " (" + arr.length + ")");'
)

# Extra tolerant fallback in case spacing/newlines differ
$content = [regex]::Replace(
  $content,
  'setDriversDebug\s*\(\s*loaded\s*from[^\r\n;]*\)\s*;',
  'setDriversDebug("loaded from " + url + " (" + arr.length + ")");'
)

if ($content -eq $original) {
  throw "Did not find malformed setDriversDebug line to repair"
}

Write-Utf8NoBom -Path $target -Content $content

Write-Host "[OK] Repaired malformed setDriversDebug syntax in $target"
Write-Host ""
Write-Host "[OK] Done."
Write-Host "Next:"
Write-Host "1) npm run build"
Write-Host "2) git add only LiveTripsClient.tsx"
Write-Host "3) git commit"