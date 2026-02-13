# PATCH-DRIVERS-LIVE-ADD-PH-TIME.ps1
# Adds location_updated_at_ph (Asia/Manila) to drivers-live response while keeping UTC field.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }

$target = "app\api\dispatch\drivers-live\route.ts"
if (!(Test-Path $target)) { Fail "Missing $target (run from repo root)" }

$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
Copy-Item $target "$target.bak.$stamp" -Force
Write-Host "[OK] Backup: $target.bak.$stamp"

$txt = Get-Content $target -Raw

# Insert helper function near the top: fmtPH
if ($txt -notmatch "function\s+fmtPH") {
  $insert = @'
function fmtPH(iso: string | null): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;

  // Format in Asia/Manila (UTC+8). This is for display only.
  return new Date(t).toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

'@

  # Put it after exports or after imports
  if ($txt -match "(export\s+const\s+revalidate\s*=\s*0;\s*\r?\n)") {
    $txt = $txt -replace "(export\s+const\s+revalidate\s*=\s*0;\s*\r?\n)", "`$1`r`n$insert"
  } else {
    # fallback: after last import
    $txt = $txt -replace "(\r?\n\r?\n)", "`$1$insert", 1
  }
  Write-Host "[OK] Inserted fmtPH helper."
}

# Add location_updated_at_ph into response object for each driver
# Find the drivers[id] assignment block and inject an extra field.
if ($txt -notmatch "location_updated_at_ph") {
  $txt = $txt -replace "location_updated_at,\s*\r?\n(\s*_src:)",
"location_updated_at,`r`n      location_updated_at_ph: fmtPH(location_updated_at),`r`n      `$1"
  Write-Host "[OK] Added location_updated_at_ph to payload."
} else {
  Write-Host "[INFO] location_updated_at_ph already present."
}

Set-Content -LiteralPath $target -Value $txt -Encoding UTF8
Write-Host "[OK] Patched: $target"

Write-Host ""
Write-Host "[STEP] npm.cmd run build"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) { Fail "Build failed. Not committing." }

Write-Host ""
Write-Host "[STEP] git add -A"
& git add -A

Write-Host "[STEP] git commit"
& git commit -m "JRIDE_DISPATCH show PH time (location_updated_at_ph) in drivers-live"

$tag = "JRIDE_DISPATCH_PH_TIME_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Write-Host "[STEP] git tag $tag"
& git tag $tag

Write-Host ""
Write-Host "[DONE] Commit + tag created:"
Write-Host "  $tag"
Write-Host ""
Write-Host "Next push:"
Write-Host "  git push"
Write-Host "  git push --tags"
