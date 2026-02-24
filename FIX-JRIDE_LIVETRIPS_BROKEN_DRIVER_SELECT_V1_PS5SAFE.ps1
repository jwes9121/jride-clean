<# 
FIX-JRIDE_LIVETRIPS_BROKEN_DRIVER_SELECT_V1_PS5SAFE.ps1

Fix:
- TSX parse errors caused by broken JSX in driver dropdown:
  {(drivers || []).map((d:any) => { ... }   // missing return/paren/brace
  leading to cascaded errors at </select>, </div>, etc.

Action:
- Replace the entire <select>...</select> block that contains:
  - option "Select driver"
  - a drivers.map(...) block
with a known-good TSX-safe implementation.

PS5-safe. ASCII-only script. Writes UTF-8 no BOM. Creates backups.
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

Info "== JRIDE LiveTrips: fix broken driver <select> TSX (V1 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
$target = Normalize-Path (Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx")

Info ("Repo:   {0}" -f $ProjRoot)
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) { Fail "Target file not found: $target" }

Backup-File $target "LIVETRIPS_BROKEN_DRIVER_SELECT_V1_BEFORE" | Out-Null

$content = Read-TextUtf8NoBom $target
$orig = $content

# We replace the <select> block that:
# - contains "Select driver" option
# - contains "drivers" and ".map"
# Singleline DOTALL, non-greedy.
$rx = New-Object System.Text.RegularExpressions.Regex(
  '(?s)<select\b[^>]*>.*?<option\b[^>]*>\s*Select driver\s*<\/option>.*?drivers\s*.*?\.map\s*\(.*?<\/select>',
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

if (-not $rx.IsMatch($content)) {
  Fail "Could not locate the driver dropdown <select> block (Select driver + drivers.map) to replace."
}

# Preserve indentation from the matched block's first line
$m = $rx.Match($content)
$block = $m.Value
$indent = ""
if ($block -match '^(?<i>[ \t]*)<select') { $indent = $Matches['i'] }

$replacement = @"
${indent}<select
${indent}  className="border rounded px-2 py-1 text-sm min-w-[320px]"
${indent}  value={manualDriverId}
${indent}  onChange={(e) => setManualDriverId(e.target.value)}
${indent}>
${indent}  <option value="">Select driver</option>
${indent}  {(drivers || []).map((d: any, idx: number) => {
${indent}    const id = String((d && (d.driver_id || d.id)) || "");
${indent}    const name = String((d && (d.name || d.full_name || d.driver_name)) || "Driver");
${indent}    const town = String((d && (d.town || d.home_town)) || "");
${indent}    const status = String((d && d.status) || "");
${indent}    const label = (`${"$"}{name}${"$"}{town ? " - " + town : ""}${"$"}{status ? " - " + status : ""}`).trim();
${indent}    return (
${indent}      <option key={id || idx} value={id}>
${indent}        {label}
${indent}      </option>
${indent}    );
${indent}  })}
${indent}</select>
"@

$newContent = $rx.Replace($content, $replacement, 1)

if ($newContent -eq $orig) {
  Warn "[WARN] No changes applied (unexpected)."
} else {
  Backup-File $target "LIVETRIPS_BROKEN_DRIVER_SELECT_V1_APPLY" | Out-Null
  Write-TextUtf8NoBom $target $newContent
  Ok "[OK] Replaced broken driver dropdown <select> with TSX-safe map()."
}

Info "Done."