param(
  [Parameter(Mandatory=$true)]
  [string]$ProjRoot
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = "Stop"

Write-Host "== FIX JRIDE: Deduplicate __jrideUnauthDiag blocks in dispatch/status (V1 / PS5-safe) =="

$target = Join-Path $ProjRoot "app\api\dispatch\status\route.ts"
if (!(Test-Path -LiteralPath $target)) { throw "Target not found: $target" }

# Backup
$bakDir = Join-Path $ProjRoot "_patch_bak"
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = Join-Path $bakDir ("route.ts.bak.UNAUTH_DIAG_DEDUPE_V1.$ts")
Copy-Item -LiteralPath $target -Destination $bak -Force
Write-Host "[OK] Backup: $bak"

$txt = Get-Content -LiteralPath $target -Raw

# This matches one full diag block, then the same block again immediately after it (dup),
# and replaces the pair with a single block.
$pattern = '(?s)(\n\s*//\s*JRIDE_UNAUTH_DIAG_V1[\s\S]*?\n\s*const\s+__jrideUnauthDiag\s*=\s*\{[\s\S]*?\n\s*\};\s*)(\n\s*//\s*JRIDE_UNAUTH_DIAG_V1[\s\S]*?\n\s*const\s+__jrideUnauthDiag\s*=\s*\{[\s\S]*?\n\s*\};\s*)'
$re = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

$before = $txt
$count = 0

while ($re.IsMatch($txt)) {
  $txt = $re.Replace($txt, '$1', 1)
  $count++
  if ($count -gt 20) { throw "Too many dedupe iterations (unexpected). Aborting." }
}

if ($txt -eq $before) {
  Write-Host "[WARN] No duplicate diag blocks found to remove. Nothing changed."
} else {
  Write-Host "[OK] Removed duplicate __jrideUnauthDiag blocks: $count occurrence(s)."
  Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
  Write-Host "[OK] Wrote: $target"
}

Write-Host "Done."