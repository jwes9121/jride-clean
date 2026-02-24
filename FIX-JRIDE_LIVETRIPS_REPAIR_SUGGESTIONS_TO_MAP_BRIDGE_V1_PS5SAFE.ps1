<# 
FIX-JRIDE_LIVETRIPS_REPAIR_SUGGESTIONS_TO_MAP_BRIDGE_V1_PS5SAFE.ps1

Repairs broken JSX structure between:
  <SmartAutoAssignSuggestions ...>
and:
  {/* Right: map */}

Your TSX diag proved:
- The suggestions block is immediately followed by the map comment without closing left-panel wrappers.
- This causes unmatched <div> tags and a cascading TSX parser failure.

Action:
- Find first occurrence of "<SmartAutoAssignSuggestions"
- Find the next occurrence of "{/* Right: map */}" after it
- Replace everything between them with a clean, balanced bridge:
    <div className="mt-2"> ... </div>
    </div>
    </div>
    (blank line)
  then keep "{/* Right: map */}" and the rest of the file unchanged.

PS5-safe, creates backups, writes UTF-8 no BOM.
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

Info "== JRIDE LiveTrips: repair Suggestions->Map bridge (V1 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
$target = Normalize-Path (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx")

Info ("Repo:   {0}" -f $ProjRoot)
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) { Fail "Target file not found: $target" }

Backup-File $target "LIVETRIPS_REPAIR_SUGG_TO_MAP_BRIDGE_V1_BEFORE" | Out-Null

$content = Read-TextUtf8NoBom $target
$orig = $content

$anchorA = "<SmartAutoAssignSuggestions"
$anchorB = "{/* Right: map */}"

$idxA = $content.IndexOf($anchorA, [System.StringComparison]::Ordinal)
if ($idxA -lt 0) { Fail "Could not find anchor A: $anchorA" }

$idxB = $content.IndexOf($anchorB, $idxA, [System.StringComparison]::Ordinal)
if ($idxB -lt 0) { Fail "Could not find anchor B after anchor A: $anchorB" }

# Find the start of the line containing anchorA (so we replace whole lines cleanly)
$start = $idxA
for ($i = $idxA; $i -gt 0; $i--) {
  $ch = $content[$i-1]
  if ($ch -eq "`n") { $start = $i; break }
  if ($i -eq 1) { $start = 0 }
}

# Replacement bridge: render suggestions in mt-2 then close 2 wrapper divs to end the left panel + left column.
# (This matches the structure implied by your TSX diagnostics: grid + left card missing closing tags.)
$bridge = @'
<div className="mt-2">
  <SmartAutoAssignSuggestions trip={selectedTrip as any} drivers={drivers as any} />
</div>
</div>
</div>

'@

# Build new content:
# 1) keep everything before $start
# 2) inject our bridge
# 3) then keep from idxB onward (including the "{/* Right: map */}" comment)
$newContent = $content.Substring(0, $start) + $bridge + $content.Substring($idxB)

if ($newContent -eq $orig) {
  Warn "[WARN] No changes applied (unexpected)."
} else {
  Backup-File $target "LIVETRIPS_REPAIR_SUGG_TO_MAP_BRIDGE_V1_APPLY" | Out-Null
  Write-TextUtf8NoBom $target $newContent
  Ok "[OK] Replaced broken block between SmartAutoAssignSuggestions and Right: map with balanced bridge + wrapper closures."
}

Info "Done."