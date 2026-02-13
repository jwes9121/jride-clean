param(
  [string]$OutZip = ".\UPLOAD_JRIDE_API_DEBUG.zip"
)

$ErrorActionPreference = "Stop"

function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red; throw $m }

$items = @(
  ".\app\api\public\passenger",
  ".\app\api\public\auth",
  ".\app\api\driver",
  ".\app\api\dispatch",
  ".\utils\supabase",
  ".\app\ride\track",
  ".\app\api\passenger\track"
)

$existing = @()
foreach ($p in $items) {
  if (Test-Path -LiteralPath $p) { $existing += $p }
  else { Warn "[SKIP] Missing: $p" }
}

if ($existing.Count -eq 0) { Fail "[FAIL] None of the paths exist. Run from repo root." }

Compress-Archive -Force -DestinationPath $OutZip -Path $existing
Ok ("[OK] Wrote: {0}" -f (Resolve-Path $OutZip).Path)
