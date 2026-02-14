param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }

Write-Host "== JRIDE Patch: add active booking code helpers for /ride (V1 / PS5-safe) ==" -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$F = Join-Path $ProjRoot "app\ride\page.tsx"
if (-not (Test-Path -LiteralPath $F)) { Fail "[FAIL] Target not found: $F" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
$bak = Join-Path $bakDir ("ride.page.tsx.bak.ACTIVEBOOKING_HELPERS_V1.{0}" -f $stamp)
Copy-Item -Force -LiteralPath $F -Destination $bak
Ok ("[OK] Backup: {0}" -f $bak)

$txt = Get-Content -LiteralPath $F -Raw

# 1) Ensure key constant exists
if ($txt -notmatch 'JRIDE_ACTIVE_BOOKING_KEY') {
  $insertKey = @'
const JRIDE_ACTIVE_BOOKING_KEY = "jride_active_booking_code";
'@

  # Insert after first "use client" line if present, else after first import block, else at top.
  if ($txt -match '(?m)^\s*"use client"\s*;\s*$') {
    $txt = [regex]::Replace($txt, '(?m)^\s*"use client"\s*;\s*$', '"use client";' + "`r`n`r`n" + $insertKey, 1)
    Ok "[OK] Inserted JRIDE_ACTIVE_BOOKING_KEY after use client"
  } elseif ($txt -match '(?m)^(import .*;\s*)+$') {
    $txt = [regex]::Replace($txt, '(?m)^(import .*;\s*)+', '$0' + "`r`n" + $insertKey + "`r`n", 1)
    Ok "[OK] Inserted JRIDE_ACTIVE_BOOKING_KEY after imports"
  } else {
    $txt = $insertKey + "`r`n" + $txt
    Ok "[OK] Inserted JRIDE_ACTIVE_BOOKING_KEY at top (fallback)"
  }
} else {
  Ok "[OK] JRIDE_ACTIVE_BOOKING_KEY already exists"
}

# 2) Ensure helpers exist
if ($txt -notmatch 'function\s+jrideGetActiveBookingCode\s*\(') {
  $helpers = @'
function jrideGetActiveBookingCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(JRIDE_ACTIVE_BOOKING_KEY) || "");
  } catch {
    return "";
  }
}

function jrideSetActiveBookingCode(code: string) {
  if (typeof window === "undefined") return;
  try {
    if (code) window.localStorage.setItem(JRIDE_ACTIVE_BOOKING_KEY, String(code));
    else window.localStorage.removeItem(JRIDE_ACTIVE_BOOKING_KEY);
  } catch {}
}
'@

  # Insert helpers right after the key constant (best place)
  if ($txt -match 'const\s+JRIDE_ACTIVE_BOOKING_KEY\s*=\s*"jride_active_booking_code";') {
    $txt = [regex]::Replace(
      $txt,
      '(const\s+JRIDE_ACTIVE_BOOKING_KEY\s*=\s*"jride_active_booking_code";\s*)',
      '$1' + "`r`n" + $helpers + "`r`n",
      1
    )
    Ok "[OK] Inserted jrideGetActiveBookingCode/jrideSetActiveBookingCode helpers"
  } else {
    $txt = $helpers + "`r`n" + $txt
    Ok "[OK] Inserted helpers at top (fallback)"
  }
} else {
  Ok "[OK] jrideGetActiveBookingCode() already exists"
}

# 3) Make activeCode use the helper (replace both common forms)
$txt = [regex]::Replace(
  $txt,
  'const\s+\[\s*activeCode\s*,\s*setActiveCode\s*\]\s*=\s*React\.useState<\s*string\s*>\s*\(\s*""\s*\)\s*;',
  'const [activeCode, setActiveCode] = React.useState<string>(() => jrideGetActiveBookingCode());',
  1
)

$txt = [regex]::Replace(
  $txt,
  'const\s+\[\s*activeCode\s*,\s*setActiveCode\s*\]\s*=\s*React\.useState<\s*string\s*>\s*\(\s*\(\s*\)\s*=>\s*[A-Za-z0-9_]+\(\)\s*\)\s*;',
  'const [activeCode, setActiveCode] = React.useState<string>(() => jrideGetActiveBookingCode());',
  1
)

# Write UTF-8 no BOM
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($F, $txt, $utf8NoBom)
Ok ("[OK] Wrote: {0}" -f $F)

Write-Host ""
Write-Host "NEXT: commit + push (skip local build if it OOMs). Then retest /ride refresh." -ForegroundColor Cyan
