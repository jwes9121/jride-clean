<# 
PATCH-JRIDE_CANBOOK_FIX_SUPABASE_IMPORT_AUTOFIND_V1_PS5SAFE.ps1

Fixes MODULE_NOT_FOUND caused by:
  import { createClient } from "@/utils/supabase/server";

Strategy:
- Auto-find the real Supabase server helper file that exports createClient
- Replace the alias import with a RELATIVE import (works even if @ alias mapping is off)
- PS5-safe, creates backup

#>

param(
  [string]$RepoRoot = "C:\Users\jwes9\Desktop\jride-clean-fresh"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

function Get-RelativeImportPath([string]$fromFile, [string]$toFile) {
  $fromDir = Split-Path -Parent $fromFile
  $fromUri = New-Object System.Uri(($fromDir.TrimEnd('\') + '\'))
  $toUri   = New-Object System.Uri($toFile)
  $relUri  = $fromUri.MakeRelativeUri($toUri)
  $relPath = [System.Uri]::UnescapeDataString($relUri.ToString())

  # Ensure forward slashes for TS imports
  $relPath = $relPath -replace '\\','/'

  # Remove .ts extension for import
  if ($relPath.EndsWith(".ts")) { $relPath = $relPath.Substring(0, $relPath.Length - 3) }

  # Ensure it starts with ./ or ../
  if ($relPath -notmatch '^\.' ) { $relPath = "./" + $relPath }
  return $relPath
}

$target = Join-Path $RepoRoot "app\api\public\passenger\can-book\route.ts"
if (-not (Test-Path $target)) {
  Fail ("[FAIL] Target not found: {0}" -f $target)
  exit 1
}

# Backup
$bakDir = Join-Path $RepoRoot "_patch_bak"
if (-not (Test-Path $bakDir)) { New-Item -ItemType Directory -Path $bakDir | Out-Null }
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$bakFile = Join-Path $bakDir ("can-book.route.ts.bak.AUTOFIND_V1." + $timestamp)
Copy-Item $target $bakFile -Force
Ok ("[OK] Backup: {0}" -f $bakFile)

$content = Get-Content -LiteralPath $target -Raw

# Confirm the problematic import exists
$oldImportPattern = 'import\s+\{\s*createClient\s*\}\s+from\s+"@/utils/supabase/server"\s*;'
if (-not ([regex]::IsMatch($content, $oldImportPattern))) {
  Warn "[WARN] Did not find import from ""@/utils/supabase/server"". Nothing to change."
  Ok ("[OK] Target: {0}" -f $target)
  exit 0
}

# Auto-find candidate files that likely export createClient
$searchRoots = @(
  (Join-Path $RepoRoot "utils"),
  (Join-Path $RepoRoot "app"),
  (Join-Path $RepoRoot "src")
) | Where-Object { Test-Path $_ }

if ($searchRoots.Count -eq 0) {
  Fail "[FAIL] No search roots found (utils/app/src). Cannot autofind supabase server helper."
  exit 1
}

$candidates = @()
foreach ($root in $searchRoots) {
  $files = Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.ts" -ErrorAction SilentlyContinue
  foreach ($f in $files) {
    # Heuristics: file path contains supabase and server OR file contains createClient export
    $p = $f.FullName.ToLowerInvariant()
    if ($p -notmatch "supabase") { continue }

    $hit = $false
    try {
      $raw = Get-Content -LiteralPath $f.FullName -Raw -ErrorAction Stop
      if ($raw -match 'export\s+\{\s*createClient\s*\}' -or
          $raw -match 'export\s+function\s+createClient' -or
          $raw -match 'const\s+createClient\s*=' -or
          $raw -match 'function\s+createClient\s*\(') {
        $hit = $true
      }
    } catch { $hit = $false }

    if ($hit) {
      $score = 0
      if ($p -match "utils") { $score += 2 }
      if ($p -match "server") { $score += 2 }
      if ($p -match "supabase/server") { $score += 5 }
      $candidates += [pscustomobject]@{ Path=$f.FullName; Score=$score }
    }
  }
}

if ($candidates.Count -eq 0) {
  Fail "[FAIL] Could not find any .ts file exporting createClient under utils/app/src that mentions supabase."
  Fail "We need the actual path of your supabase server helper file."
  exit 1
}

$best = $candidates | Sort-Object Score -Descending | Select-Object -First 1
Ok ("[OK] Found supabase server helper candidate: {0}" -f $best.Path)

$relImport = Get-RelativeImportPath -fromFile $target -toFile $best.Path
Ok ("[OK] Using relative import: {0}" -f $relImport)

$newImportLine = 'import { createClient } from "' + $relImport + '";'

$content2 = [regex]::Replace($content, $oldImportPattern, $newImportLine, 1)

Set-Content -LiteralPath $target -Value $content2 -Encoding UTF8
Ok "[OK] Patched can-book import successfully."
Ok ("[OK] Target: {0}" -f $target)
