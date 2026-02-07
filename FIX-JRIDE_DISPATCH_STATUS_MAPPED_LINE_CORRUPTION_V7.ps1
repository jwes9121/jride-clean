# FIX-JRIDE_DISPATCH_STATUS_MAPPED_LINE_CORRUPTION_V7.ps1
# Fixes the exact corruption shown in build error:
# - "if (!mapped) return;" (void) -> "if (!mapped) return {};"
# - repairs glued "nullif (!driverId" into a clean newline
# - keeps function return type Promise<{ warning?: string }> valid
# PS5-safe + backups

$ErrorActionPreference = "Stop"

$repoRoot = (Get-Location).Path
$target   = Join-Path $repoRoot "app\api\dispatch\status\route.ts"
$bakDir   = Join-Path $repoRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null

if (!(Test-Path $target)) { throw "Missing file: $target" }

function Backup-File([string]$path) {
  $ts = Get-Date -Format "yyyyMMdd_HHmmss"
  $name = $path.Replace($repoRoot, "").TrimStart("\").Replace("\","__")
  $dest = Join-Path $bakDir ($name + ".bak." + $ts)
  Copy-Item -LiteralPath $path -Destination $dest -Force
  Write-Host ("[OK] Backup: {0}" -f $dest)
}

function Read-Text([string]$path) {
  return Get-Content -LiteralPath $path -Raw -ErrorAction Stop
}

function Write-Text([string]$path, [string]$content) {
  $content | Out-File -LiteralPath $path -Encoding UTF8
  Write-Host ("[OK] Patched: {0}" -f $path)
}

Write-Host "== JRIDE Fix: dispatch/status mapped guard corruption (V7) =="

Backup-File $target
$txt  = Read-Text $target
$orig = $txt

# 1) Fix the exact glued token: "... mapping is nullif (!driverId"
# Insert a newline before that "if"
$txt = $txt -replace 'mapping is nullif\s*\(', ("mapping is null" + "`n    if (")

# 2) If we have the exact broken line from your error, rewrite it cleanly
# Example:
# if (!mapped) return; // ... nullif (!driverId || !mapped) return {};
$txt = [regex]::Replace(
  $txt,
  'if\s*\(\s*!mapped\s*\)\s*return\s*;\s*//\s*do not overwrite driver_locations\.status when mapping is null\s*if\s*\(\s*!driverId\s*\|\|\s*!mapped\s*\)\s*return\s*\{\s*\}\s*;',
  ('if (!mapped) return {}; // do not overwrite driver_locations.status when mapping is null' + "`n" +
   '    if (!driverId || !mapped) return {};'),
  20
)

# 3) Generic safety: convert any remaining "if (!mapped) return;" into return {};
$txt = [regex]::Replace(
  $txt,
  '(?m)^\s*if\s*\(\s*!mapped\s*\)\s*return\s*;\s*(//.*)?$',
  '    if (!mapped) return {}; // do not overwrite driver_locations.status when mapping is null',
  50
)

# 4) If the guard line is still glued to another "if", split it
$txt = [regex]::Replace(
  $txt,
  '(return\s*\{\s*\}\s*;\s*//[^\r\n]*?)\s*if\s*\(',
  ('$1' + "`n" + '    if ('),
  50
)

if ($txt -eq $orig) {
  throw "No changes applied. Paste lines 160-180 of app/api/dispatch/status/route.ts if this persists."
}

Write-Text $target $txt

Write-Host ""
Write-Host "[DONE] Corrupted mapped guard line repaired (return {} + proper newline)."
Write-Host "Next: npm.cmd run build"
