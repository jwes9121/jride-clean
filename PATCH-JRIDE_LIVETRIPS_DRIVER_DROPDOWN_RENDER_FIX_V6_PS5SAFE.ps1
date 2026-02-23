<# 
PATCH-JRIDE_LIVETRIPS_DRIVER_DROPDOWN_RENDER_FIX_V6_PS5SAFE.ps1

Goal:
- LiveTrips has driversLen>0, but dropdown is empty.
- Fix dropdown render to use `drivers` state directly and display driver_id/status/town.
- No guessing: this is a UI render fix only.

Target:
  <ProjRoot>\app\admin\livetrips\LiveTripsClient.tsx

Notes:
- PS5-safe, UTF-8 no BOM, backup created.
- ASCII-only patch.
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

Info "== JRIDE LiveTrips: driver dropdown render fix (V6 / PS5-safe) =="

$ProjRoot = Normalize-Path $ProjRoot
Info ("Repo: {0}" -f $ProjRoot)

$target = Join-Path $ProjRoot "app\admin\livetrips\LiveTripsClient.tsx"
$target = Normalize-Path $target
Info ("Target: {0}" -f $target)

if (!(Test-Path -LiteralPath $target)) {
  Fail "Target file not found. Expected: $target"
}

$content = Read-TextUtf8NoBom $target

# We patch the manual assign <select> options by locating the "Assign driver (manual)" block
# and replacing the <select>...</select> with a known-good version.
#
# This regex is intentionally specific to avoid breaking other selects.
$pattern = '(?s)(Assign driver \(manual\).*?<select[^>]*>)(.*?)(</select>)'

$m = [System.Text.RegularExpressions.Regex]::Match($content, $pattern)
if (-not $m.Success) {
  Fail "Could not find the 'Assign driver (manual)' <select> block to patch. The markup may have changed."
}

$selectOpen = $m.Groups[1].Value
$selectClose = $m.Groups[3].Value

$replacementInner = @'
          <option value="">Select driver</option>
          {drivers.map((d: any) => {
            const id = String(d?.driver_id || d?.driverId || d?.id || "");
            if (!id) return null;
            const town = String(d?.town || d?.home_town || "");
            const st = String(d?.status || "");
            const short = id.length > 8 ? id.slice(0, 8) + "..." : id;
            const label = `${short} ${town ? "(" + town + ")" : ""} ${st ? "[" + st + "]" : ""}`;
            return (
              <option key={id} value={id}>
                {label}
              </option>
            );
          })}
'@

Backup-File $target "LIVETRIPS_DRIVER_DROPDOWN_RENDER_FIX_V6" | Out-Null

$newContent = [System.Text.RegularExpressions.Regex]::Replace(
  $content,
  $pattern,
  ('$1' + "`r`n" + $replacementInner + "`r`n        " + '$3'),
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

Write-TextUtf8NoBom $target $newContent
Ok "[OK] Patched manual assign dropdown to render from drivers[] directly"

Info "Done."