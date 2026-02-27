param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info($m){ Write-Host $m -ForegroundColor Cyan }
function Write-Ok($m){ Write-Host $m -ForegroundColor Green }

Write-Info "== JRIDE Scan: Night Gate + Verified Source (V1 / PS5-safe) =="

$root = (Resolve-Path -LiteralPath $ProjRoot).Path

$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
$outDir = Join-Path $root ("_diag_out_" + $stamp)
New-Item -ItemType Directory -Path $outDir | Out-Null

$outFile = Join-Path $outDir "night_gate_scan.txt"

# Collect candidate source files
$files = Get-ChildItem -LiteralPath (Join-Path $root "app") -Recurse -File -Include *.ts,*.tsx,*.js,*.jsx | `
  Select-Object -ExpandProperty FullName

Write-Info ("Files scanned: " + $files.Count)

$patterns = @(
  "NIGHT_GATE",
  "NIGHT-GATE",
  "night gate",
  "UNVERIFIED",
  "BOOK_FAILED",
  "verified",
  "isVerified",
  "passenger_verifications",
  "passenger_verification_requests",
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
Write-Info "Next: open the file and copy/paste the sections that mention NIGHT_GATE / BOOK_FAILED / passenger_verifications / isVerified."