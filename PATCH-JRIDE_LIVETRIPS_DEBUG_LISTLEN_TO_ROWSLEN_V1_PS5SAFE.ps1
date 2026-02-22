<#
PATCH-JRIDE_LIVETRIPS_DEBUG_LISTLEN_TO_ROWSLEN_V1_PS5SAFE.ps1

Fixes TS error:
  Cannot find name 'list'
by rewriting:
  setDriversDebug(`... (${list.length})`)
to:
  setDriversDebug(`... (${rows.length})`)

PS5-safe. Creates a UTF-8 no-BOM backup in _patch_bak.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }

function Ensure-Dir($p) {
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function Read-TextUtf8NoBom($path) {
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    if ($bytes.Length -eq 3) { return "" }
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-TextUtf8NoBom($path, $text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Backup-File($path, $bakDir, $tag) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = [System.IO.Path]::GetFileName($path)
  $bak = Join-Path $bakDir ("{0}.bak.{1}.{2}" -f $name, $tag, $ts)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("Backup: {0}" -f $bak)
}

Write-Host "== PATCH: LiveTrips setDriversDebug list.length -> rows.length (V1 / PS5-safe) ==" -ForegroundColor Yellow

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "ProjRoot not found: $ProjRoot" }

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
if (!(Test-Path -LiteralPath $target)) { Fail "Target not found: $target" }

$bakDir = Join-Path $ProjRoot "_patch_bak"
Ensure-Dir $bakDir

$orig = Read-TextUtf8NoBom $target
$txt  = $orig

# Replace any `${list.length}` inside a setDriversDebug template string (backticks)
# Keep it conservative: only touch "setDriversDebug(`...${list.length}...`);"
$re = New-Object System.Text.RegularExpressions.Regex(
  '(?m)^(?<indent>[ \t]*)setDriversDebug\(`(?<msg>[^`]*)`\);\s*$'
)

$m = $re.Match($txt)
if (-not $m.Success) {
  Fail "Could not find setDriversDebug(`...`); line in LiveTripsClient.tsx"
}

$indent = $m.Groups["indent"].Value
$msg    = $m.Groups["msg"].Value

if ($msg -notmatch '\$\{list\.length\}') {
  Fail "Found setDriversDebug, but it does not contain `${list.length}`. No change applied."
}

$msg2 = $msg -replace '\$\{list\.length\}', '${rows.length}'
$newLine = $indent + 'setDriversDebug(`' + $msg2 + '`);'

$txt2 = $re.Replace($txt, $newLine, 1)

if ($txt2 -eq $orig) {
  Fail "No changes applied (unexpected)."
}

Backup-File $target $bakDir "LIVETRIPS_DEBUG_ROWSLEN_V1"
Write-TextUtf8NoBom $target $txt2
Ok ("Wrote: {0}" -f $target)

Write-Host ""
Write-Host "Next:" -ForegroundColor Yellow
Write-Host "1) npm.cmd run build" -ForegroundColor Yellow
Write-Host "2) Refresh /admin/livetrips" -ForegroundColor Yellow