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

# Replace the entire bestUpdatedAt() function (currently wrong)
$rx = '(?s)function\s+bestUpdatedAt\s*\(\s*row\s*:\s*any\s*\)\s*:\s*string\s*\|\s*null\s*\{.*?\n\}'
if ($txt -notmatch $rx) {
  Fail "Could not find bestUpdatedAt(row:any): string | null { ... } block to patch."
}

$replacement = @'
function bestUpdatedAt(row: any): string | null {
  if (!row) return null;

  // Prefer real timestamp fields (schema-flex)
  const candidates = [
    row.location_updated_at,
    row.locationUpdatedAt,
    row.updated_at,
    row.updatedAt,
    row.last_location_at,
    row.lastLocationAt,
    row.last_seen_at,
    row.lastSeenAt,
    row.seen_at,
    row.seenAt,
    row.pinged_at,
    row.pingedAt,
    row.ts,
    row.timestamp,
    row.created_at,
    row.createdAt,
  ];

  for (const c of candidates) {
    const iso = toIsoOrNull(c);
    if (iso) return iso;
  }
  return null;
}
'@

$txt2 = [regex]::Replace($txt, $rx, $replacement, 1)
Set-Content -LiteralPath $FILE -Value $txt2 -Encoding UTF8
Write-Host "[OK] Patched bestUpdatedAt(): now reads timestamp fields."

# Build
Write-Host ""
Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Not committing." }

# Commit + tag
Write-Host ""
Write-Host "[STEP] git add -A"
& git add -A

$msg = "JRIDE_PHASE4_6 drivers-live: fix bestUpdatedAt (timestamp fields, schema-flex)"
Write-Host "[STEP] git commit -m `"$msg`""
& git commit -m $msg

$tag = "JRIDE_PHASE4_6_FIX_BESTUPDATEDAT_" + (Get-Date -Format "yyyyMMdd_HHmmss")
Write-Host "[STEP] git tag $tag"
& git tag $tag

Write-Host ""
Write-Host "[DONE] Commit + tag created:"
Write-Host "  $tag"
Write-Host ""
Write-Host "Next push:"
Write-Host "  git push"
Write-Host "  git push --tags"
