# PATCH-JRIDE_P4_UI_MOJIBAKE_SWEEP_SAFE.ps1
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Stamp(){ Get-Date -Format "yyyyMMdd_HHmmss" }

$root = (Get-Location).Path

$targets = @(
  (Join-Path $root "app\history\page.tsx"),
  (Join-Path $root "app\dispatch\BookingForm.tsx")
)

function Apply-Replacements([string]$txt) {
  # IMPORTANT: Keep PS1 ASCII-only to avoid mojibake/encoding parser issues.

  # Common mojibake -> ASCII
  $txt = $txt -replace "-", "--"          # em dash
  $txt = $txt -replace "·", " - "          # middle dot separator
  $txt = $txt -replace "", ""              # stray 

  # Peso symbol mojibake -> ASCII currency label
  # (Prefer "PHP " prefix to avoid unicode Peso char)
  $txt = $txt -replace "â‚±", "PHP "

  return $txt
}

$didAny = $false

foreach ($f in $targets) {
  if (!(Test-Path $f)) {
    Write-Host "[SKIP] Missing: $f" -ForegroundColor DarkYellow
    continue
  }

  $orig = Get-Content -Raw -LiteralPath $f

  $next = Apply-Replacements $orig

  if ($next -ne $orig) {
    $bak = ($f + ".bak." + (Stamp))
    Copy-Item -LiteralPath $f -Destination $bak -Force
    Write-Host ("[OK] Backup: " + $bak) -ForegroundColor Green

    # Write UTF-8 (no BOM)
    [System.IO.File]::WriteAllText($f, $next, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host ("[OK] Patched: " + $f) -ForegroundColor Green
    $didAny = $true
  } else {
    Write-Host ("[OK] No changes needed: " + $f) -ForegroundColor Green
  }
}

if (-not $didAny) {
  Write-Host "[OK] Nothing to change (no mojibake patterns found in target files)." -ForegroundColor Green
}
