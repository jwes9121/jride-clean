# FIX-JRIDE_REPO_CLEANUP_BOM_AND_BAKS_V1_PS5SAFE.ps1
param(
  [Parameter(Mandatory=$true)][string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

function Fail($m){ Write-Host $m -ForegroundColor Red; exit 1 }
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Info($m){ Write-Host $m -ForegroundColor Cyan }

function EnsureDir([string]$p){
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function HasUtf8Bom([byte[]]$bytes){
  return ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
}

function WriteUtf8NoBom([string]$Path, [string]$Content) {
  $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Content, $utf8NoBom)
}

if (!(Test-Path -LiteralPath $ProjRoot)) { Fail "[FAIL] ProjRoot not found: $ProjRoot" }

$ProjRoot = (Resolve-Path -LiteralPath $ProjRoot).Path
Info "== JRIDE Repo Cleanup: Remove UTF-8 BOM + Archive *.bak* (V1 / PS5-safe) =="
Info "Root: $ProjRoot"

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$archiveRoot = Join-Path $ProjRoot "_backup_archive"
$archiveDir  = Join-Path $archiveRoot ("cleanup_" + $ts)
EnsureDir $archiveDir

$report = New-Object System.Collections.Generic.List[string]
$report.Add("== JRIDE CLEANUP REPORT ==")
$report.Add("Root: $ProjRoot")
$report.Add("Timestamp: $ts")
$report.Add("ArchiveDir: $archiveDir")
$report.Add("")

# ---------------------------
# 1) BOM removal
# ---------------------------
$exts = @(".ts",".tsx",".js",".jsx",".json",".kt",".kts",".xml",".gradle",".properties",".md",".env",".yml",".yaml",".sql")
$files = Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $exts -contains $_.Extension.ToLowerInvariant() }

$bomFixed = 0
foreach ($f in $files) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
    if (HasUtf8Bom $bytes) {
      # Decode as UTF-8, then rewrite without BOM
      $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
      WriteUtf8NoBom -Path $f.FullName -Content $text
      $bomFixed++
      $report.Add("[BOM_REMOVED] " + $f.FullName)
    }
  } catch {
    $report.Add("[BOM_SKIP_ERROR] " + $f.FullName + " :: " + $_.Exception.Message)
  }
}

Ok ("[OK] BOM removed from {0} file(s)" -f $bomFixed)
$report.Add("")
$report.Add(("BOM removed count: {0}" -f $bomFixed))
$report.Add("")

# ---------------------------
# 2) Archive backup files (move)
# ---------------------------
$bakPatterns = @("*.bak-*","*.bak_*","*.bak.*","*.orig","*~")

$bakFiles = @()
foreach ($pat in $bakPatterns) {
  $bakFiles += Get-ChildItem -LiteralPath $ProjRoot -Recurse -File -Filter $pat -ErrorAction SilentlyContinue
}

# Deduplicate by full path
$seen = @{}
$uniqBak = New-Object System.Collections.Generic.List[System.IO.FileInfo]
foreach ($bf in $bakFiles) {
  if (!$seen.ContainsKey($bf.FullName)) {
    $seen[$bf.FullName] = $true
    $uniqBak.Add($bf)
  }
}

$bakMoved = 0
foreach ($bf in $uniqBak) {
  try {
    # Preserve relative path inside archive
    $rel = $bf.FullName.Substring($ProjRoot.Length).TrimStart("\","/")
    $dest = Join-Path $archiveDir $rel
    $destDir = Split-Path -Parent $dest
    EnsureDir $destDir

    Move-Item -LiteralPath $bf.FullName -Destination $dest -Force
    $bakMoved++
    $report.Add("[BAK_MOVED] " + $rel + " -> " + $dest)
  } catch {
    $report.Add("[BAK_MOVE_ERROR] " + $bf.FullName + " :: " + $_.Exception.Message)
  }
}

Ok ("[OK] Archived {0} backup file(s) to: {1}" -f $bakMoved, $archiveDir)
$report.Add("")
$report.Add(("Backup files moved count: {0}" -f $bakMoved))
$report.Add("")

# ---------------------------
# 3) Write report
# ---------------------------
$reportPath = Join-Path $ProjRoot ("JRIDE_CLEANUP_REPORT_" + $ts + ".txt")
WriteUtf8NoBom -Path $reportPath -Content ($report -join "`r`n")
Ok "[OK] Report: $reportPath"

Ok "[OK] Done."
