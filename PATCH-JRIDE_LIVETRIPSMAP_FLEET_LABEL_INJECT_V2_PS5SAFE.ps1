param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

function WriteUtf8NoBom([string]$path, [string]$content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}

function BackupFile([string]$absPath, [string]$tag, [string]$bakRoot) {
  if (!(Test-Path -LiteralPath $absPath)) { return $null }
  New-Item -ItemType Directory -Force -Path $bakRoot | Out-Null
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = Split-Path -Leaf $absPath
  $bak = Join-Path $bakRoot ($name + ".bak." + $tag + "." + $ts)
  Copy-Item -LiteralPath $absPath -Destination $bak -Force
  return $bak
}

Info "== JRIDE Patch: LiveTripsMap inject fleet marker label (robust) (V2 / PS5-safe) =="
Info "Repo: $ProjRoot"
Write-Host ""

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$bakRoot = Join-Path $ProjRoot "_patch_bak"
$mapPath = Join-Path $ProjRoot "app\admin\livetrips\components\LiveTripsMap.tsx"

if (!(Test-Path -LiteralPath $mapPath)) { Fail "[FAIL] LiveTripsMap.tsx not found: $mapPath" }

$bak = BackupFile $mapPath "LIVETRIPSMAP_FLEET_LABEL_V2" $bakRoot
if ($bak) { Ok "[OK] Backup: $bak" }

$txt = [System.IO.File]::ReadAllText($mapPath, [System.Text.Encoding]::UTF8)

# Sanity: must contain the fleet markers section
if ($txt -notmatch "FLEET DRIVER MARKERS") {
  Fail "[FAIL] Could not find 'FLEET DRIVER MARKERS' section in LiveTripsMap.tsx."
}

# If already injected, stop (idempotent)
if ($txt -match 'textContent\s*=\s*stale\s*\?\s*"STALE"') {
  Warn "[WARN] Fleet label injection already present. No changes made."
  Ok "[NEXT] Run: npm.cmd run build"
  exit 0
}

# Inject right after the first occurrence of:
# const el2 = marker.getElement() as HTMLDivElement;
$pattern = '(?ms)(const\s+el2\s*=\s*marker\.getElement\(\)\s+as\s+HTMLDivElement\s*;\s*)'
if ($txt -notmatch $pattern) {
  Fail "[FAIL] Could not locate: const el2 = marker.getElement() as HTMLDivElement;"
}

$injection = @'
$1
      // label text (makes it obvious the marker exists)
      try {
        el2.textContent = stale ? "STALE" : (isOnline ? "ON" : "OFF");
      } catch {
        // ignore
      }

'@

$txt2 = [System.Text.RegularExpressions.Regex]::Replace(
  $txt,
  $pattern,
  $injection,
  [System.Text.RegularExpressions.RegexOptions]::Singleline
)

if ($txt2 -eq $txt) {
  Fail "[FAIL] Injection did not apply (unexpected)."
}

WriteUtf8NoBom $mapPath $txt2
Ok "[OK] Injected fleet marker label after el2 assignment (UTF-8 no BOM)."
Ok "[NEXT] Run: npm.cmd run build"