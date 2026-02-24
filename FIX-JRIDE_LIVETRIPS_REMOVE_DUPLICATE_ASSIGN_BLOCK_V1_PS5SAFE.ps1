<# 
FIX-JRIDE_LIVETRIPS_REMOVE_DUPLICATE_ASSIGN_BLOCK_V1_PS5SAFE.ps1

Removes a duplicate/broken JSX block accidentally injected into LiveTripsClient.tsx that
starts with:
  </div><div className="flex flex-wrap items-center gap-2">
and contains a second <select> + drivers.map block with a broken onChange.

This duplicate block causes TSX parse errors:
  '}' expected at {(drivers||[]).map...
  Identifier expected at </select>
  Missing closing tags cascade

PS5-safe. Writes UTF-8 no BOM. Creates backups.
#>

param(
  [Parameter(Mandatory = $true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Info([string]$m) { Write-Host $m -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host $m -ForegroundColor Green }
function Warn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host $m -ForegroundColor Red; throw $m }

function Normalize-Path([string]$p) {
  try { return (Resolve-Path -LiteralPath $p).Path } catch { return $p }
}

function Read-TextUtf8NoBom([string]$path) {
  if (!(Test-Path -LiteralPath $path)) { Fail "File not found: $path" }
  $bytes = [System.IO.File]::ReadAllBytes($path)
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }
  return [System.Text.Encoding]::UTF8.GetString($bytes)
}

function Write-TextUtf8NoBom([string]$path, [string]$text) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $text, $utf8NoBom)
}

function Backup-File([string]$path, [string]$tag) {
  $dir = Split-Path -Parent $path
  $name = Split-Path -Leaf $path
  $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
  $bak = Join-Path $dir ("{0}.bak.{1}.{2}" -f $name, $tag, $stamp)
  Copy-Item -LiteralPath $path -Destination $bak -Force
  Ok ("[OK] Backup: {0}" -f $bak)
  return $bak
}

Info "== JRIDE LiveTrips: remove duplicate Assign-driver block (V1 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
$target = Normalize-Path (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx")

Info ("Repo:   {0}" -f $ProjRoot)
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) { Fail "Target file not found: $target" }

Backup-File $target "LIVETRIPS_REMOVE_DUPLICATE_ASSIGN_BLOCK_V1_BEFORE" | Out-Null

$content = Read-TextUtf8NoBom $target
$orig = $content

# We remove ONLY the injected duplicate chunk.
# Anchor Start: the exact concatenated boundary we saw in your context:
#   </div><div className="flex flex-wrap items-center gap-2">
# Anchor End: the next occurrence of the map section marker:
#   {/* Right: map */}
#
# We keep the comment itself (end anchor not consumed).
$start = '</div><div className="flex flex-wrap items-center gap-2">'
$end   = '{/* Right: map */}'

$idxStart = $content.IndexOf($start, [System.StringComparison]::Ordinal)
if ($idxStart -lt 0) {
  Fail "Could not find start anchor for duplicate block: $start"
}

$idxEnd = $content.IndexOf($end, $idxStart, [System.StringComparison]::Ordinal)
if ($idxEnd -lt 0) {
  Fail "Could not find end anchor (Right: map) after duplicate block."
}

# Remove from idxStart up to idxEnd (do not remove end anchor)
$newContent = $content.Substring(0, $idxStart) + $content.Substring($idxEnd)

if ($newContent -eq $orig) {
  Warn "[WARN] No changes applied (unexpected)."
} else {
  Backup-File $target "LIVETRIPS_REMOVE_DUPLICATE_ASSIGN_BLOCK_V1_APPLY" | Out-Null
  Write-TextUtf8NoBom $target $newContent
  Ok "[OK] Removed duplicate injected Assign-driver JSX chunk."
}

Info "Done."