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

# Replace the entire bestDriverId() function (it is currently wrong and returns status)
$rx = '(?s)function\s+bestDriverId\s*\(\s*row\s*:\s*any\s*\)\s*:\s*string\s*\|\s*null\s*\{.*?\n\}\s*\n'
if ($txt -notmatch $rx) {
  Fail "Could not find bestDriverId(row:any): string | null { ... } block to patch."
}

$replacement = @'
function bestDriverId(row: any): string | null {
  if (!row) return null;

  // Prefer explicit driver id fields (schema-flex)
  const candidates = [
    row.driver_id,
    row.driverId,
    row.driver_uuid,
    row.driverUuid,
    row.uuid,
    row.id,
    row.user_id,
    row.userId,
  ];

  // First pass: return first UUID-looking value
  for (const c of candidates) {
    const s = str(c).trim();
    if (!s) continue;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) {
      return s;
    }
  }

  // Fallback: any non-empty string
  for (const c of candidates) {
    const s = str(c).trim();
    if (s) return s;
  }

  return null;
}
'@

# Do exactly one replacement
$txt2 = [regex]::Replace($txt, $rx, $replacement + "`r`n", 1)
Set-Content -LiteralPath $FILE -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched bestDriverId(): now returns driver UUID/id fields (not status)."

# Build
Write-Host ""
Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Not committing." }

# Commit + tag
Write-Host ""
Write-Host "[STEP] git add -A"
& git add -A

$msg = "JRIDE_PHASE4_5 drivers-live: fix bestDriverId (use driver_id/id/uuid, not status)"
Write-Host "[STEP] git commit -m `"$msg`""
& git commit -m $msg

$tag = "JRIDE_PHASE4_5_FIX_BESTDRIVERID_" + (Get-Date -Format "yyyyMMdd_HHmmss")
Write-Host "[STEP] git tag $tag"
& git tag $tag

Write-Host ""
Write-Host "[DONE] Commit + tag created:"
Write-Host "  $tag"
Write-Host ""
Write-Host "Next push:"
Write-Host "  git push"
Write-Host "  git push --tags"
