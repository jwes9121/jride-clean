$ErrorActionPreference = "Stop"

Write-Host "== FIX JRIDE ADMIN DRIVER LOCATIONS TIME PARSE V1 =="

$file = "app/api/admin/driver_locations/route.ts"

if (!(Test-Path $file)) {
  throw "File not found: $file"
}

$content = Get-Content $file -Raw

# Backup
$bak = "$file.bak.TIME_PARSE_FIX_V1.$(Get-Date -Format yyyyMMdd_HHmmss)"
Copy-Item $file $bak
Write-Host "[OK] Backup created: $bak"

# Replace unsafe ageSecondsFromIso with safe UTC parsing
$old = @"
function ageSecondsFromIso(input: string | null | undefined) {
  if (!input) return null;
  const ms = Date.now() - new Date(input).getTime();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor(ms / 1000));
}
"@

$new = @"
function ageSecondsFromIso(input: string | null | undefined) {
  if (!input) return null;

  const parsed = Date.parse(input); // strict ISO parsing

  if (!Number.isFinite(parsed)) return null;

  const now = Date.now();

  const ms = now - parsed;

  return Math.max(0, Math.floor(ms / 1000));
}
"@

if ($content -notmatch "Date\.parse") {
  $content = $content.Replace($old, $new)
  Write-Host "[OK] Replaced ageSecondsFromIso with strict parser"
} else {
  Write-Host "[SKIP] Already patched"
}

Set-Content $file $content -Encoding UTF8

Write-Host "[OK] Patch applied successfully"