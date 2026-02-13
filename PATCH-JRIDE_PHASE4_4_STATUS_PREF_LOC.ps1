param()

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$FILE = "app/api/dispatch/drivers-live/route.ts"
if (!(Test-Path $FILE)) { Fail "File not found: $FILE (run from repo root)" }

# Backup
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$bak = "$FILE.bak.$ts"
Copy-Item $FILE $bak -Force
Write-Host "[OK] Backup created: $bak"

$txt = Get-Content $FILE -Raw

# (1) Patch bestStatus candidates order: prefer realtime 'status' FIRST
$rxCandidates = '(?m)^\s*const\s+candidates\s*=\s*\[[^\]]*\]\s*;\s*$'
if ($txt -notmatch $rxCandidates) {
  Fail "Could not find 'const candidates = [...]' line in bestStatus() to patch."
}

# Replace the FIRST candidates line found (should be inside bestStatus)
$replacementCandidates = '  const candidates = [row.status, row.state, row.availability, row.driver_status, row.driverStatus, row.live_status, row.online_status];'
$txt = [regex]::Replace($txt, $rxCandidates, $replacementCandidates, 1)

Write-Host "[OK] Patched bestStatus(): prefer row.status/state/availability before driver_status."

# (2) Prefer loc over wal when computing driver_status
$rxPickOrder = '(?m)^\s*const\s+driver_status\s*=\s*bestStatus\(wal\)\s*\?\?\s*bestStatus\(loc\)\s*\?\?\s*null\s*;\s*$'
if ($txt -notmatch $rxPickOrder) {
  Fail "Could not find 'const driver_status = bestStatus(wal) ?? bestStatus(loc) ?? null;' to patch."
}

$txt = [regex]::Replace(
  $txt,
  $rxPickOrder,
  '      const driver_status = bestStatus(loc) ?? bestStatus(wal) ?? null;',
  1
)

Write-Host "[OK] Patched driver_status pick order: loc first, wal fallback."

Set-Content -LiteralPath $FILE -Value $txt -Encoding UTF8
Write-Host "[OK] Patched file: $FILE"

# Build
Write-Host ""
Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Not committing." }

# Commit + tag
Write-Host ""
Write-Host "[STEP] git add -A"
& git add -A

$msg = "JRIDE_PHASE4_4 drivers-live: prefer loc.status over drivers/wallet status"
Write-Host "[STEP] git commit -m `"$msg`""
& git commit -m $msg

$tag = "JRIDE_PHASE4_4_STATUS_LOC_FIRST_" + (Get-Date -Format "yyyyMMdd_HHmmss")
Write-Host "[STEP] git tag $tag"
& git tag $tag

Write-Host ""
Write-Host "[DONE] Commit + tag created:"
Write-Host "  $tag"
Write-Host ""
Write-Host "Next push:"
Write-Host "  git push"
Write-Host "  git push --tags"
