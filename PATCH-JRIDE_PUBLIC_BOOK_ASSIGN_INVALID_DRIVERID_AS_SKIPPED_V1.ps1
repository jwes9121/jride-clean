# PATCH-JRIDE_PUBLIC_BOOK_ASSIGN_INVALID_DRIVERID_AS_SKIPPED_V1.ps1
# PS5-safe: In app/api/public/passenger/book/route.ts, when the dispatch assign call returns
# { ok:false, code:"INVALID_DRIVER_ID" }, convert it into { ok:true, skipped:true, reason:"no_driver_id" }.
# Applies to both PHASE2D blocks found in your file.

$ErrorActionPreference = 'Stop'
function Ok($m){ Write-Host $m -ForegroundColor Green }
function Warn($m){ Write-Host $m -ForegroundColor Yellow }
function Fail($m){ Write-Host $m -ForegroundColor Red }

$repo   = (Get-Location).Path
$target = Join-Path $repo 'app\api\public\passenger\book\route.ts'
if (!(Test-Path -LiteralPath $target)) { Fail "[FAIL] Target not found: $target"; exit 1 }

$src = Get-Content -LiteralPath $target -Raw
if ([string]::IsNullOrWhiteSpace($src)) { Fail "[FAIL] Empty file: $target"; exit 1 }

# Backup
$bakDir = Join-Path $repo '_patch_bak'
New-Item -ItemType Directory -Force -Path $bakDir | Out-Null
$ts  = Get-Date -Format 'yyyyMMdd_HHmmss'
$bak = Join-Path $bakDir ("route.ts.bak.{0}" -f $ts)
Copy-Item -LiteralPath $target -Destination $bak -Force
Ok ("[OK] Backup: {0}" -f $bak)

# We patch the exact sequence:
# const j = await resp.json().catch(() => ({}));
# assign = j;
#
# into:
# const j = await resp.json().catch(() => ({}));
# if (j && j.code === "INVALID_DRIVER_ID") {
#   assign = { ok: true, skipped: true, reason: "no_driver_id" };
# } else {
#   assign = j;
# }

$pattern = @'
const j = await resp\.json\(\)\.catch\(\(\) => \(\{\}\)\)\;
\s*assign = j\;
'@

$replacement = @'
const j = await resp.json().catch(() => ({}));
if (j && (j as any).code === "INVALID_DRIVER_ID") {
  assign = { ok: true, skipped: true, reason: "no_driver_id" };
} else {
  assign = j;
}
'@

$rx = New-Object System.Text.RegularExpressions.Regex($pattern, [System.Text.RegularExpressions.RegexOptions]::Singleline)

$matches = $rx.Matches($src).Count
if ($matches -lt 1) {
  Fail "[FAIL] Could not find the assign=json pattern to patch."
  Fail "       Expected: const j = await resp.json().catch(() => ({})); assign = j;"
  exit 1
}

# Replace ALL occurrences (you have 2 blocks)
$src2 = $rx.Replace($src, $replacement)
if ($src2 -eq $src) { Fail "[FAIL] Replace produced no changes (unexpected)."; exit 1 }

$src = $src2
Ok ("[OK] Patched occurrences: {0}" -f $matches)

Set-Content -LiteralPath $target -Value $src -Encoding UTF8
Ok ("[OK] Wrote: {0}" -f $target)
Ok "[OK] Done."
