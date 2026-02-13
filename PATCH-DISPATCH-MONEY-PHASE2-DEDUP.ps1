# PATCH-DISPATCH-MONEY-PHASE2-DEDUP.ps1
# Fix: lowWalletDrivers / lowWalletCount defined multiple times
# Strategy:
#  - Keep FIRST JRIDE_UI_MONEY_PHASE2_LOWWALLET_PANEL block, remove the rest.
#  - Safety: keep first "const lowWalletDrivers = useMemo" and first "const lowWalletCount =" and remove later ones.

$ErrorActionPreference = "Stop"

function Fail($m) { throw $m }

$uiPath = "app\dispatch\page.tsx"
if (!(Test-Path $uiPath)) { Fail "Missing file: $uiPath (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "$uiPath.bak.$stamp"
Copy-Item $uiPath $bak -Force
Write-Host "[OK] Backup: $bak" -ForegroundColor Green

$txt = Get-Content $uiPath -Raw

$startMarker = '/* JRIDE_UI_MONEY_PHASE2_LOWWALLET_PANEL_START */'
$endMarker   = '/* JRIDE_UI_MONEY_PHASE2_LOWWALLET_PANEL_END */'

# --- 1) Remove duplicate marker blocks (keep first) ---
$startEsc = [regex]::Escape($startMarker)
$endEsc   = [regex]::Escape($endMarker)

$blockRx = "(?s)$startEsc.*?$endEsc"
$blocks = [regex]::Matches($txt, $blockRx)

if ($blocks.Count -ge 2) {
  Write-Host "[INFO] Found $($blocks.Count) low-wallet marker blocks. Keeping the first, removing the rest..." -ForegroundColor Yellow

  # Keep first block text
  $firstBlock = $blocks[0].Value

  # Remove all blocks
  $txtNoBlocks = [regex]::Replace($txt, $blockRx, "")

  # Reinsert the first block at the position of the first occurrence (approx)
  $firstIndex = $blocks[0].Index
  if ($firstIndex -lt 0 -or $firstIndex -gt $txtNoBlocks.Length) {
    # fallback: insert near top of component by placing before first "useEffect(" if possible
    $anchor = [regex]::Match($txtNoBlocks, "(?m)^\s*useEffect\s*\(")
    if ($anchor.Success) {
      $idx = $anchor.Index
      $txt = $txtNoBlocks.Substring(0, $idx) + "`r`n" + $firstBlock + "`r`n" + $txtNoBlocks.Substring($idx)
    } else {
      $txt = $firstBlock + "`r`n" + $txtNoBlocks
    }
  } else {
    $txt = $txtNoBlocks.Substring(0, $firstIndex) + "`r`n" + $firstBlock + "`r`n" + $txtNoBlocks.Substring($firstIndex)
  }

  Write-Host "[OK] Removed duplicate low-wallet marker blocks." -ForegroundColor Green
} else {
  Write-Host "[INFO] Marker blocks count = $($blocks.Count). No marker-duplicate removal needed." -ForegroundColor Cyan
}

# --- 2) Safety net: dedupe const lowWalletDrivers / lowWalletCount if still duplicated ---
function Dedupe-Const($text, $constName) {
  # Match "const <name> = ..." up to semicolon (multi-line safe-ish)
  $rx = "(?s)(?m)^\s*const\s+$constName\s*=\s*.*?;\s*$"
  $ms = [regex]::Matches($text, $rx)
  if ($ms.Count -le 1) { return $text }

  Write-Host "[WARN] '$constName' appears $($ms.Count) times; keeping the first and removing the rest (safety net)." -ForegroundColor Yellow

  $keep = $ms[0].Value
  $text2 = $text
  # Remove from last to first (excluding first) to preserve indices
  for ($i = $ms.Count - 1; $i -ge 1; $i--) {
    $m = $ms[$i]
    $text2 = $text2.Remove($m.Index, $m.Length)
  }
  return $text2
}

$txt = Dedupe-Const $txt "lowWalletDrivers"
$txt = Dedupe-Const $txt "lowWalletCount"

# --- 3) Write back ---
Set-Content $uiPath -Value $txt -Encoding UTF8
Write-Host "[OK] Wrote: $uiPath" -ForegroundColor Green

Write-Host ""
Write-Host "[NEXT]" -ForegroundColor Cyan
Write-Host "npm.cmd run build" -ForegroundColor Cyan
