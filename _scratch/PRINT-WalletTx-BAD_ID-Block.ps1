# PRINT-WalletTx-BAD_ID-Block.ps1
$ErrorActionPreference="Stop"
function Fail($m){ throw $m }

$rel  = "app\api\admin\wallet\transactions\route.ts"
$path = Join-Path (Get-Location).Path $rel
if (!(Test-Path $path)) { Fail "Missing file: $rel (run from repo root)" }

$lines = Get-Content -Path $path
$match = $lines | Select-String -Pattern 'Missing/invalid id \(uuid\)' -List
if (-not $match) { Fail "Could not find 'Missing/invalid id (uuid)' in $rel" }

$idx = $match.LineNumber
$start = [Math]::Max(1, $idx - 80)
$end   = [Math]::Min($lines.Count, $idx + 80)

"--- $rel lines $start..$end ---"
for ($i = $start; $i -le $end; $i++) {
  "{0,4}: {1}" -f $i, $lines[$i-1]
}
