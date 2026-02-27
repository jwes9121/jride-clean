param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m){ Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m){ Write-Host $m -ForegroundColor Green }

Write-Info "== JRIDE Scan: Night Gate Repo-wide (V1 / PS5-safe) =="

$root = (Resolve-Path -LiteralPath $ProjRoot).Path
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $root ("_diag_out_" + $stamp)
New-Item -ItemType Directory -Path $outDir | Out-Null
$outFile = Join-Path $outDir "night_gate_repo_scan.txt"

# Scan all text-like source files, exclude heavy folders
$exclude = @("\node_modules\", "\.next\", "\.git\", "\_patch_bak\", "\_diag_out_")
$includeExt = @("*.ts","*.tsx","*.js","*.jsx","*.json","*.sql","*.md","*.txt")

$files = Get-ChildItem -LiteralPath $root -Recurse -File -Include $includeExt |
  Where-Object {
    $p = $_.FullName
    foreach ($ex in $exclude) { if ($p -like "*$ex*") { return $false } }
    return $true
  } |
  Select-Object -ExpandProperty FullName

Write-Info ("Files scanned: " + $files.Count)

$patterns = @(
  "NIGHT_GATE",
  "UNVERIFIED",
  "BOOK_FAILED",
  "restricted from",
  "8PM",
  "5AM",
  "unless verified",
  "night",
  "gate",
  "passenger_verifications",
  "approved_admin",
  "approved_admin",
  "approved"
)

"== Patterns ==" | Out-File -LiteralPath $outFile -Encoding UTF8
($patterns -join "`r`n") | Out-File -LiteralPath $outFile -Append -Encoding UTF8
"" | Out-File -LiteralPath $outFile -Append -Encoding UTF8

foreach ($p in $patterns) {
  ("==== MATCHES for: " + $p + " ====") | Out-File -LiteralPath $outFile -Append -Encoding UTF8

  $hits = $files | Select-String -Pattern $p -SimpleMatch -ErrorAction SilentlyContinue
  if ($hits) {
    $hits | ForEach-Object {
      ($_.Path + ":" + $_.LineNumber + "  " + $_.Line.Trim()) | Out-File -LiteralPath $outFile -Append -Encoding UTF8
    }
  } else {
    "(none)" | Out-File -LiteralPath $outFile -Append -Encoding UTF8
  }
  "" | Out-File -LiteralPath $outFile -Append -Encoding UTF8
}

Write-Ok "[OK] Wrote: $outFile"